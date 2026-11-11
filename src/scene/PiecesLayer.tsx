import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { ChessTheme, buildPieceMaterial, DiscoveredModelSet, PieceColorOverrides, PieceMaterialSpec, findModelSet, resolvePieceModelPath, resolveFallbackPieceModelPath } from '../config/themes';
import { getNormalizedTemplate } from './pieceTemplates';
import { ActivePiece, Piece } from './Piece';

/* =========================================================================
   6. PIECES LAYER (DYNAMIC MODEL SET & MATERIAL THEME COMBINER)
   ========================================================================= */

export interface PiecesLayerProps {
  modelSet: DiscoveredModelSet;
  theme: ChessTheme;
  pieceColors?: PieceColorOverrides;
  /** User-chosen knight yaw (radians) for the active set; undefined = use the set's own default */
  knightYawOverride?: number;
  pieces: ActivePiece[];
  selectedSquare: string | null;
  onPieceClick: (piece: ActivePiece, e: any) => void;
  onPointerEnter: (piece: ActivePiece) => void;
  onPointerLeave: () => void;
  onAnimationComplete: (id: string) => void;
  onFadeComplete: (id: string) => void;
}

export function PiecesLayer({
  modelSet,
  theme,
  pieceColors,
  knightYawOverride,
  pieces,
  selectedSquare,
  onPieceClick,
  onPointerEnter,
  onPointerLeave,
  onAnimationComplete,
  onFadeComplete,
}: PiecesLayerProps) {
  const pawnUrl = resolvePieceModelPath(modelSet, 'p');
  const rookUrl = resolvePieceModelPath(modelSet, 'r');
  const knightUrl = resolvePieceModelPath(modelSet, 'n');
  const bishopUrl = resolvePieceModelPath(modelSet, 'b');
  const queenUrl = resolvePieceModelPath(modelSet, 'q');
  const kingUrl = resolvePieceModelPath(modelSet, 'k');

  const pawnGLTF = useGLTF(pawnUrl);
  const rookGLTF = useGLTF(rookUrl);
  const knightGLTF = useGLTF(knightUrl);
  const bishopGLTF = useGLTF(bishopUrl);
  const queenGLTF = useGLTF(queenUrl);
  const kingGLTF = useGLTF(kingUrl);

  const fallbackPawnGLTF = useGLTF(resolveFallbackPieceModelPath('p'));
  const fallbackRookGLTF = useGLTF(resolveFallbackPieceModelPath('r'));
  const fallbackKnightGLTF = useGLTF(resolveFallbackPieceModelPath('n'));
  const fallbackBishopGLTF = useGLTF(resolveFallbackPieceModelPath('b'));
  const fallbackQueenGLTF = useGLTF(resolveFallbackPieceModelPath('q'));
  const fallbackKingGLTF = useGLTF(resolveFallbackPieceModelPath('k'));

  const templates = useMemo(() => {
    const rawScenes: Record<string, THREE.Object3D | undefined> = {
      p: pawnGLTF?.scene || fallbackPawnGLTF?.scene,
      r: rookGLTF?.scene || fallbackRookGLTF?.scene,
      n: knightGLTF?.scene || fallbackKnightGLTF?.scene,
      b: bishopGLTF?.scene || fallbackBishopGLTF?.scene,
      q: queenGLTF?.scene || fallbackQueenGLTF?.scene,
      k: kingGLTF?.scene || fallbackKingGLTF?.scene,
    };

    const pawnScene = rawScenes.p;
    const map: Record<string, THREE.Group> = {};

    // Types this set lacks are borrowed from the Default set and normalized exactly like the
    // Default set does it (same cache key), so they never inherit this set's overrides.
    const defaultSet = findModelSet('default');
    const borrowedScenes: Record<string, THREE.Object3D | undefined> = {
      p: fallbackPawnGLTF?.scene,
      r: fallbackRookGLTF?.scene,
      n: fallbackKnightGLTF?.scene,
      b: fallbackBishopGLTF?.scene,
      q: fallbackQueenGLTF?.scene,
      k: fallbackKingGLTF?.scene,
    };

    for (const [type, rawScene] of Object.entries(rawScenes)) {
      if (modelSet.fallbackToDefaultTypes?.includes(type as 'p' | 'r' | 'n' | 'b' | 'q' | 'k')) {
        const borrowed = borrowedScenes[type];
        if (borrowed instanceof THREE.Object3D) {
          map[type] = getNormalizedTemplate(
            defaultSet.id,
            type,
            borrowed,
            defaultSet.overrides,
            borrowedScenes.p,
            defaultSet.isSingleFile,
            { nodeNames: defaultSet.nodeNames, bakeWorldTransform: defaultSet.bakeWorldTransform }
          );
        }
        continue;
      }
      if (rawScene && rawScene instanceof THREE.Object3D) {
        map[type] = getNormalizedTemplate(
          modelSet.id,
          type,
          rawScene,
          modelSet.overrides,
          pawnScene,
          modelSet.isSingleFile,
          { nodeNames: modelSet.nodeNames, bakeWorldTransform: modelSet.bakeWorldTransform }
        );
      }
    }
    return map;
  }, [
    modelSet,
    pawnGLTF,
    rookGLTF,
    knightGLTF,
    bishopGLTF,
    queenGLTF,
    kingGLTF,
    fallbackPawnGLTF,
    fallbackRookGLTF,
    fallbackKnightGLTF,
    fallbackBishopGLTF,
    fallbackQueenGLTF,
    fallbackKingGLTF,
  ]);

  // Shared materials for all pieces in this theme
  const { whiteMaterial, blackMaterial } = useMemo(() => {
    const withUserColors = (spec: PieceMaterialSpec, color?: string): PieceMaterialSpec => ({
      ...spec,
      ...(color ? { color } : {}),
      ...(pieceColors?.roughness !== undefined ? { roughness: pieceColors.roughness } : {}),
      ...(pieceColors?.metalness !== undefined ? { metalness: pieceColors.metalness } : {}),
    });
    const wMat = buildPieceMaterial(withUserColors(theme.pieceMaterials.white, pieceColors?.white));
    const bMat = buildPieceMaterial(withUserColors(theme.pieceMaterials.black, pieceColors?.black));
    return { whiteMaterial: wMat, blackMaterial: bMat };
  }, [theme, pieceColors]);

  useEffect(() => {
    return () => {
      whiteMaterial.dispose();
      blackMaterial.dispose();
    };
  }, [whiteMaterial, blackMaterial]);

  return (
    <group>
      {pieces.map((piece) => (
        <Piece
          key={piece.id}
          piece={piece}
          template={templates[piece.type]}
          whiteMaterial={whiteMaterial}
          blackMaterial={blackMaterial}
          isSelected={selectedSquare === piece.square}
          overrides={
            modelSet.fallbackToDefaultTypes?.includes(piece.type as 'p' | 'r' | 'n' | 'b' | 'q' | 'k')
              ? findModelSet('default').overrides
              : knightYawOverride !== undefined
              ? { ...modelSet.overrides, knightYawOffset: knightYawOverride }
              : modelSet.overrides
          }
          onPieceClick={onPieceClick}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onAnimationComplete={onAnimationComplete}
          onFadeComplete={onFadeComplete}
        />
      ))}
    </group>
  );
}
