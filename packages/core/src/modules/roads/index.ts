import type {
  TileflowRoadClass,
  TileflowRoadDetail,
  TileflowRoadHierarchy,
  TileflowRoadOutline,
  TileflowRoadsModuleConfig,
  TileflowRoadsModuleOptions,
  TileflowRoadWeight,
} from '../../types';

export type ResolvedRoadsModuleOptions = {
  detail: TileflowRoadDetail;
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
  path: 1,
} as const satisfies Record<TileflowRoadClass, number>;

const highwayRoadClasses = ['motorway', 'trunk'] as const;
const arterialRoadClasses = ['primary', 'secondary', 'tertiary'] as const;
const majorRoadClasses = [...highwayRoadClasses, ...arterialRoadClasses] as const;
const streetRoadClasses = ['minor'] as const;
const serviceRoadClasses = ['service', 'track'] as const;
const majorRoadClassSet = new Set<string>(majorRoadClasses);

export function roadClassesForDetail(detail: TileflowRoadDetail): string[] {
  if (detail === 'none') return [];
  return [
    ...(detail === 'highways' ? highwayRoadClasses : majorRoadClasses),
    ...(detail === 'streets' || detail === 'all' ? streetRoadClasses : []),
    ...(detail === 'all' ? serviceRoadClasses : []),
  ];
}

export function isMajorRoadClass(roadClass: string): boolean {
  return majorRoadClassSet.has(roadClass);
}

export function roads(options: TileflowRoadsModuleOptions = {}): TileflowRoadsModuleConfig {
  return {type: 'roads', ...cloneJson(options)};
}

export function resolveRoads(
  request: TileflowRoadsModuleConfig | undefined,
): ResolvedRoadsModuleOptions {
  return {
    detail: request?.detail ?? defaults.detail,
    extras: {paths: request?.extras?.paths ?? defaults.extras.paths},
    hierarchy: request?.hierarchy ?? defaults.hierarchy,
    oneWayMarkers: request?.oneWayMarkers ?? defaults.oneWayMarkers,
    outline: request?.outline ?? defaults.outline,
    weight: request?.weight ?? defaults.weight,
    ...(request?.widthScale ? {widthScale: {...defaultRoadWidthScale, ...request.widthScale}} : {}),
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
