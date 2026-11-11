# Changes (v2 + v3)

## Bug fixes
- **Board checker pattern**: the brass inlay box sat 0.0025 above the tiles and covered all 64 of them.
  It now sits just below the tile surface (visible only as the border ring and hairline gaps).
- **Geometric Studio**: rook/bishop meshes had generic names (`Cylinder.010` / `Cylinder.000`), so the
  loader fell back to the whole scene (a cluster of tiny pieces). Added explicit `nodeNames` and
  `bakeWorldTransform` for this set in `src/utils/modelRegistry.ts`.
- **Knight facing**: measured the real muzzle direction of every set. Default, Carved Classic and
  Monolithic now use `knightYawOffset = Math.PI` (white faces Black). Sculpted/Tournament were already
  correct (`Math.PI / 2`). Geometric Studio uses `Math.PI + 0.39`.
- **Geometric knight size**: `footprintScale: { n: 1.25 }` (its long head made it ~30% too small).
  `footprintScale` is now honoured in `src/scene/pieceTemplates.ts`.

## Assets
- The 12 piece files in `public/models/*.glb` and `public/models/tournament/*.glb` were 4.6 MB each because
  they contained the whole 38-mesh set while the scene used one piece. Unreferenced data was removed:
  55.2 MB -> 1.84 MB. Geometry, transforms and materials are identical (verified vertex by vertex).
- Removed 8 byte-identical duplicate GLBs that no code path loads (project root copies and
  `public/assets/*.glb`). A copy of each remains in `public/` or `public/assets/models/`.
- `Chess_pieces1.03.glb` (project root) is intentionally untouched; it is not registered as a set yet.

## Code structure (no behaviour change)
`src/App.tsx` (2620 lines) was split along its existing numbered sections:
- `src/scene/constants.ts`, `pieceTemplates.ts`, `animationUtils.ts`
- `src/scene/Piece.tsx`, `PiecesLayer.tsx`, `ChessBoard.tsx`, `CameraController.tsx`
- `src/components/ModeModal.tsx`, `ErrorBoundary.tsx`
- `src/utils/persistedSettings.ts`
`App.tsx` re-exports the old public names, so existing imports (e.g. `main.tsx`) still work.


---

# v3 changes

## Model sets: all 5 of your models are now used
Before, 6 entries were shown but only 3 were different models. Verified by comparing vertex data:
- *Carved Classic* was identical to *Championship Default* (6/6 files bit-for-bit equal).
- *Sculpted Standard* and *Tournament Steel* were identical to *Monolithic Grandmaster*.
Those duplicate folders (`public/models/**`) were removed, and old saved ids are mapped to the set that
has the same models (`MODEL_SET_ALIASES` / `findModelSet` in `src/utils/modelRegistry.ts`).

Two models that were never registered are now sets:
- **Royal Heritage** = `public/Chessboard.glb` (the file spells rook as "Rock", so node names are explicit).
- **Imperial Sculpt (HD)** = `public/Chess_pieces1.03.glb` (moved from the project root into `public/`).
  The file has no bishop or knight, so those two are borrowed from the Default set
  (`fallbackToDefaultTypes`). It is ~670k triangles, so it is flagged `heavy` and is NOT preloaded at startup.

Sets now: Championship Default, Monolithic Grandmaster, Geometric Studio, Royal Heritage, Imperial Sculpt (HD).

## New features
- **Piece Colors** section in Theme & Board Studio: white/black color pickers plus roughness and
  metalness sliders. Picking a theme (or "Reset to Theme Defaults") clears them. Saved with the other settings.
- **Hint** button (Player vs AI only): asks the AI worker for the best move at Hard strength and highlights
  both squares in green. Disappears on any move/undo/reset.

## Camera
- Removed camera inertia (`enableDamping={false}`): the view stops exactly when you release the mouse.
- Camera transitions now orbit around the board (spherical interpolation). The old straight-line
  interpolation passed directly over the board centre when flipping sides, which is what looked wrong.
  PvP auto-flip keeps your current zoom and tilt and only swings around to the other side.


---

# v4 changes

## New AI ("src/ai/chessAI.ts") and a 4th difficulty: Extreme
The old engine ran on chess.js, which is slow, so "Hard" could only look 4 moves ahead. The whole AI is now
one dedicated, dependency-free file with its own fast move generator, so the same time buys much deeper search.

* **Engine:** 0x88 board, legal move generator (verified with perft on 6 standard positions: 16.6 million
  nodes, all counts exact), tapered evaluation (material, piece-square tables, mobility, pawn structure,
  bishop pair, rook files, king safety, mop-up), iterative deepening + PVS, transposition table, null move,
  late move reductions, futility pruning, check extensions, quiescence, killer/history/MVV-LVA ordering,
  repetition and 50-move detection.
* **Levels** (tune them in `AI_LEVELS` at the top of the file): easy, medium, hard (about 6 moves deep) and
  **extreme** (no depth limit, 4.5 s per move). Measured in test matches: extreme beat hard 16-0, hard beat
  medium 5-1, medium beat easy 6-0.
* **Not the same game twice:** an opening book (74 lines, ~690 positions) with weighted random choice, plus the
  AI picks among moves that are almost as good as the best one, plus every new game gets a random
  "personality" (how much it values activity, king safety, pawn structure ...). 8 test games of extreme vs
  extreme were 8 different games.
* **Hint** now uses the same engine at full strength (non-random). It was greyed out after the first move
  because it depended on a flag (`hasActiveAnimation`) that is never cleared; that dependency is removed.
* The AI's first move (when you play Black) used to run on the main thread and would have frozen the page
  for the whole thinking time; it now runs in the worker like every other AI move. Starting a new game also
  cancels (and restarts) a worker that is still thinking.
* `src/workers/aiWorker.ts` is now a thin wrapper and `src/utils/chessEngine.ts` a thin bridge; the old
  duplicated engines were removed.

## Sets
* Removed **Royal Heritage** (`Chessboard.glb` was identical to the Default set, verified triangle by
  triangle) and **Imperial Sculpt** (its two GLBs are no longer in the project).
* New slot **New Chess**: put `pawn.glb rook.glb knight.glb bishop.glb queen.glb king.glb` in
  `public/models/new-chess/`. See `tools/README.md`.
* `tools/stl-to-glb.mjs`: converts heavy STL files (millions of triangles) into game-ready GLBs; checked with
  1.6 million triangle input (6.5 s, 426 MB RAM) and a surface deviation under 0.7% of the piece height.
* **Knight facing** selector (0/90/180/270) per set in the Studio panel.
