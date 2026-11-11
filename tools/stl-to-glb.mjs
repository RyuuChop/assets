#!/usr/bin/env node
/**
 * stl-to-glb.mjs  -  turn heavy chess-piece STL files into light, game-ready GLB files.
 *
 * Why: STL files are raw triangle soup (50 bytes per triangle). A 69 MB knight is ~1.4 million
 * triangles; the board shows 32 pieces, so the STLs cannot be used directly. This tool
 *   1. reads binary or ASCII STL,
 *   2. welds duplicate vertices,
 *   3. detects which axis is "up" (and whether the piece is upside down) and rotates it Y-up,
 *   4. simplifies the mesh to --tris triangles (quadric error metrics, keeps the shape),
 *   5. recomputes smooth normals, puts the base on y = 0, and writes a GLB.
 *
 * No npm packages needed, just Node 18+.
 *
 * Usage:
 *   node tools/stl-to-glb.mjs "<folder with STL files>" [output folder] [options]
 *
 * Options:
 *   --tris 20000     target triangle count per piece (default 20000; pawns get 60% of it)
 *   --up auto|x|y|z  which STL axis points up (default auto: the tallest axis)
 *   --no-flip-check  do not try to detect an upside-down piece
 *   --only knight    convert only files whose name contains this word
 *
 * Input file names only need to CONTAIN the piece name (any case), e.g. "Knight V1.stl".
 * Output: pawn.glb rook.glb knight.glb bishop.glb queen.glb king.glb
 * Default output folder: public/models/new-chess (relative to the project root).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ args */
const VALUE_OPTIONS = new Set(['--tris', '--up', '--only']);
const positional = [];
const options = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTIONS.has(a)) options[a] = argv[++i];
    else if (a.startsWith('--')) options[a] = true;
    else positional.push(a);
  }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = positional[0];
const outDir = positional[1] || path.resolve(here, '..', 'public', 'models', 'new-chess');
const TARGET_TRIS = parseInt(options['--tris'] || '20000', 10);
const UP = String(options['--up'] || 'auto').toLowerCase();
const FLIP_CHECK = !options['--no-flip-check'];
const ONLY = String(options['--only'] || '').toLowerCase();

if (!inputDir || options['--help']) {
  console.log(`Usage: node tools/stl-to-glb.mjs "<folder with STL files>" [output folder] [options]

Options:
  --tris 20000     target triangles per piece (default 20000; pawns get less, knights more)
  --up auto|x|y|z  which STL axis points up (default auto = the tallest axis)
  --no-flip-check  do not try to detect an upside-down piece
  --only knight    convert only files whose name contains this word

Default output folder: public/models/new-chess`);
  process.exit(options['--help'] || inputDir ? 0 : 1);
}

const PIECES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
// relative detail: a pawn does not need as many triangles as a knight
const DETAIL = { pawn: 0.6, rook: 0.8, knight: 1.3, bishop: 0.9, queen: 1.1, king: 1.1 };

/* ------------------------------------------------------------- STL read */
function readSTL(file) {
  const buf = fs.readFileSync(file);
  // Binary STL: 80 byte header, uint32 count, 50 bytes per triangle. ASCII files also start with
  // "solid", so trust the size check rather than the header text.
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      const soup = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12; // skip the facet normal
        for (let k = 0; k < 9; k++) soup[t * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return soup;
    }
  }
  const text = buf.toString('utf8');
  const nums = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  if (nums.length === 0 || nums.length % 9 !== 0) throw new Error('not a valid STL file: ' + file);
  return Float32Array.from(nums);
}

/* ------------------------------------------------------------ weld soup */
// triangle soup -> indexed mesh (shared vertices), merging vertices closer than eps
function weld(soup, eps) {
  const nCorners = soup.length / 3;
  const cap = 1 << Math.ceil(Math.log2(nCorners * 2 + 16));
  const table = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(nCorners), qy = new Int32Array(nCorners), qz = new Int32Array(nCorners);
  const pos = [];
  const idx = new Uint32Array(nCorners);
  let nv = 0;
  const inv = 1 / eps;
  for (let c = 0; c < nCorners; c++) {
    const a = Math.round(soup[c * 3] * inv) | 0;
    const b = Math.round(soup[c * 3 + 1] * inv) | 0;
    const d = Math.round(soup[c * 3 + 2] * inv) | 0;
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(d, 83492791)) >>> 0;
    let slot = h & (cap - 1);
    for (;;) {
      const v = table[slot];
      if (v === -1) {
        table[slot] = nv;
        qx[nv] = a; qy[nv] = b; qz[nv] = d;
        pos.push(soup[c * 3], soup[c * 3 + 1], soup[c * 3 + 2]);
        idx[c] = nv++;
        break;
      }
      if (qx[v] === a && qy[v] === b && qz[v] === d) { idx[c] = v; break; }
      slot = (slot + 1) & (cap - 1);
    }
  }
  // drop degenerate triangles
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t], j = idx[t + 1], k = idx[t + 2];
    if (i !== j && j !== k && i !== k) keep.push(i, j, k);
  }
  return { pos: Float64Array.from(pos), faces: Int32Array.from(keep) };
}

/* ------------------------------------------------- vertex clustering (fast pre-reduction) */
function cluster(mesh, cellSize) {
  const { pos, faces } = mesh;
  const nv = pos.length / 3;
  const map = new Map();
  const remap = new Int32Array(nv);
  const sum = [], cnt = [];
  for (let v = 0; v < nv; v++) {
    const key = Math.floor(pos[v * 3] / cellSize) + ',' + Math.floor(pos[v * 3 + 1] / cellSize) + ',' + Math.floor(pos[v * 3 + 2] / cellSize);
    let id = map.get(key);
    if (id === undefined) { id = cnt.length; map.set(key, id); sum.push(0, 0, 0); cnt.push(0); }
    remap[v] = id;
    sum[id * 3] += pos[v * 3]; sum[id * 3 + 1] += pos[v * 3 + 1]; sum[id * 3 + 2] += pos[v * 3 + 2]; cnt[id]++;
  }
  const npos = new Float64Array(cnt.length * 3);
  for (let i = 0; i < cnt.length; i++) for (let k = 0; k < 3; k++) npos[i * 3 + k] = sum[i * 3 + k] / cnt[i];
  const seen = new Set();
  const nf = [];
  for (let t = 0; t < faces.length; t += 3) {
    const a = remap[faces[t]], b = remap[faces[t + 1]], c = remap[faces[t + 2]];
    if (a === b || b === c || a === c) continue;
    const m = Math.min(a, b, c), M = Math.max(a, b, c), mid = a + b + c - m - M;
    const key = m + ',' + mid + ',' + M; // same three vertices in any order = duplicate triangle
    if (seen.has(key)) continue;
    seen.add(key);
    nf.push(a, b, c);
  }
  return { pos: npos, faces: Int32Array.from(nf) };
}

/* ------------------------------------------------ quadric edge-collapse simplification */
function simplify(mesh, targetFaces) {
  const pos = Float64Array.from(mesh.pos);
  const faces = Int32Array.from(mesh.faces);
  const nv = pos.length / 3, nf = faces.length / 3;
  const faceAlive = new Uint8Array(nf).fill(1);
  let aliveFaces = nf;
  const vAlive = new Uint8Array(nv).fill(1);
  const ver = new Uint32Array(nv);
  const vFaces = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vFaces[faces[f * 3 + k]].push(f);
  const Q = new Float64Array(nv * 10);

  const faceNormalArea = (f, out) => {
    const a = faces[f * 3] * 3, b = faces[f * 3 + 1] * 3, c = faces[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx; // = 2*area*n
  };
  const tmp = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    faceNormalArea(f, tmp);
    const len = Math.hypot(tmp[0], tmp[1], tmp[2]);
    if (len < 1e-300) continue;
    const nx = tmp[0] / len, ny = tmp[1] / len, nz = tmp[2] / len, area = len / 2;
    const p0 = faces[f * 3] * 3;
    const d = -(nx * pos[p0] + ny * pos[p0 + 1] + nz * pos[p0 + 2]);
    const q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k] * 10;
      for (let j = 0; j < 10; j++) Q[v + j] += q[j] * area;
    }
  }
  const quadricError = (q, x, y, z) =>
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z + q[9];

  // binary min-heap of collapse candidates
  const heap = [];
  const hpush = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= heap[i].cost) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const hpop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const qsum = new Float64Array(10);
  const makeEdge = (u, v) => {
    for (let j = 0; j < 10; j++) qsum[j] = Q[u * 10 + j] + Q[v * 10 + j];
    const ux = pos[u * 3], uy = pos[u * 3 + 1], uz = pos[u * 3 + 2];
    const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
    const mx = (ux + vx) / 2, my = (uy + vy) / 2, mz = (uz + vz) / 2;
    const eu = quadricError(qsum, ux, uy, uz), ev = quadricError(qsum, vx, vy, vz), em = quadricError(qsum, mx, my, mz);
    let cost = em, x = mx, y = my, z = mz;
    if (eu <= cost) { cost = eu; x = ux; y = uy; z = uz; }
    if (ev < cost) { cost = ev; x = vx; y = vy; z = vz; }
    return { cost: Math.max(cost, 0), u, v, vu: ver[u], vv: ver[v], x, y, z };
  };

  const neighbours = (v) => {
    const set = new Set();
    const list = vFaces[v];
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!faceAlive[f]) continue;
      const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
      if (a !== v && b !== v && c !== v) continue;
      list[w++] = f;
      if (a !== v) set.add(a);
      if (b !== v) set.add(b);
      if (c !== v) set.add(c);
    }
    list.length = w;
    return set;
  };

  // initial edges
  {
    const seen = new Set();
    for (let f = 0; f < nf; f++) {
      for (let k = 0; k < 3; k++) {
        const a = faces[f * 3 + k], b = faces[f * 3 + ((k + 1) % 3)];
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const key = lo * nv + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        hpush(makeEdge(lo, hi));
      }
    }
  }

  const n1 = [0, 0, 0], n2 = [0, 0, 0];
  // would moving vertex `moved` to (x,y,z) flip or crush any of its faces (ignoring faces on the edge)?
  const movesOk = (moved, other, x, y, z) => {
    const list = vFaces[moved];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!faceAlive[f]) continue;
      const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
      if (a !== moved && b !== moved && c !== moved) continue;
      if (a === other || b === other || c === other) continue; // face disappears
      faceNormalArea(f, n1);
      const l1 = Math.hypot(n1[0], n1[1], n1[2]);
      const old = [pos[moved * 3], pos[moved * 3 + 1], pos[moved * 3 + 2]];
      pos[moved * 3] = x; pos[moved * 3 + 1] = y; pos[moved * 3 + 2] = z;
      faceNormalArea(f, n2);
      pos[moved * 3] = old[0]; pos[moved * 3 + 1] = old[1]; pos[moved * 3 + 2] = old[2];
      const l2 = Math.hypot(n2[0], n2[1], n2[2]);
      if (l2 < 1e-12 * (l1 + 1e-300)) return false; // collapses to a sliver
      if ((n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / (l1 * l2 + 1e-300) < 0.35) return false; // flips / folds
    }
    return true;
  };

  while (aliveFaces > targetFaces && heap.length) {
    const e = hpop();
    const { u, v } = e;
    if (!vAlive[u] || !vAlive[v] || ver[u] !== e.vu || ver[v] !== e.vv) continue;

    const nu = neighbours(u), nvv = neighbours(v);
    if (!nu.has(v)) continue;
    // link condition: the two vertices may only share the (one or two) vertices opposite their edge
    let shared = 0;
    for (const w of nu) if (nvv.has(w)) shared++;
    let edgeFaces = 0;
    for (const f of vFaces[u]) {
      if (!faceAlive[f]) continue;
      const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
      if ((a === v || b === v || c === v)) edgeFaces++;
    }
    if (shared !== edgeFaces) continue;
    if (!movesOk(u, v, e.x, e.y, e.z) || !movesOk(v, u, e.x, e.y, e.z)) continue;

    // collapse v into u
    pos[u * 3] = e.x; pos[u * 3 + 1] = e.y; pos[u * 3 + 2] = e.z;
    for (let j = 0; j < 10; j++) Q[u * 10 + j] += Q[v * 10 + j];
    vAlive[v] = 0;
    for (const f of vFaces[v]) {
      if (!faceAlive[f]) continue;
      let hasV = false, hasU = false;
      for (let k = 0; k < 3; k++) {
        if (faces[f * 3 + k] === v) hasV = true;
        if (faces[f * 3 + k] === u) hasU = true;
      }
      if (!hasV) continue;
      if (hasU) { faceAlive[f] = 0; aliveFaces--; continue; }
      for (let k = 0; k < 3; k++) if (faces[f * 3 + k] === v) faces[f * 3 + k] = u;
      vFaces[u].push(f);
    }
    vFaces[v] = [];
    ver[u]++;
    for (const w of neighbours(u)) hpush(makeEdge(Math.min(u, w), Math.max(u, w)));
  }

  // compact
  const remap = new Int32Array(nv).fill(-1);
  const npos = [];
  const nfaces = [];
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k];
      if (remap[v] < 0) { remap[v] = npos.length / 3; npos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      nfaces.push(remap[v]);
    }
  }
  return { pos: Float64Array.from(npos), faces: Int32Array.from(nfaces) };
}

/* ----------------------------------------------------------- orientation */
function bounds(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  return { mn, mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
function transform(pos, fn) {
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = fn(pos[i], pos[i + 1], pos[i + 2]);
    pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
  }
}
function orientYUp(pos, info) {
  let up = UP;
  const b = bounds(pos);
  if (up === 'auto') up = 'xyz'[b.size.indexOf(Math.max(...b.size))];
  info.up = up;
  // proper rotations only (no mirroring), so triangle winding stays correct
  if (up === 'z') transform(pos, (x, y, z) => [x, z, -y]);
  else if (up === 'x') transform(pos, (x, y, z) => [-y, x, z]);
  if (FLIP_CHECK) {
    const bb = bounds(pos);
    const h = bb.size[1];
    const footprint = (lo, hi) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        if (y < lo || y > hi) continue;
        x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
        z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
      }
      return Math.max(0, x1 - x0) * Math.max(0, z1 - z0);
    };
    const bottom = footprint(bb.mn[1], bb.mn[1] + h * 0.1);
    const top = footprint(bb.mx[1] - h * 0.1, bb.mx[1]);
    info.flipRatio = top / Math.max(bottom, 1e-12);
    if (info.flipRatio > 1.3) {
      transform(pos, (x, y, z) => [x, -y, -z]); // 180 degrees about X
      info.flipped = true;
    }
  }
}

/* --------------------------------------------------------------- GLB out */
function writeGLB(file, name, pos, faces) {
  const nv = pos.length / 3;
  const normals = new Float64Array(nv * 3);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t] * 3, b = faces[t + 1] * 3, c = faces[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
    for (const i of [a, b, c]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  const nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    nrm[i * 3] = normals[i * 3] / l; nrm[i * 3 + 1] = normals[i * 3 + 1] / l; nrm[i * 3 + 2] = normals[i * 3 + 2] / l;
  }
  const p32 = Float32Array.from(pos);
  const use16 = nv < 65536;
  const idx = use16 ? Uint16Array.from(faces) : Uint32Array.from(faces);
  const b = bounds(p32);

  const pad4 = (n) => (4 - (n % 4)) % 4;
  const parts = [Buffer.from(p32.buffer), Buffer.from(nrm.buffer), Buffer.from(idx.buffer)];
  const offsets = [];
  let total = 0;
  for (const p of parts) { offsets.push(total); total += p.length + pad4(p.length); }
  const bin = Buffer.alloc(total);
  parts.forEach((p, i) => p.copy(bin, offsets[i]));

  const json = {
    asset: { version: '2.0', generator: 'stl-to-glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Piece', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0.1, roughnessFactor: 0.55 }, doubleSided: true }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: b.mn, max: b.mx },
      { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
      { bufferView: 2, componentType: use16 ? 5123 : 5125, count: faces.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: parts[0].length, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: parts[1].length, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: parts[2].length, target: 34963 },
    ],
    buffers: [{ byteLength: total }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length), 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write('JSON', 4, 'ascii');
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4, 'ascii');
  fs.writeFileSync(file, Buffer.concat([header, jh, js, bh, bin]));
}

/* ------------------------------------------------------------------ main */
function pieceOf(fileName) {
  const n = fileName.toLowerCase();
  return PIECES.find((p) => n.includes(p)) || (n.includes('horse') ? 'knight' : n.includes('castle') ? 'rook' : null);
}

if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
  console.error('Folder not found: ' + inputDir + '\n(put the path in quotes if it contains spaces)');
  process.exit(1);
}
const files = fs.readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.stl'));
if (files.length === 0) { console.error('No .stl files found in: ' + inputDir); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

console.log(`Input : ${inputDir}\nOutput: ${outDir}\nTarget: ~${TARGET_TRIS} triangles per piece\n`);
let converted = 0;
for (const file of files) {
  const piece = pieceOf(file);
  if (!piece) { console.log(`- skipped "${file}" (name has no pawn/rook/knight/bishop/queen/king)`); continue; }
  if (ONLY && !file.toLowerCase().includes(ONLY)) continue;
  try {
  const t0 = Date.now();
  const soup = readSTL(path.join(inputDir, file));
  const nIn = soup.length / 9;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < soup.length; i++) { if (soup[i] < mn) mn = soup[i]; if (soup[i] > mx) mx = soup[i]; }
  // vertices closer than a millionth of the model size are the same vertex
  let mesh = weld(soup, Math.max(mx - mn, 1e-9) * 1e-6);
  const info = {};
  orientYUp(mesh.pos, info);

  const target = Math.round(TARGET_TRIS * DETAIL[piece]);
  const bb = bounds(mesh.pos);
  const extent = Math.max(...bb.size);
  // quick pre-reduction with a fine vertex grid so the quadric pass only sees a few hundred thousand faces
  let res = 420;
  while (mesh.faces.length / 3 > Math.max(target * 12, 150000) && res > 30) {
    mesh = cluster(mesh, extent / res);
    res = Math.floor(res * 0.75);
  }
  const before = mesh.faces.length / 3;
  mesh = simplify(mesh, target);

  // base on y = 0, centred on x/z
  const fb = bounds(mesh.pos);
  const cx = (fb.mn[0] + fb.mx[0]) / 2, cz = (fb.mn[2] + fb.mx[2]) / 2, y0 = fb.mn[1];
  transform(mesh.pos, (x, y, z) => [x - cx, y - y0, z - cz]);

  const out = path.join(outDir, piece + '.glb');
  writeGLB(out, piece[0].toUpperCase() + piece.slice(1), mesh.pos, mesh.faces);
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(
    `${piece.padEnd(7)} ${file}\n        ${nIn.toLocaleString()} tris -> ${(mesh.faces.length / 3).toLocaleString()} tris, ${kb} KB` +
      `  (up axis: ${info.up}${info.flipped ? ', was upside down -> flipped' : ''}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`
  );
  converted++;
  } catch (err) {
    console.log(`- FAILED "${file}": ${err.message}`);
  }
}
console.log(`\nDone: ${converted} piece(s) written to ${outDir}`);
const missing = PIECES.filter((p) => !fs.existsSync(path.join(outDir, p + '.glb')));
if (missing.length) console.log('Still missing: ' + missing.join(', '));
else console.log('All 6 pieces present. Start the game and pick "New Chess" in Theme & Board Studio.');
