import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import { ModelOverrides } from '../config/themes';
import { TILE_SURFACE_Y, FRAME_TOP_Y } from './constants';
import { easeInOutCubic } from './animationUtils';

/* =========================================================================
   5. ACTIVE PIECE MODEL DATA & RENDERING
   ========================================================================= */

export interface ActivePiece {
  id: string;
  square: string;
  type: string;
  color: 'w' | 'b';
  toX: number;
  toZ: number;
  fromX?: number;
  fromZ?: number;
  animating?: boolean;
  animStartTime?: number;
  animDuration?: number;
  arcHeight?: number;
  isFading?: boolean;
  fadeStartTime?: number;
  fadeDuration?: number;
  captured?: boolean;
  trayIndex?: number;
  fromScale?: number;
  targetScale?: number;
}

export interface PieceProps {
  piece: ActivePiece;
  template?: THREE.Group;
  whiteMaterial: THREE.Material;
  blackMaterial: THREE.Material;
  isSelected: boolean;
  overrides?: ModelOverrides;
  onPieceClick: (piece: ActivePiece, e: any) => void;
  onPointerEnter: (piece: ActivePiece) => void;
  onPointerLeave: () => void;
  onAnimationComplete: (id: string) => void;
  onFadeComplete: (id: string) => void;
}

export const Piece = React.memo(function Piece({
  piece,
  template,
  whiteMaterial,
  blackMaterial,
  isSelected,
  overrides,
  onPieceClick,
  onPointerEnter,
  onPointerLeave,
  onAnimationComplete,
  onFadeComplete,
}: PieceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentLiftRef = useRef<number>(0);
  const themeBloomScaleRef = useRef<number>(0.92);

  const pieceObject = useMemo(() => {
    if (!template) return null;
    const clone = SkeletonUtils.clone(template) as THREE.Group;
    const mat = piece.color === 'w' ? whiteMaterial : blackMaterial;
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return clone;
  }, [template, piece.color, whiteMaterial, blackMaterial]);

  const knightOffset = overrides?.knightYawOffset ?? Math.PI / 2;
  const baseYaw = overrides?.baseYaw ?? 0;
  const yaw = (piece.color === 'b' ? Math.PI : 0) + (piece.type === 'n' ? knightOffset : baseYaw);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const now = performance.now();
    const group = groupRef.current;

    // Smooth theme/model switch scale-in
    themeBloomScaleRef.current = THREE.MathUtils.damp(
      themeBloomScaleRef.current,
      1.0,
      14,
      delta
    );

    const targetLift = isSelected ? 0.35 : 0;
    currentLiftRef.current = THREE.MathUtils.damp(
      currentLiftRef.current,
      targetLift,
      16,
      delta
    );

    const targetBaseScale = piece.captured ? (piece.targetScale ?? 0.65) : 1.0;
    const startBaseScale = piece.fromScale !== undefined ? piece.fromScale : 1.0;
    const startSurfaceY = TILE_SURFACE_Y;
    const endSurfaceY = piece.captured ? FRAME_TOP_Y : TILE_SURFACE_Y;

    if (piece.animating && piece.fromX !== undefined && piece.fromZ !== undefined && piece.animStartTime) {
      const elapsed = now - piece.animStartTime;
      const duration = piece.animDuration || 520;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const t = easeInOutCubic(progress);

      const curX = THREE.MathUtils.lerp(piece.fromX, piece.toX, t);
      const curZ = THREE.MathUtils.lerp(piece.fromZ, piece.toZ, t);
      const curSurfaceY = THREE.MathUtils.lerp(startSurfaceY, endSurfaceY, t);
      const arc = Math.sin(t * Math.PI) * (piece.arcHeight || 0.55);
      const currentScale = THREE.MathUtils.lerp(startBaseScale, targetBaseScale, t) * themeBloomScaleRef.current;

      group.position.set(curX, curSurfaceY + currentLiftRef.current + arc, curZ);
      group.scale.setScalar(currentScale);

      if (progress >= 1) {
        piece.animating = false;
        group.position.set(piece.toX, endSurfaceY + currentLiftRef.current, piece.toZ);
        group.scale.setScalar(targetBaseScale * themeBloomScaleRef.current);
        onAnimationComplete(piece.id);
      }
    } else if (piece.isFading && piece.fadeStartTime) {
      const elapsed = now - piece.fadeStartTime;
      const duration = piece.fadeDuration || 250;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const scale = Math.max(0.001, (1 - progress) * themeBloomScaleRef.current);

      group.scale.setScalar(scale);
      group.position.y = TILE_SURFACE_Y + progress * 0.25;

      if (progress >= 1) {
        onFadeComplete(piece.id);
      }
    } else {
      group.position.set(piece.toX, endSurfaceY + currentLiftRef.current, piece.toZ);
      group.scale.setScalar(targetBaseScale * themeBloomScaleRef.current);
    }
  });

  if (!pieceObject) return null;

  return (
    <group
      ref={groupRef}
      position={[piece.toX, piece.captured ? FRAME_TOP_Y : TILE_SURFACE_Y, piece.toZ]}
      onClick={piece.captured ? undefined : (e) => {
        e.stopPropagation();
        onPieceClick(piece, e);
      }}
      onPointerEnter={piece.captured ? undefined : (e) => {
        e.stopPropagation();
        onPointerEnter(piece);
      }}
      onPointerLeave={piece.captured ? undefined : (e) => {
        e.stopPropagation();
        onPointerLeave();
      }}
    >
      <group rotation={[0, yaw, 0]}>
        <primitive object={pieceObject} />
      </group>
    </group>
  );
});
