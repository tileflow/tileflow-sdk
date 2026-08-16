import type {
  TileflowPoi,
  TileflowPoiCategory,
  TileflowPoiClassMapping,
  TileflowPoiColorMode,
  TileflowPoiDensity,
  TileflowPoiIcons,
  TileflowPoiLabels,
  TileflowPoiModuleConfig,
  TileflowPoiModuleOptions,
} from '../../types';

export type ResolvedPoiModuleOptions = {
  categories?: readonly TileflowPoiCategory[];
  classMapping: TileflowPoiClassMapping;
  color: TileflowPoiColorMode;
  density: TileflowPoiDensity;
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

const defaultPoiMinZoom = {none: 24, minimal: 15, balanced: 13, full: 11} satisfies Record<
  TileflowPoi,
  number
>;

const defaultDensity = {
  none: 'sparse',
  minimal: 'sparse',
  balanced: 'balanced',
  full: 'dense',
} as const satisfies Record<TileflowPoi, TileflowPoiDensity>;

const defaultClassMapping: Record<string, readonly string[]> = {
  coffee: ['cafe', 'coffee'],
  culture: ['arts_centre', 'cinema', 'museum', 'theatre'],
  education: ['college', 'kindergarten', 'school', 'university'],
  food: ['bakery', 'bar', 'fast_food', 'restaurant'],
  health: ['clinic', 'dentist', 'doctors', 'hospital', 'pharmacy'],
  lodging: ['guest_house', 'hostel', 'hotel', 'motel'],
  services: ['bank', 'library', 'police', 'post_office', 'town_hall'],
  shopping: ['department_store', 'mall', 'shop', 'supermarket'],
  transit: ['bus_station', 'railway', 'station', 'subway', 'tram_stop'],
};

export function poi(options: TileflowPoiModuleOptions = {}): TileflowPoiModuleConfig {
  return {type: 'poi', ...cloneJson(options)};
}

export function resolvePoi(request: TileflowPoiModuleConfig | undefined): ResolvedPoiModuleOptions {
  const mode = request?.preset ?? 'minimal';
  const density = request?.density ?? defaultDensity[mode];
  return {
    ...(request?.categories ? {categories: [...request.categories]} : {}),
    classMapping: resolveClassMapping(request?.classMapping),
    color: request?.color ?? 'uniform',
    density,
    icons: request?.icons ?? (mode === 'none' ? false : 'essential'),
    labels: request?.labels ?? mode,
    minZoom: request?.minZoom ?? defaultPoiMinZoom[mode] + densityZoomOffset(density),
    mode,
    placement: {
      coupleIconAndLabel: request?.placement?.coupleIconAndLabel ?? false,
      iconPadding: request?.placement?.iconPadding ?? 2,
      textPadding: request?.placement?.textPadding ?? 2,
    },
  };
}

function resolveClassMapping(
  overrides: TileflowPoiClassMapping | undefined,
): TileflowPoiClassMapping {
  return Object.fromEntries(
    [...new Set([...Object.keys(defaultClassMapping), ...Object.keys(overrides ?? {})])]
      .sort()
      .map((category) => [
        category,
        [...new Set([...(defaultClassMapping[category] ?? []), ...(overrides?.[category] ?? [])])],
      ]),
  );
}

function densityZoomOffset(density: TileflowPoiDensity | undefined): number {
  if (density === 'sparse') return 1;
  if (density === 'dense') return -1;
  return 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
