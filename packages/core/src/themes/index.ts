import type {
  ResolvedTileflowTypography,
  ResolvedTileflowTypographyStyle,
  TileflowBaseColors,
  TileflowBoundaryColorConfig,
  TileflowBuildingColorConfig,
  TileflowColorConfig,
  TileflowHydroColorConfig,
  TileflowLabelColorConfig,
  TileflowLandcoverColorConfig,
  TileflowLanduseColorConfig,
  TileflowPoiColorConfig,
  TileflowRoadColorConfig,
  TileflowThemeConfig,
  TileflowThemeMode,
  TileflowThemeModulesConfig,
  TileflowTypography,
  TileflowTypographyDomain,
  TileflowTypographyStyle,
} from '../types';

type ResolvedColorGroup<TConfig> = {
  [TKey in keyof Required<TConfig>]: string;
};

export type TileflowResolvedRoadColors = ResolvedColorGroup<TileflowRoadColorConfig>;
export type TileflowResolvedLabelColors = ResolvedColorGroup<TileflowLabelColorConfig>;
export type TileflowResolvedPoiColors = ResolvedColorGroup<TileflowPoiColorConfig>;
export type TileflowResolvedLanduseColors = ResolvedColorGroup<TileflowLanduseColorConfig>;
export type TileflowResolvedLandcoverColors = ResolvedColorGroup<TileflowLandcoverColorConfig>;
export type TileflowResolvedHydroColors = ResolvedColorGroup<TileflowHydroColorConfig>;
export type TileflowResolvedBuildingColors = ResolvedColorGroup<TileflowBuildingColorConfig>;
export type TileflowResolvedBoundaryColors = ResolvedColorGroup<TileflowBoundaryColorConfig>;

export type TileflowResolvedColors = {[TKey in keyof TileflowBaseColors]: string} & {
  boundaries: TileflowResolvedBoundaryColors;
  buildings: TileflowResolvedBuildingColors;
  hydro: TileflowResolvedHydroColors;
  labels: TileflowResolvedLabelColors;
  landcover: TileflowResolvedLandcoverColors;
  landuse: TileflowResolvedLanduseColors;
  poi: TileflowResolvedPoiColors;
  roads: TileflowResolvedRoadColors;
};

export type ResolvedTileflowTheme = {
  colors: TileflowColorConfig;
  mode: TileflowThemeMode;
  modules: TileflowThemeModulesConfig;
  typography: ResolvedTileflowTypography;
};

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

const lightThemeColors = {
  background: '#F9FAF8',
  land: '#F6F7F3',
  water: '#C5E1F5',
  park: '#DDEED2',
  building: '#ECEAE4',
  road: '#FFFFFF',
  roadMajor: '#F7D58A',
  boundary: '#C9D1D9',
  text: '#5F6368',
  textMuted: '#87909A',
  textHalo: '#FFFFFF',
} as const satisfies TileflowColorConfig;

const darkThemeColors = {
  background: '#1C2228',
  land: '#232B32',
  water: '#18384D',
  park: '#274230',
  building: '#2F363D',
  road: '#39434D',
  roadMajor: '#6E7580',
  boundary: '#53606B',
  text: '#D7DEE6',
  textMuted: '#A3AFBA',
  textHalo: '#1C2228',
} as const satisfies TileflowColorConfig;

const defaultTypography = {
  font: 'Noto Sans Regular',
  places: {font: 'Noto Sans Regular'},
  roads: {font: 'Noto Sans Regular'},
  water: {font: 'Noto Sans Regular'},
  poi: {font: 'Noto Sans Regular'},
} satisfies ResolvedTileflowTypography;

export function resolveTheme(theme: TileflowThemeConfig | undefined): ResolvedTileflowTheme {
  const mode = theme?.mode ?? 'light';
  const baseColors = mode === 'dark' ? darkThemeColors : lightThemeColors;
  return {
    colors: mergeColorConfigs(baseColors, theme?.colors),
    mode,
    modules: mergeThemeModules({}, theme?.modules),
    typography: resolveTypography(resolveThemeTypography(theme), defaultTypography),
  };
}

export function resolveColors(
  overrides: TileflowColorConfig = {},
  defaults: TileflowColorConfig = defaultColors,
  moduleOverrides: TileflowThemeModulesConfig = {},
  moduleDefaults: TileflowThemeModulesConfig = {},
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
    coffee: mix(base.textMuted, base.roadMajor, 0.24),
    culture: mix(base.textMuted, base.text, 0.18),
    education: mix(base.textMuted, base.water, 0.18),
    food: mix(base.textMuted, base.roadMajor, 0.34),
    halo: labelDefaults.halo,
    health: mix(base.textMuted, '#D45E5E', 0.22),
    icon: labelDefaults.poi,
    label: labelDefaults.poi,
    lodging: mix(base.textMuted, base.water, 0.24),
    services: labelDefaults.poi,
    shopping: mix(base.textMuted, base.park, 0.2),
    transit: labelDefaults.road,
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
  } satisfies TileflowResolvedHydroColors;
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

  return {
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

function resolveThemeTypography(theme: TileflowThemeConfig | undefined): TileflowTypography {
  const typography = theme?.typography;
  if (!typography) return {};

  return {
    ...typography,
    ...(typography.fallbacks ? {fallbacks: [...typography.fallbacks]} : {}),
    ...(typography.places ? {places: {...typography.places}} : {}),
    ...(typography.poi ? {poi: {...typography.poi}} : {}),
    ...(typography.roads ? {roads: {...typography.roads}} : {}),
    ...(typography.water ? {water: {...typography.water}} : {}),
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
  defaults: TileflowThemeModulesConfig = {},
  overrides: TileflowThemeModulesConfig = {},
): TileflowThemeModulesConfig {
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

function mergeThemeModuleGroup<TKey extends keyof TileflowThemeModulesConfig>(
  key: TKey,
  defaults: TileflowThemeModulesConfig,
  overrides: TileflowThemeModulesConfig,
): Pick<TileflowThemeModulesConfig, TKey> | {} {
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
