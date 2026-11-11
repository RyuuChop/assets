import * as THREE from 'three';
import {
  DISCOVERED_MODEL_SETS,
  findModelSet,
  DiscoveredModelSet,
  resolvePieceModelPath,
  resolveFallbackPieceModelPath,
  DEFAULT_PIECE_FILES,
} from '../utils/modelRegistry';

export {
  DISCOVERED_MODEL_SETS,
  findModelSet,
  resolvePieceModelPath,
  resolveFallbackPieceModelPath,
  DEFAULT_PIECE_FILES,
};
export type { DiscoveredModelSet };

export interface ModelOverrides {
  upAxis?: 'y' | 'z' | 'x';
  baseYaw?: number;
  knightYawOffset?: number;
  scaleMultiplier?: number;
  flipUp?: boolean;
  footprintScale?: Record<string, number>;
}

export interface ModelSetDefinition extends DiscoveredModelSet {}

export interface PieceMaterialSpec {
  color: string;
  roughness: number;
  metalness: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  envMapIntensity?: number;
}

/** User adjustments layered on top of the active theme's piece materials (all optional). */
export interface PieceColorOverrides {
  white?: string;
  black?: string;
  roughness?: number;
  metalness?: number;
}

export interface BoardStyleConfig {
  preset: 'wood' | 'marble' | 'slate' | 'glass' | 'neon' | 'custom';
  lightColor: string;
  darkColor: string;
  frameColor: string;
  inlayColor: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
}

export type EnvironmentPresetKey = 'studio' | 'sunset' | 'dawn' | 'night';

export interface EnvironmentConfig {
  preset: EnvironmentPresetKey;
  backgroundGradient: string;
  canvasBackground: string;
  exposure: number;
  ambientIntensity: number;
  keyIntensity: number;
  fillColor: string;
  rimColor: string;
}

export interface ChessTheme {
  id: string;
  label: string;
  description: string;
  defaultModelSetId: string;
  swatch: {
    whitePiece: string;
    blackPiece: string;
    lightTile: string;
    darkTile: string;
    accent: string;
  };
  modelSet: DiscoveredModelSet;
  pieceMaterials: {
    white: PieceMaterialSpec;
    black: PieceMaterialSpec;
  };
  board: BoardStyleConfig;
  environment: EnvironmentConfig;
}

/* =========================================================================
   BOARD STYLE PRESETS (Toned down, high-contrast, zero wash-out)
   ========================================================================= */

export const BOARD_PRESETS: Record<string, BoardStyleConfig> = {
  wood: {
    preset: 'wood',
    lightColor: '#e8d5b0',
    darkColor: '#4a2f20',
    frameColor: '#1a1614',
    inlayColor: '#c5a059',
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.0,
  },
  marble: {
    preset: 'marble',
    lightColor: '#ecefe6',
    darkColor: '#404c5a',
    frameColor: '#1a222d',
    inlayColor: '#94a3b8',
    roughness: 0.52,
    metalness: 0.04,
    clearcoat: 0.08,
  },
  slate: {
    preset: 'slate',
    lightColor: '#b8c5d6',
    darkColor: '#2d3748',
    frameColor: '#0f172a',
    inlayColor: '#64748b',
    roughness: 0.58,
    metalness: 0.05,
    clearcoat: 0.0,
  },
  glass: {
    preset: 'glass',
    lightColor: '#b8d5ea',
    darkColor: '#1a3352',
    frameColor: '#0c1a2e',
    inlayColor: '#38bdf8',
    roughness: 0.45,
    metalness: 0.08,
    clearcoat: 0.12,
  },
  neon: {
    preset: 'neon',
    lightColor: '#38bdf8',
    darkColor: '#3730a3',
    frameColor: '#110d21',
    inlayColor: '#ec4899',
    roughness: 0.48,
    metalness: 0.1,
    clearcoat: 0.05,
  },
};

/* =========================================================================
   ENVIRONMENT PRESETS (Soft balanced ambient, key, fill and rim lights)
   ========================================================================= */

export const ENVIRONMENT_PRESETS: Record<EnvironmentPresetKey, EnvironmentConfig> = {
  studio: {
    preset: 'studio',
    backgroundGradient: 'radial-gradient(circle at 50% 35%, #323a4a 0%, #202633 55%, #141822 100%)',
    canvasBackground: '#202633',
    exposure: 0.9,
    ambientIntensity: 0.25,
    keyIntensity: 1.1,
    fillColor: '#9ec5fe',
    rimColor: '#f0f6ff',
  },
  sunset: {
    preset: 'sunset',
    backgroundGradient: 'radial-gradient(circle at 50% 35%, #3d2a30 0%, #241b24 55%, #141017 100%)',
    canvasBackground: '#241b24',
    exposure: 0.9,
    ambientIntensity: 0.25,
    keyIntensity: 1.15,
    fillColor: '#fbcfe8',
    rimColor: '#fed7aa',
  },
  dawn: {
    preset: 'dawn',
    backgroundGradient: 'radial-gradient(circle at 50% 35%, #24353d 0%, #19242b 55%, #0f161b 100%)',
    canvasBackground: '#19242b',
    exposure: 0.9,
    ambientIntensity: 0.26,
    keyIntensity: 1.1,
    fillColor: '#a7f3d0',
    rimColor: '#bae6fd',
  },
  night: {
    preset: 'night',
    backgroundGradient: 'radial-gradient(circle at 50% 35%, #251f33 0%, #171322 55%, #0d0a14 100%)',
    canvasBackground: '#171322',
    exposure: 0.95,
    ambientIntensity: 0.28,
    keyIntensity: 1.2,
    fillColor: '#c084fc',
    rimColor: '#e0e7ff',
  },
};

/* =========================================================================
   REGISTERED MATERIAL & BOARD THEMES
   Separated from 3D Model Sets so user can choose ANY model set with ANY theme.
   ========================================================================= */

const defaultSet =
  DISCOVERED_MODEL_SETS.find((s) => s.id === 'default') || DISCOVERED_MODEL_SETS[0];
const tournamentSet =
  DISCOVERED_MODEL_SETS.find((s) => s.id.includes('tournament') || s.id === 'monolithic-chess') || defaultSet;
const classicSet =
  DISCOVERED_MODEL_SETS.find((s) => s.id.includes('classic')) || defaultSet;

export const THEMES: ChessTheme[] = [
  // 1. Classic Default
  {
    id: 'default',
    label: 'Default Classic',
    description: 'Timeless championship ivory cream & dark obsidian charcoal.',
    defaultModelSetId: defaultSet.id,
    swatch: {
      whitePiece: '#f0ece1',
      blackPiece: '#1c1f26',
      lightTile: '#e8d5b0',
      darkTile: '#4a2f20',
      accent: '#d97706',
    },
    modelSet: defaultSet,
    pieceMaterials: {
      white: {
        color: '#f0ece1',
        roughness: 0.32,
        metalness: 0.05,
        envMapIntensity: 1.1,
      },
      black: {
        color: '#1c1f26',
        roughness: 0.28,
        metalness: 0.2,
        envMapIntensity: 1.5,
      },
    },
    board: BOARD_PRESETS.wood,
    environment: ENVIRONMENT_PRESETS.studio,
  },

  // 2. Metallic Prestige
  {
    id: 'metallic-prestige',
    label: 'Metallic Prestige',
    description: 'Luxury champagne gold and deep titanium obsidian.',
    defaultModelSetId: tournamentSet.id,
    swatch: {
      whitePiece: '#d4af37',
      blackPiece: '#24272e',
      lightTile: '#e0d6c4',
      darkTile: '#3d332a',
      accent: '#f59e0b',
    },
    modelSet: tournamentSet,
    pieceMaterials: {
      white: {
        color: '#d4af37',
        roughness: 0.22,
        metalness: 0.88,
        envMapIntensity: 1.3,
      },
      black: {
        color: '#24272e',
        roughness: 0.25,
        metalness: 0.8,
        envMapIntensity: 1.5,
      },
    },
    board: {
      ...BOARD_PRESETS.wood,
      lightColor: '#e0d6c4',
      darkColor: '#3d332a',
      frameColor: '#1a1614',
      inlayColor: '#d4af37',
    },
    environment: ENVIRONMENT_PRESETS.studio,
  },

  // 3. Gemstone Glass
  {
    id: 'gemstone-glass',
    label: 'Gemstone Glass',
    description: 'Light-transmitting jade pearl and deep sapphire glass.',
    defaultModelSetId: classicSet.id,
    swatch: {
      whitePiece: '#cfeee0',
      blackPiece: '#0f2b38',
      lightTile: '#d0dfd6',
      darkTile: '#19332c',
      accent: '#10b981',
    },
    modelSet: classicSet,
    pieceMaterials: {
      white: {
        color: '#cfeee0',
        roughness: 0.28,
        metalness: 0.05,
        transmission: 0.75,
        thickness: 0.8,
        ior: 1.5,
        transparent: true,
        envMapIntensity: 1.4,
      },
      black: {
        color: '#0f2b38',
        roughness: 0.2,
        metalness: 0.05,
        transmission: 0.75,
        thickness: 0.9,
        ior: 1.55,
        transparent: true,
        envMapIntensity: 1.6,
      },
    },
    board: {
      ...BOARD_PRESETS.glass,
      lightColor: '#d0dfd6',
      darkColor: '#19332c',
      frameColor: '#0c1f1a',
      inlayColor: '#34d399',
    },
    environment: ENVIRONMENT_PRESETS.dawn,
  },

  // 4. Tournament Steel
  {
    id: 'tournament-steel',
    label: 'Tournament Steel',
    description: 'Polished chrome steel and brushed dark tungsten.',
    defaultModelSetId: tournamentSet.id,
    swatch: {
      whitePiece: '#e2e8f0',
      blackPiece: '#1e222a',
      lightTile: '#b8c5d6',
      darkTile: '#2d3748',
      accent: '#38bdf8',
    },
    modelSet: tournamentSet,
    pieceMaterials: {
      white: {
        color: '#e2e8f0',
        roughness: 0.2,
        metalness: 0.9,
        envMapIntensity: 1.4,
      },
      black: {
        color: '#1e222a',
        roughness: 0.26,
        metalness: 0.82,
        envMapIntensity: 1.6,
      },
    },
    board: BOARD_PRESETS.slate,
    environment: ENVIRONMENT_PRESETS.studio,
  },

  // 5. Carrara Marble
  {
    id: 'carrara-marble',
    label: 'Carrara Marble',
    description: 'Polished Italian white marble and Spanish Nero Marquina.',
    defaultModelSetId: classicSet.id,
    swatch: {
      whitePiece: '#f8fafc',
      blackPiece: '#18181b',
      lightTile: '#ecefe6',
      darkTile: '#404c5a',
      accent: '#94a3b8',
    },
    modelSet: classicSet,
    pieceMaterials: {
      white: {
        color: '#f8fafc',
        roughness: 0.22,
        metalness: 0.04,
        envMapIntensity: 1.2,
      },
      black: {
        color: '#18181b',
        roughness: 0.24,
        metalness: 0.15,
        envMapIntensity: 1.5,
      },
    },
    board: BOARD_PRESETS.marble,
    environment: ENVIRONMENT_PRESETS.sunset,
  },

  // 6. Cyber Neon
  {
    id: 'cyber-neon',
    label: 'Cyber Neon',
    description: 'Glowing luminescent cyan and electric synthwave violet.',
    defaultModelSetId: defaultSet.id,
    swatch: {
      whitePiece: '#e0f7ff',
      blackPiece: '#181224',
      lightTile: '#38bdf8',
      darkTile: '#3730a3',
      accent: '#ec4899',
    },
    modelSet: defaultSet,
    pieceMaterials: {
      white: {
        color: '#e0f7ff',
        roughness: 0.22,
        metalness: 0.35,
        emissive: '#06b6d4',
        emissiveIntensity: 0.15,
        envMapIntensity: 1.3,
      },
      black: {
        color: '#181224',
        roughness: 0.26,
        metalness: 0.45,
        emissive: '#a855f7',
        emissiveIntensity: 0.14,
        envMapIntensity: 1.6,
      },
    },
    board: BOARD_PRESETS.neon,
    environment: ENVIRONMENT_PRESETS.night,
  },
];

/* =========================================================================
   MATERIAL CREATION UTILITY
   Uses MeshStandardMaterial for all themes, and MeshPhysicalMaterial
   with optimized low transmissionResolution ONLY for Gemstone Glass.
   ========================================================================= */

export function buildPieceMaterial(spec: PieceMaterialSpec): THREE.Material {
  if (spec.transmission && spec.transmission > 0) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(spec.color),
      roughness: spec.roughness,
      metalness: spec.metalness,
      transmission: spec.transmission,
      thickness: spec.thickness ?? 0.8,
      ior: spec.ior ?? 1.5,
      transparent: true,
      opacity: spec.opacity ?? 0.95,
      envMapIntensity: Math.min(spec.envMapIntensity ?? 1.4, 1.8),
      side: THREE.DoubleSide,
    });
  }

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.roughness,
    metalness: spec.metalness,
    envMapIntensity: Math.min(spec.envMapIntensity ?? 1.2, 1.6),
    side: THREE.DoubleSide,
  });

  if (spec.emissive) {
    mat.emissive = new THREE.Color(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity ?? 0.15;
  }

  return mat;
}
