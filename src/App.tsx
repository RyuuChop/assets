import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  Component,
  ErrorInfo,
  ReactNode,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Chess, Square, Move } from 'chess.js';
import {
  RotateCcw,
  RotateCw,
  Lightbulb,
  Settings,
  Volume2,
  VolumeX,
  Maximize2,
  RefreshCw,
  AlertTriangle,
  X,
  Layers,
  Sparkles,
} from 'lucide-react';

/* =========================================================================
   1. REACT ERROR BOUNDARY
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

/* =========================================================================
   2. TYPES & AUDIO
   ========================================================================= */

type GameMode = 'vs-ai' | 'pass-and-play';
type AIDifficulty = 'novice' | 'club' | 'master' | 'grandmaster';
type CameraPreset = 'white' | 'black' | 'top' | 'isometric' | 'free';
type LightingTheme = 'grandmaster' | 'midnight' | 'sunlit' | 'studio';
type PieceStyle = 'glb' | 'procedural';

interface MoveRecord {
  san: string;
  from: string;
  to: string;
  piece: string;
  color: 'w' | 'b';
  captured?: string;
  fen: string;
}

class ChessAudio {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;

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
    this.soundEnabled = val;
  }
  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  public playMove() {
    if (!this.soundEnabled) return;
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

  public playCapture() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  public playCheck() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [440, 554.37, 659.25].forEach((freq, idx) => {
      const osc = this.ctx?.createOscillator();
      const gain = this.ctx?.createGain();
      if (!osc || !gain) return;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.06);
      gain.gain.setValueAtTime(0.2, t + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.06 + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(t + idx * 0.06);
      osc.stop(t + idx * 0.06 + 0.35);
    });
  }

  public playGameOver() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [329.63, 392.0, 523.25, 659.25].forEach((freq, idx) => {
      const osc = this.ctx?.createOscillator();
      const gain = this.ctx?.createGain();
      if (!osc || !gain) return;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.12);
      gain.gain.setValueAtTime(0.25, t + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.12 + 0.6);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(t + idx * 0.12);
      osc.stop(t + idx * 0.12 + 0.6);
    });
  }

  public playSelect() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.04);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

const chessAudio = new ChessAudio();

/* =========================================================================
   3. AI ENGINE
   ========================================================================= */

const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999;
  if (chess.isDraw()) return 0;
  let totalScore = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board?.[r]?.[c] || null;
      if (!p) continue;
      const val = PIECE_VALUES[p?.type] || 0;
      totalScore += p?.color === 'w' ? val : -val;
    }
  }
  return totalScore;
}

async function getAIMove(chess: Chess, difficulty: AIDifficulty): Promise<Move | null> {
  const moves = chess.moves({ verbose: true });
  if (!moves || moves.length === 0) return null;

  if (difficulty === 'novice' && Math.random() < 0.6) {
    return moves[Math.floor(Math.random() * moves.length)] || null;
  }

  const isWhite = chess.turn() === 'w';
  let bestMove: Move = moves[0];
  let bestScore = isWhite ? -Infinity : Infinity;

  for (const move of moves) {
    chess.move(move);
    const score = evaluateBoard(chess);
    chess.undo();
    const jitter = (Math.random() - 0.5) * (difficulty === 'novice' ? 30 : 5);
    const adjusted = score + jitter;

    if (isWhite) {
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestMove = move;
      }
    } else {
      if (adjusted < bestScore) {
        bestScore = adjusted;
        bestMove = move;
      }
    }
  }
  return bestMove;
}

/* =========================================================================
   4. COORDINATES & PROCEDURAL / GLB PIECE CREATION
   ========================================================================= */

const SQUARE_SIZE = 1.6;
const BOARD_ORIGIN_X = -(7 * SQUARE_SIZE) / 2;
const BOARD_ORIGIN_Z = (7 * SQUARE_SIZE) / 2;
const BOARD_SURFACE_Y = 0.4;

function squareToCoords(square: string): { x: number; z: number } {
  if (!square || square.length < 2) return { x: 0, z: 0 };
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const safeFile = Math.max(0, Math.min(7, isNaN(file) ? 0 : file));
  const safeRank = Math.max(0, Math.min(7, isNaN(rank) ? 0 : rank));
  const x = BOARD_ORIGIN_X + safeFile * SQUARE_SIZE;
  const z = BOARD_ORIGIN_Z - safeRank * SQUARE_SIZE;
  return { x, z };
}

// Procedural fallback pieces (Cylinder/Box/Sphere)
function createProceduralPieceMesh(type: string, color: 'w' | 'b'): THREE.Group {
  const group = new THREE.Group();
  const isWhite = color === 'w';
  const mainMat = new THREE.MeshStandardMaterial({
    color: isWhite ? 0xf8f5ee : 0x242428,
    roughness: 0.25,
    metalness: 0.15,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: isWhite ? 0xd4af37 : 0x9ca3af,
    roughness: 0.2,
    metalness: 0.7,
  });

  const add = (geom: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  switch (type) {
    case 'p':
      add(new THREE.CylinderGeometry(0.42, 0.48, 0.2, 20), mainMat, 0.1);
      add(new THREE.CylinderGeometry(0.22, 0.36, 0.45, 20), mainMat, 0.4);
      add(new THREE.CylinderGeometry(0.28, 0.22, 0.08, 20), trimMat, 0.65);
      add(new THREE.SphereGeometry(0.26, 20, 20), mainMat, 0.88);
      break;

    case 'r':
      add(new THREE.CylinderGeometry(0.48, 0.52, 0.24, 20), mainMat, 0.12);
      add(new THREE.CylinderGeometry(0.38, 0.44, 0.65, 20), mainMat, 0.55);
      add(new THREE.CylinderGeometry(0.48, 0.38, 0.22, 20), trimMat, 0.95);
      [-0.26, 0.26].forEach((bx) => {
        [-0.26, 0.26].forEach((bz) => {
          const batt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16), mainMat);
          batt.position.set(bx, 1.12, bz);
          batt.castShadow = true;
          group.add(batt);
        });
      });
      break;

    case 'n':
      add(new THREE.CylinderGeometry(0.48, 0.52, 0.24, 20), mainMat, 0.12);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.48), mainMat);
      neck.position.set(0, 0.55, -0.06);
      neck.rotation.x = 0.25;
      neck.castShadow = true;
      group.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.52), mainMat);
      head.position.set(0, 0.85, 0.2);
      head.rotation.x = -0.3;
      head.castShadow = true;
      group.add(head);
      const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), trimMat);
      ear1.position.set(-0.12, 1.1, 0.02);
      ear1.rotation.z = -0.2;
      group.add(ear1);
      const ear2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), trimMat);
      ear2.position.set(0.12, 1.1, 0.02);
      ear2.rotation.z = 0.2;
      group.add(ear2);
      break;

    case 'b':
      add(new THREE.CylinderGeometry(0.46, 0.5, 0.24, 20), mainMat, 0.12);
      add(new THREE.CylinderGeometry(0.26, 0.42, 0.75, 20), mainMat, 0.6);
      add(new THREE.CylinderGeometry(0.34, 0.28, 0.1, 20), trimMat, 1.0);
      add(new THREE.SphereGeometry(0.3, 20, 20), mainMat, 1.25);
      add(new THREE.SphereGeometry(0.09, 14, 14), trimMat, 1.6);
      break;

    case 'q':
      add(new THREE.CylinderGeometry(0.5, 0.54, 0.24, 20), mainMat, 0.12);
      add(new THREE.CylinderGeometry(0.28, 0.44, 0.92, 20), mainMat, 0.68);
      add(new THREE.CylinderGeometry(0.46, 0.28, 0.28, 20), trimMat, 1.25);
      [0, 1, 2, 3, 4, 5].forEach((idx) => {
        const ang = (idx * Math.PI) / 3;
        const spike = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), trimMat);
        spike.position.set(Math.cos(ang) * 0.42, 1.44, Math.sin(ang) * 0.42);
        group.add(spike);
      });
      add(new THREE.SphereGeometry(0.13, 14, 14), mainMat, 1.5);
      break;

    case 'k':
    default:
      add(new THREE.CylinderGeometry(0.52, 0.56, 0.26, 20), mainMat, 0.14);
      add(new THREE.CylinderGeometry(0.32, 0.46, 1.05, 20), mainMat, 0.75);
      add(new THREE.CylinderGeometry(0.48, 0.32, 0.26, 20), trimMat, 1.35);
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.08), trimMat);
      vBar.position.set(0, 1.72, 0);
      group.add(vBar);
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.08), trimMat);
      hBar.position.set(0, 1.76, 0);
      group.add(hBar);
      break;
  }

  group.rotation.y = isWhite ? 0 : Math.PI;
  return group;
}

// Piece Mesh from loaded GLTF (Chessboard.glb)
function createGLFPieceMesh(
  type: string,
  color: 'w' | 'b',
  templates: Map<string, THREE.Object3D>
): THREE.Group {
  const key = `${color}-${type}`;
  const template = templates.get(key);

  if (!template) {
    // Graceful procedural fallback if template not ready
    return createProceduralPieceMesh(type, color);
  }

  const group = new THREE.Group();
  const clone = template.clone(true);
  clone.visible = true;

  // Enhance materials and shadow flags
  clone.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
      const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.3, 0.15, 0.7);
        mat.metalness = THREE.MathUtils.clamp(mat.metalness ?? 0.2, 0.1, 0.6);
      }
    }
  });

  group.add(clone);
  return group;
}

/* =========================================================================
   5. ACTIVE ANIMATION INTERPOLATION TRACKER
   ========================================================================= */

interface ActivePieceAnim {
  group: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startTime: number;
  duration: number; // 400ms
  peakArc: number; // 0.8
  onDone?: () => void;
}

interface CapturedAnim {
  group: THREE.Group;
  startTime: number;
  duration: number; // 350ms
}

/* =========================================================================
   6. MAIN APP COMPONENT
   ========================================================================= */

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Chess instance
  const chessRef = useRef<Chess>(new Chess());
  const chess = chessRef.current;

  // React State Tokens to trigger renders immediately
  const [boardFen, setBoardFen] = useState<string>(chess.fen());
  const [moveCount, setMoveCount] = useState<number>(0);

  // Settings
  const [gameMode, setGameMode] = useState<GameMode>('vs-ai');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('master');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('white');
  const [lightingTheme, setLightingTheme] = useState<LightingTheme>('grandmaster');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [pieceStyle, setPieceStyle] = useState<PieceStyle>('glb');

  // Interaction State
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isAIThinking, setIsAIThinking] = useState<boolean>(false);
  const [hintMove, setHintMove] = useState<string | null>(null);

  // Game Chronicles
  const [movesHistory, setMovesHistory] = useState<MoveRecord[]>([]);
  const [capturedPieces, setCapturedPieces] = useState<{ w: string[]; b: string[] }>({ w: [], b: [] });
  const [evalScore, setEvalScore] = useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);

  // 3D Asset Loading State
  const [isGLBLoaded, setIsGLBLoaded] = useState<boolean>(false);
  const glbTemplatesRef = useRef<Map<string, THREE.Object3D>>(new Map());

  const turn = chess?.turn?.() || 'w';
  const isCheck = chess?.isCheck?.() || false;
  const isCheckmate = chess?.isCheckmate?.() || false;
  const isDraw = chess?.isDraw?.() || false;

  // King in check square
  const inCheckKingSquare = useMemo(() => {
    if (!isCheck) return null;
    const board = chess?.board?.() || [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board?.[r]?.[c] || null;
        if (p?.type === 'k' && p?.color === turn) {
          return `${String.fromCharCode(97 + c)}${8 - r}`;
        }
      }
    }
    return null;
  }, [isCheck, boardFen, turn]);

  // Legal moves calculation
  const { legalMoves, captureMoves } = useMemo(() => {
    if (!selectedSquare) return { legalMoves: [], captureMoves: [] };
    try {
      const moves = chess?.moves?.({ square: selectedSquare as Square, verbose: true }) || [];
      const legals: string[] = [];
      const caps: string[] = [];
      moves.forEach((m) => {
        if (m?.to) {
          legals.push(m.to);
          if (m?.captured) caps.push(m.to);
        }
      });
      return { legalMoves: legals, captureMoves: caps };
    } catch {
      return { legalMoves: [], captureMoves: [] };
    }
  }, [selectedSquare, boardFen]);

  // Three.js instances ref
  const threeRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    tileMeshes: Map<string, THREE.Mesh>;
    pieceGroups: Map<string, THREE.Group>;
    legalMarkerGroup: THREE.Group;
    ambientLight: THREE.AmbientLight;
    dirLight1: THREE.DirectionalLight;
    dirLight2: THREE.DirectionalLight;
    // Camera transition
    camStartPos: THREE.Vector3;
    camTargetPos: THREE.Vector3;
    camLookAtStart: THREE.Vector3;
    camLookAtTarget: THREE.Vector3;
    camAnimStart: number;
    camAnimDuration: number;
    isCamTransitioning: boolean;
    // Piece movement interpolation
    activePieceAnims: ActivePieceAnim[];
    capturedAnims: CapturedAnim[];
  } | null>(null);

  // Preload and extract Chessboard.glb piece templates
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.load(
      '/Chessboard.glb',
      (gltf: GLTF) => {
        const root = gltf.scene;
        const templates = new Map<string, THREE.Object3D>();

        // Catalog of key pieces in GLTF
        const mapping: Record<string, string> = {
          'Dark_Bishop_1': 'b-b',
          'Dark_King': 'b-k',
          'Dark_Knight_1': 'b-n',
          'Dark_Pawn_1': 'b-p',
          'Dark_Queen': 'b-q',
          'Dark_Rock_1': 'b-r',
          'Light_Bishop_1': 'w-b',
          'Light_King': 'w-k',
          'Light_Knight_1': 'w-n',
          'Light_Pawn_1': 'w-p',
          'Light_Queen': 'w-q',
          'Light_Rock_1': 'w-r',
        };

        root.traverse((obj) => {
          const rawName = obj.name || '';
          const cleanName = rawName.replace(/ /g, '_');
          if (mapping[cleanName]) {
            const pieceKey = mapping[cleanName];
            if (!templates.has(pieceKey)) {
              // Clone and center the piece template
              const clone = obj.clone(true);
              const box = new THREE.Box3().setFromObject(clone);
              const center = box.getCenter(new THREE.Vector3());

              // Normalize center around (0, 0, 0) with base on y = 0
              clone.position.set(-center.x, -box.min.y, -center.z);

              const wrapper = new THREE.Group();
              wrapper.add(clone);
              templates.set(pieceKey, wrapper);
            }
          }
        });

        glbTemplatesRef.current = templates;
        setIsGLBLoaded(true);
      },
      undefined,
      (err) => {
        console.warn('[3D Chess Studio]: Chessboard.glb could not be loaded, using procedural pieces', err);
      }
    );
  }, []);

  // Initialize Three.js WebGL Scene & Render Loop
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 11, 14);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // OrbitControls with full 360 free orbit capability
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.maxPolarAngle = Math.PI / 2.02; // prevent clipping beneath floor
    controls.minDistance = 4;
    controls.maxDistance = 32;

    // If user starts dragging, unlock free orbit mode
    controls.addEventListener('start', () => {
      if (threeRefs.current) {
        threeRefs.current.isCamTransitioning = false;
      }
      setCameraPreset('free');
    });

    // Lights
    const ambientLight = new THREE.AmbientLight(0xfff5ea, 0.8);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(10, 20, 15);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.bias = -0.0001;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xb0c4de, 0.6);
    dirLight2.position.set(-10, 12, -10);
    scene.add(dirLight2);

    // Table Slab
    const tableMesh = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.4, 22),
      new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.4, metalness: 0.1 })
    );
    tableMesh.position.y = -0.3;
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);

    // Chessboard Frame
    const frameMesh = new THREE.Mesh(
      new THREE.BoxGeometry(8 * SQUARE_SIZE + 1.2, BOARD_SURFACE_Y, 8 * SQUARE_SIZE + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x2d1c14, roughness: 0.35, metalness: 0.15 })
    );
    frameMesh.position.y = BOARD_SURFACE_Y / 2 - 0.05;
    frameMesh.receiveShadow = true;
    frameMesh.castShadow = true;
    scene.add(frameMesh);

    // Gold Trim Inlay
    const trimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(8 * SQUARE_SIZE + 0.16, 0.02, 8 * SQUARE_SIZE + 0.16),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.8 })
    );
    trimMesh.position.y = BOARD_SURFACE_Y - 0.01;
    scene.add(trimMesh);

    // 64 Independent Tiles
    const tileMeshes = new Map<string, THREE.Mesh>();
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const square = `${files[f]}${ranks[r]}`;
        const isLight = (f + r) % 2 === 1;
        const coords = squareToCoords(square);

        const tileMat = new THREE.MeshStandardMaterial({
          color: isLight ? 0xeee7d7 : 0x4a372c,
          roughness: isLight ? 0.3 : 0.4,
          metalness: 0.05,
        });

        const tileMesh = new THREE.Mesh(new THREE.BoxGeometry(SQUARE_SIZE, 0.08, SQUARE_SIZE), tileMat);
        tileMesh.position.set(coords.x, BOARD_SURFACE_Y, coords.z);
        tileMesh.receiveShadow = true;
        tileMesh.userData = { square };
        scene.add(tileMesh);
        tileMeshes.set(square, tileMesh);
      }
    }

    const legalMarkerGroup = new THREE.Group();
    scene.add(legalMarkerGroup);

    threeRefs.current = {
      scene,
      camera,
      renderer,
      controls,
      tileMeshes,
      pieceGroups: new Map(),
      legalMarkerGroup,
      ambientLight,
      dirLight1,
      dirLight2,
      camStartPos: new THREE.Vector3().copy(camera.position),
      camTargetPos: new THREE.Vector3(0, 11, 14),
      camLookAtStart: new THREE.Vector3(0, 0, 0),
      camLookAtTarget: new THREE.Vector3(0, 0, 0),
      camAnimStart: 0,
      camAnimDuration: 550,
      isCamTransitioning: false,
      activePieceAnims: [],
      capturedAnims: [],
    };

    // Render & Animation Loop
    let animId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      animId = requestAnimationFrame(animate);
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      if (threeRefs.current) {
        const refs = threeRefs.current;
        const { camera: cam, controls: ctrl } = refs;

        // Camera Transition Interpolation
        if (refs.isCamTransitioning) {
          const elapsed = now - refs.camAnimStart;
          const p = Math.min(1, elapsed / refs.camAnimDuration);
          // Ease out cubic
          const ease = 1 - Math.pow(1 - p, 3);

          cam.position.lerpVectors(refs.camStartPos, refs.camTargetPos, ease);
          ctrl.target.lerpVectors(refs.camLookAtStart, refs.camLookAtTarget, ease);

          if (p >= 1) {
            refs.isCamTransitioning = false;
          }
        }

        // Turntable Auto-Rotate
        ctrl.autoRotate = autoRotate;
        ctrl.autoRotateSpeed = 1.4;
        ctrl.update();

        // Piece Movement Interpolation (Frame-by-frame Lerp with Arc)
        if (refs.activePieceAnims.length > 0) {
          const nextAnims: ActivePieceAnim[] = [];
          for (const anim of refs.activePieceAnims) {
            const elapsed = now - anim.startTime;
            const p = Math.min(1, elapsed / anim.duration);
            // Smooth quadratic ease in-out
            const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

            anim.group.position.x = THREE.MathUtils.lerp(anim.from.x, anim.to.x, ease);
            anim.group.position.z = THREE.MathUtils.lerp(anim.from.z, anim.to.z, ease);
            // Graceful jump arc
            const arc = Math.sin(p * Math.PI) * anim.peakArc;
            anim.group.position.y = THREE.MathUtils.lerp(anim.from.y, anim.to.y, ease) + arc;

            if (p < 1) {
              nextAnims.push(anim);
            } else {
              anim.group.position.copy(anim.to);
              if (anim.onDone) anim.onDone();
            }
          }
          refs.activePieceAnims = nextAnims;
        }

        // Captured Pieces Animation (Shrinking / Sinking)
        if (refs.capturedAnims.length > 0) {
          const nextCaps: CapturedAnim[] = [];
          for (const cAnim of refs.capturedAnims) {
            const elapsed = now - cAnim.startTime;
            const p = Math.min(1, elapsed / cAnim.duration);
            const scale = Math.max(0.001, 1 - p);
            cAnim.group.scale.set(scale, scale, scale);
            cAnim.group.position.y -= delta * 0.5;

            if (p < 1) {
              nextCaps.push(cAnim);
            } else {
              refs.scene.remove(cAnim.group);
              cAnim.group.traverse((c) => {
                if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
              });
            }
          }
          refs.capturedAnims = nextCaps;
        }

        renderer.render(scene, cam);
      }
    };
    animate(performance.now());

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      threeRefs.current = null;
    };
  }, []);

  // Camera Presets Smooth Transition Handler
  const transitionCameraTo = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    if (!threeRefs.current) return;
    const refs = threeRefs.current;

    if (preset === 'free') {
      refs.isCamTransitioning = false;
      return;
    }

    refs.camStartPos.copy(refs.camera.position);
    refs.camLookAtStart.copy(refs.controls.target);
    refs.camLookAtTarget.set(0, 0, 0);

    switch (preset) {
      case 'white':
        refs.camTargetPos.set(0, 11, 14);
        break;
      case 'black':
        refs.camTargetPos.set(0, 11, -14);
        break;
      case 'top':
        refs.camTargetPos.set(0, 17, 0.05);
        break;
      case 'isometric':
        refs.camTargetPos.set(11, 12, 11);
        break;
    }

    refs.camAnimStart = performance.now();
    refs.camAnimDuration = 600;
    refs.isCamTransitioning = true;
  }, []);

  // Update Lighting Atmosphere
  useEffect(() => {
    if (!threeRefs.current) return;
    const { ambientLight, dirLight1, dirLight2, scene } = threeRefs.current;
    if (lightingTheme === 'midnight') {
      scene.background = new THREE.Color(0x06080e);
      ambientLight.color.setHex(0x7fc8f8);
      ambientLight.intensity = 0.4;
      dirLight1.color.setHex(0xe0f2fe);
      dirLight1.intensity = 1.8;
      dirLight2.color.setHex(0xa855f7);
      dirLight2.intensity = 1.2;
    } else if (lightingTheme === 'sunlit') {
      scene.background = new THREE.Color(0x181a20);
      ambientLight.color.setHex(0xffffff);
      ambientLight.intensity = 0.9;
      dirLight1.color.setHex(0xfef08a);
      dirLight1.intensity = 2.0;
      dirLight2.color.setHex(0x87ceeb);
      dirLight2.intensity = 0.7;
    } else if (lightingTheme === 'studio') {
      scene.background = new THREE.Color(0x121212);
      ambientLight.color.setHex(0xffffff);
      ambientLight.intensity = 0.8;
      dirLight1.color.setHex(0xffffff);
      dirLight1.intensity = 2.0;
      dirLight2.color.setHex(0xd0d0e0);
      dirLight2.intensity = 0.8;
    } else {
      scene.background = new THREE.Color(0x121212);
      ambientLight.color.setHex(0xfff5ea);
      ambientLight.intensity = 0.8;
      dirLight1.color.setHex(0xffffff);
      dirLight1.intensity = 1.5;
      dirLight2.color.setHex(0xb0c4de);
      dirLight2.intensity = 0.6;
    }
  }, [lightingTheme]);

  // Sync 3D Pieces with Chess State + Animate Moved Piece
  useEffect(() => {
    if (!threeRefs.current) return;
    const { scene, pieceGroups, activePieceAnims, capturedAnims } = threeRefs.current;
    const board = chess?.board?.() || [];

    // Map of pieces that should currently be on the board: square -> { type, color }
    const targetBoard = new Map<string, { type: string; color: 'w' | 'b' }>();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board?.[r]?.[c] || null;
        if (piece?.type && piece?.color) {
          const sq = `${String.fromCharCode(97 + c)}${8 - r}`;
          targetBoard.set(sq, { type: piece.type, color: piece.color });
        }
      }
    }

    const templates = glbTemplatesRef.current;
    const useGLB = pieceStyle === 'glb' && isGLBLoaded && templates.size > 0;

    // Check if we have a recent move that needs smooth position interpolation
    if (lastMove) {
      const movedMesh = pieceGroups.get(lastMove.from);
      const capturedMesh = pieceGroups.get(lastMove.to);

      // Animate captured piece dissolving
      if (capturedMesh) {
        pieceGroups.delete(lastMove.to);
        capturedAnims.push({
          group: capturedMesh,
          startTime: performance.now(),
          duration: 350,
        });
      }

      // Animate moved piece sliding smoothly with arc
      if (movedMesh) {
        pieceGroups.delete(lastMove.from);
        pieceGroups.set(lastMove.to, movedMesh);

        const targetCoords = squareToCoords(lastMove.to);
        const fromPos = new THREE.Vector3().copy(movedMesh.position);
        const toPos = new THREE.Vector3(targetCoords.x, BOARD_SURFACE_Y, targetCoords.z);

        activePieceAnims.push({
          group: movedMesh,
          from: fromPos,
          to: toPos,
          startTime: performance.now(),
          duration: 400,
          peakArc: 0.8,
        });
      }
    }

    // Now reconcile remaining pieces on the board
    // 1. Remove pieces that are no longer on target squares (and not currently in active animation)
    const activeAnimGroups = new Set(activePieceAnims.map((a) => a.group));
    const capturedAnimGroups = new Set(capturedAnims.map((a) => a.group));

    pieceGroups.forEach((group, square) => {
      const target = targetBoard.get(square);
      const isAnim = activeAnimGroups.has(group) || capturedAnimGroups.has(group);
      if (!isAnim && (!target || group.userData?.type !== target.type || group.userData?.color !== target.color)) {
        scene.remove(group);
        pieceGroups.delete(square);
        group.traverse((c) => {
          if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
        });
      }
    });

    // 2. Add or update missing pieces
    targetBoard.forEach((info, square) => {
      const existing = pieceGroups.get(square);
      if (!existing) {
        // Create piece (GLB or Procedural)
        const mesh = useGLB
          ? createGLFPieceMesh(info.type, info.color, templates)
          : createProceduralPieceMesh(info.type, info.color);

        mesh.userData = { square, type: info.type, color: info.color };
        const coords = squareToCoords(square);
        const isSelected = selectedSquare === square;
        mesh.position.set(coords.x, BOARD_SURFACE_Y + (isSelected ? 0.35 : 0), coords.z);
        scene.add(mesh);
        pieceGroups.set(square, mesh);
      } else {
        // Update lift if selected
        const coords = squareToCoords(square);
        const isSelected = selectedSquare === square;
        if (!activeAnimGroups.has(existing)) {
          existing.position.y = BOARD_SURFACE_Y + (isSelected ? 0.35 : 0);
        }
      }
    });
  }, [boardFen, pieceStyle, isGLBLoaded, selectedSquare]);

  // Update Tile Highlights
  useEffect(() => {
    if (!threeRefs.current) return;
    const { tileMeshes, legalMarkerGroup } = threeRefs.current;

    while (legalMarkerGroup.children.length > 0) {
      const child = legalMarkerGroup.children[0];
      legalMarkerGroup.remove(child);
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
    }

    tileMeshes.forEach((mesh, square) => {
      const safeMat = mesh.material as THREE.MeshStandardMaterial;
      if (!safeMat) return;

      const file = square.charCodeAt(0) - 97;
      const rank = parseInt(square[1], 10) - 1;
      const isLight = (file + rank) % 2 === 1;

      const isSelected = selectedSquare === square;
      const isHovered = hoveredSquare === square;
      const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
      const isKingCheck = inCheckKingSquare === square;

      if (isKingCheck) {
        safeMat.color.setHex(0xb91c1c);
        safeMat.emissive.setHex(0xef4444);
        safeMat.emissiveIntensity = 0.6;
      } else if (isSelected) {
        safeMat.color.setHex(0xd97706);
        safeMat.emissive.setHex(0xf59e0b);
        safeMat.emissiveIntensity = 0.5;
      } else if (isLast) {
        safeMat.color.setHex(isLight ? 0xfef08a : 0x854d0e);
        safeMat.emissive.setHex(0x000000);
        safeMat.emissiveIntensity = 0;
      } else if (isHovered) {
        safeMat.color.setHex(isLight ? 0xffffff : 0x5c4537);
        safeMat.emissive.setHex(0x000000);
        safeMat.emissiveIntensity = 0;
      } else {
        safeMat.color.setHex(isLight ? 0xeee7d7 : 0x4a372c);
        safeMat.emissive.setHex(0x000000);
        safeMat.emissiveIntensity = 0;
      }
    });

    // Legal move indicators
    legalMoves.forEach((sq) => {
      const coords = squareToCoords(sq);
      const isCapture = captureMoves.includes(sq);

      if (isCapture) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.68, 30),
          new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(coords.x, BOARD_SURFACE_Y + 0.05, coords.z);
        legalMarkerGroup.add(ring);
      } else {
        const dot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24, 0.24, 0.04, 20),
          new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.8 })
        );
        dot.position.set(coords.x, BOARD_SURFACE_Y + 0.05, coords.z);
        legalMarkerGroup.add(dot);
      }
    });
  }, [selectedSquare, hoveredSquare, legalMoves, captureMoves, lastMove, inCheckKingSquare]);

  // Execute Move Handler (Updates State Tokens Immediately)
  const handleMove = useCallback(
    (moveData: { from: string; to: string; promotion?: string }) => {
      try {
        const result = chess?.move?.({
          from: moveData.from,
          to: moveData.to,
          promotion: moveData.promotion || 'q',
        });

        if (result) {
          if (result?.captured) {
            chessAudio.playCapture();
            setCapturedPieces((prev) => ({
              ...prev,
              [result.color]: [...(prev?.[result.color] || []), result.captured!],
            }));
          } else {
            chessAudio.playMove();
          }

          if (chess.isCheckmate()) {
            chessAudio.playGameOver();
          } else if (chess.isCheck()) {
            chessAudio.playCheck();
          }

          // Force immediate state sync
          const nextFen = chess.fen();
          setMovesHistory((prev) => [
            ...(prev || []),
            {
              san: result?.san || '',
              from: result?.from || '',
              to: result?.to || '',
              piece: result?.piece || '',
              color: result?.color || 'w',
              captured: result?.captured,
              fen: nextFen,
            },
          ]);
          setLastMove({ from: moveData.from, to: moveData.to });
          setHintMove(null);
          setEvalScore(evaluateBoard(chess));

          // Critical state triggers for immediate re-render
          setBoardFen(nextFen);
          setMoveCount((c) => c + 1);
        }
      } catch (err) {
        console.error('Invalid move attempted:', err);
      }
    },
    [chess]
  );

  // Square Click / Raycast
  const handleSquareClick = (square: string) => {
    if (isAIThinking || !square) return;
    const pieceOnSquare = chess?.get?.(square as Square) || null;

    if (selectedSquare) {
      const moves = chess?.moves?.({ square: selectedSquare as Square, verbose: true }) || [];
      const valid = moves.find((m) => m?.to === square);

      if (valid) {
        const moving = chess?.get?.(selectedSquare as Square) || null;
        const isPromotion =
          moving?.type === 'p' &&
          ((moving?.color === 'w' && square[1] === '8') || (moving?.color === 'b' && square[1] === '1'));

        if (isPromotion) {
          setPromotionPending({ from: selectedSquare, to: square });
          setSelectedSquare(null);
          return;
        }

        handleMove({ from: selectedSquare, to: square });
        setSelectedSquare(null);
        return;
      }

      if (pieceOnSquare?.color === turn) {
        setSelectedSquare(square);
        chessAudio.playSelect();
        return;
      }
      setSelectedSquare(null);
    } else {
      if (pieceOnSquare?.color === turn) {
        setSelectedSquare(square);
        chessAudio.playSelect();
      }
    }
  };

  // Pointer Down Raycasting
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isAIThinking || !threeRefs.current || !containerRef.current) return;
    const { camera, tileMeshes } = threeRefs.current;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const tiles = Array.from(tileMeshes.values());
    const intersects = raycaster.intersectObjects(tiles, false);

    if (intersects.length > 0) {
      const clickedSq = intersects[0]?.object?.userData?.square as string;
      if (clickedSq) handleSquareClick(clickedSq);
    } else {
      setSelectedSquare(null);
    }
  };

  // Pointer Move Raycasting (Hover)
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!threeRefs.current || !containerRef.current) return;
    const { camera, tileMeshes } = threeRefs.current;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const tiles = Array.from(tileMeshes.values());
    const intersects = raycaster.intersectObjects(tiles, false);

    if (intersects.length > 0) {
      const sq = intersects[0]?.object?.userData?.square as string;
      setHoveredSquare(sq || null);
    } else {
      setHoveredSquare(null);
    }
  };

  // AI Turn Trigger with 600ms Thinking Delay & Immediate Visual Re-Render
  useEffect(() => {
    if (gameMode !== 'vs-ai' || turn !== 'b' || isCheckmate || isDraw) {
      setIsAIThinking(false);
      return;
    }

    let active = true;
    setIsAIThinking(true);

    // Realistic 600ms AI thinking delay
    const timer = setTimeout(async () => {
      if (!active) return;
      const aiMove = await getAIMove(chess, aiDifficulty);
      if (!active) return;

      if (aiMove?.from && aiMove?.to) {
        handleMove({ from: aiMove.from, to: aiMove.to, promotion: aiMove.promotion });
      }
      setIsAIThinking(false);
    }, 600);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [turn, boardFen, gameMode, aiDifficulty, isCheckmate, isDraw, handleMove]);

  // Undo Move
  const handleUndo = () => {
    if (!movesHistory?.length || isAIThinking) return;
    if (gameMode === 'vs-ai' && movesHistory.length >= 2) {
      chess.undo();
      chess.undo();
      setMovesHistory((prev) => prev.slice(0, -2));
    } else {
      chess.undo();
      setMovesHistory((prev) => prev.slice(0, -1));
    }
    const history = chess.history({ verbose: true }) || [];
    const caps: { w: string[]; b: string[] } = { w: [], b: [] };
    history.forEach((m) => {
      if (m?.captured && m?.color) caps[m.color].push(m.captured);
    });
    setCapturedPieces(caps);
    setLastMove(
      history.length > 0
        ? { from: history[history.length - 1]?.from || '', to: history[history.length - 1]?.to || '' }
        : null
    );
    setSelectedSquare(null);
    setHintMove(null);
    setEvalScore(evaluateBoard(chess));

    const nextFen = chess.fen();
    setBoardFen(nextFen);
    setMoveCount((c) => c + 1);
  };

  // Reset Game
  const handleReset = () => {
    chess.reset();
    setMovesHistory([]);
    setCapturedPieces({ w: [], b: [] });
    setLastMove(null);
    setSelectedSquare(null);
    setHintMove(null);
    setEvalScore(0);
    setBoardFen(chess.fen());
    setMoveCount((c) => c + 1);
  };

  // Hint
  const handleHint = async () => {
    setHintMove(null);
    const best = await getAIMove(chess, 'grandmaster');
    if (best?.from && best?.to) {
      setHintMove(`${best.from.toUpperCase()} → ${best.to.toUpperCase()} (${best.san || ''})`);
      setSelectedSquare(best.from);
    }
  };

  const evalPercent = 50 + Math.max(-50, Math.min(50, evalScore / 20));

  return (
    <ErrorBoundary fallbackTitle="Grandmaster 3D Chess Studio">
      <div className="w-screen h-screen overflow-hidden bg-[#121212] flex flex-col relative select-none">
        <main
          ref={containerRef}
          className="flex-1 w-full h-full min-h-[500px] relative cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        >
          {/* Native WebGL Canvas */}
          <canvas ref={canvasRef} className="w-full h-full min-h-[500px] block" />

          {/* Hover Coordinate Badge */}
          {hoveredSquare && (
            <div className="absolute bottom-4 left-4 z-20 pointer-events-none px-3.5 py-1.5 rounded-xl bg-neutral-900/90 backdrop-blur-md border border-neutral-800 text-xs font-mono text-neutral-300 shadow-lg">
              Square: <span className="text-amber-400 font-bold">{hoveredSquare.toUpperCase()}</span>
            </div>
          )}

          {/* TOP BAR HEADER */}
          <header className="absolute top-0 left-0 right-0 z-30 pointer-events-none p-3 sm:p-4 flex items-center justify-between">
            <div className="pointer-events-auto flex items-center space-x-3">
              <div className="flex items-center space-x-2 px-3.5 py-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-800 shadow-xl">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-neutral-950 font-bold text-sm shadow-md shadow-amber-500/20">
                  ♔
                </div>
                <div>
                  <h1 className="text-sm font-bold text-neutral-100 font-serif-title tracking-wide leading-none">
                    Grandmaster 3D
                  </h1>
                  <span className="text-[10px] text-amber-400/90 font-medium">
                    {gameMode === 'vs-ai' ? `AI (${aiDifficulty.toUpperCase()})` : 'Pass & Play'}
                  </span>
                </div>
              </div>

              {/* Model Style Indicator / Quick Switcher */}
              <button
                onClick={() => setPieceStyle(pieceStyle === 'glb' ? 'procedural' : 'glb')}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/60 text-xs font-medium text-neutral-200 transition shadow-lg group"
                title="Toggle Piece 3D Style (GLB Custom vs Procedural)"
              >
                <Layers className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                <span className="hidden sm:inline">
                  {pieceStyle === 'glb' && isGLBLoaded ? '3D Studio GLB Models' : 'Procedural Pieces'}
                </span>
                {pieceStyle === 'glb' && isGLBLoaded && (
                  <Sparkles className="w-3 h-3 text-amber-400 animate-pulse ml-0.5" />
                )}
              </button>
            </div>

            {/* Turn Status & Real-Time AI Thinking Indicator */}
            <div className="pointer-events-auto flex flex-col items-center">
              <div
                className={`flex items-center space-x-2 px-4 py-1.5 rounded-full backdrop-blur-md border shadow-xl transition-all ${
                  isAIThinking
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 ring-2 ring-amber-500/30'
                    : 'bg-neutral-900/90 border-neutral-800 text-neutral-200'
                }`}
              >
                {/* Status Dot / Spinner */}
                {isAIThinking ? (
                  <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                ) : (
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      isCheckmate
                        ? 'bg-red-500 animate-ping'
                        : isCheck
                        ? 'bg-red-500 animate-pulse'
                        : turn === 'w'
                        ? 'bg-amber-400'
                        : 'bg-neutral-400'
                    }`}
                  />
                )}

                <span className="text-xs font-medium">
                  {isCheckmate
                    ? `Checkmate! ${turn === 'w' ? 'Black' : 'White'} Wins`
                    : isDraw
                    ? 'Draw Game'
                    : isCheck
                    ? `Check! ${turn === 'w' ? 'White' : 'Black'} to move`
                    : isAIThinking
                    ? 'AI is calculating move...'
                    : `${turn === 'w' ? 'White' : 'Black'}'s Turn`}
                </span>
              </div>

              {/* Evaluation score bar */}
              <div className="mt-1 flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-neutral-950/70 border border-neutral-800/80 text-[10px] font-mono">
                <span className="text-neutral-400">Eval:</span>
                <span className={evalScore > 50 ? 'text-amber-400' : 'text-neutral-300'}>
                  {(evalScore / 100).toFixed(1)}
                </span>
                <div className="w-14 h-1.5 bg-neutral-800 rounded-full overflow-hidden flex">
                  <div className="bg-amber-400 h-full transition-all duration-300" style={{ width: `${evalPercent}%` }} />
                  <div className="bg-neutral-600 h-full transition-all duration-300" style={{ width: `${100 - evalPercent}%` }} />
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="pointer-events-auto flex items-center space-x-2">
              <button
                onClick={handleHint}
                title={hintMove ? `Suggested: ${hintMove}` : 'Ask AI for Hint'}
                className={`p-2 rounded-xl border backdrop-blur-md transition shadow-lg ${
                  hintMove
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
                    : 'bg-neutral-900/80 border-neutral-700/60 text-neutral-300'
                }`}
              >
                <Lightbulb className="w-4 h-4" />
              </button>
              <button
                onClick={handleUndo}
                disabled={movesHistory.length === 0 || isAIThinking}
                title="Undo Move"
                className="p-2 rounded-xl bg-neutral-900/80 disabled:opacity-40 border border-neutral-700/60 text-neutral-300 backdrop-blur-md transition shadow-lg"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  chessAudio.setEnabled(next);
                }}
                title={soundEnabled ? 'Mute' : 'Unmute'}
                className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-700/60 text-neutral-300 backdrop-blur-md transition shadow-lg"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4 text-neutral-500" />}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                title="Settings"
                className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-700/60 text-neutral-300 backdrop-blur-md transition shadow-lg"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Camera View Switcher (Free Orbit + Smooth Perspective Transitions) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center space-x-1.5 p-1.5 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-800 shadow-2xl">
            {[
              { id: 'white', label: 'White' },
              { id: 'black', label: 'Black' },
              { id: 'top', label: 'Top' },
              { id: 'isometric', label: 'Isometric' },
              { id: 'free', label: 'Free' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => transitionCameraTo(c.id as CameraPreset)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  cameraPreset === c.id
                    ? 'bg-amber-500 text-neutral-950 font-bold shadow-md shadow-amber-500/20'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                {c.label}
              </button>
            ))}
            <div className="w-[1px] h-4 bg-neutral-800 mx-1" />
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              title="Turntable 360 Spin"
              className={`p-1.5 rounded-xl transition ${
                autoRotate ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-neutral-400 hover:bg-neutral-800/60'
              }`}
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          {/* Right Move History */}
          <aside className="absolute top-20 right-4 z-20 w-60 bg-neutral-900/90 border border-neutral-800/90 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col max-h-[calc(100vh-140px)]">
            <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300 font-serif-title">
                Move Chronicle
              </span>
              <button onClick={handleReset} className="text-[11px] font-medium text-amber-400 hover:text-amber-300">
                New Game
              </button>
            </div>

            <div className="p-2.5 border-b border-neutral-800/80 bg-neutral-950/40 text-[11px] space-y-1">
              <div className="flex justify-between items-center text-neutral-400">
                <span>W captures: {capturedPieces?.w?.join(' ') || 'none'}</span>
              </div>
              <div className="flex justify-between items-center text-neutral-400">
                <span>B captures: {capturedPieces?.b?.join(' ') || 'none'}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
              {movesHistory.length === 0 ? (
                <div className="text-neutral-500 text-center py-4 italic">No moves yet</div>
              ) : (
                Array.from({ length: Math.ceil((movesHistory?.length || 0) / 2) }).map((_, i) => (
                  <div key={i} className="flex justify-between px-1 py-0.5 hover:bg-neutral-800/40 rounded">
                    <span className="text-neutral-500">{i + 1}.</span>
                    <span className="text-amber-200">{movesHistory?.[i * 2]?.san || ''}</span>
                    <span className="text-neutral-400">{movesHistory?.[i * 2 + 1]?.san || ''}</span>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Hint Overlay Banner */}
          {hintMove && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs shadow-xl animate-bounce flex items-center space-x-2">
              <Lightbulb className="w-4 h-4 fill-neutral-950" />
              <span>Recommended: {hintMove}</span>
            </div>
          )}
        </main>

        {/* Promotion Modal */}
        {promotionPending && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="w-full max-w-xs bg-neutral-900 border border-neutral-700 rounded-2xl p-5 text-center shadow-2xl">
              <h3 className="text-base font-bold font-serif-title text-neutral-100 mb-3">Pawn Promotion</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'q', name: 'Queen', sym: '♕' },
                  { id: 'r', name: 'Rook', sym: '♖' },
                  { id: 'b', name: 'Bishop', sym: '♗' },
                  { id: 'n', name: 'Knight', sym: '♘' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      handleMove({ from: promotionPending.from, to: promotionPending.to, promotion: item.id });
                      setPromotionPending(null);
                    }}
                    className="p-3 bg-neutral-800 hover:bg-amber-500/20 border border-neutral-700 rounded-xl transition"
                  >
                    <div className="text-3xl mb-1">{item.sym}</div>
                    <div className="text-xs font-semibold text-neutral-200">{item.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
                <h2 className="text-base font-bold font-serif-title text-neutral-100">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 3D Piece Model Selector */}
              <div>
                <label className="text-xs font-semibold uppercase text-neutral-400 block mb-2">3D Piece Models</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPieceStyle('glb')}
                    className={`p-3 rounded-xl text-left border transition ${
                      pieceStyle === 'glb'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className="text-xs font-bold">Chessboard.glb Models</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      {isGLBLoaded ? 'Loaded from repository' : 'Loading models...'}
                    </div>
                  </button>
                  <button
                    onClick={() => setPieceStyle('procedural')}
                    className={`p-3 rounded-xl text-left border transition ${
                      pieceStyle === 'procedural'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className="text-xs font-bold">Procedural Geometry</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">Built-in 3D shapes</div>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-neutral-400 block mb-2">Game Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'vs-ai', label: 'vs Computer AI' },
                    { id: 'pass-and-play', label: 'Pass & Play' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setGameMode(m.id as GameMode)}
                      className={`p-2 rounded-xl text-xs font-medium border transition ${
                        gameMode === m.id
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {gameMode === 'vs-ai' && (
                <div>
                  <label className="text-xs font-semibold uppercase text-neutral-400 block mb-2">AI Difficulty</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['novice', 'club', 'master', 'grandmaster'].map((d) => (
                      <button
                        key={d}
                        onClick={() => setAiDifficulty(d as AIDifficulty)}
                        className={`p-2 rounded-xl text-xs capitalize border transition ${
                          aiDifficulty === d
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold uppercase text-neutral-400 block mb-2">Lighting Atmosphere</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {['grandmaster', 'midnight', 'sunlit', 'studio'].map((l) => (
                    <button
                      key={l}
                      onClick={() => setLightingTheme(l as LightingTheme)}
                      className={`p-2 rounded-xl text-xs capitalize border transition ${
                        lightingTheme === l
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-800 flex justify-end">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
