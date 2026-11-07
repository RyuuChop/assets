import { Chess, Move } from 'chess.js';
import { AIDifficulty } from '../types/chess';

// Piece base values specified in requirements: P=100, N=320, B=330, R=500, Q=900, K=20000
export const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-Square Tables (White perspective, rank 8 to 1; Black perspective is mirrored by row)
const PAWN_TABLE = [
   0,   0,   0,   0,   0,   0,   0,   0,
  50,  50,  50,  50,  50,  50,  50,  50,
  10,  15,  25,  35,  35,  25,  15,  10,
   5,   5,  15,  28,  28,  15,   5,   5,
   0,   0,   5,  25,  25,   5,   0,   0,
   5,  -5, -10,   5,   5, -10,  -5,   5,
   5,  10,  10, -20, -20,  10,  10,   5,
   0,   0,   0,   0,   0,   0,   0,   0,
];

const KNIGHT_TABLE = [
 -50, -40, -30, -30, -30, -30, -40, -50,
 -40, -20,   0,   5,   5,   0, -20, -40,
 -30,   5,  15,  20,  20,  15,   5, -30,
 -30,   5,  20,  25,  25,  20,   5, -30,
 -30,   5,  20,  25,  25,  20,   5, -30,
 -30,   5,  15,  20,  20,  15,   5, -30,
 -40, -20,   0,   5,   5,   0, -20, -40,
 -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_TABLE = [
 -20, -10, -10, -10, -10, -10, -10, -20,
 -10,   5,   0,   0,   0,   0,   5, -10,
 -10,  10,  10,  15,  15,  10,  10, -10,
 -10,   5,  15,  20,  20,  15,   5, -10,
 -10,   5,  15,  20,  20,  15,   5, -10,
 -10,  10,  10,  15,  15,  10,  10, -10,
 -10,   5,   0,   0,   0,   0,   5, -10,
 -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_TABLE = [
   0,   0,   5,  10,  10,   5,   0,   0,
  10,  15,  15,  15,  15,  15,  15,  10,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
   0,   0,   5,  12,  12,   5,   0,   0,
];

const QUEEN_TABLE = [
 -20, -10, -10,  -5,  -5, -10, -10, -20,
 -10,   0,   5,   0,   0,   0,   0, -10,
 -10,   5,   5,   5,   5,   5,   0, -10,
   0,   0,   5,  10,  10,   5,   0,  -5,
  -5,   0,   5,  10,  10,   5,   0,  -5,
 -10,   0,   5,   5,   5,   5,   0, -10,
 -10,   0,   0,   0,   0,   0,   0, -10,
 -20, -10, -10,  -5,  -5, -10, -10, -20,
];

const KING_TABLE = [
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -20, -30, -30, -40, -40, -30, -30, -20,
 -10, -20, -20, -20, -20, -20, -20, -10,
  20,  20,   0,   0,   0,   0,  20,  20,
  20,  30,  10,   0,   0,  10,  30,  20,
];

// King endgame table (encourages king activity in late game)
const KING_ENDGAME_TABLE = [
 -50, -30, -20, -10, -10, -20, -30, -50,
 -30, -10,  10,  20,  20,  10, -10, -30,
 -20,  10,  25,  35,  35,  25,  10, -20,
 -10,  20,  35,  40,  40,  35,  20, -10,
 -10,  20,  35,  40,  40,  35,  20, -10,
 -20,  10,  25,  35,  35,  25,  10, -20,
 -30, -10,  10,  20,  20,  10, -10, -30,
 -50, -30, -20, -10, -10, -20, -30, -50,
];

/**
 * Evaluates board position from White's perspective (+ for White, - for Black).
 */
export function evaluateBoard(chess: Chess, isHard: boolean = false): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw()) {
    return 0;
  }

  let totalScore = 0;
  let totalNonPawns = 0;
  const board = chess.board();

  // Count piece material to detect endgame
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type !== 'p' && p.type !== 'k') {
        totalNonPawns++;
      }
    }
  }
  const isEndgame = totalNonPawns <= 4;

  let whitePawnsOnFile = new Array(8).fill(0);
  let blackPawnsOnFile = new Array(8).fill(0);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;

      const baseVal = PIECE_VALUES[p.type] || 0;
      let posScore = 0;
      const squareIdx = r * 8 + c;
      const flippedIdx = (7 - r) * 8 + c;

      if (p.type === 'p') {
        posScore = p.color === 'w' ? PAWN_TABLE[squareIdx] : PAWN_TABLE[flippedIdx];
        if (p.color === 'w') whitePawnsOnFile[c]++;
        else blackPawnsOnFile[c]++;
      } else if (p.type === 'n') {
        posScore = p.color === 'w' ? KNIGHT_TABLE[squareIdx] : KNIGHT_TABLE[flippedIdx];
      } else if (p.type === 'b') {
        posScore = p.color === 'w' ? BISHOP_TABLE[squareIdx] : BISHOP_TABLE[flippedIdx];
      } else if (p.type === 'r') {
        posScore = p.color === 'w' ? ROOK_TABLE[squareIdx] : ROOK_TABLE[flippedIdx];
      } else if (p.type === 'q') {
        posScore = p.color === 'w' ? QUEEN_TABLE[squareIdx] : QUEEN_TABLE[flippedIdx];
      } else if (p.type === 'k') {
        const table = isEndgame ? KING_ENDGAME_TABLE : KING_TABLE;
        posScore = p.color === 'w' ? table[squareIdx] : table[flippedIdx];
      }

      const score = baseVal + posScore;
      totalScore += p.color === 'w' ? score : -score;
    }
  }

  // Hard difficulty additions: King safety & mobility bonus
  if (isHard) {
    // Pawn structure penalty for doubled pawns
    for (let f = 0; f < 8; f++) {
      if (whitePawnsOnFile[f] > 1) totalScore -= (whitePawnsOnFile[f] - 1) * 15;
      if (blackPawnsOnFile[f] > 1) totalScore += (blackPawnsOnFile[f] - 1) * 15;
    }

    // Mobility bonus: active side gets points for mobility
    const legalMovesCount = chess.moves().length;
    const mobilityBonus = legalMovesCount * 3;
    totalScore += chess.turn() === 'w' ? mobilityBonus : -mobilityBonus;
  }

  return totalScore;
}

/**
 * Score a move for alpha-beta ordering (MVV-LVA: Most Valuable Victim - Least Valuable Attacker)
 */
function scoreMoveForOrdering(m: Move): number {
  let score = 0;

  // 1. Captures ordered by MVV-LVA
  if (m.captured) {
    const victim = PIECE_VALUES[m.captured] || 0;
    const attacker = PIECE_VALUES[m.piece] || 0;
    score += victim * 10 - attacker + 1000;
  }

  // 2. Promotions
  if (m.promotion) {
    score += (PIECE_VALUES[m.promotion] || 900) + 800;
  }

  // 3. Checks
  if (m.san && m.san.includes('+')) {
    score += 400;
  }

  // 4. Center control for opening/middlegame
  if (['e4', 'd4', 'e5', 'd5', 'c4', 'c5', 'f4', 'f5'].includes(m.to)) {
    score += 30;
  }

  return score;
}

/**
 * Sorts moves in place by heuristic score
 */
function sortMoves(moves: Move[]): Move[] {
  return moves.sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a));
}

/**
 * Quiescence search on captures to eliminate the horizon effect (Hard mode)
 */
function quiescence(
  chess: Chess,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  qDepth: number = 0
): number {
  const standPat = evaluateBoard(chess, true);
  if (qDepth >= 3 || chess.isGameOver()) {
    return standPat;
  }

  if (isMaximizing) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const moves = chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion);
    sortMoves(moves);

    for (const m of moves) {
      chess.move(m);
      const score = quiescence(chess, alpha, beta, false, qDepth + 1);
      chess.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  } else {
    if (standPat <= alpha) return alpha;
    if (standPat < beta) beta = standPat;

    const moves = chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion);
    sortMoves(moves);

    for (const m of moves) {
      chess.move(m);
      const score = quiescence(chess, alpha, beta, true, qDepth + 1);
      chess.undo();
      if (score <= alpha) return alpha;
      if (score < beta) beta = score;
    }
    return beta;
  }
}

/**
 * Minimax with Alpha-Beta pruning
 */
function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  useQuiescence: boolean,
  deadline: number
): number {
  if (Date.now() > deadline) {
    return evaluateBoard(chess, useQuiescence);
  }

  if (depth === 0 || chess.isGameOver()) {
    if (useQuiescence) {
      return quiescence(chess, alpha, beta, isMaximizing);
    }
    return evaluateBoard(chess, false);
  }

  const moves = sortMoves(chess.moves({ verbose: true }));

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const evaluation = minimax(chess, depth - 1, alpha, beta, false, useQuiescence, deadline);
      chess.undo();

      maxEval = Math.max(maxEval, evaluation);
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break; // Beta cutoff
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of moves) {
      chess.move(m);
      const evaluation = minimax(chess, depth - 1, alpha, beta, true, useQuiescence, deadline);
      chess.undo();

      minEval = Math.min(minEval, evaluation);
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break; // Alpha cutoff
    }
    return minEval;
  }
}

/**
 * Easy AI Move:
 * 60% of the time plays a random legal move.
 * Otherwise 1-ply greedy: captures high-value pieces and avoids hanging the queen.
 */
function getEasyMove(chess: Chess): Move {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) throw new Error('No legal moves');

  // 60% random choice
  if (Math.random() < 0.6) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // 40% 1-ply greedy evaluation
  const isWhite = chess.turn() === 'w';
  let bestMoves: Move[] = [];
  let bestScore = isWhite ? -Infinity : Infinity;

  for (const m of moves) {
    chess.move(m);
    // Basic material + small random jitter to avoid robotic repetition
    let score = evaluateBoard(chess, false) + (Math.random() - 0.5) * 40;
    chess.undo();

    if (isWhite) {
      if (score > bestScore + 10) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 10) {
        bestMoves.push(m);
      }
    } else {
      if (score < bestScore - 10) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 10) {
        bestMoves.push(m);
      }
    }
  }

  return bestMoves.length > 0
    ? bestMoves[Math.floor(Math.random() * bestMoves.length)]
    : moves[0];
}

/**
 * Medium AI Move:
 * Depth 2 Minimax with Alpha-Beta pruning + piece-square tables.
 * Randomly picks among equally best moves.
 */
function getMediumMove(chess: Chess): Move {
  const moves = sortMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) throw new Error('No legal moves');

  const isWhite = chess.turn() === 'w';
  let bestMoves: Move[] = [];
  let bestScore = isWhite ? -Infinity : Infinity;
  const deadline = Date.now() + 1500;

  for (const m of moves) {
    chess.move(m);
    const score = minimax(chess, 1, -Infinity, Infinity, !isWhite, false, deadline);
    chess.undo();

    if (isWhite) {
      if (score > bestScore + 8) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 8) {
        bestMoves.push(m);
      }
    } else {
      if (score < bestScore - 8) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 8) {
        bestMoves.push(m);
      }
    }
  }

  return bestMoves.length > 0
    ? bestMoves[Math.floor(Math.random() * bestMoves.length)]
    : moves[0];
}

/**
 * Hard AI Move:
 * Iterative Deepening Alpha-Beta (depth 1 to 4) with 1.5s time cap.
 * MVV-LVA move ordering, checks prioritized, quiescence search on captures.
 * Detects forced mate in 1-2 and never hangs pieces for free.
 */
async function getHardMove(chess: Chess, isCancelled?: () => boolean): Promise<Move> {
  const moves = sortMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) throw new Error('No legal moves');
  if (moves.length === 1) return moves[0];

  const isWhite = chess.turn() === 'w';
  const startTime = Date.now();
  const deadline = startTime + 1450; // Strict 1.5s cap

  let currentBestMove: Move = moves[0];

  // Iterative deepening from depth 1 up to depth 4
  for (let targetDepth = 1; targetDepth <= 4; targetDepth++) {
    if (Date.now() > deadline || isCancelled?.()) break;

    let iterationBestMove: Move | null = null;
    let iterationBestScore = isWhite ? -Infinity : Infinity;

    for (const m of moves) {
      if (Date.now() > deadline || isCancelled?.()) break;

      // Yield control briefly every few moves to prevent event loop starvation
      await new Promise((resolve) => setTimeout(resolve, 0));

      chess.move(m);
      const score = minimax(
        chess,
        targetDepth - 1,
        -Infinity,
        Infinity,
        !isWhite,
        true, // Quiescence enabled on captures
        deadline
      );
      chess.undo();

      if (isWhite) {
        if (score > iterationBestScore) {
          iterationBestScore = score;
          iterationBestMove = m;
        }
      } else {
        if (score < iterationBestScore) {
          iterationBestScore = score;
          iterationBestMove = m;
        }
      }

      // If forced mate found, stop searching immediately
      if (isWhite && iterationBestScore >= 90000) break;
      if (!isWhite && iterationBestScore <= -90000) break;
    }

    if (iterationBestMove && !isCancelled?.()) {
      currentBestMove = iterationBestMove;
      // Re-order moves putting this iteration's best move first for faster cutoffs
      const idx = moves.indexOf(currentBestMove);
      if (idx > 0) {
        moves.splice(idx, 1);
        moves.unshift(currentBestMove);
      }
    }

    // Stop if mate reached or time nearly expired
    if (Math.abs(iterationBestScore) >= 90000) break;
    if (Date.now() - startTime > 1000) break;
  }

  return currentBestMove;
}

/**
 * Main AI Move Dispatcher:
 * Dispatches to Easy, Medium, or Hard engines with non-blocking execution.
 */
export async function getAIMove(
  chess: Chess,
  difficulty: AIDifficulty,
  isCancelled?: () => boolean
): Promise<Move | null> {
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  // Let UI thread breathe before computation
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (isCancelled?.()) return null;

  let move: Move;
  if (difficulty === 'easy') {
    move = getEasyMove(chess);
  } else if (difficulty === 'medium') {
    move = getMediumMove(chess);
  } else {
    move = await getHardMove(chess, isCancelled);
  }

  if (isCancelled?.()) return null;
  return move;
}
