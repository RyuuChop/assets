

/* =========================================================================
   1. CONSTANTS & GEOMETRY
   ========================================================================= */

export const SQUARE = 1.6;
export const TILE_THICKNESS = 0.22;
export const TILE_SURFACE_Y = TILE_THICKNESS / 2; // 0.11
export const FRAME_TOP_Y = 0.04;
export const FOOTPRINT = 0.7;

export const TYPE_FOOTPRINT: Record<string, number> = {
  p: 0.75,
  r: 0.9,
  n: 0.95,
  b: 0.9,
  q: 1.0,
  k: 1.0,
};

/**
 * Calculates world coordinates for a captured piece in the side tray.
 * Captured Black pieces go to the Left (negative X, side = -1).
 * Captured White pieces go to the Right (positive X, side = +1).
 */
export function getTraySlotCoords(color: 'w' | 'b', trayIndex: number): { x: number; z: number } {
  const side = color === 'b' ? -1 : 1;
  const col = trayIndex % 2;
  const row = Math.floor(trayIndex / 2);
  const x = side * (7.65 + 1.25 + col * 1.0);
  const z = 5.6 - row * 1.4;
  return { x, z };
}
