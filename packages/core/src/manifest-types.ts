import type {TileflowStyleFontFace} from './runtime';
import type {TileflowViewConfig} from './types';
import type {TileflowTimeOfDayVariants} from './time-of-day';

/** The original public multi-theme runtime manifest contract. */
export const tileflowRuntimeManifestVersion = 1 as const;
/** V2 adds the optional time-of-day catalog; maps without it still publish V1. */
export const tileflowTimeOfDayManifestVersion = 2 as const;
export const tileflowRuntimeManifestLimits = Object.freeze({maximumBytes: 1024 * 1024});

export type TileflowRuntimeColorScheme = 'dark' | 'light';

export type TileflowRuntimeManifestTheme = {
  colorScheme: TileflowRuntimeColorScheme;
  /** Complete font closure for this compiled theme. */
  fontFaces?: TileflowStyleFontFace[];
  /** Content or deployment revision used for cache identity and receipts. */
  revision?: string;
  /** Hosted style identity, when different from the logical map identity. */
  styleId?: string;
  styleUrl: string;
};

export type TileflowRuntimeSystemThemes = {
  dark: string;
  light: string;
};

export type TileflowRuntimeManifestMapEntry = {
  apiUrl?: string;
  defaultTheme: string;
  environment?: string;
  mapId?: string;
  systemThemes?: TileflowRuntimeSystemThemes;
  themes: Record<string, TileflowRuntimeManifestTheme>;
  timeOfDay?: TileflowTimeOfDayVariants;
  usageMode?: 'session';
  view?: TileflowViewConfig;
  worldGeneration?: 'v1';
};

/**
 * One logical map catalog for local and Hosted delivery.
 *
 * Delivery-specific fields are optional metadata on a map. The wire shape never forks into
 * self-hosted and Hosted variants, so every runtime follows the same theme resolution path.
 */
export type TileflowRuntimeManifest = {
  apiUrl?: string;
  maps: Record<string, TileflowRuntimeManifestMapEntry>;
  version: typeof tileflowRuntimeManifestVersion | typeof tileflowTimeOfDayManifestVersion;
};
