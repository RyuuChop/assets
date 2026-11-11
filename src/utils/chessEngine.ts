/* =============================================================================
   chessEngine.ts - thin bridge between the game (chess.js) and the AI brain.

   All intelligence lives in src/ai/chessAI.ts. This file is only used when a Web Worker is not
   available (the game then asks for a move on the main thread, with a shorter thinking time).
   ============================================================================= */
import { Chess, Move } from 'chess.js';
import { AIDifficulty } from '../types/chess';
import { chooseMove, AI_LEVELS } from '../ai/chessAI';

// On the main thread a long search would freeze the page, so it is capped.
const MAIN_THREAD_MAX_MS = 700;

export async function getAIMove(
  chess: Chess,
  difficulty: AIDifficulty,
  isCancelled?: () => boolean
): Promise<Move | null> {
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  // let the UI paint the "thinking" state before the search blocks the thread
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (isCancelled?.()) return null;

  const replay = new Chess();
  const history: string[] = [];
  for (const m of chess.history({ verbose: true })) {
    history.push(replay.fen());
    replay.move({ from: m.from, to: m.to, promotion: m.promotion });
  }

  const result = chooseMove({
    fen: chess.fen(),
    difficulty,
    history,
    timeMs: Math.min(AI_LEVELS[difficulty].timeMs, MAIN_THREAD_MAX_MS),
    shouldStop: isCancelled,
  });
  if (isCancelled?.() || !result) return null;

  return (
    legalMoves.find((m) => m.from === result.from && m.to === result.to && (!m.promotion || m.promotion === 'q')) ||
    legalMoves[0]
  );
}
