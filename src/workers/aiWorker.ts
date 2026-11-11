/* =============================================================================
   aiWorker.ts - runs the chess AI on a background thread so the 3D scene never stutters.

   The intelligence itself lives in src/ai/chessAI.ts. This file only receives a request
   { jobId, fen, difficulty, history?, purpose? } and answers { jobId, move }.
   ============================================================================= */
import { Chess } from 'chess.js';
import { chooseMove } from '../ai/chessAI';
import type { AIDifficulty } from '../types/chess';

interface AIWorkerRequest {
  jobId: number;
  fen: string;
  difficulty: AIDifficulty;
  /** positions before each move so far (for repetition detection) */
  history?: string[];
  /** 'hint' = strongest move without any randomness */
  purpose?: 'move' | 'hint';
}

self.onmessage = (e: MessageEvent<AIWorkerRequest>) => {
  const { jobId, fen, difficulty, history, purpose } = e.data;
  try {
    const result = chooseMove({ fen, difficulty, history, purpose });
    self.postMessage({
      jobId,
      move: result
        ? {
            from: result.from,
            to: result.to,
            promotion: result.promotion,
            score: result.score,
            depth: result.depth,
            fromBook: result.fromBook,
          }
        : null,
    });
  } catch (error) {
    // Never leave the game waiting for a move: fall back to any legal move.
    let move = null;
    try {
      const moves = new Chess(fen).moves({ verbose: true });
      if (moves.length) {
        const m = moves[Math.floor(Math.random() * moves.length)];
        move = { from: m.from, to: m.to };
      }
    } catch {
      /* position unreadable: no move */
    }
    self.postMessage({ jobId, move, error: String(error) });
  }
};
