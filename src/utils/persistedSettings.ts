import { BoardStyleConfig, EnvironmentPresetKey, PieceColorOverrides } from '../config/themes';

/* =========================================================================
   4. LOCAL STORAGE PERSISTENCE
   ========================================================================= */

export const STORAGE_KEY = 'grandmaster_3d_theme_settings_v4';

export interface PersistedSettings {
  themeId: string;
  modelSetId: string;
  useOriginalMaterials: boolean;
  board: BoardStyleConfig;
  envPreset: EnvironmentPresetKey;
  showCoordinates: boolean;
  showLegalMarkers: boolean;
  showLastMoveHighlight: boolean;
  cameraMode: 'free' | 'locked';
  fov: number;
  zoomSpeed: number;
  flipBoardOnMove: boolean;
  pieceColors?: PieceColorOverrides;
  /** Per model set: user-chosen knight facing in degrees (0/90/180/270). Missing = set default. */
  knightYawBySet?: Record<string, number>;
}

export function loadPersistedSettings(): Partial<PersistedSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePersistedSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // best-effort
  }
}
