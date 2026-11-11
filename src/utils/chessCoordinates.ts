import * as THREE from 'three';

// Centered board dimensions based on original Chessboard.glb
export const BOARD_OFFSET_X = 40.1564865;
export const BOARD_OFFSET_Y = 0;
export const BOARD_OFFSET_Z = 41.3882789;

export const FILE_STEP_X = 1.7114;
export const FILE_START_X = -6.036;

export const RANK_STEP_Z = 1.7028;
export const RANK_START_Z = 5.932;

export const BOARD_SURFACE_Y = 0.25;

/**
 * Convert algebraic notation like 'e4' to 3D world position (centered board).
 */
export function squareToCoords(square: string): { x: number; z: number } {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0, 'h' -> 7
  const rank = parseInt(square[1], 10) - 1; // '1' -> 0, '8' -> 7

  const x = FILE_START_X + file * FILE_STEP_X;
  const z = RANK_START_Z - rank * RANK_STEP_Z;

  return { x, z };
}

/**
 * Convert world position (X, Z) back to nearest chess square (e.g. 'e4'), or null if outside.
 */
export function coordsToSquare(x: number, z: number): string | null {
  const file = Math.round((x - FILE_START_X) / FILE_STEP_X);
  const rank = Math.round((RANK_START_Z - z) / RANK_STEP_Z);

  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    return null;
  }

  const fileChar = String.fromCharCode(97 + file);
  const rankChar = String(rank + 1);
  return `${fileChar}${rankChar}`;
}

/**
 * Calculates graveyard / captured piece target position outside the chessboard.
 */
export function getCapturedPosition(color: 'w' | 'b', index: number): THREE.Vector3 {
  // Captured pieces are placed neatly along the left and right table edges
  const sideX = color === 'w' ? -8.5 : 8.5;
  const row = Math.floor(index / 8);
  const col = index % 8;
  const z = -4.5 + col * 1.3;
  const x = sideX + (row === 0 ? 0 : color === 'w' ? -1.4 : 1.4);
  return new THREE.Vector3(x, BOARD_SURFACE_Y + 0.1, z);
}
