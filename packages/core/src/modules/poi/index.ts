import type {
  TileflowPoiCategory,
  TileflowPoiColorMode,
  TileflowPoiDensity,
  TileflowPoiModuleConfig,
  TileflowPoiModuleOptions,
} from '../../types';
import {tileflowPoiCategories} from '../../types';

/**
 * Stable built-in POI image convention. A theme token with the declared role
 * takes precedence; `fallback` is the invariant sprite ID used when omitted.
 */
export const tileflowPoiImageRoles = Object.freeze({
  'arts-entertainment': {fallback: 'culture', token: 'poi.arts-entertainment'},
  education: {fallback: 'education', token: 'poi.education'},
  'food-drink': {fallback: 'food', token: 'poi.food-drink'},
  landmark: {fallback: 'culture', token: 'poi.landmark'},
  lodging: {fallback: 'lodging', token: 'poi.lodging'},
  medical: {fallback: 'health', token: 'poi.medical'},
  'park-nature': {fallback: 'services', token: 'poi.park-nature'},
  'public-services': {fallback: 'services', token: 'poi.public-services'},
  religion: {fallback: 'culture', token: 'poi.religion'},
  retail: {fallback: 'shopping', token: 'poi.retail'},
  'sport-leisure': {fallback: 'culture', token: 'poi.sport-leisure'},
  transport: {fallback: 'major-transit', token: 'poi.transport'},
  'visitor-amenity': {fallback: 'services', token: 'poi.visitor-amenity'},
} as const satisfies Record<TileflowPoiCategory, {fallback: string; token: string}>);

export type ResolvedPoiModuleOptions = {
  categories: readonly TileflowPoiCategory[];
  color: TileflowPoiColorMode;
  density: TileflowPoiDensity;
  icons: boolean;
  labels: boolean;
  minZoom: number;
  placement: {
    coupleIconAndLabel: boolean;
    iconPadding: number;
    textPadding: number;
  };
};

export function poi(options: TileflowPoiModuleOptions = {}): TileflowPoiModuleConfig {
  return {type: 'poi', ...cloneJson(options)};
}

export function resolvePoi(request: TileflowPoiModuleConfig | undefined): ResolvedPoiModuleOptions {
  return {
    categories: [...new Set(request?.categories ?? tileflowPoiCategories)],
    color: request?.color ?? 'uniform',
    density: request?.density ?? 3,
    icons: request?.icons ?? true,
    labels: request?.labels ?? true,
    minZoom: request?.minZoom ?? 0,
    placement: {
      coupleIconAndLabel: request?.placement?.coupleIconAndLabel ?? false,
      iconPadding: request?.placement?.iconPadding ?? 2,
      textPadding: request?.placement?.textPadding ?? 2,
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
