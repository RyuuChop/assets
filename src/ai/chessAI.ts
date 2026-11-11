/* =============================================================================
   chessAI.ts  -  the dedicated "brain" of the game.

   Everything the computer opponent does lives in this one file and it has no dependencies
   (it does not even use chess.js), so it is fast and can run in a Web Worker.

   What it contains
   ----------------
   1.  A fast 0x88 board with make/unmake and a legal move generator (verified with perft).
   2.  A tapered evaluation: material, piece-square tables, mobility, pawn structure (doubled,
       isolated, passed), bishop pair, rooks on open files / 7th rank, king safety, mop-up in
       won endgames.
   3.  The search: iterative deepening, principal variation search, transposition table,
       null-move pruning, late-move reductions, futility / reverse-futility pruning, check
       extensions, quiescence search, killer + history + MVV-LVA move ordering, aspiration
       windows, repetition and 50-move detection, and a time manager.
   4.  An opening book (about 50 well known lines) with weighted random choice, so games do not
       all start the same way.
   5.  "Human" variety: after the search, the move is picked among the moves that are almost
       as good as the best one (softmax), and every new game gets a random "personality"
       (how much the engine values activity, king safety, pawn structure ...). That is why the
       AI does not play the same game twice.
   6.  Four difficulty levels (easy, medium, hard, extreme). Tune them in AI_LEVELS below.

   Public API:  chooseMove(request)  ->  { from, to, promotion?, score, depth, nodes, ... }
   ============================================================================= */

import type { AIDifficulty } from '../types/chess';

/* =============================================================================
   0. DIFFICULTY LEVELS  (tune the AI here)
   ============================================================================= */

export interface LevelConfig {
  /** deepest iteration the search may reach */
  maxDepth: number;
  /** thinking time budget in milliseconds (the search also stops at maxDepth) */
  timeMs: number;
  /** moves within this many centipawns of the best one are "acceptable" candidates */
  margin: number;
  /** softmax temperature (centipawns): higher = more random among the candidates */
  temperature: number;
  /** chance of playing a completely random legal move (only for the weakest level) */
  randomMoveChance: number;
  /** chance of using the opening book while the position is still in it */
  bookChance: number;
  /** how aggressive pruning is (0 = none, 1 = full) */
  pruning: number;
  /** share of the thinking time kept for choosing among near-best moves (variety) */
  varietyShare: number;
}

export const AI_LEVELS: Record<AIDifficulty, LevelConfig> = {
  // Plays sensible captures but misses tactics and sometimes just blunders.
  easy: { maxDepth: 1, timeMs: 150, margin: 350, temperature: 120, randomMoveChance: 0.2, bookChance: 0.25, pruning: 0, varietyShare: 0.4 },
  // Looks a few moves ahead, makes occasional inaccuracies.
  medium: { maxDepth: 4, timeMs: 500, margin: 110, temperature: 45, randomMoveChance: 0.02, bookChance: 0.6, pruning: 0.5, varietyShare: 0.3 },
  // Strong club player: searches about 6 moves ahead, very small inaccuracies.
  hard: { maxDepth: 6, timeMs: 800, margin: 35, temperature: 14, randomMoveChance: 0, bookChance: 0.9, pruning: 1, varietyShare: 0.25 },
  // Maximum strength: no depth limit, long thinking time, almost always the best move.
  // (Opening book and a per-game "personality" keep its games different from each other.)
  extreme: { maxDepth: 40, timeMs: 4500, margin: 10, temperature: 4, randomMoveChance: 0, bookChance: 1, pruning: 1, varietyShare: 0.2 },
};

export const AI_LEVEL_DESCRIPTIONS: Record<AIDifficulty, string> = {
  easy: 'Easy: casual opponent. Looks one move ahead and sometimes blunders.',
  medium: 'Medium: thinks a few moves ahead, occasional inaccuracies.',
  hard: 'Hard: deep search with tactics, endgame knowledge and an opening book.',
  extreme: 'Extreme: Grandmaster level powered by Gemini AI. Sharp tactical calculation and commentary.',
};

/* =============================================================================
   1. BOARD, MOVES
   ============================================================================= */

const WHITE = 0;
const BLACK = 1;
const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const WP = PAWN, WN = KNIGHT, WB = BISHOP, WR = ROOK, WQ = QUEEN, WK = KING;
const BP = PAWN | 8, BN = KNIGHT | 8, BB = BISHOP | 8, BR = ROOK | 8, BQ = QUEEN | 8, BK = KING | 8;

const INF = 32000;
const MATE = 30000;
const MATE_IN_MAX = MATE - 1000;
const MAX_PLY = 100;
const STACK_SIZE = 4096;

// castling rights bits
const C_WK = 1, C_WQ = 2, C_BK = 4, C_BQ = 8;

// move encoding: from(7) | to(7)<<7 | promo(3)<<14 | flags(3)<<17
const F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;

const KNIGHT_DIRS = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_DIRS = [-17, -16, -15, -1, 1, 15, 16, 17];
const BISHOP_DIRS = [-17, -15, 15, 17];
const ROOK_DIRS = [-16, -1, 1, 16];

const board = new Int8Array(128);
let side = WHITE;
let castling = 0;
let epSq = -1;
let halfmove = 0;
const kingSq = [0, 0];
const cnt = new Int8Array(16); // piece counts by piece code

// incremental evaluation (white minus black) and game phase
let mgScore = 0;
let egScore = 0;
let phase = 0;

// zobrist hashing (two 32 bit halves)
let hashHi = 0;
let hashLo = 0;

// undo stack
const stMove = new Int32Array(STACK_SIZE);
const stCaptured = new Int8Array(STACK_SIZE);
const stCastle = new Int8Array(STACK_SIZE);
const stEp = new Int16Array(STACK_SIZE);
const stHalf = new Int16Array(STACK_SIZE);
const stHashHi = new Int32Array(STACK_SIZE);
const stHashLo = new Int32Array(STACK_SIZE);
const stMg = new Int32Array(STACK_SIZE);
const stEg = new Int32Array(STACK_SIZE);
const stPhase = new Int16Array(STACK_SIZE);
let sp = 0;

const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0x04] = 15 & ~(C_WK | C_WQ);
CASTLE_MASK[0x00] = 15 & ~C_WQ;
CASTLE_MASK[0x07] = 15 & ~C_WK;
CASTLE_MASK[0x74] = 15 & ~(C_BK | C_BQ);
CASTLE_MASK[0x70] = 15 & ~C_BQ;
CASTLE_MASK[0x77] = 15 & ~C_BK;

/* ---------- zobrist keys (fixed seed => deterministic) ---------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) | 0;
  };
}
const zr = mulberry32(0x9e3779b9);
const Z_PIECE_HI = new Int32Array(16 * 128);
const Z_PIECE_LO = new Int32Array(16 * 128);
for (let i = 0; i < Z_PIECE_HI.length; i++) { Z_PIECE_HI[i] = zr(); Z_PIECE_LO[i] = zr(); }
const Z_CASTLE_HI = new Int32Array(16), Z_CASTLE_LO = new Int32Array(16);
for (let i = 0; i < 16; i++) { Z_CASTLE_HI[i] = zr(); Z_CASTLE_LO[i] = zr(); }
const Z_EP_HI = new Int32Array(8), Z_EP_LO = new Int32Array(8);
for (let i = 0; i < 8; i++) { Z_EP_HI[i] = zr(); Z_EP_LO[i] = zr(); }
const Z_SIDE_HI = zr(), Z_SIDE_LO = zr();

/* ---------- piece-square tables (white's point of view, rank 8 first) ---------- */
const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const PST_BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const PST_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const PST_QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const PST_KING_MG = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const PST_KING_EG = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];
// pawns get more valuable the closer they are to promotion in the endgame (by rank from own side)
const PAWN_EG_BONUS = [0, 0, 6, 14, 28, 52, 90, 0];

const MG_VALUE = [0, 100, 320, 330, 500, 900, 0];
const EG_VALUE = [0, 115, 300, 320, 520, 950, 0];
const PHASE_VALUE = [0, 0, 1, 1, 2, 4, 0];

// final per-piece tables on 0x88 squares: PST_MG[piece][sq], white pieces positive, black negative
const T_MG = Array.from({ length: 16 }, () => new Int16Array(128));
const T_EG = Array.from({ length: 16 }, () => new Int16Array(128));
(function buildTables() {
  const mgTables: Record<number, number[]> = { 1: PST_PAWN, 2: PST_KNIGHT, 3: PST_BISHOP, 4: PST_ROOK, 5: PST_QUEEN, 6: PST_KING_MG };
  const egTables: Record<number, number[]> = { 1: PST_PAWN, 2: PST_KNIGHT, 3: PST_BISHOP, 4: PST_ROOK, 5: PST_QUEEN, 6: PST_KING_EG };
  for (let type = 1; type <= 6; type++) {
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = rank * 16 + file;
        const wIdx = (7 - rank) * 8 + file; // white: rank 8 is the first row
        const bIdx = rank * 8 + file; // black: mirrored
        let wMg = MG_VALUE[type] + mgTables[type][wIdx];
        let bMg = MG_VALUE[type] + mgTables[type][bIdx];
        let wEg = EG_VALUE[type] + egTables[type][wIdx];
        let bEg = EG_VALUE[type] + egTables[type][bIdx];
        if (type === PAWN) {
          wEg = EG_VALUE[1] + PAWN_EG_BONUS[rank];
          bEg = EG_VALUE[1] + PAWN_EG_BONUS[7 - rank];
        }
        T_MG[type][sq] = wMg;
        T_EG[type][sq] = wEg;
        T_MG[type | 8][sq] = -bMg;
        T_EG[type | 8][sq] = -bEg;
      }
    }
  }
})();

/* ---------- piece placement with incremental updates ---------- */
function addPiece(sq: number, piece: number): void {
  board[sq] = piece;
  cnt[piece]++;
  hashHi ^= Z_PIECE_HI[piece * 128 + sq];
  hashLo ^= Z_PIECE_LO[piece * 128 + sq];
  mgScore += T_MG[piece][sq];
  egScore += T_EG[piece][sq];
  phase += PHASE_VALUE[piece & 7];
}
function removePiece(sq: number): void {
  const piece = board[sq];
  board[sq] = 0;
  cnt[piece]--;
  hashHi ^= Z_PIECE_HI[piece * 128 + sq];
  hashLo ^= Z_PIECE_LO[piece * 128 + sq];
  mgScore -= T_MG[piece][sq];
  egScore -= T_EG[piece][sq];
  phase -= PHASE_VALUE[piece & 7];
}

function sqName(sq: number): string {
  return 'abcdefgh'[sq & 7] + String((sq >> 4) + 1);
}
function sqFromName(name: string): number {
  return (name.charCodeAt(0) - 97) + (name.charCodeAt(1) - 49) * 16;
}

/** Is `sq` attacked by any piece of colour `by`? */
function isAttacked(sq: number, by: number): boolean {
  // pawns
  if (by === WHITE) {
    let a = sq - 15;
    if (!(a & 0x88) && board[a] === WP) return true;
    a = sq - 17;
    if (!(a & 0x88) && board[a] === WP) return true;
  } else {
    let a = sq + 15;
    if (!(a & 0x88) && board[a] === BP) return true;
    a = sq + 17;
    if (!(a & 0x88) && board[a] === BP) return true;
  }
  const n = (by << 3) | KNIGHT;
  for (let i = 0; i < 8; i++) {
    const a = sq + KNIGHT_DIRS[i];
    if (!(a & 0x88) && board[a] === n) return true;
  }
  const k = (by << 3) | KING;
  for (let i = 0; i < 8; i++) {
    const a = sq + KING_DIRS[i];
    if (!(a & 0x88) && board[a] === k) return true;
  }
  const b = (by << 3) | BISHOP, r = (by << 3) | ROOK, q = (by << 3) | QUEEN;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_DIRS[i];
    let a = sq + d;
    while (!(a & 0x88)) {
      const p = board[a];
      if (p !== 0) { if (p === b || p === q) return true; break; }
      a += d;
    }
  }
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DIRS[i];
    let a = sq + d;
    while (!(a & 0x88)) {
      const p = board[a];
      if (p !== 0) { if (p === r || p === q) return true; break; }
      a += d;
    }
  }
  return false;
}

function inCheckNow(): boolean {
  return isAttacked(kingSq[side], side ^ 1);
}

/* ---------- move generation ---------- */
// Generates pseudo-legal moves into buf starting at `off`. Returns the new end offset.
// captures=true: only captures and promotions (for quiescence search).
// allPromos=true: also generate under-promotions (the search itself only uses queen promotions).
function generate(buf: Int32Array, off: number, captures: boolean, allPromos: boolean): number {
  let n = off;
  const us = side, them = us ^ 1;
  const dir = us === WHITE ? 16 : -16;
  const startRank = us === WHITE ? 1 : 6;
  const promoRank = us === WHITE ? 6 : 1;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const from = rank * 16 + file;
      const piece = board[from];
      if (piece === 0 || (piece >> 3) !== us) continue;
      const type = piece & 7;

      if (type === PAWN) {
        const to = from + dir;
        const isPromo = rank === promoRank;
        if (board[to] === 0) {
          if (isPromo) {
            buf[n++] = from | (to << 7) | (QUEEN << 14);
            if (allPromos) {
              buf[n++] = from | (to << 7) | (ROOK << 14);
              buf[n++] = from | (to << 7) | (BISHOP << 14);
              buf[n++] = from | (to << 7) | (KNIGHT << 14);
            }
          } else if (!captures) {
            buf[n++] = from | (to << 7);
            if (rank === startRank && board[to + dir] === 0) {
              buf[n++] = from | ((to + dir) << 7) | (F_DOUBLE << 17);
            }
          }
        }
        for (let s = -1; s <= 1; s += 2) {
          const cto = from + dir + s;
          if (cto & 0x88) continue;
          const target = board[cto];
          if (target !== 0 && (target >> 3) === them) {
            if (isPromo) {
              buf[n++] = from | (cto << 7) | (QUEEN << 14);
              if (allPromos) {
                buf[n++] = from | (cto << 7) | (ROOK << 14);
                buf[n++] = from | (cto << 7) | (BISHOP << 14);
                buf[n++] = from | (cto << 7) | (KNIGHT << 14);
              }
            } else {
              buf[n++] = from | (cto << 7);
            }
          } else if (cto === epSq) {
            buf[n++] = from | (cto << 7) | (F_EP << 17);
          }
        }
      } else if (type === KNIGHT || type === KING) {
        const dirs = type === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = from + dirs[i];
          if (to & 0x88) continue;
          const target = board[to];
          if (target === 0) {
            if (!captures) buf[n++] = from | (to << 7);
          } else if ((target >> 3) === them) {
            buf[n++] = from | (to << 7);
          }
        }
      } else {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
        const nd = type === QUEEN ? 8 : 4;
        for (let i = 0; i < nd; i++) {
          const d = dirs[i];
          let to = from + d;
          while (!(to & 0x88)) {
            const target = board[to];
            if (target === 0) {
              if (!captures) buf[n++] = from | (to << 7);
            } else {
              if ((target >> 3) === them) buf[n++] = from | (to << 7);
              break;
            }
            to += d;
          }
        }
      }
    }
  }

  // castling (never in captures-only mode)
  if (!captures) {
    if (us === WHITE) {
      if (castling & C_WK && board[5] === 0 && board[6] === 0 && board[7] === WR && board[4] === WK &&
          !isAttacked(4, BLACK) && !isAttacked(5, BLACK) && !isAttacked(6, BLACK)) {
        buf[n++] = 4 | (6 << 7) | (F_CASTLE << 17);
      }
      if (castling & C_WQ && board[3] === 0 && board[2] === 0 && board[1] === 0 && board[0] === WR && board[4] === WK &&
          !isAttacked(4, BLACK) && !isAttacked(3, BLACK) && !isAttacked(2, BLACK)) {
        buf[n++] = 4 | (2 << 7) | (F_CASTLE << 17);
      }
    } else {
      if (castling & C_BK && board[0x75] === 0 && board[0x76] === 0 && board[0x77] === BR && board[0x74] === BK &&
          !isAttacked(0x74, WHITE) && !isAttacked(0x75, WHITE) && !isAttacked(0x76, WHITE)) {
        buf[n++] = 0x74 | (0x76 << 7) | (F_CASTLE << 17);
      }
      if (castling & C_BQ && board[0x73] === 0 && board[0x72] === 0 && board[0x71] === 0 && board[0x70] === BR && board[0x74] === BK &&
          !isAttacked(0x74, WHITE) && !isAttacked(0x73, WHITE) && !isAttacked(0x72, WHITE)) {
        buf[n++] = 0x74 | (0x72 << 7) | (F_CASTLE << 17);
      }
    }
  }
  return n;
}

/** Plays a pseudo-legal move. Returns false (and restores the position) if it leaves the king in check. */
function makeMove(m: number): boolean {
  const from = m & 127;
  const to = (m >> 7) & 127;
  const promo = (m >> 14) & 7;
  const flags = (m >> 17) & 7;
  const piece = board[from];
  const us = piece >> 3;
  const type = piece & 7;

  stMove[sp] = m;
  stCaptured[sp] = board[to];
  stCastle[sp] = castling;
  stEp[sp] = epSq;
  stHalf[sp] = halfmove;
  stHashHi[sp] = hashHi;
  stHashLo[sp] = hashLo;
  stMg[sp] = mgScore;
  stEg[sp] = egScore;
  stPhase[sp] = phase;
  sp++;

  if (epSq >= 0) { hashHi ^= Z_EP_HI[epSq & 7]; hashLo ^= Z_EP_LO[epSq & 7]; }
  hashHi ^= Z_CASTLE_HI[castling]; hashLo ^= Z_CASTLE_LO[castling];

  halfmove++;
  if (type === PAWN) halfmove = 0;
  epSq = -1;

  if (board[to] !== 0) { removePiece(to); halfmove = 0; }
  if (flags & F_EP) {
    const capSq = to + (us === WHITE ? -16 : 16);
    stCaptured[sp - 1] = board[capSq];
    removePiece(capSq);
  }
  removePiece(from);
  if (promo) addPiece(to, promo | (us << 3));
  else addPiece(to, piece);

  if (flags & F_CASTLE) {
    let rFrom: number, rTo: number;
    if (to === 6) { rFrom = 7; rTo = 5; }
    else if (to === 2) { rFrom = 0; rTo = 3; }
    else if (to === 0x76) { rFrom = 0x77; rTo = 0x75; }
    else { rFrom = 0x70; rTo = 0x73; }
    const rook = board[rFrom];
    removePiece(rFrom);
    addPiece(rTo, rook);
  }
  if (type === KING) kingSq[us] = to;

  castling &= CASTLE_MASK[from] & CASTLE_MASK[to];

  if (flags & F_DOUBLE) {
    // only record the en passant square when an enemy pawn can really capture
    const enemyPawn = us === WHITE ? BP : WP;
    const l = to - 1, r = to + 1;
    if ((!(l & 0x88) && board[l] === enemyPawn) || (!(r & 0x88) && board[r] === enemyPawn)) {
      epSq = (from + to) >> 1;
    }
  }

  hashHi ^= Z_CASTLE_HI[castling]; hashLo ^= Z_CASTLE_LO[castling];
  if (epSq >= 0) { hashHi ^= Z_EP_HI[epSq & 7]; hashLo ^= Z_EP_LO[epSq & 7]; }
  hashHi ^= Z_SIDE_HI; hashLo ^= Z_SIDE_LO;
  side ^= 1;

  if (isAttacked(kingSq[us], us ^ 1)) {
    unmakeMove();
    return false;
  }
  return true;
}

function unmakeMove(): void {
  sp--;
  const m = stMove[sp];
  const from = m & 127;
  const to = (m >> 7) & 127;
  const promo = (m >> 14) & 7;
  const flags = (m >> 17) & 7;
  side ^= 1;
  const us = side;
  const captured = stCaptured[sp];

  // put the moving piece back (raw: board + counts only; scalars are restored from the stack)
  let moved = board[to];
  cnt[moved]--;
  board[to] = 0;
  if (promo) moved = PAWN | (us << 3);
  board[from] = moved;
  cnt[moved]++;
  if ((moved & 7) === KING) kingSq[us] = from;

  if (flags & F_EP) {
    const capSq = to + (us === WHITE ? -16 : 16);
    board[capSq] = captured;
    cnt[captured]++;
  } else if (captured !== 0) {
    board[to] = captured;
    cnt[captured]++;
  }
  if (flags & F_CASTLE) {
    let rFrom: number, rTo: number;
    if (to === 6) { rFrom = 7; rTo = 5; }
    else if (to === 2) { rFrom = 0; rTo = 3; }
    else if (to === 0x76) { rFrom = 0x77; rTo = 0x75; }
    else { rFrom = 0x70; rTo = 0x73; }
    board[rFrom] = board[rTo];
    board[rTo] = 0;
  }

  castling = stCastle[sp];
  epSq = stEp[sp];
  halfmove = stHalf[sp];
  hashHi = stHashHi[sp];
  hashLo = stHashLo[sp];
  mgScore = stMg[sp];
  egScore = stEg[sp];
  phase = stPhase[sp];
}

function makeNull(): void {
  stMove[sp] = 0;
  stCaptured[sp] = 0;
  stCastle[sp] = castling;
  stEp[sp] = epSq;
  stHalf[sp] = halfmove;
  stHashHi[sp] = hashHi;
  stHashLo[sp] = hashLo;
  stMg[sp] = mgScore;
  stEg[sp] = egScore;
  stPhase[sp] = phase;
  sp++;
  if (epSq >= 0) { hashHi ^= Z_EP_HI[epSq & 7]; hashLo ^= Z_EP_LO[epSq & 7]; }
  epSq = -1;
  hashHi ^= Z_SIDE_HI; hashLo ^= Z_SIDE_LO;
  halfmove++;
  side ^= 1;
}
function unmakeNull(): void {
  sp--;
  side ^= 1;
  castling = stCastle[sp];
  epSq = stEp[sp];
  halfmove = stHalf[sp];
  hashHi = stHashHi[sp];
  hashLo = stHashLo[sp];
}

/* ---------- FEN ---------- */
const PIECE_FROM_CHAR: Record<string, number> = {
  P: WP, N: WN, B: WB, R: WR, Q: WQ, K: WK, p: BP, n: BN, b: BB, r: BR, q: BQ, k: BK,
};

function setFen(fen: string): void {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('bad FEN');
  board.fill(0);
  cnt.fill(0);
  hashHi = 0; hashLo = 0; mgScore = 0; egScore = 0; phase = 0;
  sp = 0;
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('bad FEN board');
  let kings = 0;
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[7 - r]) {
      if (ch >= '1' && ch <= '8') { file += ch.charCodeAt(0) - 48; continue; }
      const piece = PIECE_FROM_CHAR[ch];
      if (piece === undefined || file > 7) throw new Error('bad FEN piece');
      const sq = r * 16 + file;
      addPiece(sq, piece);
      if ((piece & 7) === KING) { kingSq[piece >> 3] = sq; kings++; }
      file++;
    }
  }
  if (kings !== 2) throw new Error('bad FEN kings');
  side = parts[1] === 'b' ? BLACK : WHITE;
  castling = 0;
  const c = parts[2] || '-';
  if (c.includes('K')) castling |= C_WK;
  if (c.includes('Q')) castling |= C_WQ;
  if (c.includes('k')) castling |= C_BK;
  if (c.includes('q')) castling |= C_BQ;
  // castling rights are only valid when king and rook really are on their home squares
  if (board[4] !== WK) castling &= ~(C_WK | C_WQ);
  if (board[7] !== WR) castling &= ~C_WK;
  if (board[0] !== WR) castling &= ~C_WQ;
  if (board[0x74] !== BK) castling &= ~(C_BK | C_BQ);
  if (board[0x77] !== BR) castling &= ~C_BK;
  if (board[0x70] !== BR) castling &= ~C_BQ;

  epSq = -1;
  const ep = parts[3];
  if (ep && ep !== '-' && ep.length === 2) {
    const e = sqFromName(ep);
    // keep it only if the side to move has a pawn that can capture there
    if (side === WHITE) {
      if ((!((e - 15) & 0x88) && board[e - 15] === WP) || (!((e - 17) & 0x88) && board[e - 17] === WP)) epSq = e;
    } else {
      if ((!((e + 15) & 0x88) && board[e + 15] === BP) || (!((e + 17) & 0x88) && board[e + 17] === BP)) epSq = e;
    }
  }
  halfmove = parseInt(parts[4] || '0', 10) || 0;

  hashHi ^= Z_CASTLE_HI[castling]; hashLo ^= Z_CASTLE_LO[castling];
  if (epSq >= 0) { hashHi ^= Z_EP_HI[epSq & 7]; hashLo ^= Z_EP_LO[epSq & 7]; }
  if (side === BLACK) { hashHi ^= Z_SIDE_HI; hashLo ^= Z_SIDE_LO; }
}

/* =============================================================================
   2. EVALUATION
   ============================================================================= */

// "personality": random multipliers (per game) for the dynamic evaluation terms
interface Personality { mobility: number; kingSafety: number; pawns: number; activity: number; }
const NEUTRAL: Personality = { mobility: 1, kingSafety: 1, pawns: 1, activity: 1 };
let personality: Personality = NEUTRAL; // the one used by evaluate() right now
let gamePersonality: Personality | null = null; // the one chosen for the current game

const PASSED_BONUS = [0, 6, 12, 24, 42, 70, 115, 0];
const LAZY_MARGIN = 220;
const TEMPO = 8;

const pawnCnt = [new Int8Array(10), new Int8Array(10)];
const pawnMin = [new Int8Array(10), new Int8Array(10)]; // lowest rank (0..7) of a pawn on the file
const pawnMax = [new Int8Array(10), new Int8Array(10)]; // highest rank
const pieceList = new Int16Array(40);

/** Static evaluation in centipawns from the side to move's point of view. */
function evaluate(alpha: number, beta: number): number {
  // insufficient material is a dead draw
  if (cnt[WP] + cnt[BP] + cnt[WR] + cnt[BR] + cnt[WQ] + cnt[BQ] === 0) {
    const minors = cnt[WN] + cnt[BN] + cnt[WB] + cnt[BB];
    if (minors <= 1) return 0;
  }

  const ph = phase > 24 ? 24 : phase;
  const base = ((mgScore * ph + egScore * (24 - ph)) / 24) | 0;
  const stm = side === WHITE ? 1 : -1;
  const lazy = base * stm;
  if (lazy + LAZY_MARGIN < alpha || lazy - LAZY_MARGIN > beta) return lazy; // cannot change the outcome

  for (let c = 0; c < 2; c++) {
    pawnCnt[c].fill(0);
    pawnMin[c].fill(8);
    pawnMax[c].fill(-1);
  }
  let np = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = rank * 16 + file;
      const piece = board[sq];
      if (piece === 0) continue;
      const type = piece & 7;
      if (type === PAWN) {
        const c = piece >> 3;
        pawnCnt[c][file + 1]++;
        if (rank < pawnMin[c][file + 1]) pawnMin[c][file + 1] = rank;
        if (rank > pawnMax[c][file + 1]) pawnMax[c][file + 1] = rank;
      } else if (type !== KING) {
        pieceList[np++] = sq;
      }
    }
  }

  const pm = personality;
  let mg = 0, eg = 0;

  // ---- pawn structure ----
  for (let c = 0; c < 2; c++) {
    const sign = c === WHITE ? 1 : -1;
    const enemy = c ^ 1;
    for (let f = 1; f <= 8; f++) {
      const n = pawnCnt[c][f];
      if (n === 0) continue;
      if (n > 1) { mg -= sign * 10 * (n - 1) * pm.pawns; eg -= sign * 14 * (n - 1) * pm.pawns; }
      if (pawnCnt[c][f - 1] === 0 && pawnCnt[c][f + 1] === 0) { mg -= sign * 11 * n * pm.pawns; eg -= sign * 14 * n * pm.pawns; }
    }
    // passed pawns
    for (let f = 1; f <= 8; f++) {
      if (pawnCnt[c][f] === 0) continue;
      // most advanced pawn of this file is the one that matters
      const r = c === WHITE ? pawnMax[c][f] : pawnMin[c][f];
      let passed = true;
      for (let g = f - 1; g <= f + 1 && passed; g++) {
        if (pawnCnt[enemy][g] === 0) continue;
        if (c === WHITE) { if (pawnMax[enemy][g] > r) passed = false; }
        else if (pawnMin[enemy][g] < r) passed = false;
      }
      if (passed) {
        const adv = c === WHITE ? r : 7 - r;
        const b = PASSED_BONUS[adv] * pm.pawns;
        mg += sign * b * 0.6;
        eg += sign * b * 1.7;
      }
    }
  }

  // ---- pieces: mobility, rooks, bishop pair ----
  for (let i = 0; i < np; i++) {
    const sq = pieceList[i];
    const piece = board[sq];
    const c = piece >> 3;
    const sign = c === WHITE ? 1 : -1;
    const type = piece & 7;
    let count = 0;
    if (type === KNIGHT) {
      for (let k = 0; k < 8; k++) {
        const to = sq + KNIGHT_DIRS[k];
        if (to & 0x88) continue;
        const t = board[to];
        if (t === 0 || (t >> 3) !== c) count++;
      }
      mg += sign * (count - 4) * 4 * pm.mobility;
      eg += sign * (count - 4) * 4 * pm.mobility;
    } else {
      const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
      const nd = type === QUEEN ? 8 : 4;
      for (let k = 0; k < nd; k++) {
        const d = dirs[k];
        let to = sq + d;
        while (!(to & 0x88)) {
          const t = board[to];
          if (t === 0) count++;
          else { if ((t >> 3) !== c) count++; break; }
          to += d;
        }
      }
      if (type === BISHOP) {
        mg += sign * (count - 6) * 4 * pm.mobility;
        eg += sign * (count - 6) * 4 * pm.mobility;
      } else if (type === ROOK) {
        mg += sign * (count - 6) * 2 * pm.mobility;
        eg += sign * (count - 6) * 4 * pm.mobility;
        const file = sq & 7, rank = sq >> 4;
        const own = pawnCnt[c][file + 1], opp = pawnCnt[c ^ 1][file + 1];
        if (own === 0) {
          const b = (opp === 0 ? 24 : 12) * pm.activity;
          mg += sign * b; eg += sign * b * 0.6;
        }
        const seventh = c === WHITE ? 6 : 1;
        if (rank === seventh) { mg += sign * 14 * pm.activity; eg += sign * 22 * pm.activity; }
      } else {
        mg += sign * (count - 10) * 1 * pm.mobility;
        eg += sign * (count - 10) * 2 * pm.mobility;
      }
    }
  }
  if (cnt[WB] >= 2) { mg += 32; eg += 42; }
  if (cnt[BB] >= 2) { mg -= 32; eg -= 42; }

  // ---- king safety: pawn shield in front of a castled king ----
  for (let c = 0; c < 2; c++) {
    const sign = c === WHITE ? 1 : -1;
    const ksq = kingSq[c];
    const kf = ksq & 7, kr = ksq >> 4;
    const homeRank = c === WHITE ? 0 : 7;
    if (Math.abs(kr - homeRank) > 1) continue; // king has walked out; PST handles it
    const up = c === WHITE ? 16 : -16;
    const own = c === WHITE ? WP : BP;
    let shield = 0;
    for (let df = -1; df <= 1; df++) {
      const f = kf + df;
      if (f < 0 || f > 7) continue;
      const s1 = ksq + df + up;
      if (!(s1 & 0x88) && board[s1] === own) shield += 11;
      else {
        const s2 = ksq + df + up * 2;
        if (!(s2 & 0x88) && board[s2] === own) shield += 5;
        else shield -= 6;
      }
      if (pawnCnt[c][f + 1] === 0) shield -= 12; // open file next to the king
    }
    mg += sign * shield * pm.kingSafety;
  }

  // ---- mop-up: drive the lone enemy king to the edge in won endings ----
  const wPieces = cnt[WN] + cnt[WB] + cnt[WR] + cnt[WQ];
  const bPieces = cnt[BN] + cnt[BB] + cnt[BR] + cnt[BQ];
  if (cnt[WP] + cnt[BP] === 0) {
    let winner = -1;
    if (bPieces === 0 && wPieces > 0) winner = WHITE;
    else if (wPieces === 0 && bPieces > 0) winner = BLACK;
    if (winner >= 0) {
      const lk = kingSq[winner ^ 1], wk = kingSq[winner];
      const lf = lk & 7, lr = lk >> 4;
      const cmd = Math.max(3 - lf, lf - 4) + Math.max(3 - lr, lr - 4);
      const md = Math.abs(lf - (wk & 7)) + Math.abs(lr - (wk >> 4));
      const bonus = 14 * cmd + 5 * (14 - md);
      eg += (winner === WHITE ? 1 : -1) * bonus;
      mg += (winner === WHITE ? 1 : -1) * bonus;
    }
  }

  const total = base + ((mg * ph + eg * (24 - ph)) / 24 | 0);
  return total * stm + TEMPO;
}

/* =============================================================================
   3. SEARCH
   ============================================================================= */

// transposition table
const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttHi = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttScore = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE); // 0 empty, 1 exact, 2 lower bound, 3 upper bound
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

function clearTT(): void {
  ttFlag.fill(0);
  ttHi.fill(0);
}

const moveBuf = new Int32Array(MAX_PLY * 256);
const scoreBuf = new Int32Array(MAX_PLY * 256);
const killers = new Int32Array(MAX_PLY * 2);
const history = new Int32Array(2 * 128 * 128);

const LMR = new Int8Array(64 * 64);
for (let d = 1; d < 64; d++) for (let m = 1; m < 64; m++) LMR[d * 64 + m] = Math.floor(0.7 + (Math.log(d) * Math.log(m)) / 2.2);

const ORDER_VALUE = [0, 100, 320, 330, 500, 900, 2000];

let nodes = 0;
let stopped = false;
let hardStopAt = 0;
let externalStop: (() => boolean) | null = null;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function checkStop(): void {
  if ((nodes & 2047) === 0) {
    if (now() >= hardStopAt || (externalStop && externalStop())) stopped = true;
  }
}

function isDraw(): boolean {
  if (halfmove >= 100) return true;
  // repetition: look back through positions with the same side to move
  const limit = Math.max(0, sp - halfmove);
  for (let i = sp - 2; i >= limit; i -= 2) {
    if (stHashHi[i] === hashHi && stHashLo[i] === hashLo) return true;
  }
  if (cnt[WP] + cnt[BP] + cnt[WR] + cnt[BR] + cnt[WQ] + cnt[BQ] === 0 &&
      cnt[WN] + cnt[BN] + cnt[WB] + cnt[BB] <= 1) return true;
  return false;
}

function hasPieces(c: number): boolean {
  const o = c << 3;
  return cnt[o | KNIGHT] + cnt[o | BISHOP] + cnt[o | ROOK] + cnt[o | QUEEN] > 0;
}

function scoreMoves(off: number, n: number, ply: number, ttm: number): void {
  const us = side;
  for (let i = off; i < off + n; i++) {
    const m = moveBuf[i];
    if (m === ttm) { scoreBuf[i] = 2000000; continue; }
    const from = m & 127, to = (m >> 7) & 127;
    const promo = (m >> 14) & 7;
    const flags = (m >> 17) & 7;
    const victim = flags & F_EP ? PAWN : board[to] & 7;
    if (victim) {
      scoreBuf[i] = 1000000 + ORDER_VALUE[victim] * 8 - ORDER_VALUE[board[from] & 7] / 8;
    } else if (promo) {
      scoreBuf[i] = 950000;
    } else if (m === killers[ply * 2]) {
      scoreBuf[i] = 900000;
    } else if (m === killers[ply * 2 + 1]) {
      scoreBuf[i] = 800000;
    } else {
      scoreBuf[i] = history[us * 16384 + from * 128 + to];
    }
  }
}

function pickBest(off: number, n: number, start: number): void {
  let best = start, bs = scoreBuf[start];
  for (let i = start + 1; i < off + n; i++) {
    if (scoreBuf[i] > bs) { bs = scoreBuf[i]; best = i; }
  }
  if (best !== start) {
    const m = moveBuf[start]; moveBuf[start] = moveBuf[best]; moveBuf[best] = m;
    const s = scoreBuf[start]; scoreBuf[start] = scoreBuf[best]; scoreBuf[best] = s;
  }
}

function quiesce(alpha: number, beta: number, ply: number): number {
  nodes++;
  checkStop();
  if (stopped) return 0;
  if (ply >= MAX_PLY - 2) return evaluate(alpha, beta);
  if (halfmove >= 100) return 0;

  const inCheck = inCheckNow();
  let best: number;
  if (inCheck) {
    best = -MATE + ply;
  } else {
    best = evaluate(alpha, beta);
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  }
  const standPat = best;

  const off = ply * 256;
  const n = inCheck ? generate(moveBuf, off, false, false) - off : generate(moveBuf, off, true, false) - off;
  scoreMoves(off, n, ply, 0);
  for (let i = off; i < off + n; i++) {
    pickBest(off, n, i);
    const m = moveBuf[i];
    if (!inCheck) {
      // delta pruning: even winning this piece cannot lift us to alpha
      const to = (m >> 7) & 127;
      const victim = ((m >> 17) & F_EP) ? PAWN : board[to] & 7;
      const promo = (m >> 14) & 7;
      if (!promo && standPat + ORDER_VALUE[victim] + 220 < alpha) continue;
    }
    if (!makeMove(m)) continue;
    const score = -quiesce(-beta, -alpha, ply + 1);
    unmakeMove();
    if (stopped) return 0;
    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) break;
      }
    }
  }
  return best;
}

function search(depth: number, alpha: number, beta: number, ply: number, isPV: boolean, allowNull: boolean, pruning: number): number {
  nodes++;
  checkStop();
  if (stopped) return 0;

  if (ply > 0 && isDraw()) return 0;
  if (ply >= MAX_PLY - 2) return evaluate(alpha, beta);

  const inCheck = inCheckNow();
  if (inCheck) depth++; // check extension
  if (depth <= 0) return quiesce(alpha, beta, ply);

  // mate distance pruning
  if (ply > 0) {
    if (alpha < -MATE + ply) alpha = -MATE + ply;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;
  }

  // transposition table
  const slot = hashLo & TT_MASK;
  let ttm = 0;
  if (ttFlag[slot] !== 0 && ttHi[slot] === hashHi) {
    ttm = ttMove[slot];
    if (ply > 0 && ttDepth[slot] >= depth && !isPV) {
      let s = ttScore[slot];
      if (s > MATE_IN_MAX) s -= ply; else if (s < -MATE_IN_MAX) s += ply;
      const f = ttFlag[slot];
      if (f === TT_EXACT) return s;
      if (f === TT_LOWER && s >= beta) return s;
      if (f === TT_UPPER && s <= alpha) return s;
    }
  }

  const staticEval = inCheck ? -INF : evaluate(alpha, beta);
  const mateScoreBound = Math.abs(beta) < MATE_IN_MAX && Math.abs(alpha) < MATE_IN_MAX;

  if (!isPV && !inCheck && pruning > 0 && mateScoreBound) {
    // reverse futility: the position is so good that a shallow search will not change that
    if (depth <= 3 && staticEval - 110 * depth >= beta) return staticEval - 110 * depth;
    // null move: give the opponent a free move; if we are still above beta, cut
    if (allowNull && depth >= 3 && staticEval >= beta && hasPieces(side)) {
      const R = 2 + (depth >= 6 ? 1 : 0) + (staticEval - beta > 200 ? 1 : 0);
      makeNull();
      const score = -search(depth - 1 - R, -beta, -beta + 1, ply + 1, false, false, pruning);
      unmakeNull();
      if (stopped) return 0;
      if (score >= beta) return score >= MATE_IN_MAX ? beta : score;
    }
  }

  const futile = !isPV && !inCheck && pruning > 0 && depth <= 2 && mateScoreBound &&
    staticEval + (depth === 1 ? 180 : 330) <= alpha;

  const off = ply * 256;
  const n = generate(moveBuf, off, false, false) - off;
  scoreMoves(off, n, ply, ttm);

  const alphaOrig = alpha;
  let bestScore = -INF;
  let bestMove = 0;
  let legal = 0;
  const us = side;

  for (let i = off; i < off + n; i++) {
    pickBest(off, n, i);
    const m = moveBuf[i];
    const to = (m >> 7) & 127;
    const flags = (m >> 17) & 7;
    const isCapture = board[to] !== 0 || (flags & F_EP) !== 0;
    const isPromo = ((m >> 14) & 7) !== 0;
    const isQuiet = !isCapture && !isPromo;

    if (!makeMove(m)) continue;
    legal++;
    const givesCheck = isAttacked(kingSq[side], us);

    if (futile && isQuiet && legal > 1 && !givesCheck) { unmakeMove(); continue; }

    let score: number;
    if (legal === 1) {
      score = -search(depth - 1, -beta, -alpha, ply + 1, isPV, true, pruning);
    } else {
      let reduction = 0;
      if (pruning > 0 && depth >= 3 && legal > 3 && isQuiet && !inCheck && !givesCheck) {
        reduction = LMR[Math.min(depth, 63) * 64 + Math.min(legal, 63)];
        if (isPV) reduction--;
        if (m === killers[ply * 2] || m === killers[ply * 2 + 1]) reduction--;
        if (reduction < 0) reduction = 0;
        if (reduction > depth - 2) reduction = depth - 2;
      }
      score = -search(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, false, true, pruning);
      if (score > alpha && reduction > 0) score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, false, true, pruning);
      if (score > alpha && score < beta) score = -search(depth - 1, -beta, -alpha, ply + 1, true, true, pruning);
    }
    unmakeMove();
    if (stopped) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (isQuiet) {
            if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
            const idx = us * 16384 + (m & 127) * 128 + to;
            history[idx] += depth * depth;
            if (history[idx] > 600000) { for (let k = 0; k < history.length; k++) history[k] >>= 1; }
          }
          break;
        }
      }
    }
  }

  if (legal === 0) return inCheck ? -MATE + ply : 0;

  // store in the transposition table
  let flag = TT_EXACT;
  if (bestScore <= alphaOrig) flag = TT_UPPER;
  else if (bestScore >= beta) flag = TT_LOWER;
  let stored = bestScore;
  if (stored > MATE_IN_MAX) stored += ply; else if (stored < -MATE_IN_MAX) stored -= ply;
  if (ttFlag[slot] === 0 || ttHi[slot] !== hashHi || depth >= ttDepth[slot] - 1) {
    ttHi[slot] = hashHi;
    ttMove[slot] = bestMove;
    ttScore[slot] = stored;
    ttDepth[slot] = depth > 120 ? 120 : depth;
    ttFlag[slot] = flag;
  }
  return bestScore;
}

/* ---------- root ---------- */
interface RootMove { move: number; score: number; }
let rootMoves: RootMove[] = [];

function collectRootMoves(): RootMove[] {
  const out: RootMove[] = [];
  const off = 0;
  const n = generate(moveBuf, off, false, false) - off;
  for (let i = 0; i < n; i++) {
    const m = moveBuf[i];
    if (makeMove(m)) { unmakeMove(); out.push({ move: m, score: -INF }); }
  }
  return out;
}

/** One full-width root iteration. Returns the best score (or INF markers when stopped). */
function searchRoot(depth: number, alpha: number, beta: number, pruning: number): number {
  let best = -INF;
  let bestMove = 0;
  const alphaStart = alpha;
  for (let i = 0; i < rootMoves.length; i++) {
    const rm = rootMoves[i];
    if (!makeMove(rm.move)) continue;
    let score: number;
    if (i === 0) {
      score = -search(depth - 1, -beta, -alpha, 1, true, true, pruning);
    } else {
      score = -search(depth - 1, -alpha - 1, -alpha, 1, false, true, pruning);
      if (score > alpha && score < beta && !stopped) score = -search(depth - 1, -beta, -alpha, 1, true, true, pruning);
    }
    unmakeMove();
    if (stopped) return best;
    rm.score = score;
    if (score > best) {
      best = score;
      bestMove = rm.move;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
  }
  if (bestMove) {
    // best move first for the next iteration; the rest sorted by their last known score
    const idx = rootMoves.findIndex((r) => r.move === bestMove);
    if (idx > 0) { const [r] = rootMoves.splice(idx, 1); rootMoves.unshift(r); }
    if (best > alphaStart) {
      // keep the order of the others by score (stable)
      const head = rootMoves[0];
      const rest = rootMoves.slice(1).sort((a, b) => b.score - a.score);
      rootMoves = [head, ...rest];
    }
  }
  return best;
}

/* =============================================================================
   4. OPENING BOOK
   ============================================================================= */

// Each line is a sequence of moves in coordinate notation (e2e4 ...). Moves that are not legal
// are ignored when the book is built, so a typo can never make the engine play an illegal move.
const BOOK_LINES: string[] = [
  // 1.e4 e5
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 b1c3 f6e4 e1g1 b4c3',
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 d2d3 g8f6 c2c3 d7d6 b2b4 c5b6 a2a4 a7a6',
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6 e1g1 e8g8 b2b4 c5b6',
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c6a5',
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4 d2d4 b7b5 a4b3 d7d5 d4e5 c8e6',
  'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5 d1d8 e8d8',
  'e2e4 e7e5 g1f3 b8c6 f1b5 f8c5 c2c3 g8f6 e1g1 e8g8 d2d4 c5b6',
  'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7 d1e2 f6d5 c2c4 c8a6',
  'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 f8c5 d4b3 c5b6 b1c3 g8f6 d1e2',
  'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 f8e7 e1g1 b8c6 c2c4 c6b4',
  'e2e4 e7e5 g1f3 g8f6 d2d4 f6e4 f1d3 d7d5 f3e5 b8d7 e5d7 c8d7 e1g1 f8d6',
  'e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 f1b5 f8b4 e1g1 e8g8 d2d3 d7d6 c1g5 b4c3 b2c3 d8e7',
  'e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 d2d4 e5d4 f3d4 f8b4 d4c6 b7c6 f1d3 d7d5 e4d5 c6d5',
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1 d4c3 d1b3 d8f6',
  'e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 g8f6 d2d4 d7d6 e5d3 f6e4',
  'e2e4 e7e5 f2f4 d7d5 e4d5 e5f4 g1f3 g8f6 f1b5 c7c6 d5c6 b8c6',
  'e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 f8e7 d2d4 e8g8 f1d3 f7f5',
  'e2e4 e7e5 b1c3 b8c6 g2g3 g8f6 f1g2 f8c5 g1e2 d7d6 e1g1 e8g8',
  // Sicilian
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6 f2f3 f8e7 d1d2 e8g8',
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5 e7e6 f2f4 f8e7 d1f3 d8c7',
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7 f2f3 e8g8 d1d2 b8c6',
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5 a7a6 b5a3 b7b5',
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 d7d6 c1g5 e7e6 d1d2 a7a6 e1c1 c8d7',
  'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 a7a6 f1d3 g8f6 e1g1 d8c7 f1e1 f8c5',
  'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7 f1e2 a7a6 e1g1 g8f6',
  'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4 c5d4 g1f3 b8c6 c3d4 d7d6 f1c4 d5b6',
  'e2e4 c7c5 c2c3 d7d5 e4d5 d8d5 d2d4 g8f6 g1f3 c8g4 f1e2 e7e6 e1g1 b8c6',
  'e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6 c1e3 e7e6',
  // French / Caro-Kann / others vs 1.e4
  'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 a2a3 c5c4 b2b4 c4b3',
  'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7 f2f4 e8g8',
  'e2e4 e7e6 d2d4 d7d5 b1d2 g8f6 e4e5 f6d7 f1d3 c7c5 c2c3 b8c6 g1e2 c5d4',
  'e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 d1g4 d8c7',
  'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5 e1g1 b8c6 c2c3 g8e7',
  'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7 h4h5 g6h7',
  'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 b8d7 g1f3 g8f6 e4g5 e7e6 f1d3 f8d6',
  'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6 f1c4 c8f5 c1d2 e7e6',
  'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f2f4 f8g7 g1f3 e8g8 f1d3 b8a6 e1g1 c7c5',
  'e2e4 g7g6 d2d4 f8g7 b1c3 d7d6 c1e3 a7a6 d1d2 b7b5 f2f3 b8d7',
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8e7 d2d4 e5d4 e1g1 g8f6 e4e5 f6e4',
  // 1.d4 d5
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 b7b6 c4d5 e6d5',
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1f4 e8g8 e2e3 c7c5 d4c5 e7c5',
  'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6 d1e2 b7b5',
  'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6 f1c4 f8b4 e1g1 b8d7',
  'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6 e2e3 b8d7 f1d3 d5c4 d3c4 b7b5 c4d3 a7a6',
  'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 e2e3 e7e6 b1d2 b8d7 f1d3 f8d6 e1g1 e8g8',
  'd2d4 d7d5 g1f3 g8f6 c2c4 e7e6 b1c3 f8e7 c1g5 e8g8 e2e3 b8d7 a1c1 c7c6',
  'd2d4 d7d5 c1f4 g8f6 e2e3 e7e6 g1f3 f8d6 f4g3 e8g8 f1d3 b8d7 b1d2 c7c5',
  'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3 b8c6 g1f3 c8f5 f1b5 d8b6',
  'd2d4 d7d5 g1f3 g8f6 e2e3 e7e6 f1d3 c7c5 b2b3 b8c6 e1g1 f8d6 c1b2 e8g8',
  // 1.d4 Nf6 (Indian defences)
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7',
  'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7 f1c4 c7c5 g1e2 b8c6',
  'd2d4 g8f6 c2c4 g7g6 g2g3 f8g7 f1g2 e8g8 b1c3 d7d6 g1f3 b8d7 e1g1 e7e5',
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 b8c6 a2a3 b4c3',
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 d1c2 e8g8 a2a3 b4c3 c2c3 b7b6 c1g5 c8b7',
  'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8 b1c3 f6e4',
  'd2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8 e1g1 d5c4 d1c2 a7a6 c2c4 b7b5',
  'd2d4 g8f6 c2c4 e7e6 g1f3 d7d5 b1c3 f8e7 c1g5 h7h6 g5h4 e8g8 e2e3 f6e4',
  'd2d4 g8f6 g1f3 e7e6 c1g5 h7h6 g5h4 d7d5 e2e3 f8e7 b1d2 e8g8 f1d3 b7b6',
  'd2d4 g8f6 c1g5 e7e6 e2e4 h7h6 g5f6 d8f6 b1c3 f8b4 d1d2 b8c6',
  // Dutch, Benoni, etc.
  'd2d4 f7f5 g2g3 g8f6 f1g2 g7g6 g1f3 f8g7 e1g1 e8g8 c2c4 d7d6 b1c3 d8e8',
  'd2d4 f7f5 c2c4 g8f6 g2g3 e7e6 f1g2 f8e7 g1f3 e8g8 e1g1 d7d6 b1c3 d8e8',
  'd2d4 g8f6 c2c4 c7c5 d4d5 e7e6 b1c3 e6d5 c4d5 d7d6 e2e4 g7g6 g1f3 f8g7',
  // 1.c4 / 1.Nf3 / others
  'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6 e1g1 f8e7',
  'c2c4 e7e5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6 e2e4 g8e7',
  'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 e1g1 e8g8 d2d4 c5d4',
  'c2c4 g8f6 b1c3 e7e6 g1f3 d7d5 d2d4 f8e7 c1g5 e8g8 e2e3 h7h6',
  'c2c4 e7e6 b1c3 d7d5 d2d4 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7',
  'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8 b1d2 c7c5 e2e4 b8c6',
  'g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8 f1e2 e7e5',
  'g1f3 g8f6 g2g3 g7g6 f1g2 f8g7 e1g1 e8g8 d2d4 d7d6 c2c4 b8c6 b1c3 a7a6',
  'g1f3 d7d5 d2d4 g8f6 c2c4 e7e6 b1c3 f8e7 c1g5 e8g8 e2e3 h7h6',
  'g1f3 c7c5 c2c4 b8c6 b1c3 e7e5 e2e3 g8f6 d2d4 e5d4 e3d4 d7d5',
  'b2b3 e7e5 c1b2 b8c6 e2e3 g8f6 f1b5 f8d6 g1f3 d8e7 f3e5',
  'e2e3 e7e5 d2d4 e5d4 e3d4 d7d5 g1f3 g8f6 f1d3 f8d6 e1g1 e8g8',
];

type BookMove = { move: number; weight: number };
let bookMap: Map<string, BookMove[]> | null = null;
const bookProblems: string[] = []; // lines that contained an unknown/illegal move (for the tests)

function buildBook(): void {
  bookMap = new Map();
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const buf = new Int32Array(256);
  for (const line of BOOK_LINES) {
    setFen(startFen);
    for (const uci of line.split(' ')) {
      const from = sqFromName(uci.slice(0, 2));
      const to = sqFromName(uci.slice(2, 4));
      const n = generate(buf, 0, false, false);
      let found = 0;
      for (let i = 0; i < n; i++) {
        const m = buf[i];
        if ((m & 127) === from && ((m >> 7) & 127) === to) { found = m; break; }
      }
      if (!found || !makeMove(found)) {
        bookProblems.push(`${uci} in: ${line}`);
        break; // unknown or illegal: ignore the rest of this line
      }
      // key = position BEFORE the move was made
      const key = stHashHi[sp - 1] + ':' + stHashLo[sp - 1];
      const list = bookMap.get(key) || [];
      const entry = list.find((e) => e.move === found);
      if (entry) entry.weight++;
      else list.push({ move: found, weight: 1 });
      bookMap.set(key, list);
    }
  }
}

/* =============================================================================
   5. CHOOSING A MOVE
   ============================================================================= */

export interface AIRequest {
  fen: string;
  difficulty: AIDifficulty;
  /** positions BEFORE each move of the game so far (oldest first); used to detect repetitions */
  history?: string[];
  /** 'hint' = give the best move without any randomness */
  purpose?: 'move' | 'hint';
  /** overrides the level's thinking time (ms) */
  timeMs?: number;
  /** return true to abort the search (the best move found so far is returned) */
  shouldStop?: () => boolean;
}

export interface AIResult {
  from: string;
  to: string;
  promotion?: 'q';
  score: number; // centipawns for the side that moves (mate scores are about +-30000)
  depth: number;
  nodes: number;
  fromBook: boolean;
  timeMs: number;
}

function toResult(m: number, score: number, depth: number, fromBook: boolean, t0: number): AIResult {
  const promo = (m >> 14) & 7;
  return {
    from: sqName(m & 127),
    to: sqName((m >> 7) & 127),
    promotion: promo ? 'q' : undefined,
    score,
    depth,
    nodes,
    fromBook,
    timeMs: Math.round(now() - t0),
  };
}

function randomPersonality(): Personality {
  const r = () => 0.7 + Math.random() * 0.6; // 0.7 .. 1.3
  return { mobility: r(), kingSafety: r(), pawns: r(), activity: r() };
}

function weightedPick<T>(items: T[], weights: number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Resets everything that should not carry over between games. */
export function newGameAI(): void {
  clearTT();
  killers.fill(0);
  history.fill(0);
  gamePersonality = randomPersonality();
}

/** Loads the position and the game history (for repetition detection) into the engine. */
function loadPosition(fen: string, historyFens?: string[]): void {
  let h = 0;
  if (historyFens && historyFens.length) {
    // every history entry is the position BEFORE a move; they sit at the bottom of the undo stack
    const hist = historyFens.slice(-60);
    for (const f of hist) {
      try {
        setFen(f);
        stHashHi[h] = hashHi;
        stHashLo[h] = hashLo;
        h++;
      } catch {
        /* ignore unreadable history entries */
      }
    }
  }
  setFen(fen); // resets the stack pointer
  sp = h; // keep the history below the root position
}

/**
 * Returns the computer's move for the given position, or null when there is no legal move.
 * Runs synchronously (call it from a Web Worker for long thinking times).
 */
export function chooseMove(req: AIRequest): AIResult | null {
  const t0 = now();
  const isHint = req.purpose === 'hint';
  const level: LevelConfig = isHint
    ? { ...AI_LEVELS.extreme, margin: 0, temperature: 0.01, timeMs: Math.min(AI_LEVELS.extreme.timeMs, 2200), varietyShare: 0 }
    : AI_LEVELS[req.difficulty] || AI_LEVELS.medium;
  const budget = req.timeMs ?? level.timeMs;

  if (!bookMap) buildBook();
  loadPosition(req.fen, req.history);

  // a new game starts: forget the old tables and pick a new personality
  const fullmove = parseInt(req.fen.trim().split(/\s+/)[5] || '1', 10) || 1;
  const gameLength = req.history ? req.history.length : (fullmove - 1) * 2 + (side === BLACK ? 1 : 0);
  if (!isHint && (gameLength <= 1 || !gamePersonality)) newGameAI();
  personality = isHint ? NEUTRAL : gamePersonality || NEUTRAL;

  rootMoves = collectRootMoves();
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return toResult(rootMoves[0].move, 0, 0, false, t0);

  // ---- opening book ----
  if (Math.random() < level.bookChance && !(req.difficulty === 'easy' && !isHint && Math.random() < 0.5)) {
    const entries = bookMap!.get(hashHi + ':' + hashLo);
    if (entries && entries.length) {
      const legal = entries.filter((e) => rootMoves.some((r) => r.move === e.move));
      if (legal.length) {
        // hint: the most popular move; otherwise a weighted random one, so openings vary
        const pick = isHint
          ? legal.reduce((a, b) => (b.weight > a.weight ? b : a))
          : weightedPick(legal, legal.map((e) => e.weight));
        return toResult(pick.move, 0, 0, true, t0);
      }
    }
  }

  // ---- the weakest level sometimes just plays a random move ----
  if (!isHint && level.randomMoveChance > 0 && Math.random() < level.randomMoveChance) {
    const r = rootMoves[Math.floor(Math.random() * rootMoves.length)];
    return toResult(r.move, 0, 0, false, t0);
  }

  // ---- iterative deepening (the last part of the time is kept for the variety pass) ----
  const wantsVariety = !isHint && level.margin > 0;
  const mainBudget = wantsVariety ? budget * (1 - level.varietyShare) : budget;
  nodes = 0;
  stopped = false;
  externalStop = req.shouldStop || null;
  hardStopAt = t0 + mainBudget;
  const pruning = level.pruning;
  const maxDepth = Math.min(level.maxDepth, MAX_PLY - 10);

  let bestMove = rootMoves[0].move;
  let bestScore = 0;
  let completedDepth = 0;
  let lastIterTime = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const iterStart = now();
    // do not start an iteration we almost certainly cannot finish
    if (depth > 2 && iterStart - t0 + lastIterTime * 2.2 > mainBudget) break;

    let alpha = -INF, beta = INF;
    let delta = 28;
    if (depth >= 5) { alpha = Math.max(-INF, bestScore - delta); beta = Math.min(INF, bestScore + delta); }
    for (;;) {
      const score = searchRoot(depth, alpha, beta, pruning);
      if (stopped) break;
      if (score <= alpha && alpha > -INF) { alpha = Math.max(-INF, alpha - delta * 2); delta *= 2; continue; }
      if (score >= beta && beta < INF) { beta = Math.min(INF, beta + delta * 2); delta *= 2; continue; }
      break;
    }
    if (stopped) break; // unfinished iteration: keep the result of the previous one
    bestMove = rootMoves[0].move;
    bestScore = rootMoves[0].score;
    completedDepth = depth;
    lastIterTime = now() - iterStart;
    if (Math.abs(bestScore) > MATE_IN_MAX && depth >= 2) break; // forced mate found
  }

  // ---- variety: choose among the near-best moves ----
  if (wantsVariety && completedDepth >= 1 && Math.abs(bestScore) < MATE_IN_MAX) {
    const chosen = pickHumanMove(level, completedDepth, bestScore, t0, budget, pruning);
    if (chosen) { bestMove = chosen.move; bestScore = chosen.score; }
  }

  return toResult(bestMove, bestScore, completedDepth, false, t0);
}

/**
 * Re-scores the root moves close to the best one (exactly, with a narrow window) and picks one of
 * them with a softmax, so equal-looking moves are played in a varied way.
 */
function pickHumanMove(
  level: LevelConfig, depth: number, bestScore: number, t0: number, budget: number, pruning: number
): RootMove | null {
  // the variety pass uses the last part of the thinking time
  stopped = false;
  hardStopAt = t0 + budget;
  let margin = level.margin;
  if (bestScore > 500) margin = Math.min(margin, 12); // winning: do not throw the win away
  if (bestScore < -500) margin = Math.min(margin, 20);

  const vdepth = Math.max(1, depth - 2);
  const lo = bestScore - margin - 1;
  const hi = bestScore + margin + 1;
  const scored: RootMove[] = [];
  for (let i = 0; i < rootMoves.length; i++) {
    const m = rootMoves[i].move;
    if (!makeMove(m)) continue;
    const s = -search(vdepth - 1, -hi, -lo, 1, true, true, pruning);
    unmakeMove();
    if (stopped) return null;
    if (s > lo) scored.push({ move: m, score: s });
  }
  if (scored.length === 0) return null;
  let top = -INF;
  for (const r of scored) if (r.score > top) top = r.score;
  const cands = scored.filter((r) => r.score >= top - margin);
  const weights = cands.map((r) => Math.exp((r.score - top) / Math.max(level.temperature, 0.5)));
  return weightedPick(cands, weights);
}

/* =============================================================================
   6. HELPERS FOR TESTS / TOOLS
   ============================================================================= */

/** Counts leaf nodes of the legal move tree (the standard way to verify a move generator). */
export function perft(fen: string, depth: number): number {
  setFen(fen);
  const go = (d: number, ply: number): number => {
    if (d === 0) return 1;
    const off = ply * 256;
    const n = generate(moveBuf, off, false, true) - off;
    let total = 0;
    for (let i = off; i < off + n; i++) {
      const m = moveBuf[i];
      if (!makeMove(m)) continue;
      total += d === 1 ? 1 : go(d - 1, ply + 1);
      unmakeMove();
    }
    return total;
  };
  return go(depth, 0);
}

/** Recomputes the incremental score from scratch; used by the tests to prove it never drifts. */
export function debugIncrementalCheck(fen: string, plies: number): boolean {
  setFen(fen);
  for (let p = 0; p < plies; p++) {
    const n = generate(moveBuf, 0, false, true);
    const legal: number[] = [];
    for (let i = 0; i < n; i++) { const m = moveBuf[i]; if (makeMove(m)) { unmakeMove(); legal.push(m); } }
    if (!legal.length) return true;
    makeMove(legal[Math.floor(Math.random() * legal.length)]);
    let mg = 0, eg = 0, ph = 0, hh = 0, hl = 0;
    const c = new Int8Array(16);
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f, pc = board[sq];
      if (!pc) continue;
      mg += T_MG[pc][sq]; eg += T_EG[pc][sq]; ph += PHASE_VALUE[pc & 7]; c[pc]++;
      hh ^= Z_PIECE_HI[pc * 128 + sq]; hl ^= Z_PIECE_LO[pc * 128 + sq];
    }
    hh ^= Z_CASTLE_HI[castling]; hl ^= Z_CASTLE_LO[castling];
    if (epSq >= 0) { hh ^= Z_EP_HI[epSq & 7]; hl ^= Z_EP_LO[epSq & 7]; }
    if (side === BLACK) { hh ^= Z_SIDE_HI; hl ^= Z_SIDE_LO; }
    if (mg !== mgScore || eg !== egScore || ph !== phase || hh !== hashHi || hl !== hashLo) return false;
    for (let i = 0; i < 16; i++) if (c[i] !== cnt[i]) return false;
  }
  return true;
}

/** Static evaluation (centipawns, side to move) of a position. */
export function evaluateFen(fen: string): number {
  setFen(fen);
  return evaluate(-INF, INF);
}

/** Opening book statistics for the tests: how many lines, positions, and which moves were rejected. */
export function debugBook(): { lines: number; positions: number; problems: string[] } {
  if (!bookMap) buildBook();
  return { lines: BOOK_LINES.length, positions: bookMap!.size, problems: bookProblems.slice() };
}

/* ---- small referee helpers, only used by the automated tests ---- */
function currentFen(): string {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 16 + f];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += 'PNBRQKpnbrqk'[(p & 7) - 1 + (p >> 3) * 6];
    }
    if (empty) out += empty;
    if (r) out += '/';
  }
  const c = (castling & C_WK ? 'K' : '') + (castling & C_WQ ? 'Q' : '') + (castling & C_BK ? 'k' : '') + (castling & C_BQ ? 'q' : '');
  return `${out} ${side === WHITE ? 'w' : 'b'} ${c || '-'} ${epSq >= 0 ? sqName(epSq) : '-'} ${halfmove} 1`;
}

export function debugLegalMoves(fen: string): { from: string; to: string; promotion?: string }[] {
  setFen(fen);
  const out: { from: string; to: string; promotion?: string }[] = [];
  const n = generate(moveBuf, 0, false, true);
  for (let i = 0; i < n; i++) {
    const m = moveBuf[i];
    if (!makeMove(m)) continue;
    unmakeMove();
    const promo = (m >> 14) & 7;
    out.push({ from: sqName(m & 127), to: sqName((m >> 7) & 127), promotion: promo ? 'nbrq'[promo - 2] : undefined });
  }
  return out;
}

/** Plays one move and returns the new FEN, or null if it is not legal. */
export function debugPlay(fen: string, from: string, to: string, promotion = 'q'): string | null {
  setFen(fen);
  const n = generate(moveBuf, 0, false, true);
  for (let i = 0; i < n; i++) {
    const m = moveBuf[i];
    if (sqName(m & 127) !== from || sqName((m >> 7) & 127) !== to) continue;
    const promo = (m >> 14) & 7;
    if (promo && 'nbrq'[promo - 2] !== promotion) continue;
    if (!makeMove(m)) return null;
    return currentFen();
  }
  return null;
}

export function debugStatus(fen: string): 'ongoing' | 'checkmate' | 'stalemate' | 'fifty' | 'insufficient' {
  setFen(fen);
  const n = generate(moveBuf, 0, false, true);
  let legal = 0;
  for (let i = 0; i < n; i++) { if (makeMove(moveBuf[i])) { unmakeMove(); legal++; } }
  if (legal === 0) return inCheckNow() ? 'checkmate' : 'stalemate';
  if (halfmove >= 100) return 'fifty';
  if (cnt[WP] + cnt[BP] + cnt[WR] + cnt[BR] + cnt[WQ] + cnt[BQ] === 0 && cnt[WN] + cnt[BN] + cnt[WB] + cnt[BB] <= 1) return 'insufficient';
  return 'ongoing';
}
