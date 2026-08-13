import type {
  ResolvedTileflowTypography,
  TileflowRoadClass,
  TileflowRoadDetail,
  TileflowRoadExtras,
  TileflowRoadHierarchy,
  TileflowRoadOutline,
  TileflowRoads,
  TileflowRoadsModuleConfig,
  TileflowRoadsModuleOptions,
  TileflowRoadWeight,
} from '../../compiler';
import {textFont, type TileflowResolvedColors} from '../../themes';

export type ResolvedRoadExtras = Required<TileflowRoadExtras>;

export type ResolvedRoadsModuleOptions = {
  detail: TileflowRoadDetail;
  extras: ResolvedRoadExtras;
  hierarchy: TileflowRoadHierarchy;
  mode: TileflowRoads;
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

const moduleRoadDefaults = {
  detail: 'streets',
  extras: {ferry: false, paths: false, rail: false},
  hierarchy: 'clear',
  oneWayMarkers: false,
  outline: 'subtle',
  weight: 'regular',
} as const satisfies Omit<ResolvedRoadsModuleOptions, 'mode'>;

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
  return {
    type: 'roads',
    ...(options.detail ? {detail: options.detail} : {}),
    ...(options.extras ? {extras: {...options.extras}} : {}),
    ...(options.hierarchy ? {hierarchy: options.hierarchy} : {}),
    ...(options.oneWayMarkers !== undefined ? {oneWayMarkers: options.oneWayMarkers} : {}),
    ...(options.outline ? {outline: options.outline} : {}),
    ...(options.weight ? {weight: options.weight} : {}),
    ...(options.widthScale ? {widthScale: {...options.widthScale}} : {}),
  };
}

export function resolveRoads(
  legacyRoads: TileflowRoads | undefined,
  moduleConfig: TileflowRoadsModuleConfig | undefined,
  fallback: TileflowRoads,
): ResolvedRoadsModuleOptions {
  const fallbackMode = legacyRoads ?? fallback;
  const defaults = moduleConfig ? moduleRoadDefaults : roadDefaultsFromLegacyMode(fallbackMode);
  const resolved = {
    detail: moduleConfig?.detail ?? defaults.detail,
    extras: {
      ferry: moduleConfig?.extras?.ferry ?? defaults.extras.ferry,
      paths: moduleConfig?.extras?.paths ?? defaults.extras.paths,
      rail: moduleConfig?.extras?.rail ?? defaults.extras.rail,
    },
    hierarchy: moduleConfig?.hierarchy ?? defaults.hierarchy,
    oneWayMarkers: moduleConfig?.oneWayMarkers ?? defaults.oneWayMarkers,
    outline: moduleConfig?.outline ?? defaults.outline,
    weight: moduleConfig?.weight ?? defaults.weight,
    ...(moduleConfig?.widthScale
      ? {widthScale: {...defaultRoadWidthScale, ...moduleConfig.widthScale}}
      : {}),
  } satisfies Omit<ResolvedRoadsModuleOptions, 'mode'>;

  return {
    ...resolved,
    mode: legacyModeFromResolvedRoads(resolved),
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
  const weightScale = {
    thin: 0.78,
    regular: 1,
    bold: 1.24,
  }[options.weight];
  const outlineOpacity = {
    none: 0,
    subtle: 0.18,
    strong: 0.34,
  }[options.outline];

  return {
    ...hierarchy,
    outlineOpacity,
    weightScale,
  };
}

export function roadLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  options: ResolvedRoadsModuleOptions,
  typography?: ResolvedTileflowTypography,
): Array<Record<string, unknown>> {
  if (options.detail === 'none') {
    return [];
  }

  const metrics = roadStyleMetrics(options);
  const roadClasses = roadClassesForDetail(options.detail);
  const selectedMajorRoadClasses = roadClasses.filter(isMajorRoadClass);
  const showsStreetRoads = roadClasses.includes('minor');
  const showsServiceRoads = roadClasses.includes('service');
  const transportClasses = [
    ...roadClasses,
    ...(options.extras.paths ? ['path'] : []),
    ...(options.extras.rail ? ['rail', 'transit'] : []),
    ...(options.extras.ferry ? ['ferry'] : []),
  ];
  const roadClassColor = roadClassColorExpression(colors);
  const nonTunnelRoadFilter = ['!=', ['get', 'brunnel'], 'tunnel'];
  const majorFilter = classFilter(selectedMajorRoadClasses);
  const streetFilter = classFilter(streetRoadClasses);
  const serviceFilter = classFilter(serviceRoadClasses);
  const roadFilter = classFilter(roadClasses);
  const transportFilter = classFilter(transportClasses);
  const layers: Array<Record<string, unknown>> = [];

  if (options.outline !== 'none') {
    layers.push({
      id: 'roads-tunnels-casing',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 10,
      filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], transportFilter],
      paint: {
        'line-color': colors.roads.tunnel,
        'line-dasharray': [0.6, 0.8],
        'line-opacity': roadOpacityExpression(
          metrics.outlineOpacity * 0.85,
          metrics.outlineOpacity * 0.85,
        ),
        'line-width': roadWidthExpression(
          [
            [10, 0.8],
            [14, 2.2],
            [16, 4.8],
          ],
          metrics,
          options.widthScale,
        ),
      },
    });
  }

  layers.push({
    id: 'roads-tunnels',
    type: 'line',
    source,
    'source-layer': sourceLayer,
    minzoom: 10,
    filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], transportFilter],
    paint: {
      'line-color': roadClassColor,
      'line-dasharray': [0.6, 0.8],
      'line-opacity': roadOpacityExpression(
        metrics.majorOpacity * 0.28,
        metrics.minorOpacity * 0.28,
      ),
      'line-width': roadWidthExpression(
        [
          [10, 0.25],
          [14, 1],
          [16, 2.4],
        ],
        metrics,
        options.widthScale,
      ),
    },
  });

  if (options.outline !== 'none') {
    layers.push({
      id: 'roads-casing',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 5,
      filter: ['all', nonTunnelRoadFilter, roadFilter],
      paint: {
        'line-color': colors.roads.casing,
        'line-opacity': roadOpacityExpression(metrics.outlineOpacity, metrics.outlineOpacity),
        'line-width': roadWidthExpression(
          [
            [6, 0.7],
            [12, 1.8],
            [16, 5.4],
          ],
          metrics,
          options.widthScale,
        ),
      },
    });
  }

  if (options.extras.ferry) {
    layers.push({
      id: 'roads-ferry',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 5,
      filter: ['all', nonTunnelRoadFilter, classFilter(['ferry'])],
      paint: {
        'line-color': colors.roads.ferry,
        'line-dasharray': [1.2, 1.1],
        'line-opacity': metrics.majorOpacity * 0.8,
        'line-width': zoomWidth(
          [
            [5, 0.25],
            [12, 0.8],
            [16, 2.6],
          ],
          metrics.weightScale,
        ),
      },
    });
  }

  if (options.extras.paths) {
    layers.push({
      id: 'roads-paths',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 10,
      filter: ['all', nonTunnelRoadFilter, classFilter(['path'])],
      paint: {
        'line-color': colors.roads.path,
        'line-dasharray': [0.7, 0.7],
        'line-opacity': metrics.minorOpacity * 0.77,
        'line-width': zoomWidth(
          [
            [10, 0.25],
            [14, 0.8],
            [16, 2.2],
          ],
          metrics.weightScale * metrics.minorWidthScale * (options.widthScale?.path ?? 1),
        ),
      },
    });
  }

  if (options.extras.rail) {
    layers.push({
      id: 'roads-rail',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 7,
      filter: ['all', nonTunnelRoadFilter, classFilter(['rail', 'transit'])],
      paint: {
        'line-color': colors.roads.rail,
        'line-opacity': metrics.minorOpacity * 0.65,
        'line-width': zoomWidth(
          [
            [7, 0.35],
            [12, 0.9],
            [16, 2.4],
          ],
          metrics.weightScale * metrics.minorWidthScale,
        ),
      },
    });
  }

  if (showsServiceRoads) {
    layers.push({
      id: 'roads-service',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 14,
      filter: ['all', nonTunnelRoadFilter, serviceFilter],
      paint: {
        'line-color': roadClassColor,
        'line-opacity': metrics.minorOpacity,
        'line-width': zoomWidth(
          [
            [14, 0.6],
            [16, 2.2],
          ],
          metrics.weightScale * metrics.minorWidthScale,
          options.widthScale,
        ),
      },
    });
  }

  if (showsStreetRoads) {
    layers.push({
      id: 'roads-minor',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 12,
      filter: ['all', nonTunnelRoadFilter, streetFilter],
      paint: {
        'line-color': roadClassColor,
        'line-opacity': metrics.minorOpacity,
        'line-width': zoomWidth(
          [
            [12, 0.8],
            [16, 3],
          ],
          metrics.weightScale * metrics.minorWidthScale,
          options.widthScale,
        ),
      },
    });
  }

  layers.push(
    {
      id: 'roads-major',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 5,
      filter: ['all', nonTunnelRoadFilter, majorFilter],
      paint: {
        'line-color': roadClassColor,
        'line-opacity': metrics.majorOpacity,
        'line-width': zoomWidth(
          [
            [5, 0.35],
            [12, 1.2],
            [16, 4],
          ],
          metrics.weightScale * metrics.majorWidthScale,
          options.widthScale,
        ),
      },
    },
    {
      id: 'roads-bridges',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 10,
      filter: ['all', ['==', ['get', 'brunnel'], 'bridge'], transportFilter],
      paint: {
        'line-color': colors.roads.bridge,
        'line-opacity': roadOpacityExpression(metrics.majorOpacity, metrics.minorOpacity),
        'line-width': roadWidthExpression(
          [
            [10, 0.45],
            [14, 1.6],
            [16, 4.4],
          ],
          metrics,
          options.widthScale,
        ),
      },
    },
  );

  if (options.oneWayMarkers) {
    layers.push(oneWayMarkerLayer(source, sourceLayer, colors, typography));
  }

  return layers;
}

function roadDefaultsFromLegacyMode(mode: TileflowRoads): Omit<ResolvedRoadsModuleOptions, 'mode'> {
  if (mode === 'hidden') {
    return {
      detail: 'none',
      extras: {ferry: false, paths: false, rail: false},
      hierarchy: 'clear',
      oneWayMarkers: false,
      outline: 'subtle',
      weight: 'regular',
    };
  }

  if (mode === 'soft') {
    return {
      detail: 'streets',
      extras: {ferry: false, paths: false, rail: false},
      hierarchy: 'subtle',
      oneWayMarkers: false,
      outline: 'subtle',
      weight: 'thin',
    };
  }

  if (mode === 'detailed') {
    return {
      detail: 'all',
      extras: {ferry: true, paths: true, rail: true},
      hierarchy: 'clear',
      oneWayMarkers: false,
      outline: 'strong',
      weight: 'regular',
    };
  }

  return {
    detail: 'streets',
    extras: {ferry: true, paths: true, rail: true},
    hierarchy: 'clear',
    oneWayMarkers: false,
    outline: 'subtle',
    weight: 'regular',
  };
}

function legacyModeFromResolvedRoads(
  options: Omit<ResolvedRoadsModuleOptions, 'mode'>,
): TileflowRoads {
  if (options.detail === 'none') return 'hidden';
  if (options.hierarchy === 'subtle') return 'soft';
  if (options.hierarchy === 'strong' || options.detail === 'all') return 'detailed';

  return 'standard';
}

function classFilter(classes: readonly string[]): unknown[] {
  return ['match', ['get', 'class'], classes, true, false];
}

function roadOpacityExpression(majorOpacity: number, minorOpacity: number): unknown[] {
  return [
    'step',
    ['zoom'],
    roadOpacityAtZoom(majorOpacity, minorOpacity, 0, 0),
    12,
    roadOpacityAtZoom(majorOpacity, minorOpacity, minorOpacity, 0),
    14,
    roadOpacityAtZoom(majorOpacity, minorOpacity, minorOpacity, minorOpacity),
  ];
}

function roadOpacityAtZoom(
  majorOpacity: number,
  minorOpacity: number,
  streetOpacity: number,
  serviceOpacity: number,
): unknown[] {
  return [
    'case',
    classFilter(majorRoadClasses),
    majorOpacity,
    classFilter(streetRoadClasses),
    streetOpacity,
    classFilter(serviceRoadClasses),
    serviceOpacity,
    minorOpacity,
  ];
}

function roadWidthExpression(
  stops: readonly (readonly [number, number])[],
  metrics: RoadStyleMetrics,
  widthScale?: Record<TileflowRoadClass, number>,
): unknown[] {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([zoom, width]) => [
      zoom,
      widthScale
        ? [
            '*',
            [
              'case',
              classFilter(majorRoadClasses),
              width * metrics.weightScale * metrics.majorWidthScale,
              width * metrics.weightScale * metrics.minorWidthScale,
            ],
            roadClassWidthScaleExpression(widthScale),
          ]
        : [
            'case',
            classFilter(majorRoadClasses),
            width * metrics.weightScale * metrics.majorWidthScale,
            width * metrics.weightScale * metrics.minorWidthScale,
          ],
    ]),
  ];
}

function zoomWidth(
  stops: readonly (readonly [number, number])[],
  scale: number,
  widthScale?: Record<TileflowRoadClass, number>,
): unknown[] {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([zoom, width]) => [
      zoom,
      widthScale ? ['*', width * scale, roadClassWidthScaleExpression(widthScale)] : width * scale,
    ]),
  ];
}

export function roadClassWidthScaleExpression(
  widthScale: Record<TileflowRoadClass, number>,
): unknown[] {
  return [
    'match',
    ['get', 'class'],
    ...Object.entries(widthScale).flatMap(([roadClass, scale]) => [roadClass, scale]),
    1,
  ];
}

export function oneWayMarkerLayer(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  typography?: ResolvedTileflowTypography,
): Record<string, unknown> {
  return {
    id: 'road-oneway-markers',
    type: 'symbol',
    source,
    'source-layer': sourceLayer,
    minzoom: 15,
    filter: [
      'any',
      ['==', ['get', 'oneway'], 1],
      ['==', ['get', 'oneway'], '1'],
      ['==', ['get', 'oneway'], true],
    ],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 88,
      'text-field': '›',
      ...(typography ? {'text-font': textFont(typography, 'roads')} : {}),
      'text-keep-upright': false,
      'text-rotation-alignment': 'map',
      'text-size': 15,
    },
    paint: {
      'text-color': colors.labels.road,
      'text-halo-color': colors.labels.halo,
      'text-halo-width': 0.5,
    },
  };
}

function roadClassColorExpression(colors: TileflowResolvedColors): unknown[] {
  return [
    'match',
    ['get', 'class'],
    'motorway',
    colors.roads.motorway,
    'trunk',
    colors.roads.trunk,
    'primary',
    colors.roads.primary,
    'secondary',
    colors.roads.secondary,
    'rail',
    colors.roads.rail,
    'transit',
    colors.roads.rail,
    'ferry',
    colors.roads.ferry,
    'path',
    colors.roads.path,
    'track',
    colors.roads.path,
    colors.roads.minor,
  ];
}
