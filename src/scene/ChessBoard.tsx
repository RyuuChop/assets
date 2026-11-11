import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { BoardStyleConfig } from '../config/themes';
import { SQUARE, TILE_SURFACE_Y, TILE_THICKNESS } from './constants';
import { squareToCoords } from './animationUtils';

/* =========================================================================
   FRAME TOP Y & FRAME BAND GEOMETRY
   Frame box: position [0, -0.12, 0], height 0.32 -> top face is at y = 0.04.
   Frame band is between tile edge (6.4) and frame outer edge (7.65) -> center = 7.025.
   ========================================================================= */

const FRAME_MESH_Y = -0.12;
const FRAME_BOX_HEIGHT = 0.32;
const FRAME_TOP_Y = FRAME_MESH_Y + FRAME_BOX_HEIGHT / 2 + 0.003; // ~0.043, resting flat on frame top

const FRAME_BAND_OFFSET = (6.4 + 7.65) / 2; // 7.025

export interface BoardProps {
  boardConfig: BoardStyleConfig;
  showCoordinates: boolean;
  showLegalMarkers: boolean;
  showLastMoveHighlight: boolean;
  selectedSquare: string | null;
  hoveredSquare: string | null;
  lastMove: { from: string; to: string } | null;
  /** Suggested move (vs-AI hint), shown as two green squares */
  hint?: { from: string; to: string } | null;
  inCheckSquare: string | null;
  legalMoves: string[];
  captureMoves: string[];
  onTileClick: (square: string, e: any) => void;
  onTilePointerOver: (square: string) => void;
  onTilePointerOut: () => void;
}

export const CustomizableChessBoard = React.memo(function CustomizableChessBoard({
  boardConfig,
  showCoordinates,
  showLegalMarkers,
  showLastMoveHighlight,
  selectedSquare,
  hoveredSquare,
  lastMove,
  hint,
  inCheckSquare,
  legalMoves,
  captureMoves,
  onTileClick,
  onTilePointerOver,
  onTilePointerOut,
}: BoardProps) {
  const { camera, invalidate } = useThree();
  const [isBlackSide, setIsBlackSide] = useState<boolean>(false);
  const isBlackSideRef = useRef<boolean>(false);

  // Detect camera side (White side vs Black side) and flip text so it remains upright
  useFrame(() => {
    const blackSide = camera.position.z < 0;
    if (blackSide !== isBlackSideRef.current) {
      isBlackSideRef.current = blackSide;
      setIsBlackSide(blackSide);
      invalidate();
    }
  });

  const tileGeometry = useMemo(
    () => new THREE.BoxGeometry(SQUARE * 0.995, TILE_THICKNESS, SQUARE * 0.995),
    []
  );

  const materials = useMemo(() => {
    const lightCol = new THREE.Color(boardConfig.lightColor);
    const darkCol = new THREE.Color(boardConfig.darkColor);
    const tileRoughness = Math.min(Math.max(boardConfig.roughness, 0.55), 0.7);
    const boardEnvMap = Math.min(boardConfig.preset === 'wood' ? 0.25 : 0.45, 0.6);

    return {
      light: new THREE.MeshStandardMaterial({
        color: lightCol,
        roughness: tileRoughness,
        metalness: 0,
        envMapIntensity: boardEnvMap,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: darkCol,
        roughness: Math.min(1.0, tileRoughness + 0.04),
        metalness: 0,
        envMapIntensity: boardEnvMap,
      }),
      lastMoveLight: new THREE.MeshStandardMaterial({
        color: lightCol.clone().offsetHSL(0.04, 0.12, -0.06),
        roughness: tileRoughness,
        metalness: 0,
        emissive: new THREE.Color('#d97706'),
        emissiveIntensity: 0.25,
      }),
      lastMoveDark: new THREE.MeshStandardMaterial({
        color: darkCol.clone().offsetHSL(0.04, 0.12, 0.06),
        roughness: tileRoughness,
        metalness: 0,
        emissive: new THREE.Color('#d97706'),
        emissiveIntensity: 0.25,
      }),
      selected: new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        roughness: 0.25,
        metalness: 0.1,
        emissive: new THREE.Color('#f59e0b'),
        emissiveIntensity: 0.35,
      }),
      inCheck: new THREE.MeshStandardMaterial({
        color: '#dc2626',
        roughness: 0.25,
        metalness: 0.1,
        emissive: new THREE.Color('#ef4444'),
        emissiveIntensity: 0.45,
      }),
      hovered: new THREE.MeshStandardMaterial({
        color: '#60a5fa',
        roughness: 0.3,
        metalness: 0.1,
        emissive: new THREE.Color('#38bdf8'),
        emissiveIntensity: 0.28,
      }),
      hintFrom: new THREE.MeshStandardMaterial({
        color: '#16a34a',
        roughness: 0.3,
        metalness: 0.1,
        emissive: new THREE.Color('#22c55e'),
        emissiveIntensity: 0.3,
      }),
      hintTo: new THREE.MeshStandardMaterial({
        color: '#22c55e',
        roughness: 0.25,
        metalness: 0.1,
        emissive: new THREE.Color('#4ade80'),
        emissiveIntensity: 0.5,
      }),
      frame: new THREE.MeshStandardMaterial({
        color: new THREE.Color(boardConfig.frameColor),
        roughness: Math.min(1.0, tileRoughness + 0.08),
        metalness: 0.05,
        envMapIntensity: Math.min(boardEnvMap, 0.5),
      }),
      brassInlay: new THREE.MeshStandardMaterial({
        color: new THREE.Color(boardConfig.inlayColor),
        roughness: 0.28,
        metalness: 0.6,
        envMapIntensity: Math.min(boardEnvMap, 0.6),
      }),
    };
  }, [boardConfig]);

  useEffect(() => {
    return () => {
      Object.values(materials).forEach((m) => m.dispose());
    };
  }, [materials]);

  const tiles = useMemo(() => {
    const list = [];
    for (let row = 0; row < 8; row++) {
      for (let file = 0; file < 8; file++) {
        const square = `${String.fromCharCode(97 + file)}${8 - row}`;
        const isDark = (file + row) % 2 !== 0;
        const x = (file - 3.5) * SQUARE;
        const z = (row - 3.5) * SQUARE;
        list.push({ square, isDark, x, z });
      }
    }
    return list;
  }, []);

  // Place files a-h and ranks 1-8 centered exactly on each column/row on the frame band
  const coordinateLabels = useMemo(() => {
    const labels: { text: string; x: number; z: number }[] = [];

    // Files a-h (letters) on top and bottom frame bands
    for (let f = 0; f < 8; f++) {
      const char = String.fromCharCode(97 + f);
      const x = (f - 3.5) * SQUARE;
      labels.push({ text: char, x, z: FRAME_BAND_OFFSET }); // White side
      labels.push({ text: char, x, z: -FRAME_BAND_OFFSET }); // Black side
    }

    // Ranks 1-8 (numbers) on left and right frame bands
    for (let r = 1; r <= 8; r++) {
      const char = String(r);
      const z = (8 - r - 3.5) * SQUARE;
      labels.push({ text: char, x: -FRAME_BAND_OFFSET, z }); // Left side
      labels.push({ text: char, x: FRAME_BAND_OFFSET, z }); // Right side
    }

    return labels;
  }, []);

  const selectedCoords = useMemo(
    () => (selectedSquare ? squareToCoords(selectedSquare) : null),
    [selectedSquare]
  );

  const textRotationY = isBlackSide ? Math.PI : 0;

  return (
    <group>
      {tiles.map((t) => {
        const isSelected = selectedSquare === t.square;
        const isHovered = hoveredSquare === t.square;
        const isInCheck = inCheckSquare === t.square;
        const isLastMove =
          showLastMoveHighlight &&
          lastMove &&
          (lastMove.from === t.square || lastMove.to === t.square);

        let activeMat = t.isDark ? materials.dark : materials.light;
        if (isInCheck) activeMat = materials.inCheck;
        else if (isSelected) activeMat = materials.selected;
        else if (hint && hint.to === t.square) activeMat = materials.hintTo;
        else if (hint && hint.from === t.square) activeMat = materials.hintFrom;
        else if (isLastMove) activeMat = t.isDark ? materials.lastMoveDark : materials.lastMoveLight;
        else if (isHovered) activeMat = materials.hovered;

        return (
          <mesh
            key={t.square}
            position={[t.x, 0, t.z]}
            geometry={tileGeometry}
            material={activeMat}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              onTileClick(t.square, e);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onTilePointerOver(t.square);
            }}
            onPointerOut={() => onTilePointerOut()}
          />
        );
      })}

      {selectedCoords && (
        <mesh
          position={[selectedCoords.x, TILE_SURFACE_Y + 0.015, selectedCoords.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.48, 0.62, 32]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}

      {showLegalMarkers &&
        legalMoves.map((sq) => {
          const coords = squareToCoords(sq);
          const isCapture = captureMoves.includes(sq);

          return isCapture ? (
            <mesh
              key={`marker-${sq}`}
              position={[coords.x, TILE_SURFACE_Y + 0.02, coords.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(sq, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onTilePointerOver(sq);
              }}
              onPointerOut={() => onTilePointerOut()}
            >
              <ringGeometry args={[0.44, 0.58, 32]} />
              <meshBasicMaterial color="#f43f5e" transparent opacity={0.88} side={THREE.DoubleSide} />
            </mesh>
          ) : (
            <mesh
              key={`marker-${sq}`}
              position={[coords.x, TILE_SURFACE_Y + 0.018, coords.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(sq, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onTilePointerOver(sq);
              }}
              onPointerOut={() => onTilePointerOut()}
            >
              <circleGeometry args={[0.22, 24]} />
              <meshBasicMaterial color="#10b981" transparent opacity={0.8} />
            </mesh>
          );
        })}

      {/* Inlay sits just BELOW the tile top so it only shows as border ring & hairline gaps */}
      <mesh position={[0, TILE_SURFACE_Y - 0.02, 0]} material={materials.brassInlay}>
        <boxGeometry args={[12.94, 0.015, 12.94]} />
      </mesh>

      <mesh position={[0, -0.12, 0]} material={materials.frame} receiveShadow>
        <boxGeometry args={[15.3, 0.32, 15.3]} />
      </mesh>
      <mesh position={[0, -0.22, 0]} material={materials.frame} receiveShadow>
        <boxGeometry args={[15.7, 0.12, 15.7]} />
      </mesh>

      {/* Captured piece tray rails (left for black pieces, right for white pieces) */}
      <mesh position={[-9.4, -0.12, 0.7]} material={materials.frame} receiveShadow castShadow>
        <boxGeometry args={[2.6, 0.32, 12.8]} />
      </mesh>
      <mesh position={[9.4, -0.12, 0.7]} material={materials.frame} receiveShadow castShadow>
        <boxGeometry args={[2.6, 0.32, 12.8]} />
      </mesh>

      {/* Coordinates: flat on frame top, high contrast, orientation follows camera */}
      {showCoordinates &&
        coordinateLabels.map((item, idx) => (
          <Text
            key={`coord-${idx}`}
            position={[item.x, FRAME_TOP_Y, item.z]}
            rotation={[-Math.PI / 2, 0, textRotationY]}
            fontSize={0.45}
            fontWeight="bold"
            color="#f5e6c8"
            outlineWidth={0.05}
            outlineColor="#1a1410"
            anchorX="center"
            anchorY="middle"
          >
            {item.text}
          </Text>
        ))}
    </group>
  );
});
