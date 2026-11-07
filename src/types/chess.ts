export type GameMode = 'vs-ai' | 'pass-and-play' | 'sandbox';
export type AppMode = 'pvp' | 'ai';
export type AIDifficulty = 'easy' | 'medium' | 'hard';
export type PlayerColorChoice = 'white' | 'black' | 'random';

export type CameraPreset = 'white' | 'black' | 'top' | 'isometric' | 'free';
export type LightingTheme = 'grandmaster' | 'midnight' | 'sunlit' | 'studio';
export type BoardTheme = 'original' | 'alternate' | 'wood' | 'obsidian';

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | '50-move';

export interface GameOverState {
  isOver: boolean;
  winner: 'w' | 'b' | 'draw' | null;
  reason: GameOverReason | null;
  description: string;
}

export interface Piece3DInfo {
  id: string;
  pieceType: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  color: 'w' | 'b';
  square: string; // e.g. "e4"
  captured: boolean;
  captureIndex?: number;
}

export interface CapturedPieces {
  w: string[]; // captured black pieces (won by white)
  b: string[]; // captured white pieces (won by black)
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  piece: string;
  color: 'w' | 'b';
  captured?: string;
  fen: string;
}
