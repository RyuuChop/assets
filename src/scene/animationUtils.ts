import { SQUARE } from './constants';

/* =========================================================================
   3. ANIMATION & COORDINATE UTILITIES
   ========================================================================= */

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function squareToCoords(square: string): { x: number; z: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10);
  const x = (file - 3.5) * SQUARE;
  const z = (8 - rank - 3.5) * SQUARE;
  return { x, z };
}
