import { Chess, Square, Move } from 'chess.js';
import { AIDifficulty } from '../types/chess';

// Piece base values
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Positional piece-square tables (from white's perspective, rank 8 to 1)
const PAWN_TABLE = [
  0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

const BISHOP_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

const ROOK_TABLE = [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0,
];

const QUEEN_TABLE = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

const KING_TABLE = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

// Evaluate board score from White's perspective
export function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw()) {
    return 0;
  }

  let totalScore = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const baseVal = PIECE_VALUES[piece.type] || 0;
      let posScore = 0;
      const squareIndex = r * 8 + c;
      const flippedIndex = (7 - r) * 8 + c;

      if (piece.type === 'p') {
        posScore = piece.color === 'w' ? PAWN_TABLE[squareIndex] : PAWN_TABLE[flippedIndex];
      } else if (piece.type === 'n') {
        posScore = piece.color === 'w' ? KNIGHT_TABLE[squareIndex] : KNIGHT_TABLE[flippedIndex];
      } else if (piece.type === 'b') {
        posScore = piece.color === 'w' ? BISHOP_TABLE[squareIndex] : BISHOP_TABLE[flippedIndex];
      } else if (piece.type === 'r') {
        posScore = piece.color === 'w' ? ROOK_TABLE[squareIndex] : ROOK_TABLE[flippedIndex];
      } else if (piece.type === 'q') {
        posScore = piece.color === 'w' ? QUEEN_TABLE[squareIndex] : QUEEN_TABLE[flippedIndex];
      } else if (piece.type === 'k') {
        posScore = piece.color === 'w' ? KING_TABLE[squareIndex] : KING_TABLE[flippedIndex];
      }

      const score = baseVal + posScore;
      totalScore += piece.color === 'w' ? score : -score;
    }
  }

  return totalScore;
}

// Alpha-Beta Minimax search
function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }

  const moves = chess.moves({ verbose: true });

  // Prioritize captures and checks for faster alpha-beta cutoffs
  moves.sort((a, b) => {
    const scoreA = (a.captured ? 10 : 0) + (a.san.includes('+') ? 5 : 0);
    const scoreB = (b.captured ? 10 : 0) + (b.san.includes('+') ? 5 : 0);
    return scoreB - scoreA;
  });

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const evaluation = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxEval = Math.max(maxEval, evaluation);
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      chess.move(move);
      const evaluation = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minEval = Math.min(minEval, evaluation);
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// Get the best move for the AI
export async function getAIMove(
  chess: Chess,
  difficulty: AIDifficulty
): Promise<Move | null> {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  // Small delay to simulate thinking
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (difficulty === 'novice') {
    // 60% random, 40% depth 1
    if (Math.random() < 0.6) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
  }

  const isWhite = chess.turn() === 'w';
  let bestMove: Move = moves[0];
  let bestScore = isWhite ? -Infinity : Infinity;

  const depth = difficulty === 'grandmaster' ? 3 : difficulty === 'master' ? 2 : 1;

  for (const move of moves) {
    chess.move(move);
    // At depth 1 or higher with alpha-beta
    const score = minimax(
      chess,
      depth - 1,
      -Infinity,
      Infinity,
      !isWhite
    );
    chess.undo();

    // Add tiny jitter to avoid repetitive play on equal moves
    const jitter = (Math.random() - 0.5) * (difficulty === 'novice' ? 40 : 5);
    const adjustedScore = score + jitter;

    if (isWhite) {
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestMove = move;
      }
    } else {
      if (adjustedScore < bestScore) {
        bestScore = adjustedScore;
        bestMove = move;
      }
    }
  }

  return bestMove;
}
