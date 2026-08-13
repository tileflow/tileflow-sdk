import type {
  ResolvedTileflowTypography,
  TileflowPoi,
  TileflowPoiCategory,
  TileflowPoiClassMapping,
  TileflowPoiColorMode,
  TileflowPoiDensity,
  TileflowPoiIcons,
  TileflowPoiLabels,
  TileflowPoiModuleConfig,
  TileflowPoiModuleOptions,
} from '../../compiler';
import {alpha, textFont, type TileflowResolvedColors} from '../../themes';
import {labelTextField} from '../labels';

export type ResolvedPoiModuleOptions = {
  categories?: readonly TileflowPoiCategory[];
  classMapping: TileflowPoiClassMapping;
  color: TileflowPoiColorMode;
  density?: TileflowPoiDensity;
  icons: TileflowPoiIcons;
  labels: TileflowPoiLabels;
  minZoom: number;
  mode: TileflowPoi;
  placement: {
    coupleIconAndLabel: boolean;
    iconPadding: number;
    textPadding: number;
  };
};

const defaultPoiMinZoom = {
  none: 24,
  minimal: 15,
  balanced: 13,
  full: 11,
} satisfies Record<TileflowPoi, number>;

export function poi(options: TileflowPoiModuleOptions = {}): TileflowPoiModuleConfig {
  return {
    type: 'poi',
    ...(options.categories ? {categories: options.categories} : {}),
    ...(options.classMapping ? {classMapping: {...options.classMapping}} : {}),
    ...(options.color ? {color: options.color} : {}),
    ...(options.density ? {density: options.density} : {}),
    ...(options.icons !== undefined ? {icons: options.icons} : {}),
    ...(options.labels ? {labels: options.labels} : {}),
    ...(options.minZoom !== undefined ? {minZoom: options.minZoom} : {}),
    ...(options.placement ? {placement: {...options.placement}} : {}),
    ...(options.preset ? {preset: options.preset} : {}),
  };
}

export function resolvePoi(
  legacyPoi: TileflowPoi | undefined,
  moduleConfig: TileflowPoiModuleConfig | undefined,
  fallback: TileflowPoi,
): ResolvedPoiModuleOptions {
  const mode = moduleConfig?.preset ?? legacyPoi ?? fallback;
  const density = moduleConfig?.density;

  return {
    ...(moduleConfig?.categories ? {categories: moduleConfig.categories} : {}),
    classMapping: resolvePoiClassMapping(moduleConfig?.classMapping),
    color: moduleConfig?.color ?? 'uniform',
    ...(density ? {density} : {}),
    icons: moduleConfig?.icons ?? (mode === 'none' ? false : 'essential'),
    labels: moduleConfig?.labels ?? poiLabelsFromMode(mode),
    minZoom:
      moduleConfig?.minZoom ??
      defaultPoiMinZoom[mode] + (density === undefined ? 0 : poiDensityZoomOffset(density)),
    mode,
    placement: {
      coupleIconAndLabel: moduleConfig?.placement?.coupleIconAndLabel ?? false,
      iconPadding: moduleConfig?.placement?.iconPadding ?? 2,
      textPadding: moduleConfig?.placement?.textPadding ?? 2,
    },
  };
}

export function poiLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  poiConfig: ResolvedPoiModuleOptions,
  typography: ResolvedTileflowTypography,
  customIconSpriteId?: string,
  customIconMapping?: Record<string, string>,
): Array<Record<string, unknown>> {
  if (poiConfig.mode === 'none') {
    return [];
  }

  const layout: Record<string, unknown> = {
    'text-field': labelTextField('auto'),
    'text-font': textFont(typography, 'poi'),
    'text-size': ['interpolate', ['linear'], ['zoom'], poiConfig.minZoom, 10, 17, 12],
    'text-letter-spacing': 0,
    'text-padding': poiConfig.placement.textPadding,
  };

  if (poiConfig.density) {
    layout['symbol-sort-key'] = poiPriorityExpression(poiConfig.classMapping);
  }

  if (poiConfig.labels === 'none') {
    delete layout['text-field'];
  }

  if (poiConfig.icons) {
    layout['icon-image'] = poiIconImageExpression(
      customIconSpriteId,
      customIconMapping,
      poiConfig.classMapping,
    );
    layout['icon-optional'] = !poiConfig.placement.coupleIconAndLabel;
    layout['icon-padding'] = poiConfig.placement.iconPadding;
    layout['icon-size'] = ['interpolate', ['linear'], ['zoom'], poiConfig.minZoom, 0.85, 17, 1];
    layout['text-anchor'] = 'top';
    layout['text-offset'] = [0, 0.75];
    if (poiConfig.placement.coupleIconAndLabel) layout['text-optional'] = false;
  }

  return [
    {
      id: 'poi-labels',
      type: 'symbol',
      source,
      'source-layer': sourceLayer,
      minzoom: poiConfig.minZoom,
      ...(poiFilter(poiConfig) ? {filter: poiFilter(poiConfig)} : {}),
      layout,
      paint: {
        'text-color':
          poiConfig.color === 'category'
            ? poiCategoryColorExpression(colors, poiConfig.classMapping)
            : colors.poi.label,
        'text-halo-color': colors.poi.halo ?? alpha(colors.background, 0.78),
        'text-halo-width': 1,
      },
    },
  ];
}

export function poiLabelsFromMode(mode: TileflowPoi): TileflowPoiLabels {
  if (mode === 'none') return 'none';
  if (mode === 'minimal') return 'minimal';
  if (mode === 'full') return 'full';

  return 'balanced';
}

export function poiCategoryFilter(
  categories: readonly TileflowPoiCategory[],
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] {
  const classes = categories.flatMap((category) => poiCategoryClasses(category, classMapping));

  return ['any', ['in', 'class', ...classes], ['in', 'subclass', ...classes]];
}

export function poiIconImageExpression(
  customIconSpriteId?: string,
  customIconMapping: Record<string, string> = {},
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] {
  const matchParts = Object.keys(classMapping).flatMap((category) => [
    category,
    poiIconImageFallback(category, customIconSpriteId, customIconMapping),
  ]);

  return [
    'match',
    poiCategoryExpression('default', classMapping),
    ...matchParts,
    poiIconImageFallback('default', customIconSpriteId, customIconMapping),
  ];
}

export function poiCategoryExpression(
  fallback = '',
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] {
  const categoryMatches = poiCategoryMatchParts(classMapping);

  return [
    'match',
    ['get', 'subclass'],
    ...categoryMatches,
    fallbackCategoryExpression(fallback, classMapping),
  ];
}

function fallbackCategoryExpression(
  fallback: string,
  classMapping: TileflowPoiClassMapping,
): unknown[] {
  const categoryMatches = poiCategoryMatchParts(classMapping);

  return ['match', ['get', 'class'], ...categoryMatches, fallback];
}

function poiCategoryMatchParts(classMapping: TileflowPoiClassMapping): unknown[] {
  return Object.entries(classMapping).flatMap(([category, classes]) => [classes, category]);
}

export function poiCategoryClasses(
  category: TileflowPoiCategory,
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): string[] {
  return [...(classMapping[category] ?? [category])];
}

export function poiPriorityExpression(
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] {
  const categoryPenalty = [
    'match',
    poiCategoryExpression('default', classMapping),
    'transit',
    0,
    'culture',
    1,
    'health',
    2,
    'education',
    3,
    'lodging',
    4,
    'food',
    5,
    'coffee',
    6,
    'services',
    7,
    'shopping',
    8,
    9,
  ];

  return ['+', ['*', categoryPenalty, 1000], ['to-number', ['get', 'rank'], 999]];
}

export function poiDensityFilter(
  density: TileflowPoiDensity,
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] | undefined {
  if (density === 'dense') return undefined;

  const cutoffs: Record<string, number> = poiDensityRankCutoffs[density];

  return [
    'any',
    ...Object.keys(classMapping).map((category) => [
      'all',
      poiCategoryFilter([category], classMapping),
      ['any', ['!has', 'rank'], ['<=', 'rank', cutoffs[category] ?? cutoffs.default]],
    ]),
  ];
}

export function poiCategoryColorExpression(
  colors: TileflowResolvedColors,
  classMapping: TileflowPoiClassMapping = poiCategoryClassNames,
): unknown[] {
  return [
    'match',
    poiCategoryExpression('default', classMapping),
    ...Object.keys(classMapping).flatMap((category) => [
      category,
      colors.poi[category as keyof typeof colors.poi] ?? colors.poi.label,
    ]),
    colors.poi.label,
  ];
}

function resolvePoiClassMapping(
  overrides: TileflowPoiClassMapping | undefined,
): TileflowPoiClassMapping {
  const categories = new Set([
    ...Object.keys(poiCategoryClassNames),
    ...Object.keys(overrides ?? {}),
  ]);

  return Object.fromEntries(
    [...categories].map((category) => [
      category,
      [...new Set([...(poiCategoryClassNames[category] ?? []), ...(overrides?.[category] ?? [])])],
    ]),
  );
}

function poiDensityZoomOffset(density: TileflowPoiDensity): number {
  if (density === 'sparse') return 1;
  if (density === 'dense') return -1;
  return 0;
}

function poiFilter(poiConfig: ResolvedPoiModuleOptions): unknown[] | undefined {
  const categoryFilter = poiConfig.categories
    ? poiCategoryFilter(poiConfig.categories, poiConfig.classMapping)
    : undefined;
  const densityFilter = poiConfig.density
    ? poiDensityFilter(poiConfig.density, poiConfig.classMapping)
    : undefined;

  if (categoryFilter && densityFilter) return ['all', categoryFilter, densityFilter];

  return categoryFilter ?? densityFilter;
}

function poiIconImageFallback(
  iconName: string,
  customIconSpriteId: string | undefined,
  customIconMapping: Record<string, string>,
): unknown[] {
  const osmBrightIcon = `${osmBrightIconNameForSemanticIcon(iconName)}_11`;
  const customIconName = customIconMapping[iconName] ?? iconName;

  if (!customIconSpriteId) {
    return ['coalesce', ['image', customIconName], ['image', osmBrightIcon]];
  }

  return [
    'coalesce',
    ['image', `${customIconSpriteId}:${customIconName}`],
    ['image', osmBrightIcon],
  ];
}

function osmBrightIconNameForSemanticIcon(iconName: string): string {
  return semanticToOsmBrightIconName[iconName] ?? 'marker';
}

const poiCategoryClassNames: Record<string, string[]> = {
  coffee: ['cafe'],
  culture: [
    'museum',
    'gallery',
    'art_gallery',
    'theatre',
    'cinema',
    'library',
    'attraction',
    'garden',
    'monument',
  ],
  education: ['school', 'college', 'university'],
  food: ['restaurant', 'fast_food', 'bar', 'pub', 'biergarten'],
  health: ['hospital', 'pharmacy', 'doctors', 'dentist'],
  lodging: ['lodging', 'hotel', 'motel', 'hostel', 'guest_house'],
  services: ['bank', 'post', 'toilet', 'police', 'fire_station', 'town_hall'],
  shopping: ['shop', 'mall', 'supermarket', 'marketplace'],
  transit: ['railway', 'station', 'bus', 'bus_stop', 'subway', 'tram'],
};

const poiDensityRankCutoffs = {
  sparse: {
    coffee: 4,
    culture: 10,
    education: 8,
    food: 6,
    health: 8,
    lodging: 8,
    services: 6,
    shopping: 4,
    transit: 14,
    default: 6,
  },
  balanced: {
    coffee: 10,
    culture: 18,
    education: 14,
    food: 14,
    health: 14,
    lodging: 16,
    services: 12,
    shopping: 10,
    transit: 24,
    default: 12,
  },
} satisfies Record<Exclude<TileflowPoiDensity, 'dense'>, Record<string, number>>;

const semanticToOsmBrightIconName: Record<string, string> = {
  coffee: 'cafe',
  culture: 'museum',
  default: 'marker',
  education: 'school',
  food: 'restaurant',
  health: 'hospital',
  lodging: 'lodging',
  services: 'marker',
  shopping: 'shop',
  transit: 'railway',
};
