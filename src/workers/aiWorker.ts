import { Chess, Move } from 'chess.js';
import { AIDifficulty } from '../types/chess';
import { evaluateBoard } from '../utils/chessEngine';

// Base piece values: P=100, N=320, B=330, R=500, Q=900, K=20000
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

function scoreMoveForOrdering(m: Move): number {
  let score = 0;
  if (m.captured) {
    const victim = PIECE_VALUES[m.captured] || 0;
    const attacker = PIECE_VALUES[m.piece] || 0;
    score += victim * 10 - attacker + 1000;
  }
  if (m.promotion) {
    score += (PIECE_VALUES[m.promotion] || 900) + 800;
  }
  if (m.san && m.san.includes('+')) {
    score += 400;
  }
  if (['e4', 'd4', 'e5', 'd5', 'c4', 'c5', 'f4', 'f5'].includes(m.to)) {
    score += 30;
  }
  return score;
}

function sortMoves(moves: Move[]): Move[] {
  return moves.sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a));
}

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
      if (beta <= alpha) break;
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
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function getEasyMove(chess: Chess): Move {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) throw new Error('No legal moves');

  if (Math.random() < 0.6) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const isWhite = chess.turn() === 'w';
  let bestMoves: Move[] = [];
  let bestScore = isWhite ? -Infinity : Infinity;

  for (const m of moves) {
    chess.move(m);
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

async function getHardMove(chess: Chess): Promise<Move> {
  const moves = sortMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) throw new Error('No legal moves');
  if (moves.length === 1) return moves[0];

  const isWhite = chess.turn() === 'w';
  const startTime = Date.now();
  const deadline = startTime + 1450;

  let currentBestMove: Move = moves[0];

  for (let targetDepth = 1; targetDepth <= 4; targetDepth++) {
    if (Date.now() > deadline) break;

    let iterationBestMove: Move | null = null;
    let iterationBestScore = isWhite ? -Infinity : Infinity;

    for (const m of moves) {
      if (Date.now() > deadline) break;

      chess.move(m);
      const score = minimax(
        chess,
        targetDepth - 1,
        -Infinity,
        Infinity,
        !isWhite,
        true,
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

      if (isWhite && iterationBestScore >= 90000) break;
      if (!isWhite && iterationBestScore <= -90000) break;
    }

    if (iterationBestMove) {
      currentBestMove = iterationBestMove;
      const idx = moves.indexOf(currentBestMove);
      if (idx > 0) {
        moves.splice(idx, 1);
        moves.unshift(currentBestMove);
      }
    }

    if (Math.abs(iterationBestScore) >= 90000) break;
    if (Date.now() - startTime > 1000) break;
  }

  return currentBestMove;
}

self.onmessage = async (e: MessageEvent<{ jobId: number; fen: string; difficulty: AIDifficulty }>) => {
  const { jobId, fen, difficulty } = e.data;
  try {
    const chess = new Chess(fen);
    let chosenMove: Move;

    if (difficulty === 'easy') {
      chosenMove = getEasyMove(chess);
    } else if (difficulty === 'medium') {
      chosenMove = getMediumMove(chess);
    } else {
      chosenMove = await getHardMove(chess);
    }

    self.postMessage({
      jobId,
      move: {
        from: chosenMove.from,
        to: chosenMove.to,
        san: chosenMove.san,
        piece: chosenMove.piece,
        promotion: chosenMove.promotion,
      },
    });
  } catch (err: any) {
    self.postMessage({
      jobId,
      error: err?.message || 'AI calculation error',
    });
  }
};
