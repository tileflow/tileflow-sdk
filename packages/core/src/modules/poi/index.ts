import type {
  TileflowPoiCategory,
  TileflowPoiColorMode,
  TileflowPoiDensity,
  TileflowPoiModuleConfig,
  TileflowPoiModuleOptions,
  TileflowPoiPlacementOrder,
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
  detailZoom: number;
  densityByCategory: Partial<Record<TileflowPoiCategory, TileflowPoiDensity>>;
  icons: boolean;
  labels: boolean;
  minZoom: number;
  placement: {
    coupleIconAndLabel: boolean;
    iconOnlyTypes: readonly string[];
    iconPadding: number;
    order: TileflowPoiPlacementOrder;
    prominentRank?: number;
    textPadding: number;
  };
};

/**
 * World POI types whose pictogram explains them without a name: parking and public toilets.
 * Applies when a map draws both pictograms and names.
 */
export const tileflowPoiIconOnlyTypes = Object.freeze([
  'parking',
  'parking_garage',
  'parking_lot',
  'public_restroom',
] as const);

export function poi(options: TileflowPoiModuleOptions = {}): TileflowPoiModuleConfig {
  return {type: 'poi', ...cloneJson(options)};
}

export function resolvePoi(request: TileflowPoiModuleConfig | undefined): ResolvedPoiModuleOptions {
  return {
    categories: [...new Set(request?.categories ?? tileflowPoiCategories)],
    color: request?.color ?? 'uniform',
    density: request?.density ?? 2,
    detailZoom: request?.detailZoom ?? 17,
    densityByCategory: {...request?.densityByCategory},
    icons: request?.icons ?? true,
    labels: request?.labels ?? true,
    minZoom: request?.minZoom ?? 0,
    placement: {
      coupleIconAndLabel: request?.placement?.coupleIconAndLabel ?? true,
      iconOnlyTypes: [...(request?.placement?.iconOnlyTypes ?? tileflowPoiIconOnlyTypes)],
      iconPadding: request?.placement?.iconPadding ?? 2,
      order: request?.placement?.order ?? 'importance',
      ...(request?.placement?.prominentRank === undefined
        ? {}
        : {prominentRank: request.placement.prominentRank}),
      textPadding: request?.placement?.textPadding ?? 3,
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
