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
      knightYawOffset: Math.PI / 2,
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
        knightYawOffset: Math.PI / 2,
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
        knightYawOffset: Math.PI / 2,
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
      overrides: {
        upAxis: 'y',
        knightYawOffset: 0,
        scaleMultiplier: 1.0,
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

export function extractPieceNode(
  rawScene: THREE.Object3D,
  type: string
): THREE.Object3D {
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

  // Fallback: return rawScene
  return rawScene;
}
