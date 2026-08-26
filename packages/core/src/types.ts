import type {
  TileflowAreaStyle,
  TileflowCircleStyle,
  TileflowFillStyle,
  TileflowIconStyle,
  TileflowLineHatchStyle,
  TileflowLinePaint,
  TileflowLineStackStyle,
  TileflowLineStyle,
  TileflowSymbolStyle,
} from './cartography/styles';
import type {TileflowStyleValue, TileflowZoomValue} from './cartography/values';

export type TileflowColor = `#${string}`;
export type TileflowThemeMode = 'light' | 'dark';

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
  education?: TileflowColor;
  government?: TileflowColor;
  industrial?: TileflowColor;
  medical?: TileflowColor;
  military?: TileflowColor;
  parking?: TileflowColor;
  recreation?: TileflowColor;
  residential?: TileflowColor;
};

export type TileflowLandcoverColorConfig = {
  farmland?: TileflowColor;
  flowerbed?: TileflowColor;
  grass?: TileflowColor;
  ice?: TileflowColor;
  meadow?: TileflowColor;
  protected?: TileflowColor;
  recreationGround?: TileflowColor;
  rock?: TileflowColor;
  sand?: TileflowColor;
  scrub?: TileflowColor;
  urbanPark?: TileflowColor;
  villageGreen?: TileflowColor;
  wetland?: TileflowColor;
  wood?: TileflowColor;
};

export type TileflowHydroColorConfig = {
  ferry?: TileflowColor;
  label?: TileflowColor;
  water?: TileflowColor;
  waterway?: TileflowColor;
};

export type TileflowBuildingColorConfig = {
  active?: TileflowColor;
  businessCorridor?: TileflowColor;
  businessCorridorOutline?: TileflowColor;
  civic?: TileflowColor;
  commercial?: TileflowColor;
  destination?: TileflowColor;
  extrusion?: TileflowColor;
  fill?: TileflowColor;
  generic?: TileflowColor;
  highRise?: TileflowColor;
  highRiseOutline?: TileflowColor;
  industrial?: TileflowColor;
  lowRise?: TileflowColor;
  lowRiseOutline?: TileflowColor;
  outline?: TileflowColor;
  residential?: TileflowColor;
};

export type TileflowBoundaryColorConfig = {
  admin?: TileflowColor;
  disputed?: TileflowColor;
  major?: TileflowColor;
  maritime?: TileflowColor;
};

export type TileflowThemeModulesConfig = {
  boundaries?: TileflowBoundaryColorConfig;
  buildings?: TileflowBuildingColorConfig;
  hydro?: TileflowHydroColorConfig;
  labels?: TileflowLabelColorConfig;
  landcover?: TileflowLandcoverColorConfig;
  landuse?: TileflowLanduseColorConfig;
  poi?: TileflowPoiColorConfig;
  roads?: TileflowRoadColorConfig;
};

export type TileflowColorConfig = Partial<TileflowBaseColors> & {roadCasing?: TileflowColor};

export type TileflowColors = {[K in keyof TileflowBaseColors]: string};

export type TileflowTypographyStyle = {
  /** Ordered exact fallback face names; CSS generic families are allowed for local fonts. */
  fallbacks?: readonly string[];
  /** Exact OpenType full name or exact remote glyph face name. */
  font?: string;
  letterSpacing?: number;
  transform?: 'lowercase' | 'none' | 'uppercase';
};

export type TileflowTypographyDomain = 'places' | 'roads' | 'water' | 'poi';
export type TileflowTypography = TileflowTypographyStyle & {
  places?: TileflowTypographyStyle;
  roads?: TileflowTypographyStyle;
  water?: TileflowTypographyStyle;
  poi?: TileflowTypographyStyle;
};
export type ResolvedTileflowTypographyStyle = Required<Pick<TileflowTypographyStyle, 'font'>> &
  Omit<TileflowTypographyStyle, 'font'>;
export type ResolvedTileflowTypography = ResolvedTileflowTypographyStyle & {
  places: ResolvedTileflowTypographyStyle;
  roads: ResolvedTileflowTypographyStyle;
  water: ResolvedTileflowTypographyStyle;
  poi: ResolvedTileflowTypographyStyle;
};

export type TileflowThemeConfig = {
  colors?: TileflowColorConfig;
  mode?: TileflowThemeMode;
  modules?: TileflowThemeModulesConfig;
  typography?: TileflowTypography;
};

export type TileflowTerrainMode = 'none' | 'hillshade' | '3d';
export type TileflowTerrainEncoding = 'mapbox' | 'terrarium';
export type TileflowTerrainConfig = {
  attribution?: string;
  encoding?: TileflowTerrainEncoding;
  exaggeration?: number;
  mode?: TileflowTerrainMode;
  sourceId?: string;
  url?: string;
};
export type TileflowTerrain = TileflowTerrainMode | TileflowTerrainConfig;

export type TileflowViewConfig = {
  bearing?: number;
  center?: readonly [number, number];
  pitch?: number;
  zoom?: number;
};

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
  | 'pathway'
  | 'footway'
  | 'cycleway'
  | 'steps'
  | 'pedestrian';
export type TileflowRoadHierarchy = 'subtle' | 'clear' | 'strong';
export type TileflowRoadWeight = 'thin' | 'regular' | 'bold';
export type TileflowRoadOutline = 'none' | 'subtle' | 'strong';
export type TileflowRoadStructure = 'bridge' | 'surface' | 'tunnel';
export type TileflowRoadExtras = {paths?: boolean};
export type TileflowRoadLayerStyle = TileflowLineStackStyle & {
  hatch?: TileflowLineHatchStyle;
};
export type TileflowRoadTreatmentLineStyle = Pick<
  TileflowLinePaint,
  'blur' | 'color' | 'dash' | 'gapWidth' | 'offset' | 'opacity' | 'width'
>;
export type TileflowRoadTreatmentLayerStyle = {
  casing?: TileflowRoadTreatmentLineStyle;
  fill?: TileflowRoadTreatmentLineStyle;
  shadow?: TileflowRoadTreatmentLineStyle;
};
export type TileflowRoadTreatmentStyle = Partial<
  Record<TileflowRoadStructure, TileflowRoadTreatmentLayerStyle>
> & {
  enabled?: boolean;
  widthScale?: number;
};
export type TileflowRoadModifier =
  | 'construction'
  | 'expressway'
  | 'indoor'
  | 'official'
  | 'ramp'
  | 'unpaved';
export type TileflowRoadRestriction = 'access' | 'bicycle' | 'foot' | 'horse' | 'toll';
export type TileflowMountainBikeScale =
  | '0'
  | '0+'
  | '1'
  | '1+'
  | '2'
  | '2+'
  | '3'
  | '3+'
  | '4'
  | '5'
  | '6';
export type TileflowRoadServiceType = 'alley' | 'crossover' | 'driveway' | 'parkingAisle' | 'yard';
export type TileflowRoadClassStyle = Partial<
  Record<TileflowRoadStructure, TileflowRoadLayerStyle>
> & {enabled?: boolean};
export type TileflowRoadAreaStyle = {
  pedestrian?: TileflowAreaStyle;
  pier?: TileflowAreaStyle;
  road?: TileflowAreaStyle;
};
export type TileflowRoadCrossingStyle = Omit<TileflowIconStyle, 'image'> & {
  image: TileflowStyleValue<string>;
};
export type TileflowRoadRoundaboutStyle = {
  casing?: TileflowCircleStyle;
  fill?: TileflowCircleStyle;
};
export type TileflowRoadSidewalkStyle = {
  outline?: TileflowLineStyle;
  pattern?: TileflowFillStyle;
  surface?: TileflowFillStyle;
};
export type TileflowRoadsModuleConfig = {
  type: 'roads';
  areas?: TileflowRoadAreaStyle;
  classes?: Partial<Record<TileflowRoadClass, TileflowRoadClassStyle>>;
  crossings?: TileflowRoadCrossingStyle;
  detail?: TileflowRoadDetail;
  enabled?: boolean;
  extras?: TileflowRoadExtras;
  hierarchy?: TileflowRoadHierarchy;
  modifiers?: Partial<Record<TileflowRoadModifier, TileflowRoadTreatmentStyle>>;
  mountainBike?: Partial<Record<TileflowMountainBikeScale, TileflowRoadTreatmentStyle>>;
  oneWayMarkers?: boolean;
  outline?: TileflowRoadOutline;
  restrictions?: Partial<Record<TileflowRoadRestriction, TileflowRoadTreatmentStyle>>;
  roundabouts?: TileflowRoadRoundaboutStyle;
  serviceTypes?: Partial<Record<TileflowRoadServiceType, TileflowRoadTreatmentStyle>>;
  sidewalks?: TileflowRoadSidewalkStyle;
  structures?: Partial<Record<TileflowRoadStructure, TileflowRoadLayerStyle>>;
  weight?: TileflowRoadWeight;
  widthScale?: Partial<Record<TileflowRoadClass, number>>;
};
export type TileflowRoadsModuleOptions = Omit<TileflowRoadsModuleConfig, 'type'>;

export type TileflowLabelDetail = 'none' | 'major' | 'all';
export type TileflowAerodromeCodeDetail = 'none' | 'iata' | 'all';
export type TileflowRoadLabelDetail = TileflowRoadDetail;
export type TileflowLabelLanguage = 'auto' | 'local' | 'en' | (string & {});
export type TileflowPlaceLabelClass =
  | 'city'
  | 'continent'
  | 'country'
  | 'neighborhood'
  | 'other'
  | 'state'
  | 'town'
  | 'village';
export type TileflowWaterLabelClass = 'line' | 'ocean' | 'other' | 'waterway';
export type TileflowRoadShieldDetail = 'none' | 'major' | 'all';
export type TileflowRoadShieldStyles = {
  default?: TileflowSymbolStyle;
  networks?: Record<string, TileflowSymbolStyle>;
};
export type TileflowLabelStyles = {
  aerodrome?: TileflowSymbolStyle;
  junctions?: TileflowSymbolStyle;
  places?: Partial<Record<TileflowPlaceLabelClass, TileflowSymbolStyle>>;
  roads?: Partial<Record<TileflowRoadClass, TileflowSymbolStyle>>;
  shields?: TileflowRoadShieldStyles;
  water?: Partial<Record<TileflowWaterLabelClass, TileflowSymbolStyle>>;
};
export type TileflowLabelsModuleConfig = {
  type: 'labels';
  aerodromeCodes?: TileflowAerodromeCodeDetail;
  enabled?: boolean;
  junctions?: boolean;
  language?: TileflowLabelLanguage;
  places?: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads?: TileflowRoadLabelDetail;
  shields?: TileflowRoadShieldDetail;
  styles?: TileflowLabelStyles;
  water?: TileflowLabelDetail;
};
export type TileflowLabelsModuleOptions = Omit<TileflowLabelsModuleConfig, 'type'>;

export type TileflowPoi = 'none' | 'minimal' | 'balanced' | 'full';
export type TileflowPoiCategory =
  | 'food'
  | 'coffee'
  | 'culture'
  | 'major-transit'
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
export type TileflowPoiRankLimit = number | TileflowZoomValue<number>;
export type TileflowPoiCategoryStyle = TileflowSymbolStyle & {
  /** Inclusive OpenMapTiles importance-rank ceiling, optionally progressive by zoom. */
  maxRank?: TileflowPoiRankLimit;
};
export type TileflowPoiModuleConfig = {
  type: 'poi';
  categories?: readonly TileflowPoiCategory[];
  classMapping?: TileflowPoiClassMapping;
  color?: TileflowPoiColorMode;
  density?: TileflowPoiDensity;
  enabled?: boolean;
  icons?: TileflowPoiIcons;
  labels?: TileflowPoiLabels;
  /** Inclusive rank ceiling shared by every category unless that category overrides it. */
  maxRank?: TileflowPoiRankLimit;
  minZoom?: number;
  placement?: {
    coupleIconAndLabel?: boolean;
    iconPadding?: number;
    textPadding?: number;
  };
  preset?: TileflowPoi;
  styles?: Record<string, TileflowPoiCategoryStyle>;
};
export type TileflowPoiModuleOptions = Omit<TileflowPoiModuleConfig, 'type'>;

export type MapLibreSprite = string | Array<{id: string; url: string}>;
export type TileflowProjection = 'globe' | 'mercator';
export type TileflowLight = {
  anchor?: 'map' | 'viewport';
  color?: TileflowColor;
  intensity?: number;
  position?: readonly [number, number, number];
};
export type MapLibreStyle = {
  version: 8;
  name: string;
  glyphs?: string;
  light?: TileflowLight;
  projection?: {type: TileflowProjection};
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
export type ValidationResult = {valid: boolean; messages: ValidationMessage[]};
