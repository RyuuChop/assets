import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type PieceKey =
  | 'w-p' | 'w-r' | 'w-n' | 'w-b' | 'w-q' | 'w-k'
  | 'b-p' | 'b-r' | 'b-n' | 'b-b' | 'b-q' | 'b-k';

export interface PieceTemplateMap {
  [key: string]: THREE.Group;
}

export interface ModelSetOption {
  id: string;
  name: string;
  source: string;
  description: string;
}

export const AVAILABLE_MODEL_SETS: ModelSetOption[] = [
  {
    id: 'chessboard-glb',
    name: 'Royal Heritage (Chessboard.glb)',
    source: '/Chessboard.glb',
    description: 'Classic obsidian chrome & cream set strictly themed with high-detail craftsmanship.',
  },
  {
    id: 'chess-glb',
    name: 'Tournament Steel (chess.glb)',
    source: '/chess.glb',
    description: 'Tournament pieces supporting luxury Metallic Prestige & Gemstone Glass shaders.',
  },
  {
    id: 'chess-model-glb',
    name: 'Sculpted Artifacts (chess model.glb)',
    source: '/chess model.glb',
    description: 'Artisanal geometric sculptures supporting luxury Metallic Prestige & Gemstone Glass shaders.',
  },
  {
    id: 'individual-assets',
    name: 'Direct Repo Assets (/assets/models/*.glb)',
    source: '/assets/models/',
    description: 'Independent piece models resolved from repository public asset paths.',
  },
];

export type MaterialTheme = 'default-obsidian' | 'metallic-prestige' | 'gemstone-glass';

export interface MaterialThemeOption {
  id: MaterialTheme;
  name: string;
  tag: string;
  description: string;
  whiteLabel: string;
  blackLabel: string;
  previewColors: [string, string];
}

export const MATERIAL_THEMES: MaterialThemeOption[] = [
  {
    id: 'default-obsidian',
    name: 'Obsidian & Cream (Default)',
    tag: 'Strictly for Default Set',
    description: 'Polished alabaster cream (#f0f0f0) vs dark obsidian metallic chrome (#1a1a1a).',
    whiteLabel: 'Polished Cream (#f0f0f0)',
    blackLabel: 'Dark Obsidian (#1a1a1a)',
    previewColors: ['#f0f0f0', '#1a1a1a'],
  },
  {
    id: 'metallic-prestige',
    name: 'Metallic Prestige (Option A)',
    tag: 'Theme Option A',
    description: 'Rich Metallic Bronze / Champagne Gold (#d4af37) vs Deep Metallic Charcoal / Obsidian (#222222).',
    whiteLabel: 'Metallic Bronze / Champagne Gold (metalness: 0.9, roughness: 0.15)',
    blackLabel: 'Deep Metallic Charcoal / Obsidian (metalness: 0.8, roughness: 0.2)',
    previewColors: ['#d4af37', '#222222'],
  },
  {
    id: 'gemstone-glass',
    name: 'Gemstone Glass (Option B)',
    tag: 'Theme Option B',
    description: 'Frosted Jade Pearl glass vs Deep Emerald dark sapphire glass with light transmission.',
    whiteLabel: 'Frosted Jade Pearl (transmission: 0.8, roughness: 0.1)',
    blackLabel: 'Deep Emerald Glass (transmission: 0.8, roughness: 0.1)',
    previewColors: ['#e2f1ec', '#073228'],
  },
];

/**
 * Creates distinct programmatic materials for White vs Black pieces according to the active theme preset:
 * - Default: Polished cream (#f0f0f0, roughness: 0.2, metalness: 0.1) vs Dark obsidian (#1a1a1a, roughness: 0.15, metalness: 0.8)
 * - Option A (Metallic Prestige): Rich Metallic Bronze / Champagne Gold (#d4af37, metalness: 0.9, roughness: 0.15) vs Deep Metallic Charcoal / Obsidian (#222222, metalness: 0.8, roughness: 0.2)
 * - Option B (Gemstone Glass): Frosted Jade Pearl vs Deep Emerald Glass (transmission: 0.8, roughness: 0.1, ior: 1.52)
 * All materials enforce THREE.DoubleSide to prevent flipped normals, gaps, or transparent culling glitches.
 */
export function createPieceMaterial(color: 'w' | 'b', theme: MaterialTheme = 'default-obsidian'): THREE.Material {
  const isWhite = color === 'w';

  if (theme === 'gemstone-glass') {
    return new THREE.MeshPhysicalMaterial({
      color: isWhite ? 0xe2f1ec : 0x073228,
      roughness: 0.1,
      metalness: 0.05,
      transmission: 0.8,
      ior: 1.52,
      thickness: 1.2,
      transparent: true,
      opacity: 0.92,
      attenuationColor: isWhite ? new THREE.Color(0xffffff) : new THREE.Color(0x0a4d3f),
      attenuationDistance: 1.5,
      side: THREE.DoubleSide,
    });
  }

  if (theme === 'metallic-prestige') {
    return new THREE.MeshStandardMaterial({
      color: isWhite ? '#d4af37' : '#222222',
      roughness: isWhite ? 0.15 : 0.2,
      metalness: isWhite ? 0.9 : 0.8,
      side: THREE.DoubleSide,
    });
  }

  // Default clean obsidian / cream (strictly for default model set)
  return new THREE.MeshStandardMaterial({
    color: isWhite ? '#f0f0f0' : '#1a1a1a',
    roughness: isWhite ? 0.2 : 0.15,
    metalness: isWhite ? 0.1 : 0.8,
    side: THREE.DoubleSide,
  });
}

/**
 * Model-specific Knight Y-axis rotation offset:
 * In raw GLB exports, knights are positioned facing sideways or backward.
 * This offset ensures White Knights face directly forward (-Z, toward Black),
 * and Black Knights face 180 degrees opposite (+Z, toward White).
 */
export function getKnightOffset(modelSetId: string): number {
  switch (modelSetId) {
    case 'chess-glb':
      return Math.PI / 2; // +90 deg aligns snout from +X to -Z
    case 'chess-model-glb':
      return Math.PI + 0.575; // aligns angled snout from ~-33 deg to -Z
    case 'chessboard-glb':
    case 'individual-assets':
    default:
      return Math.PI; // 180 deg aligns snout from +Z to -Z
  }
}

/**
 * Dynamic Per-Model Re-Centering, Normalization & Shading:
 * 1. Bakes parent world-matrix transforms into child geometries.
 * 2. Applies dynamic THREE.Box3().setFromObject(clonedScene) normalization pass.
 * 3. Locks bottom-most point flush to Y = 0 (tile surface) and centers at (0, 0).
 * 4. Recalculates horizontal scaling so bases never overflow 1.6 tile dimensions (max horizontal footprint <= 1.12).
 * 5. Applies distinct programmatic material shaders per theme preset.
 * 6. Explicit Knight facing correction & Black piece 180-degree facing.
 */
export function autoScaleAndAlignModel(
  sourceObject: THREE.Object3D,
  pieceType: string,
  pieceColor: 'w' | 'b',
  squareSize: number = 1.6,
  theme: MaterialTheme = 'default-obsidian',
  modelSetId: string = 'chessboard-glb'
): THREE.Group {
  sourceObject.updateWorldMatrix(true, true);

  const pieceGroup = new THREE.Group();
  pieceGroup.name = `template-${pieceColor}-${pieceType}`;

  // Step 1: Distinct programmatic material per color & theme preset
  const pieceMat = createPieceMaterial(pieceColor, theme);

  // Extract all child meshes, clone geometry and bake the world matrix
  sourceObject.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      if (!srcMesh.geometry) return;

      const bakedGeom = srcMesh.geometry.clone();
      bakedGeom.applyMatrix4(srcMesh.matrixWorld);
      bakedGeom.computeVertexNormals();

      const mat = pieceMat.clone();
      mat.side = THREE.DoubleSide;

      const mesh = new THREE.Mesh(bakedGeom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pieceGroup.add(mesh);
    }
  });

  // Step 2: Dynamic Bounding Box calculation
  pieceGroup.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(pieceGroup);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Step 3: Force bottom-most point locked precisely at Y = 0 and center at (0, 0)
  pieceGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.translate(-center.x, -box.min.y, -center.z);
    }
  });

  // Step 4: Proportional target heights and horizontal bounds relative to tile size
  const targetHeights: Record<string, number> = {
    p: squareSize * 0.95, // ~1.52
    r: squareSize * 1.10, // ~1.76
    n: squareSize * 1.18, // ~1.88
    b: squareSize * 1.25, // ~2.00
    q: squareSize * 1.38, // ~2.20
    k: squareSize * 1.50, // ~2.40
  };

  const targetHeight = targetHeights[pieceType] || squareSize * 1.2;
  const maxHorizontalAllowed = squareSize * 0.70; // 70% of 1.6 tile width = 1.12 units

  const rawHorizontal = Math.max(0.0001, size.x, size.z);
  const rawHeight = Math.max(0.0001, size.y);

  // Recalculate horizontal scaling so piece bases never overflow 1.6 tile dimensions
  const scaleHorizontal = maxHorizontalAllowed / rawHorizontal;
  const scaleHeight = targetHeight / rawHeight;
  const finalScale = Math.min(scaleHorizontal, scaleHeight);

  pieceGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.scale(finalScale, finalScale, finalScale);
      mesh.geometry.computeVertexNormals();
    }
  });

  // Step 5: Post-scale fine alignment pass to guarantee base flush to Y = 0 and (0, 0) center
  pieceGroup.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(pieceGroup);
  const finalCenter = new THREE.Vector3();
  finalBox.getCenter(finalCenter);

  if (Math.abs(finalBox.min.y) > 0.0001 || Math.abs(finalCenter.x) > 0.0001 || Math.abs(finalCenter.z) > 0.0001) {
    pieceGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.translate(-finalCenter.x, -finalBox.min.y, -finalCenter.z);
      }
    });
  }

  // Step 6: Specific Knight Fix & Black Piece 180-degree Facing:
  const isKnight = pieceType.toLowerCase() === 'n';
  const knightOffset = isKnight ? getKnightOffset(modelSetId) : 0;
  const baseRotation = pieceColor === 'b' ? Math.PI : 0;

  // White Knight: base 0 + knightOffset -> faces directly forward toward Black (-Z)
  // Black Knight: base Math.PI + knightOffset -> 180 degrees opposite, facing forward toward White (+Z)
  pieceGroup.rotation.set(0, baseRotation + knightOffset, 0);

  pieceGroup.updateMatrixWorld(true);
  return pieceGroup;
}

/**
 * Loads piece templates from Chessboard.glb
 */
async function loadChessboardGlb(
  loader: GLTFLoader,
  squareSize: number,
  theme: MaterialTheme = 'default-obsidian'
): Promise<Map<string, THREE.Group>> {
  const pathsToTry = ['/Chessboard.glb', '/assets/models/Chessboard.glb', '/public/Chessboard.glb'];
  let gltf: GLTF | null = null;
  let lastErr: any = null;

  for (const path of pathsToTry) {
    try {
      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
      });
      if (gltf) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!gltf) {
    throw lastErr || new Error('Could not load Chessboard.glb from repository paths');
  }

  gltf.scene.updateWorldMatrix(true, true);
  const templates = new Map<string, THREE.Group>();

  // Canonical piece mesh sources from repository GLB
  const canonicalPieces: { type: string; nodeName: string }[] = [
    { type: 'k', nodeName: 'Light_King' },
    { type: 'q', nodeName: 'Light_Queen' },
    { type: 'b', nodeName: 'Light_Bishop_1' },
    { type: 'n', nodeName: 'Light_Knight_1' },
    { type: 'r', nodeName: 'Light_Rock_1' },
    { type: 'p', nodeName: 'Light_Pawn_1' },
  ];

  // Default set strictly uses 'default-obsidian'
  const setMatTheme: MaterialTheme = 'default-obsidian';

  canonicalPieces.forEach(({ type, nodeName }) => {
    const obj = gltf.scene.getObjectByName(nodeName);
    if (obj) {
      // White pieces: facing forward toward Black with cream material
      templates.set(`w-${type}`, autoScaleAndAlignModel(obj, type, 'w', squareSize, setMatTheme, 'chessboard-glb'));
      // Black pieces: facing 180 degrees opposite toward White with dark obsidian material
      templates.set(`b-${type}`, autoScaleAndAlignModel(obj, type, 'b', squareSize, setMatTheme, 'chessboard-glb'));
    }
  });

  return templates;
}

/**
 * Loads piece templates from chess.glb
 */
async function loadChessGlb(
  loader: GLTFLoader,
  squareSize: number,
  theme: MaterialTheme = 'metallic-prestige'
): Promise<Map<string, THREE.Group>> {
  const pathsToTry = ['/chess.glb', '/assets/models/chess.glb', '/public/chess.glb'];
  let gltf: GLTF | null = null;
  let lastErr: any = null;

  for (const path of pathsToTry) {
    try {
      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
      });
      if (gltf) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!gltf) {
    throw lastErr || new Error('Could not load chess.glb from repository paths');
  }

  gltf.scene.updateWorldMatrix(true, true);
  const templates = new Map<string, THREE.Group>();

  const canonicalPieces: { type: string; nodeName: string }[] = [
    { type: 'k', nodeName: 'King' },
    { type: 'q', nodeName: 'Queen' },
    { type: 'r', nodeName: 'Roof' },
    { type: 'b', nodeName: 'Bishop' },
    { type: 'n', nodeName: 'Knight' },
    { type: 'p', nodeName: 'Pawn' },
  ];

  canonicalPieces.forEach(({ type, nodeName }) => {
    const obj = gltf.scene.getObjectByName(nodeName);
    if (obj) {
      // White pieces with premium shader preset
      templates.set(`w-${type}`, autoScaleAndAlignModel(obj, type, 'w', squareSize, theme, 'chess-glb'));
      // Black pieces rotated 180 degrees with premium shader preset
      templates.set(`b-${type}`, autoScaleAndAlignModel(obj, type, 'b', squareSize, theme, 'chess-glb'));
    }
  });

  return templates;
}

/**
 * Loads piece templates from chess model.glb
 */
async function loadChessModelGlb(
  loader: GLTFLoader,
  squareSize: number,
  theme: MaterialTheme = 'gemstone-glass'
): Promise<Map<string, THREE.Group>> {
  const pathsToTry = ['/chess model.glb', '/chess_model.glb', '/assets/models/chess model.glb', '/public/chess model.glb'];
  let gltf: GLTF | null = null;
  let lastErr: any = null;

  for (const path of pathsToTry) {
    try {
      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
      });
      if (gltf) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!gltf) {
    throw lastErr || new Error('Could not load chess model.glb from repository paths');
  }

  gltf.scene.updateWorldMatrix(true, true);
  const templates = new Map<string, THREE.Group>();

  const canonicalPieces: { type: string; nodeName: string }[] = [
    { type: 'k', nodeName: 'king' },
    { type: 'q', nodeName: 'queen' },
    { type: 'b', nodeName: 'Cylinder000' },
    { type: 'n', nodeName: 'mesh_6' },
    { type: 'r', nodeName: 'Cylinder010' },
    { type: 'p', nodeName: 'pawn_1' },
  ];

  canonicalPieces.forEach(({ type, nodeName }) => {
    const obj = gltf.scene.getObjectByName(nodeName);
    if (obj) {
      templates.set(`w-${type}`, autoScaleAndAlignModel(obj, type, 'w', squareSize, theme, 'chess-model-glb'));
      templates.set(`b-${type}`, autoScaleAndAlignModel(obj, type, 'b', squareSize, theme, 'chess-model-glb'));
    }
  });

  return templates;
}

/**
 * Loads individual piece GLBs from /assets/models/*.glb
 */
async function loadIndividualAssets(
  loader: GLTFLoader,
  squareSize: number,
  theme: MaterialTheme = 'metallic-prestige'
): Promise<Map<string, THREE.Group>> {
  const templates = new Map<string, THREE.Group>();
  const pieces = [
    { type: 'p', name: 'pawn' },
    { type: 'r', name: 'rook' },
    { type: 'n', name: 'knight' },
    { type: 'b', name: 'bishop' },
    { type: 'q', name: 'queen' },
    { type: 'k', name: 'king' },
  ];

  for (const p of pieces) {
    const paths = [
      `/assets/models/${p.name}.glb`,
      `/assets/models/${p.name}_white.glb`,
      `/models/${p.name}.glb`,
    ];
    let pieceObj: THREE.Object3D | null = null;
    for (const path of paths) {
      try {
        const gltf = await new Promise<GLTF>((res, rej) => loader.load(path, res, undefined, rej));
        pieceObj = gltf.scene;
        break;
      } catch {
        // continue
      }
    }

    if (pieceObj) {
      pieceObj.updateWorldMatrix(true, true);
      templates.set(`w-${p.type}`, autoScaleAndAlignModel(pieceObj, p.type, 'w', squareSize, theme, 'individual-assets'));
      templates.set(`b-${p.type}`, autoScaleAndAlignModel(pieceObj, p.type, 'b', squareSize, theme, 'individual-assets'));
    }
  }

  return templates;
}

/**
 * Loads custom board mesh from board 2.glb
 */
export async function loadCustomBoardModel(loader: GLTFLoader): Promise<THREE.Group | null> {
  const pathsToTry = ['/board 2.glb', '/board_2.glb', '/assets/models/board 2.glb', '/public/board 2.glb'];
  for (const path of pathsToTry) {
    try {
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
      });
      if (gltf && gltf.scene) {
        const board = gltf.scene.clone();
        board.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(board);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const targetWidth = 14.5;
        const maxRaw = Math.max(size.x, size.z);
        const scale = targetWidth / maxRaw;
        board.scale.setScalar(scale);
        board.position.set(-center.x * scale, -box.max.y * scale + 0.38, -center.z * scale);
        board.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.receiveShadow = true;
          }
        });
        return board;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Master repository loader:
 * Dynamically detects repository models and returns full piece templates.
 * Enforces clean obsidian/cream for default set, and applies luxury Metallic Prestige / Gemstone Glass
 * presets for secondary repository sets.
 */
export async function loadRepositoryChessModels(
  setId: string = 'chessboard-glb',
  squareSize: number = 1.6,
  theme: MaterialTheme = 'default-obsidian'
): Promise<{ templates: Map<string, THREE.Group>; activeSetId: string; source: string }> {
  const loader = new GLTFLoader();

  // Primary loader based on requested setId
  const loaders: { id: string; fn: () => Promise<Map<string, THREE.Group>>; source: string }[] = [
    {
      id: 'chessboard-glb',
      fn: () => loadChessboardGlb(loader, squareSize, 'default-obsidian'), // strictly obsidian/cream
      source: '/Chessboard.glb',
    },
    {
      id: 'chess-glb',
      fn: () => loadChessGlb(loader, squareSize, theme === 'default-obsidian' ? 'metallic-prestige' : theme),
      source: '/chess.glb',
    },
    {
      id: 'chess-model-glb',
      fn: () => loadChessModelGlb(loader, squareSize, theme === 'default-obsidian' ? 'gemstone-glass' : theme),
      source: '/chess model.glb',
    },
    {
      id: 'individual-assets',
      fn: () => loadIndividualAssets(loader, squareSize, theme === 'default-obsidian' ? 'metallic-prestige' : theme),
      source: '/assets/models/*.glb',
    },
  ];

  // Reorder so requested setId is first
  const ordered = [
    ...loaders.filter((l) => l.id === setId),
    ...loaders.filter((l) => l.id !== setId),
  ];

  let errors: any[] = [];
  for (const candidate of ordered) {
    try {
      console.log(`[3D Chess Studio]: Loading repository models from ${candidate.source}...`);
      const templates = await candidate.fn();
      if (templates && templates.size >= 6) {
        ensureFullSetCoverage(templates, squareSize, candidate.id === 'chessboard-glb' ? 'default-obsidian' : theme, candidate.id);
        console.log(`[3D Chess Studio]: Successfully loaded ${templates.size} repository 3D piece models from ${candidate.source}!`);
        return { templates, activeSetId: candidate.id, source: candidate.source };
      }
    } catch (err) {
      console.warn(`[3D Chess Studio]: Failed loading from ${candidate.source}, trying alternative repository model:`, err);
      errors.push({ source: candidate.source, err });
    }
  }

  throw new Error(`All repository GLB models failed to load: ${errors.map((e) => e.source).join(', ')}`);
}

/**
 * Ensures all 12 pieces are present, preserving Knight facing offsets and distinct material shaders.
 */
function ensureFullSetCoverage(
  templates: Map<string, THREE.Group>,
  squareSize: number,
  theme: MaterialTheme = 'default-obsidian',
  modelSetId: string = 'chessboard-glb'
) {
  const pieceTypes = ['p', 'r', 'n', 'b', 'q', 'k'];
  const darkMat = createPieceMaterial('b', theme);
  const lightMat = createPieceMaterial('w', theme);

  pieceTypes.forEach((t) => {
    const whiteKey = `w-${t}`;
    const blackKey = `b-${t}`;
    const isKnight = t === 'n';
    const knightOffset = isKnight ? getKnightOffset(modelSetId) : 0;

    if (templates.has(whiteKey) && !templates.has(blackKey)) {
      const cloned = templates.get(whiteKey)!.clone(true);
      // Black faces forward to white (base Math.PI + knight offset)
      cloned.rotation.set(0, Math.PI + knightOffset, 0);
      cloned.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const mesh = c as THREE.Mesh;
          const mat = darkMat.clone();
          mat.side = THREE.DoubleSide;
          mesh.material = mat;
          if (mesh.geometry) {
            mesh.geometry.computeVertexNormals();
          }
        }
      });
      templates.set(blackKey, cloned);
    } else if (templates.has(blackKey) && !templates.has(whiteKey)) {
      const cloned = templates.get(blackKey)!.clone(true);
      // White faces forward to black (base 0 + knight offset)
      cloned.rotation.set(0, knightOffset, 0);
      cloned.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const mesh = c as THREE.Mesh;
          const mat = lightMat.clone();
          mat.side = THREE.DoubleSide;
          mesh.material = mat;
          if (mesh.geometry) {
            mesh.geometry.computeVertexNormals();
          }
        }
      });
      templates.set(whiteKey, cloned);
    }
  });
}
