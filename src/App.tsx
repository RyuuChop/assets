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
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { Chess, Square, Move } from 'chess.js';
import {
  RotateCcw,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Layers,
  Crown,
  Volume2,
  VolumeX,
} from 'lucide-react';

/* =========================================================================
   1. CONSTANTS & CONFIGURATION
   ========================================================================= */

// Tile size in Three.js world units
export const SQUARE = 1.6;

// Tile geometry: thickness and top surface Y level (where piece bottoms rest)
export const TILE_THICKNESS = 0.2;
export const TILE_SURFACE_Y = TILE_THICKNESS / 2; // 0.1

// Maximum percentage of tile width a piece base may fill
export const FOOTPRINT = 0.7;

// Relative base footprint scale per chess piece type (pawns smaller, royals fill ~70%)
export const TYPE_FOOTPRINT: Record<string, number> = {
  p: 0.75,
  r: 0.9,
  n: 0.95,
  b: 0.9,
  q: 1.0,
  k: 1.0,
};

// Model filename mapping for GLB files: ${set.folder}/${FILE[type]}.glb
export const FILE: Record<string, string> = {
  p: 'pawn',
  r: 'rook',
  n: 'knight',
  b: 'bishop',
  q: 'queen',
  k: 'king',
};

// Model sets config array
export const MODEL_SETS = [
  {
    id: 'default',
    name: 'Default Set',
    folder: '/assets/models',
    description: 'Classic Alabaster Cream & Dark Obsidian championship pieces.',
  },
  {
    id: 'collection-2',
    name: 'Collection 2',
    folder: '/models',
    description: 'Sculpted tournament set supporting luxury Metallic Prestige & Gemstone Glass shaders.',
  },
];

// Preload all 6 piece types for both sets to prevent any stutter
['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'].forEach((f) => {
  try {
    useGLTF.preload(`/assets/models/${f}.glb`);
    useGLTF.preload(`/models/${f}.glb`);
  } catch {
    // preload is best-effort
  }
});

/* =========================================================================
   2. TEMPLATE NORMALIZATION CACHE (BUILT ONCE PER MODEL SET & PIECE TYPE)
   ========================================================================= */

const templateCache = new Map<string, THREE.Group>();

/**
 * Normalizes a piece model ONCE per (setId, pieceType):
 * 1. Clones raw GLTF scene safely with SkeletonUtils.clone (never mutates original).
 * 2. Resets transforms to identity.
 * 3. Measures bounding box with new THREE.Box3().setFromObject(root) (WITHOUT precise flag).
 * 4. Scales so max horizontal dimension matches 70% of 1.6 tile.
 * 5. Centers X and Z at 0, locks bottom min Y flush to 0.
 * 6. Wraps in pivot group and caches result.
 */
export function getNormalizedTemplate(
  setId: string,
  type: string,
  rawScene: THREE.Object3D
): THREE.Group {
  const cacheKey = `${setId}:${type}`;
  const existing = templateCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  // 1. Clone raw scene without touching the original cached GLTF
  const root = SkeletonUtils.clone(rawScene) as THREE.Group;

  // 2. Reset transforms
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  // Compute normals on geometry if missing
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

  // 3. Fast bounding box calculation (standard setFromObject, no precise flag)
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  // 4. Scale to ~70% of a 1.6 tile footprint
  const maxHorizontal = Math.max(0.001, size.x, size.z);
  const targetFootprint = SQUARE * FOOTPRINT * (TYPE_FOOTPRINT[type] || 1.0);
  const scale = targetFootprint / maxHorizontal;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // 5. Center horizontally (X, Z) and lock bottom flush to Y = 0
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.set(-center.x, -box.min.y, -center.z);
  root.updateMatrixWorld(true);

  // 6. Wrap in pivot group
  const pivot = new THREE.Group();
  pivot.name = `template-${setId}-${type}`;
  pivot.add(root);

  templateCache.set(cacheKey, pivot);
  return pivot;
}

/* =========================================================================
   3. THEMES & MATERIAL SPECIFICATIONS
   ========================================================================= */

export type ThemeKey = 'metallic-prestige' | 'gemstone-glass';

/* =========================================================================
   4. SYNTHESIZED WEB AUDIO (Move clicks)
   ========================================================================= */

class ChessAudio {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
  }
  public isEnabled(): boolean {
    return this.enabled;
  }

  public playMove() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

const chessAudio = new ChessAudio();

/* =========================================================================
   5. AI ENGINE FOR PLAY
   ========================================================================= */

const PIECE_VALS: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999;
  if (chess.isDraw()) return 0;
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const v = PIECE_VALS[p.type] || 0;
      score += p.color === 'w' ? v : -v;
    }
  }
  return score;
}

async function getAIMove(chess: Chess): Promise<Move | null> {
  const moves = chess.moves({ verbose: true });
  if (!moves || moves.length === 0) return null;

  let bestMove: Move = moves[0];
  let bestScore = Infinity; // Black minimizes

  for (const m of moves) {
    chess.move(m);
    const score = evaluateBoard(chess) + (Math.random() - 0.5) * 8;
    chess.undo();
    if (score < bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

/* =========================================================================
   6. 3D CHESS PIECE COMPONENT
   ========================================================================= */

export interface BoardPieceData {
  id: string;
  square: string;
  type: string;
  color: 'w' | 'b';
  file: number; // 0..7 (a..h)
  row: number;  // 0..7 (0 = rank 8 Black, 7 = rank 1 White)
}

interface PieceProps {
  piece: BoardPieceData;
  template: THREE.Group | undefined;
  whiteMaterial: THREE.Material;
  blackMaterial: THREE.Material;
  isSelected: boolean;
  onClick: (piece: BoardPieceData) => void;
}

/**
 * 3D Piece Component:
 * - Clones cached template once per piece.
 * - Applies the shared white or black material.
 * - Computes yaw: Black gets +Math.PI, Knights get extra Math.PI/2.
 * - Strict null-guard: never renders <primitive object={x} /> unless valid Object3D.
 */
const Piece = React.memo(function Piece({
  piece,
  template,
  whiteMaterial,
  blackMaterial,
  isSelected,
  onClick,
}: PieceProps) {
  // Cheap clone of pre-normalized template
  const pieceObject = useMemo(() => {
    if (!template) return null;
    const clone = SkeletonUtils.clone(template) as THREE.Group;
    const mat = piece.color === 'w' ? whiteMaterial : blackMaterial;
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return clone;
  }, [template, piece.color, whiteMaterial, blackMaterial]);

  // World coordinates: x = (file - 3.5) * SQUARE, z = (row - 3.5) * SQUARE
  const x = (piece.file - 3.5) * SQUARE;
  const z = (piece.row - 3.5) * SQUARE;

  // Yaw calculation: Black gets +Math.PI on Y; knights get an extra Math.PI/2
  const yaw = (piece.color === 'b' ? Math.PI : 0) + (piece.type === 'n' ? Math.PI / 2 : 0);

  // Subtle lift when piece is selected
  const liftY = isSelected ? 0.35 : 0;

  // CRITICAL GUARD: Remove every null from the scene graph
  if (!pieceObject || !(pieceObject instanceof THREE.Object3D)) {
    return null;
  }

  return (
    <group
      position={[x, TILE_SURFACE_Y + liftY, z]}
      onClick={(e) => {
        e.stopPropagation();
        onClick(piece);
      }}
    >
      <group rotation={[0, yaw, 0]}>
        <primitive object={pieceObject} />
      </group>
    </group>
  );
});

/* =========================================================================
   7. PIECES LAYER (Pre-loads 6 GLTFs & builds templates once)
   ========================================================================= */

interface PiecesLayerProps {
  modelSet: (typeof MODEL_SETS)[0];
  themeKey: ThemeKey;
  pieces: BoardPieceData[];
  selectedSquare: string | null;
  onPieceClick: (piece: BoardPieceData) => void;
}

function PiecesLayer({
  modelSet,
  themeKey,
  pieces,
  selectedSquare,
  onPieceClick,
}: PiecesLayerProps) {
  // Load 6 GLTF models for this modelSet via useGLTF
  const pawnGLTF = useGLTF(`${modelSet.folder}/pawn.glb`);
  const rookGLTF = useGLTF(`${modelSet.folder}/rook.glb`);
  const knightGLTF = useGLTF(`${modelSet.folder}/knight.glb`);
  const bishopGLTF = useGLTF(`${modelSet.folder}/bishop.glb`);
  const queenGLTF = useGLTF(`${modelSet.folder}/queen.glb`);
  const kingGLTF = useGLTF(`${modelSet.folder}/king.glb`);

  // Build normalized templates ONCE per (modelSet, pieceType)
  const templates = useMemo(() => {
    const gltfs: Record<string, THREE.Object3D | undefined> = {
      p: pawnGLTF?.scene,
      r: rookGLTF?.scene,
      n: knightGLTF?.scene,
      b: bishopGLTF?.scene,
      q: queenGLTF?.scene,
      k: kingGLTF?.scene,
    };

    const map: Record<string, THREE.Group> = {};
    for (const [type, rawScene] of Object.entries(gltfs)) {
      if (rawScene && rawScene instanceof THREE.Object3D) {
        map[type] = getNormalizedTemplate(modelSet.id, type, rawScene);
      }
    }
    return map;
  }, [modelSet.id, pawnGLTF, rookGLTF, knightGLTF, bishopGLTF, queenGLTF, kingGLTF]);

  // Create only 2 materials per active theme: one for white and one for black
  const { whiteMaterial, blackMaterial } = useMemo(() => {
    const isDefault = modelSet.id === 'default';
    let wMat: THREE.Material;
    let bMat: THREE.Material;

    if (isDefault) {
      // Classic Alabaster Cream vs Dark Obsidian Chrome
      wMat = new THREE.MeshStandardMaterial({
        color: '#f0f0f0',
        roughness: 0.2,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      bMat = new THREE.MeshStandardMaterial({
        color: '#1a1a1a',
        roughness: 0.15,
        metalness: 0.8,
        side: THREE.DoubleSide,
      });
    } else if (themeKey === 'gemstone-glass') {
      // Luxury Gemstone Glass (capped dpr ensures high performance)
      wMat = new THREE.MeshPhysicalMaterial({
        color: '#cfeee0',
        roughness: 0.25,
        metalness: 0.05,
        transmission: 0.8,
        thickness: 0.8,
        ior: 1.5,
        transparent: true,
        side: THREE.DoubleSide,
      });
      bMat = new THREE.MeshPhysicalMaterial({
        color: '#0f2a6b',
        roughness: 0.1,
        metalness: 0.05,
        transmission: 0.8,
        thickness: 1.0,
        ior: 1.6,
        transparent: true,
        side: THREE.DoubleSide,
      });
    } else {
      // Metallic Prestige: Champagne Gold vs Deep Metallic Charcoal
      wMat = new THREE.MeshStandardMaterial({
        color: '#d4af37',
        roughness: 0.15,
        metalness: 0.9,
        side: THREE.DoubleSide,
      });
      bMat = new THREE.MeshStandardMaterial({
        color: '#222222',
        roughness: 0.2,
        metalness: 0.8,
        side: THREE.DoubleSide,
      });
    }

    return { whiteMaterial: wMat, blackMaterial: bMat };
  }, [modelSet.id, themeKey]);

  // Dispose materials strictly on set/theme unmount (never dispose geometries)
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
          isSelected={selectedSquare === piece.square}
          onClick={onPieceClick}
        />
      ))}
    </group>
  );
}

/* =========================================================================
   8. CHESSBOARD TILES COMPONENT
   ========================================================================= */

interface ChessBoardProps {
  selectedSquare: string | null;
  hoveredSquare: string | null;
  legalMoves: string[];
  captureMoves: string[];
  inCheckSquare: string | null;
  onTileClick: (square: string) => void;
  onTilePointerOver: (square: string) => void;
  onTilePointerOut: () => void;
}

/**
 * 64 Box tiles with top face flush at TILE_SURFACE_Y, plus frame underneath.
 * Uses pre-allocated static materials to avoid any GC or runtime allocation.
 */
function ChessBoardTiles({
  selectedSquare,
  hoveredSquare,
  legalMoves,
  captureMoves,
  inCheckSquare,
  onTileClick,
  onTilePointerOver,
  onTilePointerOut,
}: ChessBoardProps) {
  const tileGeometry = useMemo(
    () => new THREE.BoxGeometry(SQUARE, TILE_THICKNESS, SQUARE),
    []
  );

  const materials = useMemo(
    () => ({
      light: new THREE.MeshStandardMaterial({
        color: '#e2d6b5',
        roughness: 0.35,
        metalness: 0.1,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: '#4a3b32',
        roughness: 0.45,
        metalness: 0.1,
      }),
      frame: new THREE.MeshStandardMaterial({
        color: '#1a1412',
        roughness: 0.5,
        metalness: 0.2,
      }),
      inCheck: new THREE.MeshStandardMaterial({
        color: '#ef4444',
        roughness: 0.2,
        metalness: 0.2,
        emissive: new THREE.Color('#ef4444'),
        emissiveIntensity: 0.3,
      }),
      selected: new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        roughness: 0.2,
        metalness: 0.2,
        emissive: new THREE.Color('#f59e0b'),
        emissiveIntensity: 0.3,
      }),
      capture: new THREE.MeshStandardMaterial({
        color: '#dc2626',
        roughness: 0.2,
        metalness: 0.2,
        emissive: new THREE.Color('#dc2626'),
        emissiveIntensity: 0.3,
      }),
      legal: new THREE.MeshStandardMaterial({
        color: '#10b981',
        roughness: 0.2,
        metalness: 0.2,
        emissive: new THREE.Color('#10b981'),
        emissiveIntensity: 0.3,
      }),
      hovered: new THREE.MeshStandardMaterial({
        color: '#60a5fa',
        roughness: 0.2,
        metalness: 0.2,
        emissive: new THREE.Color('#60a5fa'),
        emissiveIntensity: 0.3,
      }),
    }),
    []
  );

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

  return (
    <group>
      {/* 64 Chessboard Tiles */}
      {tiles.map((t) => {
        const isSelected = selectedSquare === t.square;
        const isHovered = hoveredSquare === t.square;
        const isLegal = legalMoves.includes(t.square);
        const isCapture = captureMoves.includes(t.square);
        const isInCheck = inCheckSquare === t.square;

        let activeMat = t.isDark ? materials.dark : materials.light;
        if (isInCheck) activeMat = materials.inCheck;
        else if (isSelected) activeMat = materials.selected;
        else if (isCapture) activeMat = materials.capture;
        else if (isLegal) activeMat = materials.legal;
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
              onTileClick(t.square);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onTilePointerOver(t.square);
            }}
            onPointerOut={() => onTilePointerOut()}
          />
        );
      })}

      {/* Decorative Wooden Board Frame underneath */}
      <mesh position={[0, -0.15, 0]} material={materials.frame} receiveShadow>
        <boxGeometry args={[8 * SQUARE + 1.2, 0.3, 8 * SQUARE + 1.2]} />
      </mesh>
    </group>
  );
}

/* =========================================================================
   9. MAIN APPLICATION COMPONENT
   ========================================================================= */

export default function App() {
  // Model Set & Material Theme state
  const [activeModelSetId, setActiveModelSetId] = useState<string>('default');
  const [activeThemeKey, setActiveThemeKey] = useState<ThemeKey>('metallic-prestige');

  const currentModelSet = useMemo(
    () => MODEL_SETS.find((s) => s.id === activeModelSetId) || MODEL_SETS[0],
    [activeModelSetId]
  );
  const isDefaultSet = activeModelSetId === 'default';

  // Chess Game State
  const chessRef = useRef<Chess>(new Chess());
  const chess = chessRef.current;
  const [fen, setFen] = useState<string>(chess.fen());
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isAIThinking, setIsAIThinking] = useState<boolean>(false);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);

  const turn = chess.turn();
  const isCheck = chess.isCheck();
  const isCheckmate = chess.isCheckmate();
  const isDraw = chess.isDraw();

  // Memoize pieces currently on the board
  const pieces = useMemo(() => {
    const list: BoardPieceData[] = [];
    const board = chess.board();
    for (let row = 0; row < 8; row++) {
      for (let file = 0; file < 8; file++) {
        const p = board[row][file];
        if (p) {
          const sq = `${String.fromCharCode(97 + file)}${8 - row}`;
          list.push({
            id: `${file}-${row}-${p.type}-${p.color}`,
            square: sq,
            type: p.type,
            color: p.color,
            file,
            row,
          });
        }
      }
    }
    return list;
  }, [fen]);

  // King square in check
  const inCheckSquare = useMemo(() => {
    if (!isCheck) return null;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'k' && p.color === turn) {
          return `${String.fromCharCode(97 + c)}${8 - r}`;
        }
      }
    }
    return null;
  }, [isCheck, fen, turn]);

  // Legal moves from selected square
  const { legalMoves, captureMoves } = useMemo(() => {
    if (!selectedSquare) return { legalMoves: [], captureMoves: [] };
    const legals: string[] = [];
    const caps: string[] = [];
    try {
      const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
      moves.forEach((m) => {
        legals.push(m.to);
        if (m.captured) caps.push(m.to);
      });
    } catch {
      // ignore
    }
    return { legalMoves: legals, captureMoves: caps };
  }, [selectedSquare, fen, chess]);

  // Execute a chess move
  const executeMove = useCallback(
    (from: string, to: string) => {
      try {
        const move = chess.move({
          from: from as Square,
          to: to as Square,
          promotion: 'q',
        });
        if (move) {
          chessAudio.playMove();
          const nextFen = chess.fen();
          setFen(nextFen);
          setSelectedSquare(null);
          setMoveHistory((prev) => [...prev, move.san]);
          return true;
        }
      } catch {
        // invalid move
      }
      return false;
    },
    [chess]
  );

  // Trigger AI move when it's Black's turn
  useEffect(() => {
    if (turn !== 'b' || isCheckmate || isDraw) return;
    let active = true;
    setIsAIThinking(true);

    const timer = setTimeout(async () => {
      if (!active) return;
      const aiMove = await getAIMove(chess);
      if (!active) return;
      if (aiMove) {
        executeMove(aiMove.from, aiMove.to);
      }
      setIsAIThinking(false);
    }, 600);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [turn, fen, isCheckmate, isDraw, chess, executeMove]);

  // Piece Click handler
  const handlePieceClick = useCallback(
    (piece: BoardPieceData) => {
      if (isAIThinking) return;

      // If own piece clicked, toggle select it
      if (piece.color === turn) {
        setSelectedSquare((prev) => (piece.square === prev ? null : piece.square));
        return;
      }

      // If opposing piece clicked and destination is legal move, capture it
      if (selectedSquare && piece.color !== turn) {
        if (legalMoves.includes(piece.square)) {
          executeMove(selectedSquare, piece.square);
        } else {
          setSelectedSquare(null);
        }
      }
    },
    [isAIThinking, turn, selectedSquare, legalMoves, executeMove]
  );

  // Tile Click handler
  const handleTileClick = useCallback(
    (square: string) => {
      if (isAIThinking) return;
      if (selectedSquare) {
        if (legalMoves.includes(square)) {
          executeMove(selectedSquare, square);
        } else {
          setSelectedSquare(null);
        }
      }
    },
    [isAIThinking, selectedSquare, legalMoves, executeMove]
  );

  // Reset Game
  const handleReset = useCallback(() => {
    chess.reset();
    setFen(chess.fen());
    setSelectedSquare(null);
    setHoveredSquare(null);
    setMoveHistory([]);
  }, [chess]);

  // Undo Move
  const handleUndo = useCallback(() => {
    if (moveHistory.length === 0 || isAIThinking) return;
    chess.undo();
    chess.undo(); // Undo both AI and player
    setFen(chess.fen());
    setSelectedSquare(null);
    setMoveHistory((prev) => prev.slice(0, -2));
  }, [moveHistory.length, isAIThinking, chess]);

  // Unique key to cleanly remount pieces when switching set or theme
  const layerKey = `${currentModelSet.id}:${activeThemeKey}`;

  return (
    <div className="w-screen h-screen overflow-hidden bg-neutral-950 flex flex-col relative select-none font-sans text-neutral-100">
      {/* 3D R3F Canvas */}
      <div className="flex-1 w-full h-full relative cursor-pointer">
        <Canvas
          shadows
          dpr={[1, 1.5]}
          camera={{ position: [0, 12, 14], fov: 40 }}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          {/* Lighting */}
          <ambientLight intensity={0.7} />
          <directionalLight
            position={[8, 16, 10]}
            intensity={1.8}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.5}
            shadow-camera-far={40}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
          />
          <directionalLight position={[-8, 12, -10]} intensity={0.6} color="#93c5fd" />

          {/* HDR Environment Reflections */}
          <Environment preset="city" />

          {/* Orbit Controls with polar angle limit just under 90° */}
          <OrbitControls
            makeDefault
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={6}
            maxDistance={28}
          />

          {/* 64 Board Tiles */}
          <ChessBoardTiles
            selectedSquare={selectedSquare}
            hoveredSquare={hoveredSquare}
            legalMoves={legalMoves}
            captureMoves={captureMoves}
            inCheckSquare={inCheckSquare}
            onTileClick={handleTileClick}
            onTilePointerOver={(sq) => setHoveredSquare(sq)}
            onTilePointerOut={() => setHoveredSquare(null)}
          />

          {/* Piece Layer with Suspense and Fallback */}
          <Suspense fallback={null}>
            <PiecesLayer
              key={layerKey}
              modelSet={currentModelSet}
              themeKey={activeThemeKey}
              pieces={pieces}
              selectedSquare={selectedSquare}
              onPieceClick={handlePieceClick}
            />
          </Suspense>
        </Canvas>

        {/* TOP BAR / GAME HUD */}
        <header className="absolute top-0 left-0 right-0 z-30 pointer-events-none p-4 flex items-center justify-between">
          <div className="pointer-events-auto flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 shadow-xl">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-neutral-950 font-bold text-sm shadow-md shadow-amber-500/20">
                <Crown className="w-4 h-4 text-neutral-950" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-neutral-100 tracking-wide leading-none">
                  Grandmaster 3D
                </h1>
                <span className="text-[10px] text-amber-400 font-medium">
                  {turn === 'w' ? 'White to Move' : 'Black (AI) to Move'}
                </span>
              </div>
            </div>

            {/* Model Set Picker (Default / Collection 2) */}
            <div className="flex items-center bg-neutral-900/90 backdrop-blur-md p-1 rounded-2xl border border-neutral-800 shadow-xl space-x-1">
              {MODEL_SETS.map((set) => {
                const active = activeModelSetId === set.id;
                return (
                  <button
                    key={set.id}
                    onClick={() => setActiveModelSetId(set.id)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-xl text-xs transition ${
                      active
                        ? 'bg-amber-500 text-neutral-950 font-bold shadow-md shadow-amber-500/20'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {set.name}
                  </button>
                );
              })}
            </div>

            {/* Theme Picker (Metallic Prestige / Gemstone Glass) - Appears ONLY when non-default set is active */}
            {!isDefaultSet && (
              <div className="flex items-center bg-neutral-900/90 backdrop-blur-md p-1 rounded-2xl border border-neutral-800 shadow-xl space-x-1">
                <span className="text-[10px] text-neutral-400 px-2 font-semibold uppercase tracking-wider flex items-center space-x-1">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>Theme:</span>
                </span>
                <button
                  onClick={() => setActiveThemeKey('metallic-prestige')}
                  aria-pressed={activeThemeKey === 'metallic-prestige'}
                  className={`px-3 py-1.5 rounded-xl text-xs transition flex items-center space-x-1.5 ${
                    activeThemeKey === 'metallic-prestige'
                      ? 'bg-amber-500 text-neutral-950 font-bold shadow-md shadow-amber-500/20'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-[#d4af37] border border-amber-300" />
                  <span>Metallic Prestige</span>
                </button>
                <button
                  onClick={() => setActiveThemeKey('gemstone-glass')}
                  aria-pressed={activeThemeKey === 'gemstone-glass'}
                  className={`px-3 py-1.5 rounded-xl text-xs transition flex items-center space-x-1.5 ${
                    activeThemeKey === 'gemstone-glass'
                      ? 'bg-emerald-500 text-neutral-950 font-bold shadow-md shadow-emerald-500/20'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-[#cfeee0] border border-emerald-300" />
                  <span>Gemstone Glass</span>
                </button>
              </div>
            )}
          </div>

          {/* Audio & Actions */}
          <div className="pointer-events-auto flex items-center space-x-2">
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                chessAudio.setEnabled(next);
              }}
              className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 transition shadow-lg"
              title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-neutral-500" />}
            </button>
            <button
              onClick={handleUndo}
              disabled={moveHistory.length === 0 || isAIThinking}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 disabled:opacity-40 border border-neutral-800 text-xs font-medium text-neutral-300 transition shadow-lg"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
            <button
              onClick={handleReset}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 transition shadow-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </header>

        {/* BOTTOM STATUS BADGE */}
        <div className="absolute bottom-4 left-4 z-20 pointer-events-none flex items-center space-x-3">
          {hoveredSquare && (
            <div className="px-3 py-1.5 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 text-xs font-mono text-neutral-300 shadow-lg">
              Tile: <span className="text-amber-400 font-bold">{hoveredSquare.toUpperCase()}</span>
            </div>
          )}
          <div className="px-3 py-1.5 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 text-xs text-neutral-400 shadow-lg flex items-center space-x-2">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Set: <strong className="text-neutral-200">{currentModelSet.name}</strong> ({currentModelSet.folder})
            </span>
          </div>
        </div>

        {/* CHECK / CHECKMATE BANNER */}
        {(isCheckmate || isCheck || isDraw) && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div
              className={`px-5 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-md text-xs font-bold uppercase tracking-wider flex items-center space-x-2 ${
                isCheckmate
                  ? 'bg-red-500/20 border-red-500 text-red-200'
                  : isCheck
                  ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                  : 'bg-neutral-800/80 border-neutral-700 text-neutral-300'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span>
                {isCheckmate
                  ? `Checkmate! ${turn === 'w' ? 'Black' : 'White'} Wins`
                  : isDraw
                  ? 'Game Drawn'
                  : `Check! ${turn === 'w' ? 'White' : 'Black'} King Threatened`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   10. APPLICATION ERROR BOUNDARY
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
        <div className="w-full h-full min-h-[500px] flex flex-col items-center justify-center bg-[#121212] p-8 text-neutral-200 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold font-serif-title text-neutral-100 mb-2">
            {this.props.fallbackTitle || 'Grandmaster 3D Chess Recovery'}
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
