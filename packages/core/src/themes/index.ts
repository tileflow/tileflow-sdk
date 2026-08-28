import type {
  ResolvedTileflowTypography,
  ResolvedTileflowTypographyStyle,
  TileflowBaseColors,
  TileflowBoundaryColorConfig,
  TileflowBuildingColorConfig,
  TileflowColorConfig,
  TileflowColorGroupsConfig,
  TileflowHydroColorConfig,
  TileflowLabelColorConfig,
  TileflowLandcoverColorConfig,
  TileflowLanduseColorConfig,
  TileflowPoiColorConfig,
  TileflowRoadColorConfig,
  TileflowTypography,
  TileflowTypographyDomain,
  TileflowTypographyStyle,
} from '../types';
import {resolveTileflowTheme, type TileflowTheme} from './model';

export * from './model';
export * from './visual-semantics';

type ResolvedColorGroup<TConfig> = {
  [TKey in keyof Required<TConfig>]: string;
};

export type TileflowResolvedRoadColors = ResolvedColorGroup<TileflowRoadColorConfig>;
export type TileflowResolvedLabelColors = ResolvedColorGroup<TileflowLabelColorConfig>;
export type TileflowResolvedPoiColors = ResolvedColorGroup<TileflowPoiColorConfig>;
export type TileflowResolvedLanduseColors = ResolvedColorGroup<TileflowLanduseColorConfig>;
export type TileflowResolvedLandcoverColors = ResolvedColorGroup<TileflowLandcoverColorConfig>;
export type TileflowResolvedHydroColors = ResolvedColorGroup<TileflowHydroColorConfig> & {
  /** Semantic bathymetry bands; intermediate compiler stops derive only from these theme roles. */
  depth: {
    m0: string;
    m200: string;
    m2000: string;
    m7000: string;
  };
};
export type TileflowResolvedBuildingColors = ResolvedColorGroup<TileflowBuildingColorConfig>;
export type TileflowResolvedBoundaryColors = ResolvedColorGroup<TileflowBoundaryColorConfig>;
export type TileflowResolvedTerrainColors = {
  contour: {
    halo: string;
    index: string;
    label: string;
    minor: string;
  };
  hillshade: {
    accent: string;
    highlight: string;
    shadow: string;
  };
};
export type TileflowResolvedVegetationColors = {
  tree: {
    bark: string;
    broadleaf: readonly [string, string, string, string];
    conifer: readonly [string, string, string];
  };
};

export type TileflowResolvedColors = {[TKey in keyof TileflowBaseColors]: string} & {
  boundaries: TileflowResolvedBoundaryColors;
  buildings: TileflowResolvedBuildingColors;
  hydro: TileflowResolvedHydroColors;
  labels: TileflowResolvedLabelColors;
  landcover: TileflowResolvedLandcoverColors;
  landuse: TileflowResolvedLanduseColors;
  poi: TileflowResolvedPoiColors;
  roads: TileflowResolvedRoadColors;
  terrain: TileflowResolvedTerrainColors;
  vegetation: TileflowResolvedVegetationColors;
};

/** Concrete semantic image-token catalog available to domain compilers. */
export type TileflowResolvedImages = Readonly<Record<string, string>>;

const defaultColors = {
  background: '#F6F7F3',
  land: '#F1F3ED',
  water: '#A9D3F5',
  park: '#CDE8B5',
  building: '#E6E3DA',
  road: '#FFFFFF',
  roadMajor: '#F4C95D',
  boundary: '#C9D1D9',
  text: '#3C4043',
  textMuted: '#727B84',
  textHalo: '#FFFFFF',
} as const;

const defaultTypography = {
  font: 'Noto Sans Regular',
  places: {font: 'Noto Sans Regular'},
  roads: {font: 'Noto Sans Regular'},
  water: {font: 'Noto Sans Regular'},
  poi: {font: 'Noto Sans Regular'},
} satisfies ResolvedTileflowTypography;

export function resolveColors(
  overrides: TileflowColorConfig = {},
  defaults: TileflowColorConfig = defaultColors,
  moduleOverrides: TileflowColorGroupsConfig = {},
  moduleDefaults: TileflowColorGroupsConfig = {},
): TileflowResolvedColors {
  const defaultInput = defaults;
  const overrideInput = overrides;
  const defaultModules = moduleDefaults;
  const overrideModules = moduleOverrides;
  const base = resolveBaseColors(overrideInput, defaultInput);
  const baseRoadCasing =
    overrideInput.roadCasing ?? defaultInput.roadCasing ?? mix(base.road, base.text, 0.2);
  const roadCasing =
    overrideModules.roads?.casing ?? defaultModules.roads?.casing ?? baseRoadCasing;
  const baseResolved = {
    ...base,
  };
  const roadDefaults = {
    bridge: base.roadMajor,
    casing: roadCasing,
    ferry: base.water,
    minor: base.road,
    motorway: base.roadMajor,
    path: mix(base.road, base.park, 0.2),
    primary: base.roadMajor,
    rail: base.textMuted,
    secondary: base.roadMajor,
    trunk: base.roadMajor,
    tunnel: mix(baseRoadCasing, base.background, 0.35),
  } satisfies TileflowResolvedRoadColors;
  const labelDefaults = {
    country: base.text,
    halo: base.textHalo,
    muted: base.textMuted,
    neighborhood: base.textMuted,
    poi: base.textMuted,
    primary: base.text,
    road: base.textMuted,
    settlement: base.text,
    water: mix(base.water, base.text, 0.42),
  } satisfies TileflowResolvedLabelColors;
  const poiDefaults = {
    'arts-entertainment': mix(base.textMuted, base.text, 0.18),
    education: mix(base.textMuted, base.water, 0.18),
    'food-drink': mix(base.textMuted, base.roadMajor, 0.34),
    halo: labelDefaults.halo,
    icon: labelDefaults.poi,
    label: labelDefaults.poi,
    landmark: mix(base.textMuted, base.text, 0.12),
    lodging: mix(base.textMuted, base.water, 0.24),
    medical: mix(base.textMuted, base.roadMajor, 0.22),
    'park-nature': mix(base.textMuted, base.park, 0.14),
    'public-services': labelDefaults.poi,
    religion: mix(base.textMuted, base.text, 0.18),
    retail: mix(base.textMuted, base.park, 0.2),
    'sport-leisure': mix(base.textMuted, base.park, 0.1),
    transport: labelDefaults.road,
    'visitor-amenity': labelDefaults.poi,
  } satisfies TileflowResolvedPoiColors;
  const landuseDefaults = {
    cemetery: mix(base.park, base.land, 0.35),
    civic: mix(base.land, base.textMuted, 0.08),
    commercial: mix(base.land, base.textMuted, 0.05),
    education: mix(base.park, base.land, 0.18),
    government: mix(base.land, base.boundary, 0.12),
    industrial: mix(base.land, base.text, 0.04),
    medical: mix(base.land, base.water, 0.12),
    military: mix(base.land, base.textMuted, 0.16),
    parking: mix(base.land, base.textMuted, 0.1),
    railway: mix(base.land, base.textMuted, 0.08),
    recreation: mix(base.park, base.land, 0.15),
    residential: mix(base.land, base.background, 0.35),
  } satisfies TileflowResolvedLanduseColors;
  const landcoverDefaults = {
    farmland: mix(base.park, base.land, 0.55),
    flowerbed: mix(base.park, base.land, 0.08),
    grass: mix(base.park, base.land, 0.25),
    ice: mix(base.water, base.background, 0.65),
    meadow: mix(base.park, base.land, 0.4),
    protected: mix(base.park, base.textMuted, 0.08),
    recreationGround: mix(base.park, base.land, 0.18),
    rock: mix(base.land, base.text, 0.12),
    sand: mix(base.land, base.roadMajor, 0.1),
    scrub: mix(base.park, base.land, 0.62),
    urbanPark: base.park,
    villageGreen: mix(base.park, base.land, 0.12),
    wetland: mix(base.water, base.park, 0.35),
    wood: mix(base.park, base.text, 0.08),
  } satisfies TileflowResolvedLandcoverColors;
  const hydroDefaults = {
    ferry: mix(base.water, base.text, 0.24),
    label: labelDefaults.water,
    water: base.water,
    waterway: mix(base.water, base.text, 0.08),
  } satisfies ResolvedColorGroup<TileflowHydroColorConfig>;
  const buildingDefaults = {
    active: mix(base.building, base.roadMajor, 0.22),
    businessCorridor: mix(base.building, base.roadMajor, 0.28),
    businessCorridorOutline: mix(base.building, base.roadMajor, 0.42),
    civic: mix(base.building, base.boundary, 0.28),
    commercial: mix(base.building, base.roadMajor, 0.22),
    destination: mix(base.building, base.roadMajor, 0.22),
    extrusion: mix(base.building, base.text, 0.08),
    fill: base.building,
    generic: base.building,
    highRise: base.building,
    highRiseOutline: mix(base.building, base.text, 0.2),
    industrial: mix(base.building, base.textMuted, 0.2),
    lowRise: mix(base.building, base.land, 0.55),
    lowRiseOutline: mix(base.building, base.land, 0.2),
    outline: mix(base.building, base.text, 0.2),
    residential: mix(base.building, base.land, 0.18),
  } satisfies TileflowResolvedBuildingColors;
  const boundaryDefaults = {
    admin: base.boundary,
    disputed: alpha(base.boundary, 0.65),
    major: mix(base.boundary, base.text, 0.2),
    maritime: mix(base.water, base.text, 0.25),
  } satisfies TileflowResolvedBoundaryColors;

  const resolved = {
    ...mapColorRecord(baseResolved),
    boundaries: mapColorRecord(
      resolveGroup(boundaryDefaults, defaultModules.boundaries, overrideModules.boundaries),
    ),
    buildings: mapColorRecord(
      resolveGroup(buildingDefaults, defaultModules.buildings, overrideModules.buildings),
    ),
    hydro: mapColorRecord(resolveGroup(hydroDefaults, defaultModules.hydro, overrideModules.hydro)),
    labels: mapColorRecord(
      resolveGroup(labelDefaults, defaultModules.labels, overrideModules.labels),
    ),
    landcover: mapColorRecord(
      resolveGroup(landcoverDefaults, defaultModules.landcover, overrideModules.landcover),
    ),
    landuse: mapColorRecord(
      resolveGroup(landuseDefaults, defaultModules.landuse, overrideModules.landuse),
    ),
    poi: mapColorRecord(resolveGroup(poiDefaults, defaultModules.poi, overrideModules.poi)),
    roads: mapColorRecord(resolveGroup(roadDefaults, defaultModules.roads, overrideModules.roads)),
  };
  const [hillshadeInk, hillshadeLight] = orderByLuminance(
    resolved.labels.primary,
    resolved.labels.halo,
  );
  const depthInk = resolved.labels.primary;
  const depth = {
    m0: resolved.hydro.water,
    m200: mix(resolved.hydro.water, depthInk, 0.04),
    m2000: mix(resolved.hydro.water, depthInk, 0.11),
    m7000: mix(resolved.hydro.water, depthInk, 0.18),
  } satisfies TileflowResolvedHydroColors['depth'];

  return {
    ...resolved,
    hydro: {...resolved.hydro, depth},
    terrain: {
      contour: {
        halo: resolved.labels.halo,
        index: resolved.labels.primary,
        label: resolved.labels.primary,
        minor: resolved.labels.muted,
      },
      hillshade: {
        accent: alpha(hillshadeInk, 0.18),
        highlight: alpha(hillshadeLight, 0.28),
        shadow: alpha(hillshadeInk, 0.34),
      },
    },
    vegetation: {
      tree: {
        bark: resolved.buildings.outline,
        broadleaf: [
          resolved.landcover.wood,
          resolved.landcover.urbanPark,
          resolved.landcover.grass,
          resolved.landcover.meadow,
        ],
        conifer: [resolved.landcover.protected, resolved.landcover.scrub, resolved.landcover.wood],
      },
    },
  };
}

/** Build the semantic compiler's concrete color context from semantic theme roles. */
export function resolveThemeColors(theme: TileflowTheme): TileflowResolvedColors {
  const tokens = resolveTileflowTheme(theme).tokens.color;
  const requireColor = (name: string): string => {
    const value = tokens[name];
    if (value !== undefined) return value;
    throw new Error(
      `Tileflow semantic compiler requires color token "${name}" in theme "${theme.id}".`,
    );
  };
  const optionalGroup = <const TKeys extends readonly string[]>(
    group: string,
    keys: TKeys,
  ): Partial<Record<TKeys[number], string>> =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const value = tokens[`${group}.${key}`];
        return value === undefined ? [] : [[key, value]];
      }),
    ) as Partial<Record<TKeys[number], string>>;

  const base = {
    background: requireColor('surface.background'),
    boundary: requireColor('boundaries.default'),
    building: requireColor('surface.building'),
    land: requireColor('surface.land'),
    park: requireColor('surface.park'),
    road: requireColor('roads.default'),
    roadCasing: requireColor('roads.casing'),
    roadMajor: requireColor('roads.major'),
    text: requireColor('labels.primary'),
    textHalo: requireColor('labels.halo'),
    textMuted: requireColor('labels.muted'),
    water: requireColor('surface.water'),
  } as TileflowColorConfig;
  const modules = {
    boundaries: optionalGroup('boundaries', ['admin', 'disputed', 'major', 'maritime']),
    buildings: optionalGroup('buildings', [
      'active',
      'businessCorridor',
      'businessCorridorOutline',
      'civic',
      'commercial',
      'destination',
      'extrusion',
      'fill',
      'generic',
      'highRise',
      'highRiseOutline',
      'industrial',
      'lowRise',
      'lowRiseOutline',
      'outline',
      'residential',
    ]),
    hydro: optionalGroup('hydro', ['ferry', 'label', 'water', 'waterway']),
    labels: optionalGroup('labels', [
      'country',
      'halo',
      'muted',
      'neighborhood',
      'poi',
      'primary',
      'road',
      'settlement',
      'water',
    ]),
    landcover: optionalGroup('landcover', [
      'farmland',
      'flowerbed',
      'grass',
      'ice',
      'meadow',
      'protected',
      'recreationGround',
      'rock',
      'sand',
      'scrub',
      'urbanPark',
      'villageGreen',
      'wetland',
      'wood',
    ]),
    landuse: optionalGroup('landuse', [
      'cemetery',
      'civic',
      'commercial',
      'education',
      'government',
      'industrial',
      'medical',
      'military',
      'parking',
      'railway',
      'recreation',
      'residential',
    ]),
    poi: optionalGroup('poi', [
      'arts-entertainment',
      'education',
      'food-drink',
      'halo',
      'icon',
      'label',
      'landmark',
      'lodging',
      'medical',
      'park-nature',
      'public-services',
      'religion',
      'retail',
      'sport-leisure',
      'transport',
      'visitor-amenity',
    ]),
    roads: optionalGroup('roads', [
      'bridge',
      'casing',
      'ferry',
      'minor',
      'motorway',
      'path',
      'primary',
      'rail',
      'secondary',
      'trunk',
      'tunnel',
    ]),
  } as TileflowColorGroupsConfig;
  const colors = resolveColors({}, base, {}, modules);
  const optionalColor = (name: string, fallback: string): string =>
    cssColor(tokens[name] ?? fallback);
  return {
    ...colors,
    hydro: {
      ...colors.hydro,
      depth: {
        m0: optionalColor('hydro.depth.m0', colors.hydro.depth.m0),
        m200: optionalColor('hydro.depth.m200', colors.hydro.depth.m200),
        m2000: optionalColor('hydro.depth.m2000', colors.hydro.depth.m2000),
        m7000: optionalColor('hydro.depth.m7000', colors.hydro.depth.m7000),
      },
    },
    terrain: {
      contour: {
        halo: optionalColor('terrain.contour.halo', colors.terrain.contour.halo),
        index: optionalColor('terrain.contour.index', colors.terrain.contour.index),
        label: optionalColor('terrain.contour.label', colors.terrain.contour.label),
        minor: optionalColor('terrain.contour.minor', colors.terrain.contour.minor),
      },
      hillshade: {
        accent: optionalColor('terrain.hillshade.accent', colors.terrain.hillshade.accent),
        highlight: optionalColor('terrain.hillshade.highlight', colors.terrain.hillshade.highlight),
        shadow: optionalColor('terrain.hillshade.shadow', colors.terrain.hillshade.shadow),
      },
    },
    vegetation: {
      tree: {
        bark: optionalColor('vegetation.tree.bark', colors.vegetation.tree.bark),
        broadleaf: [
          optionalColor('vegetation.tree.broadleaf.a', colors.vegetation.tree.broadleaf[0]),
          optionalColor('vegetation.tree.broadleaf.b', colors.vegetation.tree.broadleaf[1]),
          optionalColor('vegetation.tree.broadleaf.c', colors.vegetation.tree.broadleaf[2]),
          optionalColor('vegetation.tree.broadleaf.d', colors.vegetation.tree.broadleaf[3]),
        ],
        conifer: [
          optionalColor('vegetation.tree.conifer.a', colors.vegetation.tree.conifer[0]),
          optionalColor('vegetation.tree.conifer.b', colors.vegetation.tree.conifer[1]),
          optionalColor('vegetation.tree.conifer.c', colors.vegetation.tree.conifer[2]),
        ],
      },
    },
  };
}

/** Resolve the complete semantic image catalog for one concrete theme. */
export function resolveThemeImages(theme: TileflowTheme): TileflowResolvedImages {
  return Object.freeze({...resolveTileflowTheme(theme).tokens.image});
}

export function resolveTypography(
  overrides: TileflowTypography = {},
  defaults: ResolvedTileflowTypography = defaultTypography,
): ResolvedTileflowTypography {
  const base = resolveTypographyStyle(overrides, defaults);

  return {
    ...base,
    places: resolveTypographyDomain(overrides.places, overrides, defaults.places, base),
    roads: resolveTypographyDomain(overrides.roads, overrides, defaults.roads, base),
    water: resolveTypographyDomain(overrides.water, overrides, defaults.water, base),
    poi: resolveTypographyDomain(overrides.poi, overrides, defaults.poi, base),
  };
}

export function textFont(
  typography: ResolvedTileflowTypography,
  domain?: TileflowTypographyDomain,
): string[] {
  const style = domain ? typography[domain] : typography;
  return [style.font, ...(style.fallbacks ?? [])];
}

function resolveTypographyStyle(
  overrides: TileflowTypographyStyle | undefined,
  defaults: ResolvedTileflowTypographyStyle,
): ResolvedTileflowTypographyStyle {
  return {
    font: overrides?.font ?? defaults.font,
    ...resolveOptionalTypography(overrides, defaults),
  };
}

function resolveTypographyDomain(
  domainOverrides: TileflowTypographyStyle | undefined,
  globalOverrides: TileflowTypographyStyle,
  defaults: ResolvedTileflowTypographyStyle,
  resolvedGlobal: ResolvedTileflowTypographyStyle,
): ResolvedTileflowTypographyStyle {
  const globalFontOverridden = Boolean(globalOverrides.font);
  const font =
    domainOverrides?.font ?? (globalFontOverridden ? resolvedGlobal.font : defaults.font);

  return {
    font,
    ...resolveOptionalTypography(domainOverrides, globalOverrides, defaults, resolvedGlobal),
  };
}

function resolveOptionalTypography(
  ...styles: Array<TileflowTypographyStyle | ResolvedTileflowTypographyStyle | undefined>
): Omit<TileflowTypographyStyle, 'font'> {
  const first = <TKey extends 'fallbacks' | 'letterSpacing' | 'transform'>(key: TKey) =>
    styles.find((style) => style?.[key] !== undefined)?.[key];
  const fallbacks = first('fallbacks');
  const letterSpacing = first('letterSpacing');
  const transform = first('transform');
  return {
    ...(fallbacks ? {fallbacks: [...fallbacks]} : {}),
    ...(letterSpacing === undefined ? {} : {letterSpacing}),
    ...(transform === undefined ? {} : {transform}),
  };
}

function resolveBaseColors(
  overrides: TileflowColorConfig,
  defaults: TileflowColorConfig,
): TileflowBaseColors {
  const background = overrides.background ?? defaults.background ?? defaultColors.background;
  const land = overrides.land ?? defaults.land ?? defaultColors.land;
  const water = overrides.water ?? defaults.water ?? defaultColors.water;
  const park = overrides.park ?? defaults.park ?? defaultColors.park;
  const road = overrides.road ?? defaults.road ?? defaultColors.road;
  const text = overrides.text ?? defaults.text ?? defaultColors.text;
  const textMuted = overrides.textMuted ?? defaults.textMuted ?? mix(text, background, 0.42);
  const textHalo = overrides.textHalo ?? defaults.textHalo ?? background;

  return {
    background,
    boundary: overrides.boundary ?? defaults.boundary ?? mix(text, background, 0.72),
    building: overrides.building ?? defaults.building ?? mix(land, text, 0.08),
    land,
    park,
    road,
    roadMajor: overrides.roadMajor ?? defaults.roadMajor ?? mix(road, textMuted, 0.16),
    text,
    textHalo,
    textMuted,
    water,
  };
}

function mergeColorConfigs(
  defaults: TileflowColorConfig,
  overrides: TileflowColorConfig = {},
): TileflowColorConfig {
  return {
    ...defaults,
    ...overrides,
  };
}

function mergeThemeModules(
  defaults: TileflowColorGroupsConfig = {},
  overrides: TileflowColorGroupsConfig = {},
): TileflowColorGroupsConfig {
  return {
    ...mergeThemeModuleGroup('boundaries', defaults, overrides),
    ...mergeThemeModuleGroup('buildings', defaults, overrides),
    ...mergeThemeModuleGroup('hydro', defaults, overrides),
    ...mergeThemeModuleGroup('labels', defaults, overrides),
    ...mergeThemeModuleGroup('landcover', defaults, overrides),
    ...mergeThemeModuleGroup('landuse', defaults, overrides),
    ...mergeThemeModuleGroup('poi', defaults, overrides),
    ...mergeThemeModuleGroup('roads', defaults, overrides),
  };
}

function mergeThemeModuleGroup<TKey extends keyof TileflowColorGroupsConfig>(
  key: TKey,
  defaults: TileflowColorGroupsConfig,
  overrides: TileflowColorGroupsConfig,
): Pick<TileflowColorGroupsConfig, TKey> | {} {
  const value = {
    ...(isRecord(defaults[key]) ? defaults[key] : {}),
    ...(isRecord(overrides[key]) ? overrides[key] : {}),
  };

  return Object.keys(value).length > 0 ? {[key]: value} : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveGroup<T extends Record<string, string>>(
  defaults: T,
  themeDefaults: Partial<T> | undefined,
  overrides: Partial<T> | undefined,
): T {
  return {
    ...defaults,
    ...themeDefaults,
    ...overrides,
  };
}

function mapColorRecord<T extends Record<string, string>>(colors: T): T {
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, cssColor(value)]),
  ) as T;
}

function orderByLuminance(first: string, second: string): readonly [string, string] {
  return relativeLuminance(first) <= relativeLuminance(second) ? [first, second] : [second, first];
}

function relativeLuminance(color: string): number {
  const {b, g, r} = hexToRgba(color);
  const linear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function alpha(color: string, opacity: number): string {
  const {a, b, g, r} = hexToRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${roundAlpha(a * opacity)})`;
}

export function mix(hexA: string, hexB: string, amount: number): `#${string}` {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * amount);
  const g = Math.round(a.g + (b.g - a.g) * amount);
  const bValue = Math.round(a.b + (b.b - a.b) * amount);

  return rgbToHex(r, g, bValue);
}

function hexToRgb(hex: string): {r: number; g: number; b: number} {
  const {b, g, r} = hexToRgba(hex);

  return {b, g, r};
}

function hexToRgba(hex: string): {
  a: number;
  r: number;
  g: number;
  b: number;
} {
  const rgbMatch = hex.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/,
  );

  if (rgbMatch) {
    return {
      a: roundAlpha(Number(rgbMatch[4] ?? 1)),
      r: Math.round(Number(rgbMatch[1])),
      g: Math.round(Number(rgbMatch[2])),
      b: Math.round(Number(rgbMatch[3])),
    };
  }

  const value = hex.replace('#', '');
  const normalized =
    value.length === 3 || value.length === 4
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;

  return {
    a: normalized.length === 8 ? roundAlpha(Number.parseInt(normalized.slice(6, 8), 16) / 255) : 1,
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function cssColor(hex: string): string {
  const value = hex.replace('#', '');

  if (value.length !== 4 && value.length !== 8) {
    return hex;
  }

  const {a, b, g, r} = hexToRgba(hex);

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function roundAlpha(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rgbToHex(r: number, g: number, b: number): `#${string}` {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
