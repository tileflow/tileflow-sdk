import type {
  TileflowRoadClass,
  TileflowRoadDetail,
  TileflowRoadHierarchy,
  TileflowRoadOutline,
  TileflowRoadsModuleConfig,
  TileflowRoadsModuleOptions,
  TileflowRoadWeight,
} from '../../types';
import type {TileflowResolvedModuleConfig} from '../resolved';
import {tileflowPathRoadClasses} from './semantics';

export {tileflowRoadClasses} from './semantics';

export type ResolvedRoadsModuleOptions = {
  detail: TileflowRoadDetail;
  disabledClasses: readonly TileflowRoadClass[];
  enabled: boolean;
  explicitClasses: readonly TileflowRoadClass[];
  extras: {paths: boolean};
  hierarchy: TileflowRoadHierarchy;
  oneWayMarkers: boolean;
  outline: TileflowRoadOutline;
  weight: TileflowRoadWeight;
  widthScale?: Record<TileflowRoadClass, number>;
};

export type RoadStyleMetrics = {
  majorOpacity: number;
  majorWidthScale: number;
  minorOpacity: number;
  minorWidthScale: number;
  outlineOpacity: number;
  weightScale: number;
};

const defaults = {
  detail: 'streets',
  disabledClasses: [],
  enabled: true,
  explicitClasses: [],
  extras: {paths: false},
  hierarchy: 'clear',
  oneWayMarkers: false,
  outline: 'subtle',
  weight: 'regular',
} as const satisfies Omit<ResolvedRoadsModuleOptions, 'widthScale'>;

const defaultRoadWidthScale = {
  motorway: 1,
  trunk: 1,
  primary: 1,
  secondary: 1,
  tertiary: 1,
  minor: 1,
  service: 1,
  track: 1,
  pathway: 1,
  footway: 1,
  cycleway: 1,
  steps: 1,
  pedestrian: 1,
} as const satisfies Record<TileflowRoadClass, number>;

const highwayRoadClasses = ['motorway', 'trunk'] as const;
const arterialRoadClasses = ['primary', 'secondary', 'tertiary'] as const;
const majorRoadClasses = [...highwayRoadClasses, ...arterialRoadClasses] as const;
const streetRoadClasses = ['minor', 'service'] as const;
const serviceRoadClasses = ['track'] as const;
const majorRoadClassSet = new Set<string>(majorRoadClasses);

export function roadClassesForDetail(detail: TileflowRoadDetail): TileflowRoadClass[] {
  if (detail === 'none') return [];
  return [
    ...(detail === 'highways' ? highwayRoadClasses : majorRoadClasses),
    ...(detail === 'streets' || detail === 'all' ? streetRoadClasses : []),
    ...(detail === 'all' ? serviceRoadClasses : []),
  ];
}

export function roadClassesWithPaths(
  detail: TileflowRoadDetail,
  paths: boolean,
): TileflowRoadClass[] {
  return [...roadClassesForDetail(detail), ...(paths ? tileflowPathRoadClasses : [])];
}

export function visibleRoadClasses(options: ResolvedRoadsModuleOptions): TileflowRoadClass[] {
  if (!options.enabled) return [];
  const disabled = new Set(options.disabledClasses);
  return [
    ...new Set([
      ...roadClassesWithPaths(options.detail, options.extras.paths),
      ...options.explicitClasses,
    ]),
  ].filter((roadClass) => !disabled.has(roadClass));
}

export function isMajorRoadClass(roadClass: string): boolean {
  return majorRoadClassSet.has(roadClass);
}

export function roads(options: TileflowRoadsModuleOptions = {}): TileflowRoadsModuleConfig {
  return {type: 'roads', ...cloneJson(options)};
}

export function resolveRoads(
  request: TileflowResolvedModuleConfig<TileflowRoadsModuleConfig> | undefined,
): ResolvedRoadsModuleOptions {
  return {
    detail: request?.detail ?? defaults.detail,
    disabledClasses: Object.entries(request?.classes ?? {})
      .filter(([, style]) => style?.enabled === false)
      .map(([roadClass]) => roadClass as TileflowRoadClass),
    enabled: request?.enabled ?? defaults.enabled,
    explicitClasses: Object.entries(request?.classes ?? {})
      .filter(([, style]) => style?.enabled !== false)
      .map(([roadClass]) => roadClass as TileflowRoadClass),
    extras: {paths: request?.extras?.paths ?? defaults.extras.paths},
    hierarchy: request?.hierarchy ?? defaults.hierarchy,
    oneWayMarkers: request?.oneWayMarkers ?? defaults.oneWayMarkers,
    outline: request?.outline ?? defaults.outline,
    weight: request?.weight ?? defaults.weight,
    ...(request?.widthScale
      ? {
          widthScale: {
            ...defaultRoadWidthScale,
            ...request.widthScale,
          } as Record<TileflowRoadClass, number>,
        }
      : {}),
  };
}

export function roadStyleMetrics(options: ResolvedRoadsModuleOptions): RoadStyleMetrics {
  const hierarchy = {
    subtle: {
      majorOpacity: 0.92,
      majorWidthScale: 1,
      minorOpacity: 0.82,
      minorWidthScale: 0.94,
    },
    clear: {
      majorOpacity: 0.92,
      majorWidthScale: 1,
      minorOpacity: 0.68,
      minorWidthScale: 0.84,
    },
    strong: {
      majorOpacity: 0.92,
      majorWidthScale: 1,
      minorOpacity: 0.52,
      minorWidthScale: 0.7,
    },
  }[options.hierarchy];
  return {
    ...hierarchy,
    outlineOpacity: {none: 0, subtle: 0.18, strong: 0.34}[options.outline],
    weightScale: {thin: 0.78, regular: 1, bold: 1.24}[options.weight],
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
