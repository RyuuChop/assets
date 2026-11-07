import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  Suspense,
  Component,
  ErrorInfo,
  ReactNode,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment, ContactShadows, Text, AdaptiveDpr } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { Chess, Square } from 'chess.js';
import {
  RotateCcw,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Crown,
  Volume2,
  VolumeX,
  Swords,
  Bot,
  Shuffle,
  Trophy,
  Play,
  RotateCw,
  X,
  Palette,
  Sun,
  Moon,
  Sunrise,
  Check,
  Camera,
  Compass,
  Lock,
  Unlock,
  PlusCircle,
  Box,
  Layers,
} from 'lucide-react';
import { chessAudio } from './utils/chessAudio';
import { getAIMove } from './utils/chessEngine';
import {
  AppMode,
  AIDifficulty,
  PlayerColorChoice,
  GameOverState,
} from './types/chess';
import {
  THEMES,
  BOARD_PRESETS,
  ENVIRONMENT_PRESETS,
  ChessTheme,
  BoardStyleConfig,
  EnvironmentPresetKey,
  ModelOverrides,
  buildPieceMaterial,
  DISCOVERED_MODEL_SETS,
  DiscoveredModelSet,
  resolvePieceModelPath,
  resolveFallbackPieceModelPath,
  DEFAULT_PIECE_FILES,
} from './config/themes';
import { extractPieceNode } from './utils/modelRegistry';

/* =========================================================================
   1. CONSTANTS & GEOMETRY
   ========================================================================= */

const SQUARE = 1.6;
const TILE_THICKNESS = 0.22;
const TILE_SURFACE_Y = TILE_THICKNESS / 2; // 0.11
const FOOTPRINT = 0.7;

const TYPE_FOOTPRINT: Record<string, number> = {
  p: 0.75,
  r: 0.9,
  n: 0.95,
  b: 0.9,
  q: 1.0,
  k: 1.0,
};

/* =========================================================================
   2. TEMPLATE NORMALIZATION CACHE (BUILT ONCE PER MODEL SET & PIECE TYPE)
   ========================================================================= */

const templateCache = new Map<string, THREE.Group>();
const detectedSetUpAxis = new Map<string, 'y' | 'z' | 'x'>();

export function getNormalizedTemplate(
  setId: string,
  type: string,
  rawScene: THREE.Object3D,
  overrides?: ModelOverrides,
  pawnScene?: THREE.Object3D,
  isSingleFile?: boolean
): THREE.Group {
  const cacheKey = `${setId}:${type}`;
  const existing = templateCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  // 1. Isolate the specific piece mesh/node if single-file or multi-mesh scene
  const targetNode = isSingleFile || rawScene.children.length > 3
    ? extractPieceNode(rawScene, type)
    : rawScene;

  // 2. Determine orientation (up-axis)
  let upAxis: 'y' | 'z' | 'x' = overrides?.upAxis || detectedSetUpAxis.get(setId) || 'y';
  if (!overrides?.upAxis && !detectedSetUpAxis.has(setId)) {
    const probeTarget = pawnScene ? extractPieceNode(pawnScene, 'p') : targetNode;
    const probe = SkeletonUtils.clone(probeTarget);
    probe.updateMatrixWorld(true);
    const probeBox = new THREE.Box3().setFromObject(probe);
    const probeSize = new THREE.Vector3();
    probeBox.getSize(probeSize);

    if (probeSize.z > probeSize.y && probeSize.z > probeSize.x) {
      upAxis = 'z';
    } else if (probeSize.x > probeSize.y && probeSize.x > probeSize.z) {
      upAxis = 'x';
    } else {
      upAxis = 'y';
    }
    detectedSetUpAxis.set(setId, upAxis);
  }

  const root = SkeletonUtils.clone(targetNode) as THREE.Group;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.geometry && !mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals();
      }
    }
  });

  // 3. Up-axis rotation correction BEFORE scaling
  if (upAxis === 'z' || overrides?.flipUp) {
    root.rotation.x = -Math.PI / 2;
  } else if (upAxis === 'x') {
    root.rotation.z = Math.PI / 2;
  }
  root.updateMatrixWorld(true);

  // 4. Scale to 70% of tile
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxHorizontal = Math.max(0.001, size.x, size.z);
  const scaleMult = overrides?.scaleMultiplier ?? 1.0;
  const targetFootprint = SQUARE * FOOTPRINT * (TYPE_FOOTPRINT[type] || 1.0) * scaleMult;
  const scale = targetFootprint / maxHorizontal;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // 5. Center X/Z and place base flush at Y = 0
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.set(-center.x, -box.min.y, -center.z);
  root.updateMatrixWorld(true);

  const pivot = new THREE.Group();
  pivot.name = `template-${setId}-${type}`;
  pivot.add(root);

  templateCache.set(cacheKey, pivot);
  return pivot;
}

/* =========================================================================
   3. ANIMATION & COORDINATE UTILITIES
   ========================================================================= */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function squareToCoords(square: string): { x: number; z: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10);
  const x = (file - 3.5) * SQUARE;
  const z = (8 - rank - 3.5) * SQUARE;
  return { x, z };
}

/* =========================================================================
   4. LOCAL STORAGE PERSISTENCE
   ========================================================================= */

const STORAGE_KEY = 'grandmaster_3d_theme_settings_v4';

interface PersistedSettings {
  themeId: string;
  modelSetId: string;
  useOriginalMaterials: boolean;
  board: BoardStyleConfig;
  envPreset: EnvironmentPresetKey;
  showCoordinates: boolean;
  showLegalMarkers: boolean;
  showLastMoveHighlight: boolean;
  cameraMode: 'free' | 'locked';
  fov: number;
  zoomSpeed: number;
  flipBoardOnMove: boolean;
}

function loadPersistedSettings(): Partial<PersistedSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // best-effort
  }
}

/* =========================================================================
   5. ACTIVE PIECE MODEL DATA & RENDERING
   ========================================================================= */

export interface ActivePiece {
  id: string;
  square: string;
  type: string;
  color: 'w' | 'b';
  toX: number;
  toZ: number;
  fromX?: number;
  fromZ?: number;
  animating?: boolean;
  animStartTime?: number;
  animDuration?: number;
  arcHeight?: number;
  isFading?: boolean;
  fadeStartTime?: number;
  fadeDuration?: number;
}

interface PieceProps {
  piece: ActivePiece;
  template?: THREE.Group;
  whiteMaterial: THREE.Material;
  blackMaterial: THREE.Material;
  useOriginalMaterials: boolean;
  isSelected: boolean;
  overrides?: ModelOverrides;
  onPieceClick: (piece: ActivePiece, e: any) => void;
  onPointerEnter: (piece: ActivePiece) => void;
  onPointerLeave: () => void;
  onAnimationComplete: (id: string) => void;
  onFadeComplete: (id: string) => void;
}

const Piece = React.memo(function Piece({
  piece,
  template,
  whiteMaterial,
  blackMaterial,
  useOriginalMaterials,
  isSelected,
  overrides,
  onPieceClick,
  onPointerEnter,
  onPointerLeave,
  onAnimationComplete,
  onFadeComplete,
}: PieceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentLiftRef = useRef<number>(0);
  const themeBloomScaleRef = useRef<number>(0.92);

  const pieceObject = useMemo(() => {
    if (!template) return null;
    const clone = SkeletonUtils.clone(template) as THREE.Group;
    if (!useOriginalMaterials) {
      const mat = piece.color === 'w' ? whiteMaterial : blackMaterial;
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = mat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }
    return clone;
  }, [template, piece.color, whiteMaterial, blackMaterial, useOriginalMaterials]);

  const knightOffset = overrides?.knightYawOffset ?? Math.PI / 2;
  const baseYaw = overrides?.baseYaw ?? 0;
  const yaw = (piece.color === 'b' ? Math.PI : 0) + (piece.type === 'n' ? knightOffset : baseYaw);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const now = performance.now();
    const group = groupRef.current;

    // Smooth theme/model switch scale-in
    themeBloomScaleRef.current = THREE.MathUtils.damp(
      themeBloomScaleRef.current,
      1.0,
      14,
      delta
    );

    const targetLift = isSelected ? 0.35 : 0;
    currentLiftRef.current = THREE.MathUtils.damp(
      currentLiftRef.current,
      targetLift,
      16,
      delta
    );

    if (piece.animating && piece.fromX !== undefined && piece.fromZ !== undefined && piece.animStartTime) {
      const elapsed = now - piece.animStartTime;
      const duration = piece.animDuration || 520;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const t = easeInOutCubic(progress);

      const curX = THREE.MathUtils.lerp(piece.fromX, piece.toX, t);
      const curZ = THREE.MathUtils.lerp(piece.fromZ, piece.toZ, t);
      const arc = Math.sin(t * Math.PI) * (piece.arcHeight || 0.55);

      group.position.set(curX, TILE_SURFACE_Y + currentLiftRef.current + arc, curZ);
      group.scale.setScalar(themeBloomScaleRef.current);

      if (progress >= 1) {
        piece.animating = false;
        group.position.set(piece.toX, TILE_SURFACE_Y + currentLiftRef.current, piece.toZ);
        onAnimationComplete(piece.id);
      }
    } else if (piece.isFading && piece.fadeStartTime) {
      const elapsed = now - piece.fadeStartTime;
      const duration = piece.fadeDuration || 250;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const scale = Math.max(0.001, (1 - progress) * themeBloomScaleRef.current);

      group.scale.setScalar(scale);
      group.position.y = TILE_SURFACE_Y + progress * 0.25;

      if (progress >= 1) {
        onFadeComplete(piece.id);
      }
    } else {
      group.position.set(piece.toX, TILE_SURFACE_Y + currentLiftRef.current, piece.toZ);
      group.scale.setScalar(themeBloomScaleRef.current);
    }
  });

  if (!pieceObject) return null;

  return (
    <group
      ref={groupRef}
      position={[piece.toX, TILE_SURFACE_Y, piece.toZ]}
      onClick={(e) => {
        e.stopPropagation();
        onPieceClick(piece, e);
      }}
      onPointerEnter={(e) => {
        e.stopPropagation();
        onPointerEnter(piece);
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        onPointerLeave();
      }}
    >
      <group rotation={[0, yaw, 0]}>
        <primitive object={pieceObject} />
      </group>
    </group>
  );
});

/* =========================================================================
   6. PIECES LAYER (DYNAMIC MODEL SET & MATERIAL THEME COMBINER)
   ========================================================================= */

interface PiecesLayerProps {
  modelSet: DiscoveredModelSet;
  theme: ChessTheme;
  useOriginalMaterials: boolean;
  pieces: ActivePiece[];
  selectedSquare: string | null;
  onPieceClick: (piece: ActivePiece, e: any) => void;
  onPointerEnter: (piece: ActivePiece) => void;
  onPointerLeave: () => void;
  onAnimationComplete: (id: string) => void;
  onFadeComplete: (id: string) => void;
}

function PiecesLayer({
  modelSet,
  theme,
  useOriginalMaterials,
  pieces,
  selectedSquare,
  onPieceClick,
  onPointerEnter,
  onPointerLeave,
  onAnimationComplete,
  onFadeComplete,
}: PiecesLayerProps) {
  const pawnUrl = resolvePieceModelPath(modelSet, 'p');
  const rookUrl = resolvePieceModelPath(modelSet, 'r');
  const knightUrl = resolvePieceModelPath(modelSet, 'n');
  const bishopUrl = resolvePieceModelPath(modelSet, 'b');
  const queenUrl = resolvePieceModelPath(modelSet, 'q');
  const kingUrl = resolvePieceModelPath(modelSet, 'k');

  const pawnGLTF = useGLTF(pawnUrl);
  const rookGLTF = useGLTF(rookUrl);
  const knightGLTF = useGLTF(knightUrl);
  const bishopGLTF = useGLTF(bishopUrl);
  const queenGLTF = useGLTF(queenUrl);
  const kingGLTF = useGLTF(kingUrl);

  const fallbackPawnGLTF = useGLTF(resolveFallbackPieceModelPath('p'));
  const fallbackRookGLTF = useGLTF(resolveFallbackPieceModelPath('r'));
  const fallbackKnightGLTF = useGLTF(resolveFallbackPieceModelPath('n'));
  const fallbackBishopGLTF = useGLTF(resolveFallbackPieceModelPath('b'));
  const fallbackQueenGLTF = useGLTF(resolveFallbackPieceModelPath('q'));
  const fallbackKingGLTF = useGLTF(resolveFallbackPieceModelPath('k'));

  const templates = useMemo(() => {
    const rawScenes: Record<string, THREE.Object3D | undefined> = {
      p: pawnGLTF?.scene || fallbackPawnGLTF?.scene,
      r: rookGLTF?.scene || fallbackRookGLTF?.scene,
      n: knightGLTF?.scene || fallbackKnightGLTF?.scene,
      b: bishopGLTF?.scene || fallbackBishopGLTF?.scene,
      q: queenGLTF?.scene || fallbackQueenGLTF?.scene,
      k: kingGLTF?.scene || fallbackKingGLTF?.scene,
    };

    const pawnScene = rawScenes.p;
    const map: Record<string, THREE.Group> = {};

    for (const [type, rawScene] of Object.entries(rawScenes)) {
      if (rawScene && rawScene instanceof THREE.Object3D) {
        map[type] = getNormalizedTemplate(
          modelSet.id,
          type,
          rawScene,
          modelSet.overrides,
          pawnScene,
          modelSet.isSingleFile
        );
      }
    }
    return map;
  }, [
    modelSet,
    pawnGLTF,
    rookGLTF,
    knightGLTF,
    bishopGLTF,
    queenGLTF,
    kingGLTF,
    fallbackPawnGLTF,
    fallbackRookGLTF,
    fallbackKnightGLTF,
    fallbackBishopGLTF,
    fallbackQueenGLTF,
    fallbackKingGLTF,
  ]);

  // Shared materials for all pieces in this theme
  const { whiteMaterial, blackMaterial } = useMemo(() => {
    const wMat = buildPieceMaterial(theme.pieceMaterials.white);
    const bMat = buildPieceMaterial(theme.pieceMaterials.black);
    return { whiteMaterial: wMat, blackMaterial: bMat };
  }, [theme]);

  useEffect(() => {
    return () => {
      whiteMaterial.dispose();
      blackMaterial.dispose();
    };
  }, [whiteMaterial, blackMaterial]);

  return (
    <group>
      {pieces.map((piece) => (
        <Piece
          key={piece.id}
          piece={piece}
          template={templates[piece.type]}
          whiteMaterial={whiteMaterial}
          blackMaterial={blackMaterial}
          useOriginalMaterials={useOriginalMaterials}
          isSelected={selectedSquare === piece.square}
          overrides={modelSet.overrides}
          onPieceClick={onPieceClick}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onAnimationComplete={onAnimationComplete}
          onFadeComplete={onFadeComplete}
        />
      ))}
    </group>
  );
}

/* =========================================================================
   7. CUSTOMIZABLE CHESSBOARD (8x8 CHECKER GRID WITH MEMOIZED TILES)
   ========================================================================= */

interface BoardProps {
  boardConfig: BoardStyleConfig;
  showCoordinates: boolean;
  showLegalMarkers: boolean;
  showLastMoveHighlight: boolean;
  selectedSquare: string | null;
  hoveredSquare: string | null;
  lastMove: { from: string; to: string } | null;
  inCheckSquare: string | null;
  legalMoves: string[];
  captureMoves: string[];
  onTileClick: (square: string, e: any) => void;
  onTilePointerOver: (square: string) => void;
  onTilePointerOut: () => void;
}

const CustomizableChessBoard = React.memo(function CustomizableChessBoard({
  boardConfig,
  showCoordinates,
  showLegalMarkers,
  showLastMoveHighlight,
  selectedSquare,
  hoveredSquare,
  lastMove,
  inCheckSquare,
  legalMoves,
  captureMoves,
  onTileClick,
  onTilePointerOver,
  onTilePointerOut,
}: BoardProps) {
  const tileGeometry = useMemo(
    () => new THREE.BoxGeometry(SQUARE * 0.995, TILE_THICKNESS, SQUARE * 0.995),
    []
  );

  const materials = useMemo(() => {
    const lightCol = new THREE.Color(boardConfig.lightColor);
    const darkCol = new THREE.Color(boardConfig.darkColor);
    const tileRoughness = Math.min(Math.max(boardConfig.roughness, 0.55), 0.7);
    const boardEnvMap = Math.min(boardConfig.preset === 'wood' ? 0.25 : 0.45, 0.6);

    return {
      light: new THREE.MeshStandardMaterial({
        color: lightCol,
        roughness: tileRoughness,
        metalness: 0,
        envMapIntensity: boardEnvMap,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: darkCol,
        roughness: Math.min(1.0, tileRoughness + 0.04),
        metalness: 0,
        envMapIntensity: boardEnvMap,
      }),
      lastMoveLight: new THREE.MeshStandardMaterial({
        color: lightCol.clone().offsetHSL(0.04, 0.12, -0.06),
        roughness: tileRoughness,
        metalness: 0,
        emissive: new THREE.Color('#d97706'),
        emissiveIntensity: 0.25,
      }),
      lastMoveDark: new THREE.MeshStandardMaterial({
        color: darkCol.clone().offsetHSL(0.04, 0.12, 0.06),
        roughness: tileRoughness,
        metalness: 0,
        emissive: new THREE.Color('#d97706'),
        emissiveIntensity: 0.25,
      }),
      selected: new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        roughness: 0.25,
        metalness: 0.1,
        emissive: new THREE.Color('#f59e0b'),
        emissiveIntensity: 0.35,
      }),
      inCheck: new THREE.MeshStandardMaterial({
        color: '#dc2626',
        roughness: 0.25,
        metalness: 0.1,
        emissive: new THREE.Color('#ef4444'),
        emissiveIntensity: 0.45,
      }),
      hovered: new THREE.MeshStandardMaterial({
        color: '#60a5fa',
        roughness: 0.3,
        metalness: 0.1,
        emissive: new THREE.Color('#38bdf8'),
        emissiveIntensity: 0.28,
      }),
      frame: new THREE.MeshStandardMaterial({
        color: new THREE.Color(boardConfig.frameColor),
        roughness: Math.min(1.0, tileRoughness + 0.08),
        metalness: 0.05,
        envMapIntensity: Math.min(boardEnvMap, 0.5),
      }),
      brassInlay: new THREE.MeshStandardMaterial({
        color: new THREE.Color(boardConfig.inlayColor),
        roughness: 0.28,
        metalness: 0.6,
        envMapIntensity: Math.min(boardEnvMap, 0.6),
      }),
    };
  }, [boardConfig]);

  useEffect(() => {
    return () => {
      Object.values(materials).forEach((m) => m.dispose());
    };
  }, [materials]);

  const tiles = useMemo(() => {
    const list = [];
    for (let row = 0; row < 8; row++) {
      for (let file = 0; file < 8; file++) {
        const square = `${String.fromCharCode(97 + file)}${8 - row}`;
        const isDark = (file + row) % 2 !== 0;
        const x = (file - 3.5) * SQUARE;
        const z = (row - 3.5) * SQUARE;
        list.push({ square, isDark, x, z });
      }
    }
    return list;
  }, []);

  const coordinateLabels = useMemo(() => {
    const labels = [];
    for (let f = 0; f < 8; f++) {
      const char = String.fromCharCode(97 + f);
      const x = (f - 3.5) * SQUARE;
      labels.push({ text: char, x, z: 6.85, rot: -Math.PI / 2 });
      labels.push({ text: char, x, z: -6.85, rot: -Math.PI / 2 });
    }
    for (let r = 1; r <= 8; r++) {
      const char = String(r);
      const z = (8 - r - 3.5) * SQUARE;
      labels.push({ text: char, x: -6.85, z, rot: -Math.PI / 2 });
      labels.push({ text: char, x: 6.85, z, rot: -Math.PI / 2 });
    }
    return labels;
  }, []);

  const selectedCoords = useMemo(
    () => (selectedSquare ? squareToCoords(selectedSquare) : null),
    [selectedSquare]
  );

  return (
    <group>
      {tiles.map((t) => {
        const isSelected = selectedSquare === t.square;
        const isHovered = hoveredSquare === t.square;
        const isInCheck = inCheckSquare === t.square;
        const isLastMove =
          showLastMoveHighlight &&
          lastMove &&
          (lastMove.from === t.square || lastMove.to === t.square);

        let activeMat = t.isDark ? materials.dark : materials.light;
        if (isInCheck) activeMat = materials.inCheck;
        else if (isSelected) activeMat = materials.selected;
        else if (isLastMove) activeMat = t.isDark ? materials.lastMoveDark : materials.lastMoveLight;
        else if (isHovered) activeMat = materials.hovered;

        return (
          <mesh
            key={t.square}
            position={[t.x, 0, t.z]}
            geometry={tileGeometry}
            material={activeMat}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              onTileClick(t.square, e);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onTilePointerOver(t.square);
            }}
            onPointerOut={() => onTilePointerOut()}
          />
        );
      })}

      {selectedCoords && (
        <mesh
          position={[selectedCoords.x, TILE_SURFACE_Y + 0.015, selectedCoords.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.48, 0.62, 32]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}

      {showLegalMarkers &&
        legalMoves.map((sq) => {
          const coords = squareToCoords(sq);
          const isCapture = captureMoves.includes(sq);

          return isCapture ? (
            <mesh
              key={`marker-${sq}`}
              position={[coords.x, TILE_SURFACE_Y + 0.02, coords.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(sq, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onTilePointerOver(sq);
              }}
              onPointerOut={() => onTilePointerOut()}
            >
              <ringGeometry args={[0.44, 0.58, 32]} />
              <meshBasicMaterial color="#f43f5e" transparent opacity={0.88} side={THREE.DoubleSide} />
            </mesh>
          ) : (
            <mesh
              key={`marker-${sq}`}
              position={[coords.x, TILE_SURFACE_Y + 0.018, coords.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(sq, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onTilePointerOver(sq);
              }}
              onPointerOut={() => onTilePointerOut()}
            >
              <circleGeometry args={[0.22, 24]} />
              <meshBasicMaterial color="#10b981" transparent opacity={0.8} />
            </mesh>
          );
        })}

      <mesh position={[0, TILE_SURFACE_Y - 0.005, 0]} material={materials.brassInlay}>
        <boxGeometry args={[12.94, 0.015, 12.94]} />
      </mesh>

      <mesh position={[0, -0.12, 0]} material={materials.frame} receiveShadow>
        <boxGeometry args={[15.3, 0.32, 15.3]} />
      </mesh>
      <mesh position={[0, -0.22, 0]} material={materials.frame} receiveShadow>
        <boxGeometry args={[15.7, 0.12, 15.7]} />
      </mesh>

      {showCoordinates &&
        coordinateLabels.map((item, idx) => (
          <Text
            key={`coord-${idx}`}
            position={[item.x, TILE_SURFACE_Y + 0.01, item.z]}
            rotation={[item.rot, 0, 0]}
            fontSize={0.32}
            color="#d4b483"
            anchorX="center"
            anchorY="middle"
          >
            {item.text}
          </Text>
        ))}
    </group>
  );
});

/* =========================================================================
   8. CAMERA CONTROLLER & SMART DEMAND PACER
   ========================================================================= */

export interface CameraTransitionRequest {
  id: number;
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  duration: number;
}

interface CameraControllerProps {
  cameraMode: 'free' | 'locked';
  fov: number;
  zoomSpeed: number;
  autoRotate: boolean;
  transitionRequest: CameraTransitionRequest | null;
  onTransitionEnd?: () => void;
  controlsRef: React.RefObject<any>;
}

function CameraController({
  cameraMode,
  fov,
  zoomSpeed,
  autoRotate,
  transitionRequest,
  onTransitionEnd,
  controlsRef,
}: CameraControllerProps) {
  const { camera, invalidate } = useThree();
  const transitionRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startLook: THREE.Vector3;
    endLook: THREE.Vector3;
    startTime: number;
    duration: number;
  } | null>(null);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, fov, invalidate]);

  useEffect(() => {
    if (transitionRequest) {
      const controls = controlsRef.current;
      const currentLook = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
      transitionRef.current = {
        startPos: camera.position.clone(),
        endPos: transitionRequest.targetPos.clone(),
        startLook: currentLook,
        endLook: transitionRequest.targetLook.clone(),
        startTime: performance.now(),
        duration: transitionRequest.duration || 700,
      };
      invalidate();
    }
  }, [transitionRequest, camera, controlsRef, invalidate]);

  useFrame(() => {
    const active = transitionRef.current;
    if (active) {
      const now = performance.now();
      const elapsed = now - active.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / active.duration));
      const t = easeInOutCubic(progress);

      camera.position.lerpVectors(active.startPos, active.endPos, t);
      const look = new THREE.Vector3().lerpVectors(active.startLook, active.endLook, t);
      camera.lookAt(look);

      if (controlsRef.current) {
        controlsRef.current.target.copy(look);
        controlsRef.current.update();
      }

      invalidate();

      if (progress >= 1) {
        transitionRef.current = null;
        if (onTransitionEnd) onTransitionEnd();
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={30}
      maxPolarAngle={Math.PI / 2.05}
      enabled={cameraMode === 'free' && !transitionRef.current}
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      zoomSpeed={zoomSpeed}
      onChange={() => invalidate()}
      onStart={() => {
        transitionRef.current = null;
        invalidate();
      }}
    />
  );
}

// Calls invalidate() while busy so GPU idles when no animation is running
function DemandFramePacer({ isBusy }: { isBusy: boolean }) {
  const { invalidate } = useThree();
  useFrame(() => {
    if (isBusy) {
      invalidate();
    }
  });
  return null;
}

/* =========================================================================
   9. MAIN APPLICATION COMPONENT
   ========================================================================= */

export default function App() {
  const initialSettings = useMemo(() => loadPersistedSettings(), []);

  // Theme & Board Customization State
  const [activeThemeId, setActiveThemeId] = useState<string>(
    initialSettings?.themeId || 'default'
  );

  const activeTheme = useMemo(
    () => THEMES.find((t) => t.id === activeThemeId) || THEMES[0],
    [activeThemeId]
  );

  // Model Set State (Separated from theme)
  const [activeModelSetId, setActiveModelSetId] = useState<string>(
    initialSettings?.modelSetId || activeTheme.defaultModelSetId || 'default'
  );

  const activeModelSet = useMemo(
    () =>
      DISCOVERED_MODEL_SETS.find((s) => s.id === activeModelSetId) ||
      DISCOVERED_MODEL_SETS[0],
    [activeModelSetId]
  );

  const [useOriginalMaterials, setUseOriginalMaterials] = useState<boolean>(
    initialSettings?.useOriginalMaterials ?? false
  );

  const [boardConfig, setBoardConfig] = useState<BoardStyleConfig>(
    initialSettings?.board || activeTheme.board
  );

  const [envPresetKey, setEnvPresetKey] = useState<EnvironmentPresetKey>(
    initialSettings?.envPreset || activeTheme.environment.preset
  );

  const [showCoordinates, setShowCoordinates] = useState<boolean>(
    initialSettings?.showCoordinates ?? true
  );
  const [showLegalMarkers, setShowLegalMarkers] = useState<boolean>(
    initialSettings?.showLegalMarkers ?? true
  );
  const [showLastMoveHighlight, setShowLastMoveHighlight] = useState<boolean>(
    initialSettings?.showLastMoveHighlight ?? true
  );

  const [showThemeDrawer, setShowThemeDrawer] = useState<boolean>(false);

  // Camera Settings
  const [cameraMode, setCameraMode] = useState<'free' | 'locked'>(
    initialSettings?.cameraMode || 'free'
  );
  const [cameraFov, setCameraFov] = useState<number>(initialSettings?.fov || 38);
  const [cameraZoomSpeed, setCameraZoomSpeed] = useState<number>(
    initialSettings?.zoomSpeed || 1.0
  );
  const [flipBoardOnMove, setFlipBoardOnMove] = useState<boolean>(
    initialSettings?.flipBoardOnMove ?? false
  );

  const orbitControlsRef = useRef<any>(null);
  const [cameraTransition, setCameraTransition] = useState<CameraTransitionRequest | null>(null);

  const triggerCameraTransition = useCallback(
    (targetPos: THREE.Vector3, targetLook: THREE.Vector3 = new THREE.Vector3(0, 0, 0), duration: number = 700) => {
      setCameraTransition({
        id: Date.now() + Math.random(),
        targetPos,
        targetLook,
        duration,
      });
    },
    []
  );

  useEffect(() => {
    savePersistedSettings({
      themeId: activeThemeId,
      modelSetId: activeModelSetId,
      useOriginalMaterials,
      board: boardConfig,
      envPreset: envPresetKey,
      showCoordinates,
      showLegalMarkers,
      showLastMoveHighlight,
      cameraMode,
      fov: cameraFov,
      zoomSpeed: cameraZoomSpeed,
      flipBoardOnMove,
    });
  }, [
    activeThemeId,
    activeModelSetId,
    useOriginalMaterials,
    boardConfig,
    envPresetKey,
    showCoordinates,
    showLegalMarkers,
    showLastMoveHighlight,
    cameraMode,
    cameraFov,
    cameraZoomSpeed,
    flipBoardOnMove,
  ]);

  // Audio State
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    chessAudio.setMuted(next);
  }, [isMuted]);

  // Preload discovered models lazily in background
  const [preloadedCount, setPreloadedCount] = useState<number>(0);
  useEffect(() => {
    const urlsToPreload: string[] = [];
    DISCOVERED_MODEL_SETS.forEach((set) => {
      ['p', 'r', 'n', 'b', 'q', 'k'].forEach((p) => {
        urlsToPreload.push(resolvePieceModelPath(set, p));
      });
    });

    const uniqueUrls = [...new Set(urlsToPreload)];
    let loaded = 0;

    const timeout = setTimeout(() => {
      uniqueUrls.forEach((url, idx) => {
        setTimeout(() => {
          try {
            useGLTF.preload(url);
            loaded++;
            setPreloadedCount(loaded);
          } catch {
            // best-effort
          }
        }, idx * 120);
      });
    }, 600);

    return () => clearTimeout(timeout);
  }, []);

  // Game Engine State
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [chess] = useState<Chess>(() => new Chess());
  const [, setFen] = useState<string>(chess.fen());
  const [appMode, setAppMode] = useState<AppMode>('ai');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');
  const [playerColorChoice, setPlayerColorChoice] = useState<PlayerColorChoice>('white');
  const [playerActualColor, setPlayerActualColor] = useState<'w' | 'b'>('w');
  const [showModeModal, setShowModeModal] = useState<boolean>(true);

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [isAIThinking, setIsAIThinking] = useState<boolean>(false);
  const [gameOver, setGameOver] = useState<GameOverState>({
    isOver: false,
    winner: null,
    reason: null,
    description: '',
  });

  const isAnimatingRef = useRef<boolean>(false);
  const aiJobIdRef = useRef<number>(0);
  const aiWorkerRef = useRef<Worker | null>(null);

  // Initialize Web Worker for AI engine so rendering never stutters
  useEffect(() => {
    try {
      const worker = new Worker(new URL('./workers/aiWorker.ts', import.meta.url), {
        type: 'module',
      });
      aiWorkerRef.current = worker;
      return () => {
        worker.terminate();
      };
    } catch {
      // Fallback to async direct call if worker cannot be instantiated
      aiWorkerRef.current = null;
    }
  }, []);

  // Pointer drag movement tracker
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const isDragMovement = useCallback((e: any) => {
    if (!e || typeof e.clientX !== 'number') return false;
    const dist = Math.hypot(
      e.clientX - pointerDownPosRef.current.x,
      e.clientY - pointerDownPosRef.current.y
    );
    return dist > 4;
  }, []);

  // Board pieces representation
  const [pieces, setPieces] = useState<ActivePiece[]>([]);

  const syncPiecesFromBoard = useCallback(() => {
    const list: ActivePiece[] = [];
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const item = board[r][f];
        if (item) {
          const sq = `${String.fromCharCode(97 + f)}${8 - r}`;
          const coords = squareToCoords(sq);
          list.push({
            id: `${item.color}${item.type}_${sq}`,
            square: sq,
            type: item.type,
            color: item.color,
            toX: coords.x,
            toZ: coords.z,
          });
        }
      }
    }
    setPieces(list);
  }, [chess]);

  useEffect(() => {
    syncPiecesFromBoard();
  }, [syncPiecesFromBoard]);

  const turn = chess.turn();

  const legalMoves = useMemo<string[]>(() => {
    if (!selectedSquare) return [];
    try {
      const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
      return moves.map((m) => m.to as string);
    } catch {
      return [];
    }
  }, [chess, selectedSquare]);

  const captureMoves = useMemo<string[]>(() => {
    if (!selectedSquare) return [];
    try {
      const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
      return moves.filter((m) => !!m.captured).map((m) => m.to as string);
    } catch {
      return [];
    }
  }, [chess, selectedSquare]);

  const inCheckSquare = useMemo(() => {
    if (!chess.isCheck()) return null;
    const currentTurn = chess.turn();
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === currentTurn) {
          return `${String.fromCharCode(97 + f)}${8 - r}`;
        }
      }
    }
    return null;
  }, [chess]);

  const checkGameOverStatus = useCallback(() => {
    if (chess.isGameOver()) {
      let winner: 'w' | 'b' | 'draw' = 'draw';
      let reason: GameOverState['reason'] = 'stalemate';
      let description = '';

      if (chess.isCheckmate()) {
        winner = chess.turn() === 'w' ? 'b' : 'w';
        reason = 'checkmate';
        description = `Checkmate! ${winner === 'w' ? 'White' : 'Black'} wins the match.`;
      } else if (chess.isDraw()) {
        winner = 'draw';
        if (chess.isStalemate()) {
          reason = 'stalemate';
          description = 'Draw by stalemate. No legal moves remaining.';
        } else if (chess.isThreefoldRepetition()) {
          reason = 'threefold';
          description = 'Draw by threefold repetition.';
        } else if (chess.isInsufficientMaterial()) {
          reason = 'insufficient';
          description = 'Draw by insufficient material to checkmate.';
        } else {
          reason = '50-move';
          description = 'Draw by the fifty-move rule.';
        }
      }

      setGameOver({ isOver: true, winner, reason, description });
      chessAudio.playGameOver();
      return true;
    }
    return false;
  }, [chess]);

  // Execute Move
  const executeMove = useCallback(
    (from: string, to: string) => {
      if (isAnimatingRef.current) return false;

      try {
        const move = chess.move({
          from: from as Square,
          to: to as Square,
          promotion: 'q',
        });

        if (move) {
          isAnimatingRef.current = true;
          const fromCoords = squareToCoords(from);
          const toCoords = squareToCoords(to);
          const now = performance.now();
          const isKnight = move.piece === 'n';

          let castlingRookFrom: string | null = null;
          let castlingRookTo: string | null = null;
          if (move.flags.includes('k')) {
            castlingRookFrom = move.color === 'w' ? 'h1' : 'h8';
            castlingRookTo = move.color === 'w' ? 'f1' : 'f8';
          } else if (move.flags.includes('q')) {
            castlingRookFrom = move.color === 'w' ? 'a1' : 'a8';
            castlingRookTo = move.color === 'w' ? 'd1' : 'd8';
          }

          const capturedSquare = move.flags.includes('e')
            ? `${move.to[0]}${move.from[1]}`
            : move.captured
            ? move.to
            : null;

          setPieces((prev) =>
            prev.map((p) => {
              if (p.square === from) {
                return {
                  ...p,
                  square: to,
                  type: move.promotion ? move.promotion : p.type,
                  fromX: fromCoords.x,
                  fromZ: fromCoords.z,
                  toX: toCoords.x,
                  toZ: toCoords.z,
                  animating: true,
                  animStartTime: now,
                  animDuration: 520,
                  arcHeight: isKnight ? 1.25 : 0.55,
                };
              }
              if (castlingRookFrom && p.square === castlingRookFrom) {
                const rFrom = squareToCoords(castlingRookFrom);
                const rTo = squareToCoords(castlingRookTo!);
                return {
                  ...p,
                  square: castlingRookTo!,
                  fromX: rFrom.x,
                  fromZ: rFrom.z,
                  toX: rTo.x,
                  toZ: rTo.z,
                  animating: true,
                  animStartTime: now,
                  animDuration: 520,
                  arcHeight: 0.45,
                };
              }
              if (capturedSquare && p.square === capturedSquare) {
                return {
                  ...p,
                  isFading: true,
                  fadeStartTime: now,
                  fadeDuration: 250,
                };
              }
              return p;
            })
          );

          if (move.captured) {
            chessAudio.playCapture();
          } else {
            chessAudio.playMove();
          }

          setLastMove({ from: move.from, to: move.to });
          setSelectedSquare(null);
          setMoveHistory((prev) => [...prev, move.san]);

          if (appMode === 'pvp' && flipBoardOnMove) {
            const nextTurn = chess.turn();
            triggerCameraTransition(
              nextTurn === 'w' ? new THREE.Vector3(0, 13, 14) : new THREE.Vector3(0, 13, -14),
              new THREE.Vector3(0, 0, 0),
              700
            );
          }

          return true;
        }
      } catch {
        // invalid move
      }
      return false;
    },
    [chess, appMode, flipBoardOnMove, triggerCameraTransition]
  );

  // Trigger AI Move (Runs in Web Worker)
  const triggerAIMove = useCallback(() => {
    if (gameOver.isOver || isAnimatingRef.current) return;
    if (appMode !== 'ai') return;
    if (chess.turn() === playerActualColor) return;

    const currentJobId = ++aiJobIdRef.current;
    setIsAIThinking(true);

    const delayMs =
      difficulty === 'easy'
        ? 700 + Math.random() * 200
        : difficulty === 'medium'
        ? 850 + Math.random() * 250
        : 1050 + Math.random() * 300;

    const timer = setTimeout(async () => {
      if (currentJobId !== aiJobIdRef.current) return;

      const worker = aiWorkerRef.current;
      if (worker) {
        // Run AI search inside Web Worker on background thread
        const handleWorkerMessage = (e: MessageEvent) => {
          if (e.data.jobId === currentJobId) {
            worker.removeEventListener('message', handleWorkerMessage);
            setIsAIThinking(false);
            if (e.data.move) {
              executeMove(e.data.move.from, e.data.move.to);
            }
          }
        };
        worker.addEventListener('message', handleWorkerMessage);
        worker.postMessage({
          jobId: currentJobId,
          fen: chess.fen(),
          difficulty,
        });
      } else {
        // Fallback to async direct call if worker unavailable
        try {
          const aiMove = await getAIMove(chess, difficulty, () => currentJobId !== aiJobIdRef.current);
          if (currentJobId === aiJobIdRef.current && aiMove) {
            executeMove(aiMove.from, aiMove.to);
          }
        } finally {
          if (currentJobId === aiJobIdRef.current) {
            setIsAIThinking(false);
          }
        }
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [appMode, chess, difficulty, executeMove, gameOver.isOver, playerActualColor]);

  const handleAnimationComplete = useCallback(
    (_id: string) => {
      isAnimatingRef.current = false;
      const nextFen = chess.fen();
      setFen(nextFen);

      const isFinished = checkGameOverStatus();
      if (!isFinished) {
        if (chess.isCheck()) {
          chessAudio.playCheck();
        }
        if (appMode === 'ai' && chess.turn() !== playerActualColor) {
          triggerAIMove();
        }
      }
    },
    [chess, checkGameOverStatus, appMode, playerActualColor, triggerAIMove]
  );

  const handleFadeComplete = useCallback((id: string) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const setCursor = useCallback((pointer: boolean) => {
    document.body.style.cursor = pointer ? 'pointer' : 'auto';
  }, []);

  // Piece Click handler
  const handlePieceClick = useCallback(
    (piece: ActivePiece, e: any) => {
      if (!gameStarted || gameOver.isOver || isAIThinking || isAnimatingRef.current || isDragMovement(e)) {
        return;
      }
      if (appMode === 'ai' && chess.turn() !== playerActualColor) return;

      if (piece.color === turn) {
        chessAudio.playSelect();
        setSelectedSquare((prev) => (piece.square === prev ? null : piece.square));
        return;
      }

      if (selectedSquare && piece.color !== turn) {
        if (legalMoves.includes(piece.square)) {
          executeMove(selectedSquare, piece.square);
        } else {
          setSelectedSquare(null);
        }
      }
    },
    [gameStarted, gameOver.isOver, isAIThinking, isDragMovement, appMode, chess, playerActualColor, turn, selectedSquare, legalMoves, executeMove]
  );

  // Tile Click handler
  const handleTileClick = useCallback(
    (square: string, e: any) => {
      if (!gameStarted || gameOver.isOver || isAIThinking || isAnimatingRef.current || isDragMovement(e)) {
        return;
      }
      if (appMode === 'ai' && chess.turn() !== playerActualColor) return;

      if (selectedSquare) {
        if (legalMoves.includes(square)) {
          executeMove(selectedSquare, square);
        } else {
          setSelectedSquare(null);
        }
      }
    },
    [gameStarted, gameOver.isOver, isAIThinking, isDragMovement, appMode, chess, playerActualColor, selectedSquare, legalMoves, executeMove]
  );

  const handlePiecePointerEnter = useCallback(
    (piece: ActivePiece) => {
      if (!gameStarted) return;
      const isPlayerTurn = appMode === 'pvp' || chess.turn() === playerActualColor;
      if (isPlayerTurn && (piece.color === turn || (selectedSquare && legalMoves.includes(piece.square)))) {
        setCursor(true);
      }
      setHoveredSquare(piece.square);
    },
    [gameStarted, appMode, chess, playerActualColor, turn, selectedSquare, legalMoves, setCursor]
  );

  const handleTilePointerOver = useCallback(
    (square: string) => {
      if (!gameStarted) return;
      const isPlayerTurn = appMode === 'pvp' || chess.turn() === playerActualColor;
      if (isPlayerTurn && legalMoves.includes(square)) {
        setCursor(true);
      }
      setHoveredSquare(square);
    },
    [gameStarted, appMode, chess, playerActualColor, legalMoves, setCursor]
  );

  const handlePointerOut = useCallback(() => {
    setCursor(false);
    setHoveredSquare(null);
  }, [setCursor]);

  // Start New Game
  const startNewGame = useCallback(
    (mode: AppMode, diff: AIDifficulty, color: PlayerColorChoice) => {
      aiJobIdRef.current++;
      setIsAIThinking(false);
      isAnimatingRef.current = false;

      chess.reset();
      setAppMode(mode);
      setDifficulty(diff);
      setPlayerColorChoice(color);

      let actualColor: 'w' | 'b' = 'w';
      if (color === 'random') {
        actualColor = Math.random() < 0.5 ? 'w' : 'b';
      } else {
        actualColor = color === 'black' ? 'b' : 'w';
      }
      setPlayerActualColor(actualColor);

      setFen(chess.fen());
      setSelectedSquare(null);
      setHoveredSquare(null);
      setLastMove(null);
      setMoveHistory([]);
      setGameOver({ isOver: false, winner: null, reason: null, description: '' });
      setShowModeModal(false);
      setGameStarted(true);
      syncPiecesFromBoard();

      const targetPos = actualColor === 'b' ? new THREE.Vector3(0, 13, -14) : new THREE.Vector3(0, 13, 14);
      triggerCameraTransition(targetPos, new THREE.Vector3(0, 0, 0), 850);

      if (mode === 'ai' && actualColor === 'b') {
        const jobId = ++aiJobIdRef.current;
        setIsAIThinking(true);
        setTimeout(async () => {
          if (jobId !== aiJobIdRef.current) return;
          const aiMove = await getAIMove(chess, diff, () => jobId !== aiJobIdRef.current);
          if (jobId !== aiJobIdRef.current) return;
          if (aiMove) {
            executeMove(aiMove.from, aiMove.to);
          }
          setIsAIThinking(false);
        }, 950 + Math.random() * 300);
      }
    },
    [chess, executeMove, syncPiecesFromBoard, triggerCameraTransition]
  );

  const handleReset = useCallback(() => {
    startNewGame(appMode, difficulty, playerColorChoice);
  }, [startNewGame, appMode, difficulty, playerColorChoice]);

  const handleUndo = useCallback(() => {
    if (!gameStarted || moveHistory.length === 0 || isAIThinking || isAnimatingRef.current) return;

    aiJobIdRef.current++;
    setIsAIThinking(false);
    isAnimatingRef.current = false;

    if (appMode === 'ai') {
      chess.undo();
      if (chess.turn() !== playerActualColor) {
        chess.undo();
      }
      setMoveHistory((prev) => prev.slice(0, -2));
    } else {
      chess.undo();
      setMoveHistory((prev) => prev.slice(0, -1));
    }

    setFen(chess.fen());
    setSelectedSquare(null);
    setLastMove(null);
    setGameOver({ isOver: false, winner: null, reason: null, description: '' });
    syncPiecesFromBoard();
  }, [gameStarted, moveHistory.length, isAIThinking, appMode, chess, playerActualColor, syncPiecesFromBoard]);

  // Handle Theme Selection (Preserves current game & piece positions)
  const handleSelectTheme = useCallback((theme: ChessTheme) => {
    setActiveThemeId(theme.id);
    setBoardConfig({ ...theme.board });
    setEnvPresetKey(theme.environment.preset);
    // Preset provides a default model set, but user can freely override it
    if (theme.defaultModelSetId) {
      setActiveModelSetId(theme.defaultModelSetId);
    }
  }, []);

  // Handle Model Set Selection (Independent from material theme)
  const handleSelectModelSet = useCallback((modelSet: DiscoveredModelSet) => {
    setActiveModelSetId(modelSet.id);
  }, []);

  const currentEnv = useMemo(
    () => ENVIRONMENT_PRESETS[envPresetKey] || ENVIRONMENT_PRESETS.studio,
    [envPresetKey]
  );

  // Check if scene has active piece animation
  const hasActiveAnimation = useMemo(
    () => pieces.some((p) => p.animating || p.isFading),
    [pieces]
  );

  const isScenePacingBusy = !gameStarted || isAnimatingRef.current || hasActiveAnimation || !!cameraTransition;

  return (
    <div
      className="w-screen h-screen overflow-hidden flex flex-col relative select-none font-sans text-neutral-100"
      style={{
        background: currentEnv.backgroundGradient,
      }}
      onPointerDown={handlePointerDown}
    >
      {/* 3D R3F Canvas with frameloop="demand" for 0% GPU idle and 60 FPS animation */}
      <div className="flex-1 w-full h-full relative cursor-pointer">
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          gl={{
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.9,
            antialias: true,
            powerPreference: 'high-performance',
          }}
          camera={{ position: [0, 13, 14], fov: cameraFov }}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <AdaptiveDpr pixelated />
          <color attach="background" args={[currentEnv.canvasBackground]} />

          {/* Key light has shadow enabled; fill and rim lights do not for optimal performance */}
          <hemisphereLight
            intensity={0.25}
            color="#ffffff"
            groundColor={currentEnv.canvasBackground}
          />
          <directionalLight
            position={[8, 18, 10]}
            intensity={1.1}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.5}
            shadow-camera-far={45}
            shadow-camera-left={-12}
            shadow-camera-right={12}
            shadow-camera-top={12}
            shadow-camera-bottom={-12}
            shadow-bias={-0.0001}
          />
          <directionalLight position={[-10, 12, -8]} intensity={0.4} color={currentEnv.fillColor} />
          <directionalLight position={[0, 8, -14]} intensity={0.5} color={currentEnv.rimColor} />

          <Environment preset={currentEnv.preset} environmentIntensity={0.35} />

          {/* Static ContactShadows: frames={1} bakes once so GPU doesn't recalculate each frame */}
          <ContactShadows
            frames={1}
            position={[0, -0.23, 0]}
            opacity={0.55}
            scale={22}
            blur={2.0}
            far={4}
            resolution={512}
            color="#0b0e14"
          />

          {/* Paces frames during active tweens and idles cleanly on rest */}
          <DemandFramePacer isBusy={isScenePacingBusy} />

          {/* Camera Controller with smooth transitions and OrbitControls */}
          <CameraController
            cameraMode={cameraMode}
            fov={cameraFov}
            zoomSpeed={cameraZoomSpeed}
            autoRotate={!gameStarted}
            transitionRequest={cameraTransition}
            onTransitionEnd={() => setCameraTransition(null)}
            controlsRef={orbitControlsRef}
          />

          {/* Customizable Chess Board */}
          <CustomizableChessBoard
            boardConfig={boardConfig}
            showCoordinates={showCoordinates}
            showLegalMarkers={showLegalMarkers}
            showLastMoveHighlight={showLastMoveHighlight}
            selectedSquare={selectedSquare}
            hoveredSquare={hoveredSquare}
            lastMove={lastMove}
            inCheckSquare={inCheckSquare}
            legalMoves={legalMoves}
            captureMoves={captureMoves}
            onTileClick={handleTileClick}
            onTilePointerOver={handleTilePointerOver}
            onTilePointerOut={handlePointerOut}
          />

          {/* Active 3D Model Set Piece Layer */}
          <Suspense fallback={null}>
            <PiecesLayer
              key={`${activeModelSet.id}-${useOriginalMaterials ? 'orig' : activeTheme.id}`}
              modelSet={activeModelSet}
              theme={activeTheme}
              useOriginalMaterials={useOriginalMaterials}
              pieces={pieces}
              selectedSquare={selectedSquare}
              onPieceClick={handlePieceClick}
              onPointerEnter={handlePiecePointerEnter}
              onPointerLeave={handlePointerOut}
              onAnimationComplete={handleAnimationComplete}
              onFadeComplete={handleFadeComplete}
            />
          </Suspense>
        </Canvas>

        {/* TOP BAR / GAME HUD */}
        <header className="absolute top-0 left-0 right-0 z-30 pointer-events-none p-4 flex items-center justify-between">
          <div className="pointer-events-auto flex items-center space-x-3">
            {/* Turn & Status Badge */}
            <div className="flex items-center space-x-2.5 px-3.5 py-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 shadow-2xl">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-neutral-950 font-bold text-sm shadow-md shadow-amber-500/20">
                <Crown className="w-4 h-4 text-neutral-950" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-neutral-100 tracking-wide leading-none font-serif-title">
                  Grandmaster 3D
                </h1>
                <span className="text-[10px] text-amber-400 font-semibold tracking-wider uppercase">
                  {!gameStarted
                    ? 'No game in progress'
                    : turn === 'w'
                    ? 'White to Move'
                    : 'Black to Move'}
                </span>
              </div>
            </div>

            {/* Mode & Opponent Badge */}
            <div className="flex items-center space-x-2 px-3 py-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 text-xs shadow-2xl">
              {appMode === 'ai' ? (
                <>
                  <Bot className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold text-neutral-200 capitalize">
                    vs AI ({difficulty})
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-neutral-400">
                    You: <strong className="text-amber-400">{playerActualColor === 'w' ? 'White' : 'Black'}</strong>
                  </span>
                </>
              ) : (
                <>
                  <Swords className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-semibold text-neutral-200">
                    Player vs Player
                  </span>
                </>
              )}
            </div>

            {/* Active Model Set & Preload Status */}
            <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-2xl bg-neutral-900/80 backdrop-blur-md border border-neutral-800 text-[11px] text-neutral-400">
              <Box className="w-3.5 h-3.5 text-amber-400" />
              <span>Model: <strong className="text-neutral-200">{activeModelSet.name}</strong></span>
              {preloadedCount > 0 && (
                <span className="text-[10px] text-emerald-400 font-mono">({preloadedCount} cached)</span>
              )}
            </div>

            {/* AI is thinking Indicator */}
            {isAIThinking && (
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-2xl animate-pulse">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span>AI is thinking...</span>
              </div>
            )}

            {/* PvP Flip Board Toggle */}
            {appMode === 'pvp' && (
              <button
                onClick={() => setFlipBoardOnMove((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition shadow-xl ${
                  flipBoardOnMove
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
                    : 'bg-neutral-900/85 text-neutral-300 border-neutral-700 hover:bg-neutral-800'
                }`}
                title="Automatically flip board perspective on each move"
              >
                <RotateCw className="w-3 h-3" />
                <span>Flip Board: {flipBoardOnMove ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {/* New Match Button */}
            <button
              onClick={() => setShowModeModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition shadow-2xl"
              title="Open mode selection to start a new match"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>NEW GAME</span>
            </button>
          </div>

          {/* Right Action Controls: Theme Studio & Audio Mute */}
          <div className="pointer-events-auto flex items-center space-x-2.5">
            <button
              onClick={() => setShowThemeDrawer((prev) => !prev)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-2xl border text-xs font-semibold transition shadow-2xl ${
                showThemeDrawer
                  ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-amber-500/20'
                  : 'bg-neutral-900/85 hover:bg-neutral-800 text-neutral-200 border-neutral-700/60'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Theme & Board Studio</span>
            </button>

            <button
              onClick={toggleMute}
              className="p-2.5 rounded-2xl bg-neutral-900/85 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-300 transition shadow-2xl"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>
          </div>
        </header>

        {/* BOTTOM ACTION BAR */}
        <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center space-x-2">
          <div className="pointer-events-auto flex items-center space-x-2 px-3 py-2 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 shadow-2xl">
            <button
              onClick={handleUndo}
              disabled={!gameStarted || moveHistory.length === 0 || isAIThinking || isAnimatingRef.current}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-neutral-800 text-neutral-200 text-xs font-semibold transition border border-neutral-700/50"
              title="Undo move"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>

            <button
              onClick={handleReset}
              disabled={!gameStarted}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-neutral-800 text-neutral-200 text-xs font-semibold transition border border-neutral-700/50"
              title="Reset current match"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <div className="h-4 w-[1px] bg-neutral-700 mx-1" />

            <div className="flex items-center space-x-2 text-xs font-mono text-neutral-400 px-1">
              <span>Moves: {moveHistory.length}</span>
              {moveHistory.length > 0 && (
                <span className="text-amber-400 font-semibold">
                  ({moveHistory[moveHistory.length - 1]})
                </span>
              )}
            </div>
          </div>
        </footer>

        {/* THEME & BOARD STUDIO DRAWER */}
        {showThemeDrawer && (
          <div className="absolute top-16 right-4 z-40 w-96 max-h-[calc(100vh-5.5rem)] overflow-y-auto bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/80 rounded-3xl p-5 shadow-2xl flex flex-col space-y-4 text-neutral-100">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center space-x-2">
                <Palette className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm tracking-wide">Theme & Board Studio</h3>
              </div>
              <button
                onClick={() => setShowThemeDrawer(false)}
                className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* 1. Theme Presets (Materials & Board Colors) */}
              <div>
                <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block mb-2">
                  Theme Presets (Materials & Colors)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((theme) => {
                    const isSelected = activeThemeId === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => handleSelectTheme(theme)}
                        className={`p-2.5 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500 ring-1 ring-amber-500/50'
                            : 'bg-neutral-800/60 border-neutral-700/70 hover:bg-neutral-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-neutral-200 text-xs truncate">
                            {theme.label}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </div>

                        <div className="flex items-center space-x-1 pt-1">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-neutral-600 shadow-sm"
                            style={{ backgroundColor: theme.swatch.whitePiece }}
                            title="White Piece"
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-neutral-600 shadow-sm"
                            style={{ backgroundColor: theme.swatch.blackPiece }}
                            title="Black Piece"
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-neutral-600 shadow-sm"
                            style={{ backgroundColor: theme.swatch.lightTile }}
                            title="Light Tile"
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-neutral-600 shadow-sm"
                            style={{ backgroundColor: theme.swatch.darkTile }}
                            title="Dark Tile"
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. 3D Model Set Row (Discovered & Registered Models) */}
              <div className="pt-2 border-t border-neutral-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1.5">
                    <Box className="w-3.5 h-3.5 text-amber-400" />
                    <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                      3D Model Set ({DISCOVERED_MODEL_SETS.length} Discovered)
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-2">
                  {DISCOVERED_MODEL_SETS.map((set) => {
                    const isSelected = activeModelSetId === set.id;
                    return (
                      <button
                        key={set.id}
                        onClick={() => handleSelectModelSet(set)}
                        className={`p-2.5 rounded-2xl border text-left transition flex flex-col space-y-1 ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500 ring-1 ring-amber-500/50'
                            : 'bg-neutral-800/60 border-neutral-700/70 hover:bg-neutral-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-neutral-200 text-xs truncate">
                            {set.name}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-neutral-400">
                          <span>{set.pieceCount} / 6 pieces</span>
                          <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                            {set.isSingleFile ? 'GLB Node' : 'Multi-GLB'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Option: Original Materials Toggle */}
                <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 cursor-pointer text-xs">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-neutral-300">Original materials (Keep embedded GLB textures)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={useOriginalMaterials}
                    onChange={(e) => setUseOriginalMaterials(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>

              {/* 3. Board Finish Presets */}
              <div>
                <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block mb-2">
                  Board Finish Presets
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {Object.keys(BOARD_PRESETS).map((key) => {
                    const p = BOARD_PRESETS[key];
                    const active = boardConfig.preset === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setBoardConfig({ ...p })}
                        className={`py-1.5 px-2 rounded-xl border text-[11px] font-semibold capitalize transition ${
                          active
                            ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
                            : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                        }`}
                      >
                        <span>{key}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Board Color Pickers & Sliders */}
              <div className="p-3 bg-neutral-950/40 rounded-2xl border border-neutral-800/80 space-y-3">
                <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                  Board Colors
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="text-[10px] text-neutral-400 block mb-1">Light Tile</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={boardConfig.lightColor}
                        onChange={(e) =>
                          setBoardConfig((prev) => ({ ...prev, lightColor: e.target.value, preset: 'custom' }))
                        }
                        className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-neutral-300">{boardConfig.lightColor}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 block mb-1">Dark Tile</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={boardConfig.darkColor}
                        onChange={(e) =>
                          setBoardConfig((prev) => ({ ...prev, darkColor: e.target.value, preset: 'custom' }))
                        }
                        className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-neutral-300">{boardConfig.darkColor}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 block mb-1">Outer Frame</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={boardConfig.frameColor}
                        onChange={(e) =>
                          setBoardConfig((prev) => ({ ...prev, frameColor: e.target.value, preset: 'custom' }))
                        }
                        className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-neutral-300">{boardConfig.frameColor}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-neutral-800">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">Tile Roughness</span>
                    <span className="font-mono text-amber-400">{boardConfig.roughness.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.55"
                    max="0.80"
                    step="0.01"
                    value={boardConfig.roughness}
                    onChange={(e) =>
                      setBoardConfig((prev) => ({ ...prev, roughness: parseFloat(e.target.value), preset: 'custom' }))
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-neutral-400">Tile Metalness</span>
                    <span className="font-mono text-amber-400">{boardConfig.metalness.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="0.5"
                    step="0.01"
                    value={boardConfig.metalness}
                    onChange={(e) =>
                      setBoardConfig((prev) => ({ ...prev, metalness: parseFloat(e.target.value), preset: 'custom' }))
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* 5. Environment Lighting Presets */}
              <div>
                <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block mb-2">
                  Lighting & Backdrop
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['studio', 'sunset', 'dawn', 'night'] as EnvironmentPresetKey[]).map((envKey) => {
                    const active = envPresetKey === envKey;
                    return (
                      <button
                        key={envKey}
                        onClick={() => setEnvPresetKey(envKey)}
                        className={`py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition flex items-center justify-between ${
                          active
                            ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
                            : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          {envKey === 'studio' && <Sun className="w-3.5 h-3.5" />}
                          {envKey === 'sunset' && <Sunrise className="w-3.5 h-3.5" />}
                          {envKey === 'dawn' && <Sparkles className="w-3.5 h-3.5" />}
                          {envKey === 'night' && <Moon className="w-3.5 h-3.5" />}
                          <span>{envKey}</span>
                        </div>
                        {active && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 6. Board Display Toggles */}
              <div className="space-y-2 pt-2 border-t border-neutral-800">
                <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                  Display Toggles
                </label>
                <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 cursor-pointer text-xs">
                  <span className="text-neutral-300">Show Coordinates (a-h, 1-8)</span>
                  <input
                    type="checkbox"
                    checked={showCoordinates}
                    onChange={(e) => setShowCoordinates(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 cursor-pointer text-xs">
                  <span className="text-neutral-300">Show Legal Move Markers</span>
                  <input
                    type="checkbox"
                    checked={showLegalMarkers}
                    onChange={(e) => setShowLegalMarkers(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 cursor-pointer text-xs">
                  <span className="text-neutral-300">Highlight Last Move</span>
                  <input
                    type="checkbox"
                    checked={showLastMoveHighlight}
                    onChange={(e) => setShowLastMoveHighlight(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>

              {/* 7. Camera Section */}
              <div className="space-y-3 pt-3 border-t border-neutral-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Camera className="w-3.5 h-3.5 text-amber-400" />
                    <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                      Camera & View
                    </label>
                  </div>
                  <div className="flex items-center bg-neutral-950/60 p-0.5 rounded-lg border border-neutral-800">
                    <button
                      onClick={() => setCameraMode('free')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition flex items-center space-x-1 ${
                        cameraMode === 'free'
                          ? 'bg-amber-500 text-neutral-950 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <Unlock className="w-2.5 h-2.5" />
                      <span>Free</span>
                    </button>
                    <button
                      onClick={() => setCameraMode('locked')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition flex items-center space-x-1 ${
                        cameraMode === 'locked'
                          ? 'bg-amber-500 text-neutral-950 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <Lock className="w-2.5 h-2.5" />
                      <span>Locked</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-400 block mb-1.5 font-medium">Quick Presets</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => triggerCameraTransition(new THREE.Vector3(0, 13, 14))}
                      className="py-1.5 px-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[11px] font-medium transition text-center"
                    >
                      White Side
                    </button>
                    <button
                      onClick={() => triggerCameraTransition(new THREE.Vector3(0, 13, -14))}
                      className="py-1.5 px-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[11px] font-medium transition text-center"
                    >
                      Black Side
                    </button>
                    <button
                      onClick={() => triggerCameraTransition(new THREE.Vector3(0, 20, 0.01))}
                      className="py-1.5 px-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[11px] font-medium transition text-center"
                    >
                      Top-Down
                    </button>
                    <button
                      onClick={() => triggerCameraTransition(new THREE.Vector3(11, 12, 12))}
                      className="py-1.5 px-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[11px] font-medium transition text-center"
                    >
                      Angled 3D
                    </button>
                  </div>
                </div>

                <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 cursor-pointer text-xs">
                  <span className="text-neutral-300">Auto-flip to side to move (PvP)</span>
                  <input
                    type="checkbox"
                    checked={flipBoardOnMove}
                    onChange={(e) => setFlipBoardOnMove(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <div className="p-3 bg-neutral-950/40 rounded-2xl border border-neutral-800/80 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">Field of View (FOV)</span>
                    <span className="font-mono text-amber-400">{cameraFov}°</span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="60"
                    step="1"
                    value={cameraFov}
                    onChange={(e) => setCameraFov(parseInt(e.target.value, 10))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-neutral-400">Zoom Speed</span>
                    <span className="font-mono text-amber-400">{cameraZoomSpeed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={cameraZoomSpeed}
                    onChange={(e) => setCameraZoomSpeed(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <button
                  onClick={() => {
                    setCameraFov(38);
                    setCameraZoomSpeed(1.0);
                    setCameraMode('free');
                    triggerCameraTransition(new THREE.Vector3(0, 13, 14));
                  }}
                  className="w-full py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-xs font-semibold transition flex items-center justify-center space-x-1.5"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Reset Camera to Default</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-800 mt-2">
              <button
                onClick={() => handleSelectTheme(activeTheme)}
                className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs tracking-wider uppercase transition border border-neutral-700"
              >
                Reset to Theme Defaults
              </button>
            </div>
          </div>
        )}

        {/* START MENU OVERLAY MODAL */}
        {showModeModal && (
          <div className="absolute inset-0 z-50 bg-neutral-950/70 backdrop-blur-md flex items-center justify-center p-4">
            <ModeModal
              initialMode={appMode}
              initialDifficulty={difficulty}
              initialColor={playerColorChoice}
              isGameStarted={gameStarted}
              onClose={() => {
                if (gameStarted) {
                  setShowModeModal(false);
                }
              }}
              onStart={(m, d, c) => startNewGame(m, d, c)}
            />
          </div>
        )}

        {/* GAME OVER OVERLAY MODAL */}
        {gameOver.isOver && (
          <div className="absolute inset-0 z-40 bg-neutral-950/70 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-neutral-900/95 border border-neutral-700/80 rounded-3xl p-6 shadow-2xl text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400">
                {gameOver.winner === 'draw' ? (
                  <Swords className="w-8 h-8 text-blue-400" />
                ) : (
                  <Trophy className="w-8 h-8 text-amber-400" />
                )}
              </div>

              <h2 className="text-2xl font-bold font-serif-title text-neutral-100 mb-2">
                {gameOver.winner === 'draw'
                  ? 'Game Drawn'
                  : gameOver.winner === 'w'
                  ? 'White Wins!'
                  : 'Black Wins!'}
              </h2>

              <p className="text-sm text-neutral-300 mb-6 bg-neutral-950/50 px-4 py-2.5 rounded-xl border border-neutral-800">
                {gameOver.description}
              </p>

              <div className="flex items-center space-x-3 w-full">
                <button
                  onClick={handleReset}
                  className="flex-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold text-xs tracking-wider uppercase transition border border-neutral-700 flex items-center justify-center space-x-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rematch</span>
                </button>
                <button
                  onClick={() => {
                    setGameOver({ isOver: false, winner: null, reason: null, description: '' });
                    setShowModeModal(true);
                  }}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs tracking-wider uppercase transition shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>New Match</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   10. MODE SELECTION & START MATCH MODAL
   ========================================================================= */

interface ModeModalProps {
  initialMode: AppMode;
  initialDifficulty: AIDifficulty;
  initialColor: PlayerColorChoice;
  isGameStarted: boolean;
  onClose: () => void;
  onStart: (mode: AppMode, diff: AIDifficulty, color: PlayerColorChoice) => void;
}

function ModeModal({
  initialMode,
  initialDifficulty,
  initialColor,
  isGameStarted,
  onClose,
  onStart,
}: ModeModalProps) {
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [diff, setDiff] = useState<AIDifficulty>(initialDifficulty);
  const [color, setColor] = useState<PlayerColorChoice>(initialColor);

  return (
    <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700/80 rounded-3xl p-6 shadow-2xl relative text-neutral-100">
      {isGameStarted && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-neutral-950 shadow-lg shadow-amber-500/20">
          <Crown className="w-5 h-5 text-neutral-950" />
        </div>
        <div>
          <h2 className="text-lg font-bold font-serif-title leading-tight">
            {isGameStarted ? 'Start New Match' : 'Grandmaster 3D Chess'}
          </h2>
          <p className="text-xs text-neutral-400">
            {isGameStarted ? 'Choose your game rules and opponent' : 'Select mode and difficulty to begin'}
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          Game Mode
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('ai')}
            className={`p-3.5 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
              mode === 'ai'
                ? 'bg-amber-500/15 border-amber-500 text-neutral-100 ring-1 ring-amber-500'
                : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-neutral-100">Player vs AI</span>
              <Bot className={`w-4 h-4 ${mode === 'ai' ? 'text-amber-400' : 'text-neutral-500'}`} />
            </div>
            <span className="text-[11px] text-neutral-400 leading-tight">
              Challenge our tactical engine with 3 difficulty levels
            </span>
          </button>

          <button
            onClick={() => setMode('pvp')}
            className={`p-3.5 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
              mode === 'pvp'
                ? 'bg-blue-500/15 border-blue-500 text-neutral-100 ring-1 ring-blue-500'
                : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-neutral-100">Player vs Player</span>
              <Swords className={`w-4 h-4 ${mode === 'pvp' ? 'text-blue-400' : 'text-neutral-500'}`} />
            </div>
            <span className="text-[11px] text-neutral-400 leading-tight">
              Local pass-and-play match with optional board flipping
            </span>
          </button>
        </div>
      </div>

      {mode === 'ai' && (
        <div className="space-y-4 mb-6 pt-3 border-t border-neutral-800">
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
              AI Difficulty
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['easy', 'medium', 'hard'] as AIDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDiff(d)}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition ${
                    diff === d
                      ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1.5 block">
              {diff === 'easy' && 'Easy: Casual opponent that makes beatable blunders.'}
              {diff === 'medium' && 'Medium: Evaluates material and piece squares (depth 2).'}
              {diff === 'hard' && 'Hard: Grandmaster depth 4 with quiescence search & move ordering.'}
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
              Your Color
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setColor('white')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'white'
                    ? 'bg-neutral-100 text-neutral-950 border-white shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white border border-neutral-300" />
                <span>White</span>
              </button>
              <button
                onClick={() => setColor('black')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'black'
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 border border-neutral-500" />
                <span>Black</span>
              </button>
              <button
                onClick={() => setColor('random')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'random'
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Shuffle className="w-3 h-3" />
                <span>Random</span>
              </button>
            </div>
            <span className="text-[11px] text-neutral-400 mt-1.5 block">
              {color === 'black'
                ? 'You play as Black. The AI will make the opening move as White.'
                : color === 'white'
                ? 'You play as White and make the first move.'
                : 'Randomly assigned White or Black.'}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center space-x-3 pt-4 border-t border-neutral-800">
        {isGameStarted && (
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs tracking-wider uppercase transition border border-neutral-700"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => onStart(mode, diff, color)}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs tracking-wider uppercase transition shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-1.5"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Start Game</span>
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   11. APPLICATION ERROR BOUNDARY
   ========================================================================= */

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[3D Chess Application Error Caught]:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[500px] flex flex-col items-center justify-center bg-[#181d28] p-8 text-neutral-200 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold font-serif-title text-neutral-100 mb-2">
            {this.props.fallbackTitle || 'Grandmaster 3D Chess Studio'}
          </h2>
          <p className="text-sm text-neutral-400 max-w-md mb-6 font-mono text-xs bg-neutral-900 p-3 rounded-lg border border-neutral-800 break-words">
            {this.state.error?.message || 'A runtime rendering exception occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-xs tracking-wider uppercase transition shadow-lg shadow-amber-500/20"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload 3D Board</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
