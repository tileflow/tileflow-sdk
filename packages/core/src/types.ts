import type {
  TileflowFillStyle,
  TileflowIconStyle,
  TileflowLineStyle,
  TileflowTextStyle,
} from './cartography/styles';

export type TileflowColor = `#${string}`;
export type TileflowTheme = 'standard' | 'light' | 'dark' | 'minimal';
export type TileflowThemeName = string;
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
export type TileflowFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';
export const tileflowHostedNotoSansWeights = ['regular', 'bold'] as const;
export type TileflowHostedNotoSansWeight = (typeof tileflowHostedNotoSansWeights)[number];

export type TileflowTypographyStyle = {
  font?: string;
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

export type TileflowThemeConfig = {
  colors?: TileflowColorConfig;
  extends?: string;
  mode?: TileflowThemeMode;
  modules?: TileflowThemeModulesConfig;
  typography?: TileflowTypography;
};
export type TileflowProjectThemes = Record<TileflowThemeName, TileflowThemeConfig>;

export type TileflowIconSetConfig = {
  extends?: string;
  mapping?: Record<string, string>;
  source?: string;
  sprite?: string;
};
export type TileflowIconSet = string | TileflowIconSetConfig;
export type TileflowProjectIconSets = Record<string, TileflowIconSet>;

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
export type TileflowRoadLayerStyle = {
  casing?: TileflowLineStyle;
  fill?: TileflowLineStyle;
  shadow?: TileflowLineStyle;
};
export type TileflowRoadTreatmentLineStyle = {
  blur?: number;
  color?: string;
  dash?: readonly number[];
  gapWidth?: number;
  offset?: number;
  opacity?: number;
};
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
export type TileflowRoadModifier = 'construction' | 'ramp' | 'unpaved';
export type TileflowRoadRestriction = 'access' | 'bicycle' | 'foot' | 'horse';
export type TileflowRoadServiceType = 'alley' | 'crossover' | 'driveway' | 'parkingAisle' | 'yard';
export type TileflowRoadClassStyle = Partial<
  Record<TileflowRoadStructure, TileflowRoadLayerStyle>
> & {enabled?: boolean};
export type TileflowRoadAreaStyle = {
  pedestrian?: TileflowFillStyle;
  pier?: TileflowFillStyle;
  pierLine?: TileflowLineStyle;
  road?: TileflowFillStyle;
};
export type TileflowRoadsModuleConfig = {
  type: 'roads';
  areas?: TileflowRoadAreaStyle;
  classes?: Partial<Record<TileflowRoadClass, TileflowRoadClassStyle>>;
  detail?: TileflowRoadDetail;
  enabled?: boolean;
  extras?: TileflowRoadExtras;
  hierarchy?: TileflowRoadHierarchy;
  modifiers?: Partial<Record<TileflowRoadModifier, TileflowRoadTreatmentStyle>>;
  oneWayMarkers?: boolean;
  outline?: TileflowRoadOutline;
  restrictions?: Partial<Record<TileflowRoadRestriction, TileflowRoadTreatmentStyle>>;
  serviceTypes?: Partial<Record<TileflowRoadServiceType, TileflowRoadTreatmentStyle>>;
  structures?: Partial<Record<TileflowRoadStructure, TileflowRoadLayerStyle>>;
  weight?: TileflowRoadWeight;
  widthScale?: Partial<Record<TileflowRoadClass, number>>;
};
export type TileflowRoadsModuleOptions = Omit<TileflowRoadsModuleConfig, 'type'>;

export type TileflowLabelDetail = 'none' | 'major' | 'all';
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
export type TileflowLabelStyles = {
  aerodrome?: TileflowTextStyle;
  places?: Partial<Record<TileflowPlaceLabelClass, TileflowTextStyle>>;
  roads?: Partial<Record<TileflowRoadClass, TileflowTextStyle>>;
  shields?: TileflowTextStyle;
  water?: Partial<Record<TileflowWaterLabelClass, TileflowTextStyle>>;
};
export type TileflowLabelsModuleConfig = {
  type: 'labels';
  enabled?: boolean;
  language?: TileflowLabelLanguage;
  places?: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads?: TileflowRoadLabelDetail;
  styles?: TileflowLabelStyles;
  water?: TileflowLabelDetail;
};
export type TileflowLabelsModuleOptions = Omit<TileflowLabelsModuleConfig, 'type'>;

export type TileflowPoi = 'none' | 'minimal' | 'balanced' | 'full';
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
export type TileflowPoiCategoryStyle = {icon?: TileflowIconStyle; text?: TileflowTextStyle};
export type TileflowPoiModuleConfig = {
  type: 'poi';
  categories?: readonly TileflowPoiCategory[];
  classMapping?: TileflowPoiClassMapping;
  color?: TileflowPoiColorMode;
  density?: TileflowPoiDensity;
  enabled?: boolean;
  icons?: TileflowPoiIcons;
  labels?: TileflowPoiLabels;
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
export type ValidationResult = {valid: boolean; messages: ValidationMessage[]};
