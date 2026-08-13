import type {
  ResolvedTileflowTypography,
  TileflowBaseColors,
  TileflowBoundaryColorConfig,
  TileflowBuildingColorConfig,
  TileflowColorConfig,
  TileflowConfig,
  TileflowFontWeight,
  TileflowHydroColorConfig,
  TileflowLabelColorConfig,
  TileflowLabels,
  TileflowLandcoverColorConfig,
  TileflowLanduseColorConfig,
  TileflowPoi,
  TileflowPoiColorConfig,
  TileflowProjectThemes,
  TileflowRoadColorConfig,
  TileflowRoads,
  TileflowStyleLayerOverride,
  TileflowTheme,
  TileflowThemeConfig,
  TileflowThemeMode,
  TileflowThemeModulesConfig,
  TileflowTypography,
  TileflowTypographyDomain,
  TileflowTypographyStyle,
} from '../compiler';

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
  canvas: string;
  greenspace: string;
  nature: string;
  roadCasing: string;
  roadMinor: string;
  boundaries: TileflowResolvedBoundaryColors;
  buildings: TileflowResolvedBuildingColors;
  hydro: TileflowResolvedHydroColors;
  labels: TileflowResolvedLabelColors;
  landcover: TileflowResolvedLandcoverColors;
  landuse: TileflowResolvedLanduseColors;
  poi: TileflowResolvedPoiColors;
  roads: TileflowResolvedRoadColors;
};

export type TileflowThemePreset = {
  colors: TileflowColorConfig;
  density: TileflowConfig['density'];
  labels: TileflowLabels;
  poi: TileflowPoi;
  roads: TileflowRoads;
};

export type ResolvedTileflowTheme = {
  colorOverrides: TileflowColorConfig;
  colors: TileflowColorConfig;
  custom: boolean;
  layerOverrides: Record<string, TileflowStyleLayerOverride>;
  mode: TileflowThemeMode;
  moduleOverrides: TileflowThemeModulesConfig;
  modules: TileflowThemeModulesConfig;
  name: string;
  preset: TileflowThemePreset;
  typography: ResolvedTileflowTypography;
  typographyOverridden: boolean;
};

const defaultColors = {
  background: '#F6F7F3',
  canvas: '#F6F7F3',
  land: '#F1F3ED',
  water: '#A9D3F5',
  park: '#CDE8B5',
  greenspace: '#CDE8B5',
  nature: '#CDE8B5',
  building: '#E6E3DA',
  road: '#FFFFFF',
  roadMajor: '#F4C95D',
  boundary: '#C9D1D9',
  text: '#3C4043',
  textMuted: '#727B84',
  textHalo: '#FFFFFF',
} as const;

const themePresets = {
  standard: {
    colors: defaultColors,
    density: 'balanced',
    labels: 'balanced',
    poi: 'minimal',
    roads: 'standard',
  },
  light: {
    colors: {
      background: '#F9FAF8',
      land: '#F6F7F3',
      water: '#C5E1F5',
      park: '#DDEED2',
      greenspace: '#DDEED2',
      building: '#ECEAE4',
      road: '#FFFFFF',
      roadMajor: '#F7D58A',
      boundary: '#C9D1D9',
      text: '#5F6368',
      textMuted: '#87909A',
      textHalo: '#FFFFFF',
    },
    density: 'clean',
    labels: 'essential',
    poi: 'minimal',
    roads: 'standard',
  },
  dark: {
    colors: {
      background: '#1C2228',
      land: '#232B32',
      water: '#18384D',
      park: '#274230',
      greenspace: '#274230',
      building: '#2F363D',
      road: '#39434D',
      roadMajor: '#6E7580',
      boundary: '#53606B',
      text: '#D7DEE6',
      textMuted: '#A3AFBA',
      textHalo: '#1C2228',
    },
    density: 'balanced',
    labels: 'balanced',
    poi: 'minimal',
    roads: 'standard',
  },
  minimal: {
    colors: {
      background: '#FAFAF8',
      land: '#F7F7F2',
      water: '#D6EAF6',
      park: '#E5EEDB',
      greenspace: '#E5EEDB',
      building: '#F0EEE8',
      road: '#FFFFFF',
      roadMajor: '#E5E0D7',
      boundary: '#D4D9DD',
      text: '#697079',
      textMuted: '#8E969F',
      textHalo: '#FFFFFF',
    },
    density: 'clean',
    labels: 'essential',
    poi: 'none',
    roads: 'soft',
  },
  'osm-bright-2': {
    colors: {
      background: '#EBE9E4',
      land: '#F5F4F1',
      water: '#AADAFF',
      park: '#C7E6A8',
      greenspace: '#C7E6A8',
      building: '#EFEDE7',
      road: '#FFFFFF',
      roadMajor: '#F9C97C',
      boundary: '#B8C0CA',
      text: '#5F6368',
      textMuted: '#87909A',
      textHalo: '#FFFFFF',
    },
    density: 'balanced',
    labels: 'balanced',
    poi: 'balanced',
    roads: 'detailed',
  },
} as const satisfies Record<TileflowTheme, TileflowThemePreset>;

const defaultTypography = {
  font: 'Noto Sans',
  fontFamily: 'Noto Sans',
  weight: 'regular',
  places: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular'},
  roads: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular'},
  water: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular'},
  poi: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular'},
} satisfies ResolvedTileflowTypography;

const fontWeightLabels = {
  regular: 'Regular',
  medium: 'Medium',
  semibold: 'Semibold',
  bold: 'Bold',
} satisfies Record<TileflowFontWeight, string>;

export function getDefaultColors(): TileflowBaseColors & {
  canvas: string;
  greenspace: string;
  nature: string;
} {
  return {...defaultColors};
}

export function resolveTheme(
  theme: TileflowConfig['theme'],
  projectThemes: TileflowProjectThemes | undefined,
): ResolvedTileflowTheme {
  if (!theme) {
    return resolveLegacyTheme('light');
  }

  if (typeof theme === 'string') {
    if (projectThemes?.[theme]) {
      return resolveProjectTheme(theme, projectThemes);
    }

    if (isLegacyTheme(theme)) {
      return resolveLegacyTheme(theme);
    }

    throw new Error(`Unknown Tileflow theme: ${theme}`);
  }

  return resolveInlineTheme(theme, projectThemes);
}

export function resolveColors(
  overrides: TileflowColorConfig = {},
  defaults: TileflowColorConfig = defaultColors,
  moduleOverrides: TileflowThemeModulesConfig = {},
  moduleDefaults: TileflowThemeModulesConfig = {},
): TileflowResolvedColors {
  const defaultInput = normalizeColorAliases(defaults);
  const overrideInput = normalizeColorAliases(overrides);
  const defaultModules = mergeThemeModules(extractLegacyModuleColors(defaults), moduleDefaults);
  const overrideModules = mergeThemeModules(extractLegacyModuleColors(overrides), moduleOverrides);
  const base = resolveBaseColors(overrideInput, defaultInput);
  const baseRoadCasing =
    overrideInput.roadCasing ?? defaultInput.roadCasing ?? mix(base.road, base.text, 0.2);
  const roadCasing =
    overrideModules.roads?.casing ?? defaultModules.roads?.casing ?? baseRoadCasing;
  const baseResolved = {
    ...base,
    canvas: base.background,
    greenspace: base.park,
    nature: base.park,
    roadCasing,
    roadMinor: base.road,
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
    industrial: mix(base.land, base.text, 0.04),
    residential: mix(base.land, base.background, 0.35),
  } satisfies TileflowResolvedLanduseColors;
  const landcoverDefaults = {
    grass: mix(base.park, base.land, 0.25),
    ice: mix(base.water, base.background, 0.65),
    park: base.park,
    protected: mix(base.park, base.textMuted, 0.08),
    sand: mix(base.land, base.roadMajor, 0.1),
    wood: mix(base.park, base.text, 0.08),
  } satisfies TileflowResolvedLandcoverColors;
  const hydroDefaults = {
    ferry: mix(base.water, base.text, 0.24),
    label: labelDefaults.water,
    water: base.water,
    waterway: mix(base.water, base.text, 0.08),
  } satisfies TileflowResolvedHydroColors;
  const buildingDefaults = {
    extrusion: mix(base.building, base.text, 0.08),
    fill: base.building,
    highRise: base.building,
    highRiseOutline: mix(base.building, base.text, 0.2),
    lowRise: mix(base.building, base.land, 0.55),
    lowRiseOutline: mix(base.building, base.land, 0.2),
    outline: mix(base.building, base.text, 0.2),
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
  return [`${style.font} ${fontWeightLabels[style.weight]}`];
}

function resolveTypographyStyle(
  overrides: TileflowTypographyStyle | undefined,
  defaults: Required<TileflowTypographyStyle>,
): Required<TileflowTypographyStyle> {
  const font = overrides?.font ?? overrides?.fontFamily ?? defaults.font;

  return {
    font,
    fontFamily: font,
    weight: overrides?.weight ?? defaults.weight,
  };
}

function resolveTypographyDomain(
  domainOverrides: TileflowTypographyStyle | undefined,
  globalOverrides: TileflowTypographyStyle,
  defaults: Required<TileflowTypographyStyle>,
  resolvedGlobal: Required<TileflowTypographyStyle>,
): Required<TileflowTypographyStyle> {
  const globalFontOverridden = Boolean(globalOverrides.font || globalOverrides.fontFamily);
  const font =
    domainOverrides?.font ??
    domainOverrides?.fontFamily ??
    (globalFontOverridden ? resolvedGlobal.font : defaults.font);

  return {
    font,
    fontFamily: font,
    weight: domainOverrides?.weight ?? globalOverrides.weight ?? defaults.weight,
  };
}

function resolveLegacyTheme(theme: TileflowTheme): ResolvedTileflowTheme {
  const preset = themePresets[theme];
  const mode = theme === 'dark' ? 'dark' : 'light';

  return {
    colorOverrides: theme === 'light' ? {} : preset.colors,
    colors: preset.colors,
    custom: false,
    layerOverrides: {},
    mode,
    moduleOverrides: {},
    modules: {},
    name: theme,
    preset,
    typography: defaultTypography,
    typographyOverridden: false,
  };
}

function resolveProjectTheme(
  name: string,
  projectThemes: TileflowProjectThemes,
  seen: readonly string[] = [],
): ResolvedTileflowTheme {
  if (seen.includes(name)) {
    throw new Error(`Circular Tileflow theme extends: ${[...seen, name].join(' -> ')}`);
  }

  const theme = projectThemes[name];

  if (!theme) {
    throw new Error(`Unknown Tileflow theme: ${name}`);
  }

  const base = resolveThemeBase(theme, name, projectThemes, [...seen, name]);

  return resolveThemeConfig(name, theme, base, true);
}

function resolveInlineTheme(
  theme: TileflowThemeConfig,
  projectThemes: TileflowProjectThemes | undefined,
): ResolvedTileflowTheme {
  const base = resolveThemeBase(theme, 'inline', projectThemes, ['inline']);

  return resolveThemeConfig('inline', theme, base, true);
}

function resolveThemeBase(
  theme: TileflowThemeConfig,
  name: string,
  projectThemes: TileflowProjectThemes | undefined,
  seen: readonly string[],
): ResolvedTileflowTheme {
  if (theme.extends) {
    if (projectThemes?.[theme.extends]) {
      return resolveProjectTheme(theme.extends, projectThemes, seen);
    }

    if (isLegacyTheme(theme.extends)) {
      return resolveLegacyTheme(theme.extends);
    }

    throw new Error(`Unknown Tileflow theme: ${theme.extends}`);
  }

  if (theme.mode === 'dark' || name === 'dark') {
    return resolveLegacyTheme('dark');
  }

  return resolveLegacyTheme('light');
}

function resolveThemeConfig(
  name: string,
  theme: TileflowThemeConfig,
  base: ResolvedTileflowTheme,
  custom: boolean,
): ResolvedTileflowTheme {
  const themeColorOverrides = normalizeColorAliases(theme.colors);
  const themeModuleOverrides = mergeThemeModules(
    extractLegacyModuleColors(theme.colors),
    theme.modules,
  );
  const colorOverrides = mergeColorConfigs(base.colorOverrides, themeColorOverrides);
  const colors = mergeColorConfigs(base.colors, themeColorOverrides);
  const moduleOverrides = mergeThemeModules(base.moduleOverrides, themeModuleOverrides);
  const modules = mergeThemeModules(base.modules, themeModuleOverrides);
  const mode = theme.mode ?? base.mode;
  const preset = {
    ...base.preset,
    colors,
  };

  return {
    colorOverrides,
    colors,
    custom,
    layerOverrides: mergeStyleLayerOverrides(base.layerOverrides, theme.layers),
    mode,
    moduleOverrides,
    modules,
    name,
    preset,
    typography: resolveTypography(resolveThemeTypography(theme), base.typography),
    typographyOverridden: base.typographyOverridden || hasTypographyConfig(theme),
  };
}

function isLegacyTheme(value: string): value is TileflowTheme {
  return value in themePresets;
}

function resolveThemeTypography(theme: TileflowThemeConfig): TileflowTypography {
  const font =
    theme.typography?.font ??
    theme.typography?.fontFamily ??
    theme.fonts?.labels ??
    theme.fonts?.body;

  return {
    ...(theme.typography?.places ? {places: theme.typography.places} : {}),
    ...(theme.typography?.poi ? {poi: theme.typography.poi} : {}),
    ...(theme.typography?.roads ? {roads: theme.typography.roads} : {}),
    ...(theme.typography?.water ? {water: theme.typography.water} : {}),
    ...(theme.typography?.weight ? {weight: theme.typography.weight} : {}),
    ...(font ? {font} : {}),
  };
}

function hasTypographyConfig(theme: TileflowThemeConfig): boolean {
  return Boolean(
    theme.typography?.font ||
    theme.typography?.fontFamily ||
    theme.typography?.weight ||
    theme.typography?.places ||
    theme.typography?.poi ||
    theme.typography?.roads ||
    theme.typography?.water ||
    theme.fonts?.labels ||
    theme.fonts?.body,
  );
}

function normalizeColorAliases(colors: TileflowColorConfig | undefined): TileflowColorConfig {
  if (!colors) {
    return {};
  }

  return {
    ...colors,
    background: colors.background ?? colors.canvas,
    park: colors.park ?? colors.greenspace ?? colors.nature,
    greenspace: colors.greenspace ?? colors.park ?? colors.nature,
  };
}

function resolveBaseColors(
  overrides: TileflowColorConfig,
  defaults: TileflowColorConfig,
): TileflowBaseColors {
  const background =
    overrides.background ?? defaults.background ?? defaults.canvas ?? defaultColors.background;
  const land = overrides.land ?? defaults.land ?? defaultColors.land;
  const water = overrides.water ?? defaults.water ?? defaultColors.water;
  const park =
    overrides.park ??
    overrides.greenspace ??
    overrides.nature ??
    defaults.park ??
    defaults.greenspace ??
    defaults.nature ??
    defaultColors.park;
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
    ...stripLegacyModuleColors(defaults),
    ...stripLegacyModuleColors(overrides),
  };
}

function stripLegacyModuleColors(colors: TileflowColorConfig): TileflowColorConfig {
  const {
    boundaries: _boundaries,
    buildings: _buildings,
    hydro: _hydro,
    labels: _labels,
    landcover: _landcover,
    landuse: _landuse,
    poi: _poi,
    roads: _roads,
    ...baseColors
  } = colors;

  return baseColors;
}

function extractLegacyModuleColors(
  colors: TileflowColorConfig | undefined,
): TileflowThemeModulesConfig {
  if (!colors) {
    return {};
  }

  return {
    ...(colors.boundaries ? {boundaries: colors.boundaries} : {}),
    ...(colors.buildings ? {buildings: colors.buildings} : {}),
    ...(colors.hydro ? {hydro: colors.hydro} : {}),
    ...(colors.labels ? {labels: colors.labels} : {}),
    ...(colors.landcover ? {landcover: colors.landcover} : {}),
    ...(colors.landuse ? {landuse: colors.landuse} : {}),
    ...(colors.poi ? {poi: colors.poi} : {}),
    ...(colors.roads ? {roads: colors.roads} : {}),
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

function mergeStyleLayerOverrides(
  defaults: Record<string, TileflowStyleLayerOverride> = {},
  overrides: Record<string, TileflowStyleLayerOverride> = {},
): Record<string, TileflowStyleLayerOverride> {
  return {
    ...defaults,
    ...overrides,
  };
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
