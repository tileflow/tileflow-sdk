import type {
  ResolvedTileflowTypography,
  TileflowLabelDetail,
  TileflowLabelLanguage,
  TileflowLabels,
  TileflowLabelsModuleConfig,
  TileflowLabelsModuleOptions,
  TileflowRoadClass,
  TileflowRoadLabelDetail,
  TileflowSourceLayers,
} from '../../compiler';
import {textFont, type TileflowResolvedColors} from '../../themes';
import {isMajorRoadClass, type ResolvedRoadsModuleOptions, roadClassesForDetail} from '../roads';

export type ResolvedLabelsModuleOptions = {
  language: TileflowLabelLanguage;
  mode: TileflowLabels;
  places: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads: TileflowRoadLabelDetail;
  water: TileflowLabelDetail;
};

const moduleLabelDefaults = {
  language: 'auto',
  places: 'major',
  roads: 'major',
  water: 'major',
} as const satisfies Omit<ResolvedLabelsModuleOptions, 'mode'>;

const majorPlaceClasses = ['continent', 'country', 'state', 'city', 'town'] as const;
const majorWaterClasses = ['ocean', 'sea', 'lake'] as const;
const majorWaterwayClasses = ['river'] as const;

export function labels(options: TileflowLabelsModuleOptions = {}): TileflowLabelsModuleConfig {
  return {
    type: 'labels',
    ...(options.language ? {language: options.language} : {}),
    ...(options.places ? {places: options.places} : {}),
    ...(options.roadClasses ? {roadClasses: [...options.roadClasses]} : {}),
    ...(options.roads ? {roads: options.roads} : {}),
    ...(options.water ? {water: options.water} : {}),
  };
}

export function resolveLabels(
  legacyLabels: TileflowLabels | undefined,
  moduleConfig: TileflowLabelsModuleConfig | undefined,
  fallback: TileflowLabels,
): ResolvedLabelsModuleOptions {
  const fallbackMode = legacyLabels ?? fallback;
  const defaults = moduleConfig ? moduleLabelDefaults : labelDefaultsFromLegacyMode(fallbackMode);
  const resolved = {
    language: moduleConfig?.language ?? defaults.language,
    places: moduleConfig?.places ?? defaults.places,
    ...(moduleConfig?.roadClasses ? {roadClasses: moduleConfig.roadClasses} : {}),
    roads: moduleConfig?.roads ?? defaults.roads,
    water: moduleConfig?.water ?? defaults.water,
  } satisfies Omit<ResolvedLabelsModuleOptions, 'mode'>;

  return {
    ...resolved,
    mode: moduleConfig ? legacyModeFromResolvedLabels(resolved) : fallbackMode,
  };
}

export function labelLayers(
  source: string,
  sourceLayers: Required<TileflowSourceLayers>,
  colors: TileflowResolvedColors,
  labelsConfig: ResolvedLabelsModuleOptions,
  roadsConfig: ResolvedRoadsModuleOptions,
  typography: ResolvedTileflowTypography,
): Array<Record<string, unknown>> {
  return [
    ...placeLabelLayers(source, sourceLayers.place, colors, labelsConfig, typography),
    ...roadLabelLayers(
      source,
      sourceLayers.roadName,
      colors,
      labelsConfig,
      roadsConfig,
      typography,
    ),
    ...waterLabelLayers(
      source,
      sourceLayers.waterName,
      sourceLayers.waterway,
      colors,
      labelsConfig,
      typography,
    ),
  ];
}

function placeLabelLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  labelsConfig: ResolvedLabelsModuleOptions,
  typography: ResolvedTileflowTypography,
): Array<Record<string, unknown>> {
  if (labelsConfig.places === 'none') return [];

  return [
    {
      id: 'place-labels',
      type: 'symbol',
      source,
      'source-layer': sourceLayer,
      minzoom: 0,
      filter:
        labelsConfig.places === 'major'
          ? ['all', ['has', 'name'], classFilter(majorPlaceClasses)]
          : ['has', 'name'],
      layout: {
        'text-field': labelTextField(labelsConfig.language),
        'text-font': textFont(typography, 'places'),
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13, 14, 17],
        'text-letter-spacing': 0,
        'text-padding': 4,
      },
      paint: {
        'text-color': colors.labels.primary,
        'text-halo-color': colors.labels.halo,
        'text-halo-width': 1.2,
      },
    },
  ];
}

function roadLabelLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  labelsConfig: ResolvedLabelsModuleOptions,
  roadsConfig: ResolvedRoadsModuleOptions,
  typography: ResolvedTileflowTypography,
): Array<Record<string, unknown>> {
  const classes = visibleRoadLabelClasses(
    labelsConfig.roads,
    roadsConfig,
    labelsConfig.roadClasses,
  );
  const majorClasses = classes.filter(isMajorRoadClass);
  const minorClasses = classes.filter((roadClass) => !isMajorRoadClass(roadClass));

  if (classes.length === 0) return [];

  const layers: Array<Record<string, unknown>> = [];
  const sharedLayout = {
    'symbol-placement': 'line',
    'text-field': labelTextField(labelsConfig.language),
    'text-font': textFont(typography, 'roads'),
    'text-rotation-alignment': 'map',
    'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 14, 13, 17, 15],
  };
  const sharedPaint = {
    'text-color': colors.labels.road,
    'text-halo-color': colors.labels.halo,
    'text-halo-width': 1,
  };

  if (majorClasses.length > 0) {
    const namedMajorClasses = majorClasses.filter((roadClass) => roadClass !== 'motorway');

    layers.push({
      id: 'road-shields',
      type: 'symbol',
      source,
      'source-layer': sourceLayer,
      minzoom: 8,
      filter: ['all', ['has', 'ref'], classFilter(majorClasses)],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 240,
        'text-field': ['get', 'ref'],
        'text-font': textFont(typography, 'roads'),
        'text-rotation-alignment': 'viewport',
        'text-size': 10,
      },
      paint: sharedPaint,
    });

    if (namedMajorClasses.length > 0) {
      layers.unshift({
        id: 'road-labels-major',
        type: 'symbol',
        source,
        'source-layer': sourceLayer,
        minzoom: 10,
        filter: ['all', ['has', 'name'], classFilter(namedMajorClasses)],
        layout: sharedLayout,
        paint: sharedPaint,
      });
    }
  }

  if (minorClasses.length > 0) {
    layers.push({
      id: 'road-labels-minor',
      type: 'symbol',
      source,
      'source-layer': sourceLayer,
      minzoom: 14,
      filter: ['all', ['has', 'name'], classFilter(minorClasses)],
      layout: sharedLayout,
      paint: sharedPaint,
    });
  }

  return layers;
}

function waterLabelLayers(
  source: string,
  waterNameSourceLayer: string,
  waterwaySourceLayer: string,
  colors: TileflowResolvedColors,
  labelsConfig: ResolvedLabelsModuleOptions,
  typography: ResolvedTileflowTypography,
): Array<Record<string, unknown>> {
  if (labelsConfig.water === 'none') return [];

  const waterFilter =
    labelsConfig.water === 'major'
      ? ['all', ['has', 'name'], classFilter(majorWaterClasses)]
      : ['has', 'name'];
  const waterwayFilter =
    labelsConfig.water === 'major'
      ? ['all', ['has', 'name'], classFilter(majorWaterwayClasses)]
      : ['has', 'name'];
  const paint = {
    'text-color': colors.labels.water,
    'text-halo-color': colors.labels.halo,
    'text-halo-width': 1,
  };

  return [
    {
      id: 'water-labels',
      type: 'symbol',
      source,
      'source-layer': waterNameSourceLayer,
      minzoom: 3,
      filter: ['all', ['==', ['geometry-type'], 'Point'], waterFilter],
      layout: {
        'text-field': labelTextField(labelsConfig.language),
        'text-font': textFont(typography, 'water'),
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 14],
      },
      paint,
    },
    {
      id: 'water-line-labels',
      type: 'symbol',
      source,
      'source-layer': waterNameSourceLayer,
      minzoom: 5,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], waterFilter],
      layout: {
        'symbol-placement': 'line',
        'text-field': labelTextField(labelsConfig.language),
        'text-font': textFont(typography, 'water'),
        'text-size': 13,
      },
      paint,
    },
    {
      id: 'waterway-labels',
      type: 'symbol',
      source,
      'source-layer': waterwaySourceLayer,
      minzoom: 10,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], waterwayFilter],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'text-field': labelTextField(labelsConfig.language),
        'text-font': textFont(typography, 'water'),
        'text-size': 12,
      },
      paint,
    },
  ];
}

export function visibleRoadLabelClasses(
  detail: TileflowRoadLabelDetail,
  roadsConfig: ResolvedRoadsModuleOptions,
  eligibleClasses?: readonly TileflowRoadClass[],
): string[] {
  if (detail === 'none' || roadsConfig.detail === 'none') return [];

  const visibleRoadClasses = [
    ...roadClassesForDetail(roadsConfig.detail),
    ...(roadsConfig.extras.paths ? ['path'] : []),
  ];
  const requestedClasses = roadLabelClasses(detail);
  const visible = new Set(visibleRoadClasses);
  const eligible = eligibleClasses ? new Set<string>(eligibleClasses) : undefined;

  return requestedClasses.filter(
    (roadClass) => visible.has(roadClass) && (!eligible || eligible.has(roadClass)),
  );
}

export function roadLabelClasses(detail: TileflowRoadLabelDetail): string[] {
  return [...roadClassesForDetail(detail), ...(detail === 'all' ? ['path'] : [])];
}

function labelDefaultsFromLegacyMode(
  mode: TileflowLabels,
): Omit<ResolvedLabelsModuleOptions, 'mode'> {
  if (mode === 'none') {
    return {language: 'auto', places: 'none', roads: 'none', water: 'none'};
  }

  if (mode === 'essential') {
    return {language: 'auto', places: 'major', roads: 'major', water: 'major'};
  }

  return {language: 'auto', places: 'all', roads: 'all', water: 'all'};
}

function legacyModeFromResolvedLabels(
  options: Omit<ResolvedLabelsModuleOptions, 'mode'>,
): TileflowLabels {
  if (options.places === 'none' && options.roads === 'none' && options.water === 'none') {
    return 'none';
  }

  if (options.places === 'major' && options.roads === 'major' && options.water === 'major') {
    return 'essential';
  }

  return 'balanced';
}

function classFilter(classes: readonly string[]): unknown[] {
  return ['match', ['get', 'class'], classes, true, false];
}

export function labelTextField(language: TileflowLabelLanguage): unknown[] {
  if (language === 'local') {
    return ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name:en']];
  }

  if (language === 'auto') {
    return ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'name:en']];
  }

  return ['coalesce', ['get', `name:${language}`], ['get', 'name:latin'], ['get', 'name']];
}
