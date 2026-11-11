/// <reference types="vite/client" />
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { ModelOverrides } from '../config/themes';

/* =========================================================================
   CANONICAL PIECE IDENTIFICATION & ALIAS MATCHER
   Matches filenames and named node meshes case-insensitively with common aliases:
   - pawn
   - rook / castle / roof / tower
   - knight / horse / kn base / kn_base
   - bishop
   - queen
   - king
   ========================================================================= */

export const DEFAULT_PIECE_FILES: Record<string, string> = {
  p: 'pawn.glb',
  r: 'rook.glb',
  n: 'knight.glb',
  b: 'bishop.glb',
  q: 'queen.glb',
  k: 'king.glb',
};

export function matchPieceType(name: string): 'p' | 'r' | 'n' | 'b' | 'q' | 'k' | null {
  const lower = name.toLowerCase().replace(/[_\-\.]/g, ' ');

  // Queen
  if (lower.includes('queen')) return 'q';
  // King
  if (lower.includes('king')) return 'k';
  // Knight / Horse / Kn Base
  if (
    lower.includes('knight') ||
    lower.includes('horse') ||
    lower.includes(' kn ') ||
    lower.startsWith('kn ') ||
    lower.startsWith('kn')
  ) {
    return 'n';
  }
  // Bishop
  if (lower.includes('bishop')) return 'b';
  // Rook / Castle / Roof / Tower
  if (
    lower.includes('rook') ||
    lower.includes('castle') ||
    lower.includes('roof') ||
    lower.includes('tower')
  ) {
    return 'r';
  }
  // Pawn
  if (lower.includes('pawn')) return 'p';

  return null;
}

export interface DiscoveredModelSet {
  id: string;
  name: string;
  folder: string;
  description: string;
  pieceCount: number;
  files: Partial<Record<'p' | 'r' | 'n' | 'b' | 'q' | 'k', string>>;
  isSingleFile?: boolean;
  singleFilePath?: string;
  overrides?: ModelOverrides;
  approxTriangles: number;
  /** Optional explicit node names (as authored in the GLB) per piece type, for single-file sets
   *  whose meshes are not named after the piece (e.g. "Cylinder.010"). */
  nodeNames?: Partial<Record<'p' | 'r' | 'n' | 'b' | 'q' | 'k', string>>;
  /** When true, the extracted piece keeps its full world transform (parent + own rotation/scale),
   *  baked into the geometry, so it stands upright exactly as it does in the source file. */
  bakeWorldTransform?: boolean;
  /** Piece types this set does not contain; those are borrowed from the Default set. */
  fallbackToDefaultTypes?: Array<'p' | 'r' | 'n' | 'b' | 'q' | 'k'>;
  /** Very detailed set: not preloaded at startup, only loaded when selected. */
  heavy?: boolean;
}

/* =========================================================================
   AUTOMATIC MODEL SET DISCOVERY (Vite import.meta.glob)
   Discovers all sub-folders and .glb files in the models directory,
   public assets, and standalone monolithic single-file GLBs.
   ========================================================================= */

// Discover all GLB files across project models folders
const rawGlbModules: Record<string, string> = (import.meta as any).glob(
  [
    '/models/**/*.glb',
    '/public/models/**/*.glb',
    '/public/assets/models/**/*.glb',
    '/public/*.glb',
  ],
  { query: '?url', import: 'default', eager: true }
);

function formatSetTitle(folderName: string): string {
  const cleaned = folderName.replace(/^.*[\\\/]/, '').replace(/[-_]/g, ' ').trim();
  if (!cleaned || cleaned.toLowerCase() === 'models') return 'Sculpted Standard';
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function cleanWebUrl(rawPath: string): string {
  if (rawPath.startsWith('/public/')) {
    return rawPath.slice(7);
  }
  return rawPath;
}

function discoverAllModelSets(): DiscoveredModelSet[] {
  const folderBuckets: Record<string, Partial<Record<'p' | 'r' | 'n' | 'b' | 'q' | 'k', string>>> = {};
  const singleFiles: { name: string; url: string }[] = [];

  for (const [rawKey, importedUrl] of Object.entries(rawGlbModules)) {
    const webPath = typeof importedUrl === 'string' ? importedUrl : cleanWebUrl(rawKey);
    const filename = rawKey.split('/').pop() || '';
    const dir = rawKey.substring(0, rawKey.lastIndexOf('/'));
    const cleanDir = cleanWebUrl(dir);

    // Filter out boards / scenery files
    if (
      filename.toLowerCase().includes('board') ||
      filename.toLowerCase().includes('chessboard')
    ) {
      continue;
    }

    const matchedPiece = matchPieceType(filename);
    if (matchedPiece) {
      if (!folderBuckets[cleanDir]) {
        folderBuckets[cleanDir] = {};
      }
      folderBuckets[cleanDir][matchedPiece] = webPath;
    } else if (filename.endsWith('.glb')) {
      // Standalone single-file chess model containing all pieces
      singleFiles.push({ name: filename, url: webPath });
    }
  }

  const registeredSets: DiscoveredModelSet[] = [];

  // 1. Primary Default Championship Set (/assets/models)
  const defaultFiles = folderBuckets['/assets/models'] || {};
  registeredSets.push({
    id: 'default',
    name: 'Championship Default',
    folder: '/assets/models',
    description: 'Championship tournament pieces with balanced weighting & ivory styling.',
    pieceCount: Object.keys(defaultFiles).length || 6,
    files: defaultFiles,
    overrides: {
      upAxis: 'y',
      // Measured: this model's muzzle points +Z, so PI makes White face -Z (toward Black).
      knightYawOffset: Math.PI,
      scaleMultiplier: 1.0,
    },
    approxTriangles: 12500,
  });

  // 2. Add each discovered folder in /models
  for (const [folderPath, pieceMap] of Object.entries(folderBuckets)) {
    if (folderPath === '/assets/models') continue; // already added above

    const pieceCount = Object.keys(pieceMap).length;
    if (pieceCount === 0) continue;

    const folderSlug = folderPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '');
    const isClassic = folderPath.includes('classic');
    const isTournament = folderPath.includes('tournament');

    // NOTE: Sets with monolithic geometries (e.g. Tournament Steel and Models Root) contain
    // ~253,814 triangles per un-isolated raw mesh, which exceeds 80k triangles per piece.
    // The engine extracts isolated piece meshes (reducing triangles to ~6k-10k per piece)
    // and caches normalized templates to maintain 60 FPS performance.
    const approxTriangles = isClassic ? 14200 : 253814;

    // "New Chess": the user's own sculpt, converted from STL with tools/stl-to-glb.mjs.
    // Files: public/models/new-chess/{pawn,rook,knight,bishop,queen,king}.glb (already Y-up, base at y=0).
    if (folderPath === '/models/new-chess') {
      registeredSets.push({
        id: 'new-chess',
        name: 'New Chess',
        folder: folderPath,
        description: `Custom sculpted set (${pieceCount}/6 pieces mapped).`,
        pieceCount,
        files: pieceMap,
        overrides: {
          upAxis: 'y',
          // The converter cannot know which way the horse faces. If the knights look sideways or
          // backwards, use "Knight facing" in the Studio panel (or change this value: 0, PI/2, PI, -PI/2).
          knightYawOffset: 0,
          scaleMultiplier: 1.0,
        },
        approxTriangles: 20000,
      });
      continue;
    }

    registeredSets.push({
      id: folderSlug || 'models-root',
      name: isClassic
        ? 'Carved Classic'
        : isTournament
        ? 'Tournament Steel'
        : formatSetTitle(folderPath),
      folder: folderPath,
      description: `Discovered model set from ${folderPath} (${pieceCount}/6 pieces mapped).`,
      pieceCount,
      files: pieceMap,
      overrides: {
        upAxis: isClassic ? 'y' : 'z',
        // Carved Classic: muzzle points +Z -> PI. Sculpted/Tournament: muzzle points +X -> PI/2.
        knightYawOffset: isClassic ? Math.PI : Math.PI / 2,
        scaleMultiplier: 1.0,
      },
      approxTriangles,
    });
  }

  // 3. Add standalone single-file sets (e.g. chess.glb, chess model.glb)
  const monolithicChess = singleFiles.find((f) => f.name.toLowerCase() === 'chess.glb');
  if (monolithicChess) {
    registeredSets.push({
      id: 'monolithic-chess',
      name: 'Monolithic Grandmaster',
      folder: monolithicChess.url,
      description: 'Full tournament set extracted dynamically from single monolithic GLB.',
      pieceCount: 6,
      files: {},
      isSingleFile: true,
      singleFilePath: monolithicChess.url,
      overrides: {
        upAxis: 'z',
        // Measured: muzzle points +Z after the up-axis fix, so PI makes White face -Z.
        knightYawOffset: Math.PI,
        scaleMultiplier: 1.0,
      },
      approxTriangles: 48000,
    });
  }

  const geometricStudio = singleFiles.find((f) => f.name.toLowerCase().includes('chess model'));
  if (geometricStudio) {
    registeredSets.push({
      id: 'geometric-studio',
      name: 'Geometric Studio',
      folder: geometricStudio.url,
      description: 'Sculpted geometric chess set from single studio GLB.',
      pieceCount: 6,
      files: {},
      isSingleFile: true,
      singleFilePath: geometricStudio.url,
      // Node names verified by rendering each mesh's cross-section (the file names are misleading):
      // Cylinder.010 = rook (crenellated top), Cylinder.000 = bishop (mitre), 'kn base.002' = knight.
      nodeNames: {
        p: 'pawn 1',
        r: 'Cylinder.010',
        n: 'kn base.002',
        b: 'Cylinder.000',
        q: 'queen',
        k: 'king',
      },
      bakeWorldTransform: true,
      overrides: {
        upAxis: 'y', // world transform is baked in, so the piece is already Y-up
        // Measured snout direction of the baked knight is ~22deg off +Z; this yaw makes white
        // knights face -Z (toward Black) and black knights (+PI) face +Z. Tweak if needed.
        knightYawOffset: Math.PI + 0.39,
        scaleMultiplier: 1.0,
        // The knight's long head makes its bounding box wide, so it was scaled down to ~1.77 tall
        // (rook 1.94, bishop 2.63). 1.25x brings it to ~2.2, between rook and bishop.
        footprintScale: { n: 1.25 },
      },
      approxTriangles: 18000,
    });
  }

  // Report approximate triangle counts once in console
  console.info(
    '[3D Chess Model Registry] Discovered Model Sets & Triangle Counts:',
    registeredSets.map(
      (s) =>
        `${s.name} (${s.pieceCount}/6 pieces): ~${s.approxTriangles.toLocaleString()} tris`
    )
  );

  return registeredSets;
}

export const DISCOVERED_MODEL_SETS: DiscoveredModelSet[] = discoverAllModelSets();

/** Old set ids that were byte-for-byte duplicates of another set and no longer exist. Saved
 *  settings and themes that still use them are mapped to the set that has the same models. */
export const MODEL_SET_ALIASES: Record<string, string> = {
  models: 'monolithic-chess', // "Sculpted Standard"
  'models-tournament': 'monolithic-chess', // "Tournament Steel"
  'models-classic': 'default', // "Carved Classic"
  'royal-heritage': 'default', // Chessboard.glb pieces are identical to the Default set
};

export function findModelSet(id: string | undefined | null): DiscoveredModelSet {
  const wanted = (id && MODEL_SET_ALIASES[id]) || id;
  return (
    DISCOVERED_MODEL_SETS.find((s) => s.id === wanted) ||
    DISCOVERED_MODEL_SETS[0]
  );
}

/* =========================================================================
   PIECE PATH RESOLVER WITH ROBUST FALLBACK
   Resolves piece model paths with fallback to Default set so it never crashes
   ========================================================================= */

export function resolvePieceModelPath(
  modelSet: DiscoveredModelSet,
  type: string
): string {
  if (modelSet.isSingleFile && modelSet.singleFilePath) {
    return modelSet.singleFilePath;
  }

  if (modelSet.files && modelSet.files[type as keyof typeof modelSet.files]) {
    const filename = modelSet.files[type as keyof typeof modelSet.files]!;
    return filename.startsWith('/') ? filename : `${modelSet.folder}/${filename}`;
  }

  const standardName = DEFAULT_PIECE_FILES[type] || `${type}.glb`;
  return `${modelSet.folder}/${standardName}`;
}

export function resolveFallbackPieceModelPath(type: string): string {
  const standardName = DEFAULT_PIECE_FILES[type] || 'pawn.glb';
  return `/assets/models/${standardName}`;
}

/* =========================================================================
   EXTRACT PIECE NODE FROM MULTI-MESH OR SINGLE-FILE SCENE
   Extracts only the isolated mesh/group matching pieceType, avoiding
   excess geometry duplication from unseparated Blender files.
   ========================================================================= */

export interface ExtractPieceOptions {
  nodeNames?: DiscoveredModelSet['nodeNames'];
  bakeWorldTransform?: boolean;
}

/** Returns a Group holding the piece's meshes with their full world transform (relative to
 *  rawScene) baked into cloned geometry. Original scene geometry is never mutated. */
function bakePieceWorldTransform(rawScene: THREE.Object3D, node: THREE.Object3D): THREE.Group {
  rawScene.updateWorldMatrix(true, true);
  const sceneInv = new THREE.Matrix4().copy(rawScene.matrixWorld).invert();
  const out = new THREE.Group();
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sceneInv, mesh.matrixWorld));
    const baked = new THREE.Mesh(geom, mesh.material);
    baked.name = mesh.name;
    out.add(baked);
  });
  return out;
}

export function extractPieceNode(
  rawScene: THREE.Object3D,
  type: string,
  options?: ExtractPieceOptions
): THREE.Object3D {
  // 0. Explicit node-name mapping for sets whose meshes aren't named after the piece.
  //    GLTFLoader sanitizes node names (spaces -> '_', dots removed), so compare sanitized.
  const wantedName = options?.nodeNames?.[type as 'p' | 'r' | 'n' | 'b' | 'q' | 'k'];
  if (wantedName) {
    const wanted = THREE.PropertyBinding.sanitizeNodeName(wantedName);
    const explicit = rawScene.getObjectByName(wanted);
    if (explicit) {
      if (options?.bakeWorldTransform) {
        const baked = bakePieceWorldTransform(rawScene, explicit);
        if (baked.children.length > 0) return baked;
      } else {
        const clone = SkeletonUtils.clone(explicit);
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        return clone;
      }
    }
    console.warn(`[modelRegistry] Node "${wantedName}" for piece "${type}" not found; falling back to name matching.`);
  }

  let matchedNode: THREE.Object3D | null = null;

  // 1. Direct name match on child meshes
  rawScene.traverse((child) => {
    if (matchedNode) return;
    if (child === rawScene) return;
    const pieceType = matchPieceType(child.name);
    if (pieceType === type && (child as THREE.Mesh).isMesh) {
      matchedNode = child;
    }
  });

  // 2. Direct name match on any named group or object
  if (!matchedNode) {
    rawScene.traverse((child) => {
      if (matchedNode) return;
      if (child === rawScene) return;
      const pieceType = matchPieceType(child.name);
      if (pieceType === type) {
        matchedNode = child;
      }
    });
  }

  // 3. If an isolated matching piece node was found, clone just that node
  if (matchedNode) {
    const clone = SkeletonUtils.clone(matchedNode);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    return clone;
  }

  // Fallback: return rawScene (this shows the WHOLE set in one square; add a nodeNames entry
  // for the set if you see this warning).
  console.warn(`[modelRegistry] No node found for piece "${type}"; using the whole scene.`);
  return rawScene;
}
