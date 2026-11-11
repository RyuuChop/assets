import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import { ModelOverrides } from '../config/themes';
import { TILE_SURFACE_Y } from './constants';
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
}

export interface PieceProps {
  piece: ActivePiece;
  template?: THREE.Group;
  whiteMaterial: THREE.Material;
  blackMaterial: THREE.Material;
  useOriginalMaterials: boolean;
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
  useOriginalMaterials,
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
    if (!useOriginalMaterials) {
      const mat = piece.color === 'w' ? whiteMaterial : blackMaterial;
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = mat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }
    return clone;
  }, [template, piece.color, whiteMaterial, blackMaterial, useOriginalMaterials]);

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

    if (piece.animating && piece.fromX !== undefined && piece.fromZ !== undefined && piece.animStartTime) {
      const elapsed = now - piece.animStartTime;
      const duration = piece.animDuration || 520;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const t = easeInOutCubic(progress);

      const curX = THREE.MathUtils.lerp(piece.fromX, piece.toX, t);
      const curZ = THREE.MathUtils.lerp(piece.fromZ, piece.toZ, t);
      const arc = Math.sin(t * Math.PI) * (piece.arcHeight || 0.55);

      group.position.set(curX, TILE_SURFACE_Y + currentLiftRef.current + arc, curZ);
      group.scale.setScalar(themeBloomScaleRef.current);

      if (progress >= 1) {
        piece.animating = false;
        group.position.set(piece.toX, TILE_SURFACE_Y + currentLiftRef.current, piece.toZ);
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
      group.position.set(piece.toX, TILE_SURFACE_Y + currentLiftRef.current, piece.toZ);
      group.scale.setScalar(themeBloomScaleRef.current);
    }
  });

  if (!pieceObject) return null;

  return (
    <group
      ref={groupRef}
      position={[piece.toX, TILE_SURFACE_Y, piece.toZ]}
      onClick={(e) => {
        e.stopPropagation();
        onPieceClick(piece, e);
      }}
      onPointerEnter={(e) => {
        e.stopPropagation();
        onPointerEnter(piece);
      }}
      onPointerLeave={(e) => {
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
