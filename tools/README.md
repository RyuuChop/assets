# Converting your STL chess set ("New Chess")

STL files are far too heavy for a real-time game (your Knight is ~69 MB = about 1.4 million triangles,
and the board shows 32 pieces). `stl-to-glb.mjs` turns them into light GLB files (~20,000 triangles,
about 0.3-0.5 MB each) without visibly changing the shape. It needs only Node (no npm install).

## 1. Name of the files and where they go

The converter writes these six files (the names matter):

    public/models/new-chess/pawn.glb
    public/models/new-chess/rook.glb
    public/models/new-chess/knight.glb
    public/models/new-chess/bishop.glb
    public/models/new-chess/queen.glb
    public/models/new-chess/king.glb

When they exist, the set appears by itself as **New Chess** in *Theme & Board Studio -> 3D Model Set*.
(If you make the GLBs another way, e.g. in Blender, just save them with exactly these names in that folder.)

## 2. Convert

Open a terminal in the project folder (the one with `package.json`) and run (keep the quotes, your
path has spaces):

    node tools/stl-to-glb.mjs "D:\webs\My Project\assets\new chess\STL Files"

or, equivalently:

    npm run convert-stl -- "D:\webs\My Project\assets\new chess\STL Files"

The STL file names only have to CONTAIN the piece name, so `Bishop V1.stl`, `king V1.stl`, `Knight V1.stl`,
`Pawn V1.stl`, `Queen V1.stl` and `Rook V1.stl` all work. Expect a few seconds per piece.

Options (all optional):

| option            | meaning                                                                   |
|-------------------|---------------------------------------------------------------------------|
| `--tris 20000`    | target triangles per piece. Lower (e.g. 12000) = lighter, higher = finer. |
| `--up z`          | force the up axis (`x`, `y` or `z`). Default `auto` picks the tallest axis. |
| `--no-flip-check` | do not try to detect a piece that is upside down.                         |
| `--only knight`   | convert only the files whose name contains this word.                     |

## 3. Check it in the game

Start the game, open *Theme & Board Studio*, pick **New Chess**.

* Pieces lying on their side or upside down: run again with `--up x`, `--up y` or `--up z`.
* **Knights facing sideways or backwards:** the converter cannot know which way the horse looks. In the
  Studio panel, under *3D Model Set*, use **Knight facing** (0 / 90 / 180 / 270) until the white knights
  look at Black. It is remembered per set.
* Game feels slow: convert again with a smaller `--tris`.
