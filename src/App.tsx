import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment, ContactShadows, AdaptiveDpr } from '@react-three/drei';
import { Chess, Square } from 'chess.js';
import { RotateCcw, Sparkles, RefreshCw, Crown, Volume2, VolumeX, Swords, Bot, Trophy, Play, RotateCw, X, Palette, Sun, Moon, Sunrise, Check, Camera, Compass, Lock, Unlock, PlusCircle, Box, Layers, Lightbulb } from 'lucide-react';
import { chessAudio } from './utils/chessAudio';
import { getAIMove } from './utils/chessEngine';
import { AppMode, AIDifficulty, PlayerColorChoice, GameOverState } from './types/chess';
import { THEMES, BOARD_PRESETS, ENVIRONMENT_PRESETS, ChessTheme, BoardStyleConfig, EnvironmentPresetKey, DISCOVERED_MODEL_SETS, findModelSet, DiscoveredModelSet, PieceColorOverrides, resolvePieceModelPath } from './config/themes';
import { squareToCoords } from './scene/animationUtils';
import { loadPersistedSettings, savePersistedSettings } from './utils/persistedSettings';
import { ActivePiece, Piece } from './scene/Piece';
import { PiecesLayer } from './scene/PiecesLayer';
import { CustomizableChessBoard } from './scene/ChessBoard';
import { CameraController, CameraTransitionRequest, DemandFramePacer } from './scene/CameraController';
import { ModeModal } from './components/ModeModal';

// Re-exports keep every previous `import ... from './App'` working.
export { ErrorBoundary } from './components/ErrorBoundary';
export { getNormalizedTemplate } from './scene/pieceTemplates';
export { squareToCoords } from './scene/animationUtils';
export type { ActivePiece } from './scene/Piece';
export type { CameraTransitionRequest } from './scene/CameraController';

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
    // findModelSet maps ids of removed duplicate sets (from old saved settings) to their replacement
    () => findModelSet(initialSettings?.modelSetId || activeTheme.defaultModelSetId || 'default').id
  );

  const activeModelSet = useMemo(
    () => findModelSet(activeModelSetId),
    [activeModelSetId]
  );

  const [useOriginalMaterials, setUseOriginalMaterials] = useState<boolean>(
    initialSettings?.useOriginalMaterials ?? false
  );

  const [boardConfig, setBoardConfig] = useState<BoardStyleConfig>(
    initialSettings?.board || activeTheme.board
  );

  // User adjustments to piece colours, layered over the active theme (cleared when a theme is picked)
  const [pieceColors, setPieceColors] = useState<PieceColorOverrides>(
    initialSettings?.pieceColors || {}
  );

  // Per model set knight facing chosen by the user (degrees). Missing = the set's own default.
  const [knightYawBySet, setKnightYawBySet] = useState<Record<string, number>>(
    initialSettings?.knightYawBySet || {}
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
    (
      targetPos: THREE.Vector3,
      targetLook: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
      duration: number = 700,
      keepDistanceAndTilt: boolean = false
    ) => {
      setCameraTransition({
        id: Date.now() + Math.random(),
        targetPos,
        targetLook,
        duration,
        keepDistanceAndTilt,
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
      pieceColors,
      knightYawBySet,
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
    pieceColors,
    knightYawBySet,
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
      if (set.heavy) return; // big file: only loaded when the user selects it
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

  const aiBusyRef = useRef<boolean>(false); // a move search is running inside the worker

  const spawnAIWorker = useCallback((): Worker | null => {
    try {
      return new Worker(new URL('./workers/aiWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      return null; // askAI falls back to the main thread
    }
  }, []);

  // Initialize Web Worker for AI engine so rendering never stutters
  useEffect(() => {
    aiWorkerRef.current = spawnAIWorker();
    return () => {
      aiWorkerRef.current?.terminate();
      aiWorkerRef.current = null;
    };
  }, [spawnAIWorker]);

  /** Throws away the worker (and whatever it is still thinking about) and starts a fresh one. */
  const restartAIWorker = useCallback(() => {
    aiWorkerRef.current?.terminate();
    aiWorkerRef.current = spawnAIWorker();
    aiBusyRef.current = false;
  }, [spawnAIWorker]);

  // Human-looking pause before the computer answers (a long search already counts towards it)
  const aiHumanDelay = (diff: AIDifficulty): number =>
    diff === 'easy'
      ? 700 + Math.random() * 200
      : diff === 'medium'
      ? 850 + Math.random() * 250
      : diff === 'hard'
      ? 1050 + Math.random() * 300
      : 900 + Math.random() * 300;

  /** Asks the AI for a move. Runs in the worker; without a worker it uses the main thread. */
  const askAI = useCallback(
    (
      fenToSearch: string,
      diff: AIDifficulty,
      positionHistory: string[],
      purpose: 'move' | 'hint',
      jobId: number,
      isStale: () => boolean
    ) =>
      new Promise<{ from: string; to: string } | null>((resolve) => {
        const worker = aiWorkerRef.current;
        if (worker) {
          if (purpose === 'move') aiBusyRef.current = true;
          const onMessage = (e: MessageEvent) => {
            if (e.data.jobId !== jobId) return;
            worker.removeEventListener('message', onMessage);
            if (purpose === 'move') aiBusyRef.current = false;
            resolve(e.data.move ? { from: e.data.move.from, to: e.data.move.to } : null);
          };
          worker.addEventListener('message', onMessage);
          worker.postMessage({ jobId, fen: fenToSearch, difficulty: diff, history: positionHistory, purpose });
        } else {
          getAIMove(new Chess(fenToSearch), diff, isStale)
            .then((m) => resolve(m ? { from: m.from, to: m.to } : null))
            .catch(() => resolve(null));
        }
      }),
    []
  );

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
              900,
              true // swing around the board, keep the user's zoom and tilt
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
  // Positions BEFORE each move of the game so far; the AI uses them to avoid repeating positions
  const getPositionHistory = useCallback((): string[] => {
    const replay = new Chess();
    const before: string[] = [];
    for (const m of chess.history({ verbose: true })) {
      before.push(replay.fen());
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return before;
  }, [chess]);

  const triggerAIMove = useCallback(() => {
    if (gameOver.isOver || isAnimatingRef.current) return;
    if (appMode !== 'ai') return;
    if (chess.turn() === playerActualColor) return;

    const currentJobId = ++aiJobIdRef.current;
    setIsAIThinking(true);

    const startedAt = performance.now();
    const minDelay = aiHumanDelay(difficulty);
    const isStale = () => currentJobId !== aiJobIdRef.current;

    askAI(chess.fen(), difficulty, getPositionHistory(), 'move', currentJobId, isStale).then((aiMove) => {
      if (isStale()) return;
      // never answer faster than a person would; a long search has already taken its time
      const wait = Math.max(0, minDelay - (performance.now() - startedAt));
      window.setTimeout(() => {
        if (isStale()) return;
        setIsAIThinking(false);
        if (aiMove) executeMove(aiMove.from, aiMove.to);
      }, wait);
    });
  }, [appMode, chess, difficulty, executeMove, gameOver.isOver, playerActualColor, askAI, getPositionHistory]);

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
      // a new game cancels whatever the AI was still thinking about (job id + worker)
      if (aiBusyRef.current) restartAIWorker();
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
        const startedAt = performance.now();
        const minDelay = aiHumanDelay(diff);
        const isStale = () => jobId !== aiJobIdRef.current;
        askAI(chess.fen(), diff, [], 'move', jobId, isStale).then((aiMove) => {
          if (isStale()) return;
          const wait = Math.max(0, minDelay - (performance.now() - startedAt));
          window.setTimeout(() => {
            if (isStale()) return;
            if (aiMove) executeMove(aiMove.from, aiMove.to);
            setIsAIThinking(false);
          }, wait);
        });
      }
    },
    [chess, executeMove, syncPiecesFromBoard, triggerCameraTransition, askAI, restartAIWorker]
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
    setPieceColors({});
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

  // ---- Hint (Player vs AI only) -------------------------------------------------------------
  // Asks the AI worker for the best move for the human player (always at Hard strength, whatever
  // the game difficulty is) and highlights it on the board. Cleared as soon as the position changes.
  const [hint, setHint] = useState<{ from: string; to: string; san: string } | null>(null);
  const [isHintLoading, setIsHintLoading] = useState<boolean>(false);
  const hintJobIdRef = useRef<number>(1_000_000); // separate id range from the AI's own jobs

  useEffect(() => {
    // any move / undo / reset / new game / mode change invalidates the hint and any pending request
    hintJobIdRef.current++;
    setHint(null);
    setIsHintLoading(false);
  }, [moveHistory.length, gameStarted, appMode]);

  const canRequestHint =
    gameStarted &&
    appMode === 'ai' &&
    !gameOver.isOver &&
    !isAIThinking &&
    // NOTE: do not use `hasActiveAnimation` here. Pieces clear their own `animating` flag by
    // mutation (no React update), so that memo stays `true` after the first move and would keep the
    // hint disabled forever. `isAnimatingRef` is reset reliably when a move animation completes.
    !isAnimatingRef.current &&
    chess.turn() === playerActualColor;

  const handleHint = useCallback(() => {
    if (hint) {
      setHint(null); // second click hides the hint
      return;
    }
    if (!canRequestHint || isHintLoading) return;

    const jobId = ++hintJobIdRef.current;
    const fen = chess.fen();
    setIsHintLoading(true);
    window.setTimeout(() => {
      if (jobId === hintJobIdRef.current) setIsHintLoading(false);
    }, 10000);

    const finish = (move: { from: string; to: string } | null | undefined) => {
      if (jobId !== hintJobIdRef.current) return; // position changed meanwhile
      setIsHintLoading(false);
      if (!move) return;
      const san = new Chess(fen)
        .moves({ verbose: true })
        .find((m) => m.from === move.from && m.to === move.to)?.san;
      setHint({ from: move.from, to: move.to, san: san ?? `${move.from}-${move.to}` });
    };

    // the worker always answers a 'hint' with its strongest, non-random move
    askAI(fen, 'extreme', getPositionHistory(), 'hint', jobId, () => jobId !== hintJobIdRef.current)
      .then(finish)
      .catch(() => {
        if (jobId === hintJobIdRef.current) setIsHintLoading(false);
      });
  }, [hint, canRequestHint, isHintLoading, chess, askAI, getPositionHistory]);

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
            hint={hint}
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
              pieceColors={pieceColors}
              knightYawOverride={
                knightYawBySet[activeModelSet.id] !== undefined
                  ? (knightYawBySet[activeModelSet.id] * Math.PI) / 180
                  : undefined
              }
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

            {appMode === 'ai' && (
              <button
                onClick={handleHint}
                disabled={!hint && (!canRequestHint || isHintLoading)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl disabled:opacity-40 text-xs font-semibold transition border ${
                  hint
                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/50'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700/50 disabled:hover:bg-neutral-800'
                }`}
                title={hint ? 'Hide hint' : 'Show the best move'}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span>{isHintLoading ? 'Thinking...' : hint ? `Hint: ${hint.san}` : 'Hint'}</span>
              </button>
            )}

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

                {/* Option: knight facing (fixes models whose horse faces sideways/backwards) */}
                <div className="p-2 rounded-xl bg-neutral-800/50 border border-neutral-700/60 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Knight facing (this set)</span>
                    {knightYawBySet[activeModelSet.id] !== undefined && (
                      <button
                        onClick={() =>
                          setKnightYawBySet((prev) => {
                            const next = { ...prev };
                            delete next[activeModelSet.id];
                            return next;
                          })
                        }
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold"
                      >
                        Auto
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[0, 90, 180, 270].map((deg) => {
                      const selected = knightYawBySet[activeModelSet.id] === deg;
                      return (
                        <button
                          key={deg}
                          onClick={() => setKnightYawBySet((prev) => ({ ...prev, [activeModelSet.id]: deg }))}
                          className={`py-1.5 rounded-lg font-mono text-[11px] border transition ${
                            selected
                              ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold'
                              : 'bg-neutral-900 text-neutral-300 border-neutral-700 hover:bg-neutral-800'
                          }`}
                        >
                          {deg}°
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-neutral-500">
                    If knights look sideways or backwards, try another angle until White knights face Black.
                  </p>
                </div>
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

              {/* 4b. Piece Color Pickers & Sliders */}
              <div className="p-3 bg-neutral-950/40 rounded-2xl border border-neutral-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                    Piece Colors
                  </label>
                  {Object.keys(pieceColors).length > 0 && (
                    <button
                      onClick={() => setPieceColors({})}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {useOriginalMaterials && (
                  <p className="text-[10px] text-neutral-500">
                    "Original materials" is on, so these colors are not applied. Turn it off to use them.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-neutral-400 block mb-1">White Pieces</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={pieceColors.white ?? activeTheme.pieceMaterials.white.color}
                        onChange={(e) => setPieceColors((prev) => ({ ...prev, white: e.target.value }))}
                        className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-neutral-300">
                        {pieceColors.white ?? activeTheme.pieceMaterials.white.color}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 block mb-1">Black Pieces</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={pieceColors.black ?? activeTheme.pieceMaterials.black.color}
                        onChange={(e) => setPieceColors((prev) => ({ ...prev, black: e.target.value }))}
                        className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-neutral-300">
                        {pieceColors.black ?? activeTheme.pieceMaterials.black.color}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-neutral-800">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">Piece Roughness</span>
                    <span className="font-mono text-amber-400">
                      {(pieceColors.roughness ?? activeTheme.pieceMaterials.white.roughness).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={pieceColors.roughness ?? activeTheme.pieceMaterials.white.roughness}
                    onChange={(e) =>
                      setPieceColors((prev) => ({ ...prev, roughness: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-neutral-400">Piece Metalness</span>
                    <span className="font-mono text-amber-400">
                      {(pieceColors.metalness ?? activeTheme.pieceMaterials.white.metalness).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={pieceColors.metalness ?? activeTheme.pieceMaterials.white.metalness}
                    onChange={(e) =>
                      setPieceColors((prev) => ({ ...prev, metalness: parseFloat(e.target.value) }))
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
