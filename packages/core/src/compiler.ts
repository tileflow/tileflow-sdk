import {osm} from './basemaps';
import {openMapTilesLayers} from './basemaps/osm/layers';
import type {TileflowCaptureScene} from './capture-scene';
import {type ResolvedLabelsModuleOptions, resolveLabels} from './modules/labels';
import {type ResolvedPoiModuleOptions, resolvePoi} from './modules/poi';
import {resolveRoads} from './modules/roads';
import {applyStyleOverrides} from './modules/style-override';
import {configSchema} from './schema';
import {createOsmBrightStyle} from './templates/osm-bright';
import {resolveTerrain, withTerrainLayers} from './terrain';
import {
  getDefaultColors as getThemeDefaultColors,
  resolveColors,
  type ResolvedTileflowTheme,
  resolveTheme,
  resolveTypography,
} from './themes';

export type TileflowDensity = 'clean' | 'balanced' | 'dense';
export type TileflowRoads = 'hidden' | 'soft' | 'standard' | 'detailed';
export type TileflowLabels = 'none' | 'essential' | 'balanced' | 'full';
export type TileflowPoi = 'none' | 'minimal' | 'balanced' | 'full';
export type TileflowLabelDetail = 'none' | 'major' | 'all';
export type TileflowRoadLabelDetail = TileflowRoadDetail;
export type TileflowLabelLanguage = 'auto' | 'local' | 'en' | (string & {});
export type TileflowPoiCategory =
  | 'food'
  | 'coffee'
  | 'culture'
  | 'transit'
  | 'shopping'
  | 'lodging'
  | 'health'
  | 'education'
  | 'services'
  | (string & {});
export type TileflowPoiIcons = boolean | 'essential' | 'full';
export type TileflowPoiLabels = 'none' | 'minimal' | 'balanced' | 'full';
export type TileflowPoiDensity = 'sparse' | 'balanced' | 'dense';
export type TileflowPoiColorMode = 'uniform' | 'category';
export type TileflowPoiClassMapping = Record<string, readonly string[]>;
export type TileflowTheme = 'standard' | 'light' | 'dark' | 'minimal' | 'osm-bright-2';
export type TileflowBuildings = 'hidden' | 'flat' | '3d';
export type TileflowTerrainMode = 'none' | 'hillshade' | '3d';
export type TileflowTerrainEncoding = 'mapbox' | 'terrarium';
export type TileflowRenderer = 'auto' | 'osm-bright' | 'generated';
export type TileflowThemeName = string;
export type TileflowThemeMode = 'light' | 'dark';
export type TileflowColor = `#${string}`;

export type TileflowBaseColors = {
  background: TileflowColor;
  land: TileflowColor;
  water: TileflowColor;
  park: TileflowColor;
  building: TileflowColor;
  road: TileflowColor;
  roadMajor: TileflowColor;
  boundary: TileflowColor;
  text: TileflowColor;
  textMuted: TileflowColor;
  textHalo: TileflowColor;
};

type LegacyTileflowColorAliases = {
  accent?: TileflowColor;
  canvas?: TileflowColor;
  background?: TileflowColor;
  greenspace?: TileflowColor;
  nature?: TileflowColor;
  park?: TileflowColor;
  roadCasing?: TileflowColor;
};

export type TileflowRoadColorConfig = {
  bridge?: TileflowColor;
  casing?: TileflowColor;
  ferry?: TileflowColor;
  minor?: TileflowColor;
  motorway?: TileflowColor;
  path?: TileflowColor;
  primary?: TileflowColor;
  rail?: TileflowColor;
  secondary?: TileflowColor;
  trunk?: TileflowColor;
  tunnel?: TileflowColor;
};

export type TileflowLabelColorConfig = {
  country?: TileflowColor;
  halo?: TileflowColor;
  muted?: TileflowColor;
  neighborhood?: TileflowColor;
  poi?: TileflowColor;
  primary?: TileflowColor;
  road?: TileflowColor;
  settlement?: TileflowColor;
  water?: TileflowColor;
};

export type TileflowPoiColorConfig = {
  coffee?: TileflowColor;
  culture?: TileflowColor;
  education?: TileflowColor;
  food?: TileflowColor;
  halo?: TileflowColor;
  health?: TileflowColor;
  icon?: TileflowColor;
  label?: TileflowColor;
  lodging?: TileflowColor;
  services?: TileflowColor;
  shopping?: TileflowColor;
  transit?: TileflowColor;
};

export type TileflowLanduseColorConfig = {
  cemetery?: TileflowColor;
  civic?: TileflowColor;
  commercial?: TileflowColor;
  industrial?: TileflowColor;
  residential?: TileflowColor;
};

export type TileflowLandcoverColorConfig = {
  grass?: TileflowColor;
  ice?: TileflowColor;
  park?: TileflowColor;
  protected?: TileflowColor;
  sand?: TileflowColor;
  wood?: TileflowColor;
};

export type TileflowHydroColorConfig = {
  ferry?: TileflowColor;
  label?: TileflowColor;
  water?: TileflowColor;
  waterway?: TileflowColor;
};

export type TileflowBuildingColorConfig = {
  extrusion?: TileflowColor;
  fill?: TileflowColor;
  highRise?: TileflowColor;
  highRiseOutline?: TileflowColor;
  lowRise?: TileflowColor;
  lowRiseOutline?: TileflowColor;
  outline?: TileflowColor;
};

export type TileflowBuildingStyleConfig = {
  fillOpacity?: number;
  heightThreshold?: number;
  outlineOpacity?: number;
  outlineWidth?: number;
};

export type TileflowBoundaryColorConfig = {
  admin?: TileflowColor;
  disputed?: TileflowColor;
  major?: TileflowColor;
  maritime?: TileflowColor;
};

export type TileflowAdvancedColorConfig = {
  boundaries?: TileflowBoundaryColorConfig;
  buildings?: TileflowBuildingColorConfig;
  hydro?: TileflowHydroColorConfig;
  labels?: TileflowLabelColorConfig;
  landcover?: TileflowLandcoverColorConfig;
  landuse?: TileflowLanduseColorConfig;
  poi?: TileflowPoiColorConfig;
  roads?: TileflowRoadColorConfig;
};

export type TileflowThemeModulesConfig = TileflowAdvancedColorConfig;

export type TileflowColorConfig = Partial<TileflowBaseColors> &
  LegacyTileflowColorAliases &
  TileflowAdvancedColorConfig;

export type TileflowColors = {[K in keyof TileflowBaseColors]: string} & {
  canvas: string;
  greenspace: string;
  nature: string;
};

export type TileflowFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export const tileflowHostedNotoSansWeights = ['regular', 'bold'] as const;
export type TileflowHostedNotoSansWeight = (typeof tileflowHostedNotoSansWeights)[number];

export type TileflowTypographyStyle = {
  font?: string;
  fontFamily?: string;
  weight?: TileflowFontWeight;
};

export type TileflowTypographyDomain = 'places' | 'roads' | 'water' | 'poi';

export type TileflowTypography = TileflowTypographyStyle & {
  places?: TileflowTypographyStyle;
  roads?: TileflowTypographyStyle;
  water?: TileflowTypographyStyle;
  poi?: TileflowTypographyStyle;
};

export type ResolvedTileflowTypography = Required<TileflowTypographyStyle> & {
  places: Required<TileflowTypographyStyle>;
  roads: Required<TileflowTypographyStyle>;
  water: Required<TileflowTypographyStyle>;
  poi: Required<TileflowTypographyStyle>;
};

export type TileflowFonts = {
  body?: string;
  labels?: string;
};

export type TileflowThemeConfig = {
  colors?: TileflowColorConfig;
  extends?: string;
  fonts?: TileflowFonts;
  layers?: Record<string, TileflowStyleLayerOverride>;
  mode?: TileflowThemeMode;
  modules?: TileflowThemeModulesConfig;
  typography?: TileflowTypography;
};

export type TileflowSourceLayers = {
  landcover?: string;
  landuse?: string;
  park?: string;
  water?: string;
  waterName?: string;
  waterway?: string;
  road?: string;
  roadName?: string;
  building?: string;
  boundary?: string;
  place?: string;
  poi?: string;
};

export type TileflowTiles = {
  sourceId?: string;
  tileset?: string;
  url?: string;
  attribution?: string;
  sourceLayers?: TileflowSourceLayers;
  version?: string;
};

export type TileflowTerrainConfig = {
  attribution?: string;
  encoding?: TileflowTerrainEncoding;
  exaggeration?: number;
  mode?: TileflowTerrainMode;
  sourceId?: string;
  tileset?: string;
  url?: string;
};

export type TileflowTerrain = TileflowTerrainMode | TileflowTerrainConfig;

export type TileflowViewConfig = {
  bearing?: number;
  center?: readonly [number, number];
  zoom?: number;
};

export type TileflowOsmBasemapConfig = {
  type: 'osm';
  attribution?: string;
  glyphs?: string;
  sourceId?: string;
  sourceLayers?: TileflowSourceLayers;
  sprite?: string;
  tileset?: string;
  url?: string;
  version?: string;
};

export type TileflowBasemapConfig = TileflowOsmBasemapConfig;

export type TileflowOsmBasemapOptions = Omit<TileflowOsmBasemapConfig, 'type'>;

export type TileflowRoadDetail = 'none' | 'highways' | 'major' | 'streets' | 'all';
export type TileflowRoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'minor'
  | 'service'
  | 'track'
  | 'path';
export type TileflowRoadHierarchy = 'subtle' | 'clear' | 'strong';
export type TileflowRoadWeight = 'thin' | 'regular' | 'bold';
export type TileflowRoadOutline = 'none' | 'subtle' | 'strong';

export type TileflowRoadExtras = {
  ferry?: boolean;
  paths?: boolean;
  rail?: boolean;
};

export type TileflowRoadsModuleConfig = {
  type: 'roads';
  detail?: TileflowRoadDetail;
  extras?: TileflowRoadExtras;
  hierarchy?: TileflowRoadHierarchy;
  oneWayMarkers?: boolean;
  outline?: TileflowRoadOutline;
  weight?: TileflowRoadWeight;
  widthScale?: Partial<Record<TileflowRoadClass, number>>;
};

export type TileflowRoadsModuleOptions = Omit<TileflowRoadsModuleConfig, 'type'>;

export type TileflowLabelsModuleConfig = {
  type: 'labels';
  language?: TileflowLabelLanguage;
  places?: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads?: TileflowRoadLabelDetail;
  water?: TileflowLabelDetail;
};

export type TileflowLabelsModuleOptions = Omit<TileflowLabelsModuleConfig, 'type'>;

export type TileflowPoiModuleConfig = {
  type: 'poi';
  categories?: readonly TileflowPoiCategory[];
  classMapping?: TileflowPoiClassMapping;
  color?: TileflowPoiColorMode;
  density?: TileflowPoiDensity;
  icons?: TileflowPoiIcons;
  labels?: TileflowPoiLabels;
  minZoom?: number;
  placement?: {
    coupleIconAndLabel?: boolean;
    iconPadding?: number;
    textPadding?: number;
  };
  preset?: TileflowPoi;
};

export type TileflowPoiModuleOptions = Omit<TileflowPoiModuleConfig, 'type'>;

export type TileflowIconSetConfig = {
  extends?: string;
  mapping?: Record<string, string>;
  source?: string;
  sprite?: string;
};

export type TileflowIconSet = string | TileflowIconSetConfig;
export type TileflowProjectIconSets = Record<string, TileflowIconSet>;

export type MapLibreSprite =
  | string
  | Array<{
      id: string;
      url: string;
    }>;

export type TileflowStyleLayerOverride = Record<string, unknown> & {
  before?: string;
  filter?: unknown;
  layout?: Record<string, unknown>;
  maxzoom?: number;
  metadata?: Record<string, unknown>;
  minzoom?: number;
  paint?: Record<string, unknown>;
  source?: string;
  'source-layer'?: string;
  type?: string;
};

export type TileflowStyleOverrideModuleConfig = {
  type: 'styleOverride';
  layers?: Record<string, TileflowStyleLayerOverride>;
  removeLayers?: string[];
};

export type TileflowStyleOverrideOptions = Omit<TileflowStyleOverrideModuleConfig, 'type'>;

export type TileflowModuleConfig =
  | TileflowLabelsModuleConfig
  | TileflowPoiModuleConfig
  | TileflowRoadsModuleConfig
  | TileflowStyleOverrideModuleConfig;

export type TileflowConfig = {
  basemap?: TileflowBasemapConfig;
  name?: string;
  tileset?: string;
  theme?: TileflowTheme | string | TileflowThemeConfig;
  modules?: readonly TileflowModuleConfig[];
  layers?: Record<string, TileflowStyleLayerOverride>;
  colors?: TileflowColorConfig;
  typography?: TileflowTypography;
  density?: TileflowDensity;
  roads?: TileflowRoads;
  labels?: TileflowLabels;
  poi?: TileflowPoi;
  buildings?: TileflowBuildings;
  buildingStyle?: TileflowBuildingStyleConfig;
  terrain?: TileflowTerrain;
  renderer?: TileflowRenderer;
  glyphs?: string;
  icons?: TileflowIconSet;
  sprite?: string;
  tiles?: TileflowTiles;
  view?: TileflowViewConfig;
  /**
   * Domains allowed to load this map in production (e.g. "example.com" or
   * "*.example.com"). When set, tile and session requests from other
   * websites are rejected. Local development (localhost, private network
   * addresses) is always allowed. Leave unset to allow any domain.
   */
  allowedOrigins?: string[];
};

export type TileflowMapConfig = TileflowConfig;

export type TileflowTilesetConfig = {
  id?: string;
  name?: string;
  attribution?: string;
  sourceLayers?: TileflowSourceLayers;
  version?: string;
};

export type TileflowProjectThemes = Record<TileflowThemeName, TileflowThemeConfig>;

export type TileflowProjectConfig = {
  icons?: TileflowProjectIconSets;
  scenes?: Record<string, TileflowCaptureScene>;
  themes?: TileflowProjectThemes;
  tilesets?: Record<string, TileflowTilesetConfig>;
  maps: Record<string, TileflowMapConfig>;
};

export type TileflowStyleOptions = {
  iconSets?: TileflowProjectIconSets;
  themes?: TileflowProjectThemes;
  tileBaseUrl?: string;
  tileset?: string;
};

export type TileflowManifest = {
  version: 1;
  tileBaseUrl: string;
  styles: Record<string, string>;
  maps: Record<string, string>;
};

export type MapLibreStyle = {
  version: 8;
  name: string;
  glyphs?: string;
  sprite?: MapLibreSprite;
  sources: Record<string, Record<string, unknown>>;
  layers: Array<Record<string, unknown>>;
  terrain?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ValidationMessage = {
  level: 'error' | 'warning';
  path: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  messages: ValidationMessage[];
};

const defaultSourceLayers = {
  landcover: 'landcover',
  landuse: 'landuse',
  park: 'park',
  water: 'water',
  waterName: 'water_name',
  waterway: 'waterway',
  road: 'transportation',
  roadName: 'transportation_name',
  building: 'building',
  boundary: 'boundary',
  place: 'place',
  poi: 'poi',
} satisfies Required<TileflowSourceLayers>;

const defaultConfig = {
  density: 'balanced',
  roads: 'standard',
  labels: 'balanced',
  poi: 'minimal',
} satisfies Required<Pick<TileflowConfig, 'density' | 'roads' | 'labels' | 'poi'>>;

const defaultTileBaseUrl = 'https://api.tileflow.dev';
const defaultTileset = 'world';
const customIconSpriteId = 'tileflow';

export function createStyle(
  input: TileflowConfig = {},
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const parsed = configSchema.safeParse(input);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid Tileflow config. ${message}`);
  }

  const config = parsed.data as TileflowConfig;
  const basemap = config.basemap ?? osm();
  const theme = resolveTheme(config.theme, options.themes);
  const density = config.density ?? theme.preset.density ?? defaultConfig.density;
  const themeLayerOverrideModules: TileflowStyleOverrideModuleConfig[] =
    Object.keys(theme.layerOverrides).length > 0
      ? [
          {
            type: 'styleOverride',
            layers: theme.layerOverrides,
          },
        ]
      : [];
  const mapLayerOverrideModules: TileflowStyleOverrideModuleConfig[] = config.layers
    ? [
        {
          type: 'styleOverride',
          layers: config.layers,
        },
      ]
    : [];
  const styleOverrideModules = [
    ...themeLayerOverrideModules,
    ...mapLayerOverrideModules,
    ...(config.modules?.filter(
      (moduleConfig): moduleConfig is TileflowStyleOverrideModuleConfig =>
        moduleConfig.type === 'styleOverride',
    ) ?? []),
  ];
  const roadModule = config.modules?.find(
    (moduleConfig): moduleConfig is TileflowRoadsModuleConfig => moduleConfig.type === 'roads',
  );
  const labelsModule = config.modules?.find(
    (moduleConfig): moduleConfig is TileflowLabelsModuleConfig => moduleConfig.type === 'labels',
  );
  const poiModule = config.modules?.find(
    (moduleConfig): moduleConfig is TileflowPoiModuleConfig => moduleConfig.type === 'poi',
  );
  const resolvedRoads = resolveRoads(
    config.roads,
    roadModule,
    theme.preset.roads ?? defaultConfig.roads,
  );
  const {mode: resolvedRoadMode, ...resolvedRoadModule} = resolvedRoads;
  const resolvedRoadModuleMetadata = {
    detail: resolvedRoadModule.detail,
    extras: resolvedRoadModule.extras,
    hierarchy: resolvedRoadModule.hierarchy,
    outline: resolvedRoadModule.outline,
    weight: resolvedRoadModule.weight,
    ...(roadModule?.oneWayMarkers !== undefined
      ? {oneWayMarkers: resolvedRoadModule.oneWayMarkers}
      : {}),
    ...(roadModule?.widthScale ? {widthScale: resolvedRoadModule.widthScale} : {}),
  };
  const resolvedLabels = resolveLabels(
    config.labels,
    labelsModule,
    theme.preset.labels ?? defaultConfig.labels,
  );
  const {mode: resolvedLabelsMode, ...resolvedLabelsModule} = resolvedLabels;
  const resolvedPoi = resolvePoi(config.poi, poiModule, theme.preset.poi ?? defaultConfig.poi);
  const {mode: poi, ...resolvedPoiModule} = resolvedPoi;
  const labels = resolvedLabelsMode;
  const buildings = config.buildings ?? 'flat';
  const colors = resolveColors(config.colors, theme.colors, {}, theme.modules);
  const sourceId = config.tiles?.sourceId ?? basemap.sourceId ?? 'tileflow';
  const tileBaseUrl = normalizeBaseUrl(options.tileBaseUrl);
  const tileset =
    options.tileset ?? config.tileset ?? config.tiles?.tileset ?? basemap.tileset ?? defaultTileset;
  const tilesetVersion = config.tiles?.version ?? basemap.version;
  const tilesUrl = withArchiveVersion(
    config.tiles?.url ?? basemap.url ?? `${tileBaseUrl}/tiles/${tileset}/tiles.json`,
    tilesetVersion,
  );
  const typography = resolveTypography(config.typography, theme.typography);
  const terrain = resolveTerrain(config.terrain, tileBaseUrl);
  const rendererPreference = config.renderer ?? 'auto';
  const canUseOsmBrightTemplate = isOsmBrightTemplateCompatible(config, basemap, theme);
  const useOsmBrightTemplate =
    rendererPreference === 'osm-bright' ||
    (rendererPreference === 'auto' && canUseOsmBrightTemplate);

  if (rendererPreference === 'osm-bright' && !canUseOsmBrightTemplate) {
    throw new Error(
      'Tileflow renderer "osm-bright" is not compatible with this config. Use renderer "auto" or "generated", or remove map-level color overrides, density, legacy roads/buildings, custom source layers, and unsupported modules.',
    );
  }

  const glyphs = config.glyphs ?? basemap.glyphs ?? `${tileBaseUrl}/fonts/{fontstack}/{range}.pbf`;
  validateHostedTypography(typography, glyphs, tileBaseUrl);
  const iconSet = resolveIconSet(config.icons, options.iconSets);
  const iconSprite = iconSet?.sprite;
  const basemapSprite =
    basemap.sprite ??
    (basemap.type === 'osm' ? `${tileBaseUrl}/sprites/osm-bright/sprite` : undefined);
  const sprite = config.sprite ?? resolveSprite(basemapSprite, iconSprite);
  const customIconSpriteName = Array.isArray(sprite) && iconSprite ? customIconSpriteId : undefined;
  const attribution =
    config.tiles?.attribution ??
    basemap.attribution ??
    '© OpenMapTiles © OpenStreetMap contributors';
  const metadata = {
    'tileflow:basemap': basemap.type,
    'tileflow:theme': theme.name,
    'tileflow:themeMode': theme.mode,
    'tileflow:density': density,
    'tileflow:roads': resolvedRoadMode,
    ...(roadModule ? {'tileflow:roadsModule': resolvedRoadModuleMetadata} : {}),
    'tileflow:labels': labels,
    ...(labelsModule ? {'tileflow:labelsModule': resolvedLabelsModule} : {}),
    'tileflow:poi': poi,
    ...(poiModule ? {'tileflow:poiModule': resolvedPoiModule} : {}),
    ...(iconSet
      ? {
          'tileflow:icons': {
            ...(customIconSpriteName ? {customSpriteId: customIconSpriteName} : {}),
            ...(iconSet.mapping ? {mapping: iconSet.mapping} : {}),
            ...(iconSprite ? {sprite: iconSprite} : {}),
          },
        }
      : {}),
    'tileflow:buildings': buildings,
    ...(config.buildingStyle ? {'tileflow:buildingStyle': config.buildingStyle} : {}),
    'tileflow:modules': config.modules?.map((moduleConfig) => moduleConfig.type) ?? [],
    'tileflow:themeModules': Object.keys(theme.moduleOverrides),
    ...(terrain
      ? {
          'tileflow:terrain': {
            encoding: terrain.source.encoding,
            mode: terrain.mode,
            sourceId: terrain.sourceId,
          },
        }
      : {}),
    'tileflow:renderer': useOsmBrightTemplate ? 'osm-bright' : 'generated',
    'tileflow:rendererPreference': rendererPreference,
    'tileflow:typography': typographyMetadata(typography),
    'tileflow:colors': colors,
    'tileflow:tileBaseUrl': tileBaseUrl,
    'tileflow:tileset': tileset,
    ...(tilesetVersion ? {'tileflow:tilesetVersion': tilesetVersion} : {}),
    'tileflow:tiles': 'tileflow',
    ...(config.view ? {'tileflow:view': config.view} : {}),
  };

  if (useOsmBrightTemplate) {
    const style = createOsmBrightStyle({
      attribution,
      colors,
      glyphs,
      metadata,
      name: config.name ?? 'OSM Bright',
      sourceId,
      sprite,
      terrain,
      theme,
      tilesUrl,
      typography,
      typographyOverridden: Boolean(config.typography) || theme.typographyOverridden,
      labelsModule: resolvedLabels,
      poi,
      poiModule: resolvedPoi,
      roadsModule: roadModule ? resolvedRoads : undefined,
      customIconMapping: iconSet?.mapping,
      customIconSpriteId: customIconSpriteName,
    });

    return {
      ...style,
      layers: applyStyleOverrides(style.layers, styleOverrideModules),
    };
  }

  const sourceLayers = resolveSourceLayers(
    {
      ...defaultSourceLayers,
      ...basemap.sourceLayers,
      ...config.tiles?.sourceLayers,
    },
    undefined,
  );
  const layers = openMapTilesLayers(sourceId, sourceLayers, colors, {
    buildings,
    buildingStyle: config.buildingStyle,
    density,
    labels: resolvedLabels,
    poi: resolvedPoi,
    roads: resolvedRoads,
    typography,
    customIconMapping: iconSet?.mapping,
    customIconSpriteId: customIconSpriteName,
  });
  const terrainLayers = terrain ? withTerrainLayers(layers, terrain) : layers;
  const resolvedLayers = applyStyleOverrides(terrainLayers, styleOverrideModules);

  const style: MapLibreStyle = {
    version: 8,
    name: config.name ?? 'Tileflow',
    glyphs,
    ...(sprite ? {sprite} : {}),
    sources: {
      [sourceId]: {
        type: 'vector',
        url: tilesUrl,
        attribution,
      },
      ...(terrain
        ? {
            [terrain.sourceId]: terrain.source,
          }
        : {}),
    },
    layers: resolvedLayers,
    ...(terrain?.mode === '3d'
      ? {
          terrain: {
            exaggeration: terrain.exaggeration,
            source: terrain.sourceId,
          },
        }
      : {}),
    metadata,
  };

  return style;
}

export function createStyleFromProject<
  const TProject extends TileflowProjectConfig,
  const TMapName extends keyof TProject['maps'] & string,
>(projectConfig: TProject, mapName: TMapName, options?: TileflowStyleOptions): MapLibreStyle;

export function createStyleFromProject(
  projectConfig: TileflowProjectConfig,
  mapName: string,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const config = Object.hasOwn(projectConfig.maps, mapName)
    ? projectConfig.maps[mapName]
    : undefined;

  if (!config) {
    throw new Error(`Unknown Tileflow map: ${mapName}`);
  }

  const tilesetName =
    options.tileset ?? config.tileset ?? config.tiles?.tileset ?? config.basemap?.tileset;
  const tilesetConfig = tilesetName ? projectConfig.tilesets?.[tilesetName] : undefined;
  const resolvedTileset = tilesetConfig?.id ?? tilesetName ?? defaultTileset;
  const baseBasemap = config.basemap ?? osm();
  const {sourceLayers: tileSourceLayers, ...tileOptions} = config.tiles ?? {};
  const resolvedBasemapSourceLayers =
    baseBasemap.sourceLayers || tilesetConfig?.sourceLayers
      ? resolveSourceLayers(baseBasemap.sourceLayers, tilesetConfig?.sourceLayers)
      : undefined;
  const resolvedTileSourceLayers =
    baseBasemap.sourceLayers || !tileSourceLayers
      ? undefined
      : resolveSourceLayers(tileSourceLayers, tilesetConfig?.sourceLayers);

  return createStyle(
    {
      ...config,
      tileset: resolvedTileset,
      basemap: {
        ...baseBasemap,
        tileset: resolvedTileset,
        attribution: baseBasemap.attribution ?? tilesetConfig?.attribution,
        version: baseBasemap.version ?? tilesetConfig?.version,
        ...(resolvedBasemapSourceLayers ? {sourceLayers: resolvedBasemapSourceLayers} : {}),
      },
      tiles: {
        ...tileOptions,
        tileset: resolvedTileset,
        version: tileOptions.version ?? baseBasemap.version ?? tilesetConfig?.version,
        ...(resolvedTileSourceLayers ? {sourceLayers: resolvedTileSourceLayers} : {}),
      },
    },
    {
      ...options,
      iconSets: projectConfig.icons,
      themes: projectConfig.themes,
      tileset: resolvedTileset,
    },
  );
}

export function createManifest(
  projectConfig: TileflowProjectConfig,
  options: {styleBaseUrl?: string; tileBaseUrl?: string} = {},
): TileflowManifest {
  const styleBaseUrl = normalizeStyleBaseUrl(options.styleBaseUrl);
  const tileBaseUrl = normalizeBaseUrl(options.tileBaseUrl);
  const maps = Object.keys(projectConfig.maps);

  return {
    version: 1,
    tileBaseUrl,
    styles: Object.fromEntries(
      maps.map((mapName) => [mapName, `${styleBaseUrl}/styles/${mapName}.json`]),
    ),
    maps: Object.fromEntries(
      maps.map((mapName) => [mapName, `${styleBaseUrl}/styles/${mapName}.json`]),
    ),
  };
}

export function getDefaultColors(): TileflowColors {
  return getThemeDefaultColors();
}

function resolveSourceLayers(
  mapLayers: TileflowSourceLayers | undefined,
  tilesetLayers: TileflowSourceLayers | undefined,
): Required<TileflowSourceLayers> {
  return {
    ...defaultSourceLayers,
    ...tilesetLayers,
    ...mapLayers,
  };
}

function isOsmBrightTemplateCompatible(
  config: TileflowConfig,
  basemap: TileflowBasemapConfig,
  theme: ResolvedTileflowTheme,
): boolean {
  const templateTheme = theme.custom || theme.name === 'light' || theme.name === 'dark';

  return (
    basemap.type === 'osm' &&
    templateTheme &&
    !hasEffectiveColorOverrides(config.colors) &&
    !config.density &&
    !config.roads &&
    !config.buildings &&
    !config.buildingStyle &&
    !config.modules?.some(
      (moduleConfig) =>
        moduleConfig.type !== 'styleOverride' &&
        moduleConfig.type !== 'labels' &&
        moduleConfig.type !== 'poi' &&
        moduleConfig.type !== 'roads',
    ) &&
    !basemap.sourceLayers &&
    !config.tiles?.sourceLayers
  );
}

function hasEffectiveColorOverrides(colors: TileflowColorConfig | undefined): boolean {
  if (!colors) {
    return false;
  }

  return Object.entries(colors).some(([key, value]) => {
    if (key === 'accent' || value === undefined) {
      return false;
    }

    if (isRecord(value)) {
      return Object.values(value).some((nestedValue) => typeof nestedValue === 'string');
    }

    return typeof value === 'string';
  });
}

function typographyMetadata(typography: ResolvedTileflowTypography): TileflowTypography {
  const base = {
    font: typography.font,
    fontFamily: typography.fontFamily,
    weight: typography.weight,
  };

  return {
    ...base,
    ...(sameTypographyStyle(typography.places, base) ? {} : {places: typography.places}),
    ...(sameTypographyStyle(typography.roads, base) ? {} : {roads: typography.roads}),
    ...(sameTypographyStyle(typography.water, base) ? {} : {water: typography.water}),
    ...(sameTypographyStyle(typography.poi, base) ? {} : {poi: typography.poi}),
  };
}

function sameTypographyStyle(
  left: Required<TileflowTypographyStyle>,
  right: Required<TileflowTypographyStyle>,
): boolean {
  return (
    left.font === right.font && left.fontFamily === right.fontFamily && left.weight === right.weight
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBaseUrl(value: string | undefined): string {
  return normalizeUrl(value ?? defaultTileBaseUrl);
}

function normalizeStyleBaseUrl(value: string | undefined): string {
  return normalizeUrl(value ?? '');
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function withArchiveVersion(value: string, version: string | undefined): string {
  if (!version) return value;

  const url = new URL(value);
  url.searchParams.set('archiveVersion', version);
  return url.toString();
}

function resolveIconSet(
  icons: TileflowIconSet | undefined,
  iconSets: TileflowProjectIconSets | undefined,
  path: string[] = [],
): TileflowIconSetConfig | undefined {
  if (!icons) {
    return undefined;
  }

  if (typeof icons === 'string') {
    const referenced = iconSets?.[icons];

    if (referenced) {
      if (path.includes(icons)) {
        throw new Error(`Circular Tileflow icon set extends: ${[...path, icons].join(' -> ')}`);
      }

      return resolveIconSet(referenced, iconSets, [...path, icons]);
    }

    if (isSpriteReference(icons)) {
      return {sprite: icons};
    }

    return {source: icons};
  }

  const extended = icons.extends ? resolveIconSet(icons.extends, iconSets, path) : undefined;

  return {
    ...extended,
    ...icons,
    mapping: {
      ...extended?.mapping,
      ...icons.mapping,
    },
  };
}

function resolveSprite(
  basemapSprite: string | undefined,
  iconSprite: string | undefined,
): MapLibreSprite | undefined {
  if (!basemapSprite) {
    return iconSprite;
  }

  if (!iconSprite || iconSprite === basemapSprite) {
    return basemapSprite;
  }

  return [
    {id: 'default', url: basemapSprite},
    {id: customIconSpriteId, url: iconSprite},
  ];
}

function isSpriteReference(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    value.startsWith('data:')
  );
}

function validateHostedTypography(
  typography: ResolvedTileflowTypography,
  glyphs: string,
  tileBaseUrl: string,
): void {
  const hostedGlyphs = `${tileBaseUrl}/fonts/{fontstack}/{range}.pbf`;
  if (glyphs !== hostedGlyphs) return;

  for (const [domain, style] of [
    ['default', typography],
    ['places', typography.places],
    ['roads', typography.roads],
    ['water', typography.water],
    ['poi', typography.poi],
  ] as const) {
    if (
      style.font === 'Noto Sans' &&
      !tileflowHostedNotoSansWeights.includes(style.weight as TileflowHostedNotoSansWeight)
    ) {
      throw new Error(
        `Tileflow-hosted Noto Sans does not provide the ${style.weight} weight for ${domain} typography. Use regular or bold, or configure a custom glyphs URL that provides this font stack.`,
      );
    }
  }
}
