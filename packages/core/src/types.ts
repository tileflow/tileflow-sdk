import type {
  TileflowAreaStyle,
  TileflowCircleStyle,
  TileflowFillStyle,
  TileflowIconStyle,
  TileflowLineHatchStyle,
  TileflowLinePaint,
  TileflowLineStackStyle,
  TileflowLineStyle,
  TileflowMarkerSymbolStyle,
  TileflowNumberStyleValue,
  TileflowSymbolStyle,
} from './cartography/styles';
import type {
  TileflowThemeColorValue,
  TileflowThemeFontValue,
  TileflowThemeImageValue,
  TileflowThemeNumberValue,
} from './cartography/values';

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

export type TileflowPoiColorConfig = Partial<Record<TileflowPoiCategory, TileflowColor>> & {
  halo?: TileflowColor;
  icon?: TileflowColor;
  label?: TileflowColor;
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
  railway?: TileflowColor;
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

/** Internal compiler color groups populated from the resolved semantic token catalog. */
export type TileflowColorGroupsConfig = {
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

export type TileflowTerrainMode = 'none' | 'hillshade' | '3d';
export type TileflowTerrainEncoding = 'mapbox' | 'terrarium';
export type TileflowTerrainLayerRange = {
  maxZoom?: number;
  minZoom?: number;
  visible?: boolean;
};
export type TileflowTerrainHillshadeStyle = TileflowTerrainLayerRange & {
  accentColor?: TileflowThemeColorValue;
  exaggeration?: TileflowThemeNumberValue;
  highlightColor?: TileflowThemeColorValue;
  illuminationAnchor?: 'map' | 'viewport';
  illuminationDirection?: TileflowThemeNumberValue;
  shadowColor?: TileflowThemeColorValue;
};
export type TileflowTerrainContourLineStyle = TileflowTerrainLayerRange & {
  color?: TileflowThemeColorValue;
  opacity?: TileflowThemeNumberValue;
  width?: TileflowThemeNumberValue;
};
export type TileflowTerrainContourLabelStyle = TileflowTerrainLayerRange & {
  color?: TileflowThemeColorValue;
  font?: TileflowThemeFontValue;
  haloColor?: TileflowThemeColorValue;
  haloWidth?: TileflowThemeNumberValue;
  opacity?: TileflowThemeNumberValue;
  size?: TileflowThemeNumberValue;
  spacing?: TileflowThemeNumberValue;
};
export type TileflowTerrainContoursConfig = {
  /** Maximum native zoom exposed by the DEM tile template. */
  demMaxZoom: number;
  /**
   * HTTP(S) DEM template containing {z}, {x}, and {y}. Defaults to the hosted Tileflow Terrain
   * tiles, `{apiBaseUrl}/tiles/terrain/{z}/{x}/{y}.webp`, which follow the current release.
   */
  demUrl?: string;
  index?: TileflowTerrainContourLineStyle;
  labels?: TileflowTerrainContourLabelStyle;
  maxZoom?: number;
  minZoom?: number;
  minor?: TileflowTerrainContourLineStyle;
  multiplier?: number;
  overzoom?: number;
  sourceId?: string;
  /** Zoom-indexed [minor, index] elevation intervals. */
  thresholds: Readonly<Record<number, readonly [number, number]>>;
};
export type TileflowTerrainConfig = {
  /** Explicit DEM tile templates, mutually exclusive with the TileJSON url. */
  tiles?: readonly string[];
  /** Native DEM resolution limits, independent of hillshade visibility. */
  minZoom?: number;
  maxZoom?: number;
  /** Raster tile width in pixels. Defaults to the renderer default when omitted. */
  tileSize?: 256 | 512;
  attribution?: string;
  contours?: TileflowTerrainContoursConfig;
  encoding?: TileflowTerrainEncoding;
  exaggeration?: number;
  hillshade?: TileflowTerrainHillshadeStyle;
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
  widthScale?: TileflowThemeNumberValue;
};
export type TileflowRoadModifier =
  'construction' | 'expressway' | 'indoor' | 'official' | 'ramp' | 'unpaved';
export type TileflowRoadRestriction = 'access' | 'bicycle' | 'foot' | 'horse' | 'toll';
export type TileflowMountainBikeScale =
  '0' | '0+' | '1' | '1+' | '2' | '2+' | '3' | '3+' | '4' | '5' | '6';
export type TileflowRoadServiceType = 'alley' | 'crossover' | 'driveway' | 'parkingAisle' | 'yard';
export type TileflowRoadClassStyle = Partial<
  Record<TileflowRoadStructure, TileflowRoadLayerStyle>
> & {enabled?: boolean};
export type TileflowRoadAreaStyle = {
  pedestrian?: TileflowAreaStyle;
  pier?: TileflowAreaStyle;
  road?: TileflowAreaStyle;
};
export type TileflowRoadCrossingStyle = Omit<TileflowIconStyle, 'image'> &
  Required<Pick<TileflowIconStyle, 'image'>>;
export type TileflowRoadRoundaboutStyle = {
  /** Extra casing width in pixels, split equally across both edges; defaults to the road border. */
  borderWidth?: TileflowNumberStyleValue;
  casing?: TileflowCircleStyle;
  /** Road width in pixels when metric radii are absent; defaults to the effective surface fill width. */
  fallbackWidth?: TileflowNumberStyleValue;
  fill?: TileflowCircleStyle;
};
/**
 * How Core's street lights renderer lights the map's streets at night, from the lamps and lit
 * streets its data holds.
 */
export type TileflowRoadStreetLightStyle = {
  /** The light of lamps whose data gives no colour; a warm white by default. */
  color?: TileflowThemeColorValue;
  /** Whether the map has street lights; defaults to false. Set true to opt in. */
  enabled?: boolean;
  /**
   * Where light is estimated where the data maps no lamps: `lit` (the default) along streets and
   * pavements mapped as lit; `streets` also along streets the data says nothing about, in tiles
   * that map few lamps, which invents light; `none` nowhere.
   */
  estimate?: 'lit' | 'streets' | 'none';
  /** How bright the lights shine, from 0 to 2; defaults to 1. */
  intensity?: TileflowThemeNumberValue;
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
  extras?: TileflowRoadExtras;
  hierarchy?: TileflowRoadHierarchy;
  modifiers?: Partial<Record<TileflowRoadModifier, TileflowRoadTreatmentStyle>>;
  mountainBike?: Partial<Record<TileflowMountainBikeScale, TileflowRoadTreatmentStyle>>;
  oneWayMarkers?: boolean;
  outline?: TileflowRoadOutline;
  /** Draw ramp fills below receiving roads by default; `by-class` keeps their class's order. */
  rampOrder?: 'below-roads' | 'by-class';
  restrictions?: Partial<Record<TileflowRoadRestriction, TileflowRoadTreatmentStyle>>;
  roundabouts?: TileflowRoadRoundaboutStyle;
  serviceTypes?: Partial<Record<TileflowRoadServiceType, TileflowRoadTreatmentStyle>>;
  sidewalks?: TileflowRoadSidewalkStyle;
  streetLights?: TileflowRoadStreetLightStyle;
  structures?: Partial<Record<TileflowRoadStructure, TileflowRoadLayerStyle>>;
  weight?: TileflowRoadWeight;
  widthScale?: Partial<Record<TileflowRoadClass, TileflowThemeNumberValue>>;
};
export type TileflowRoadsModuleOptions = Omit<TileflowRoadsModuleConfig, 'type'>;

export type TileflowLabelDetail = 'none' | 'major' | 'all';
export type TileflowAerodromeCodeDetail = 'none' | 'iata' | 'all';
export type TileflowRoadLabelDetail = TileflowRoadDetail;
export type TileflowLabelLanguage = 'auto' | 'local' | 'en' | (string & {});
export type TileflowPlaceLabelClass =
  'city' | 'continent' | 'country' | 'neighborhood' | 'other' | 'state' | 'town' | 'village';
export type TileflowWaterLabelClass = 'line' | 'ocean' | 'other' | 'waterway';
export type TileflowRoadShieldDetail = 'none' | 'major' | 'all';
export type TileflowLabelCollisionPriority = 'balanced' | 'navigation';
export type TileflowRoadShieldStyles = {
  default?: TileflowSymbolStyle;
  detail?: TileflowSymbolStyle;
  kinds?: Record<string, {image: TileflowThemeImageValue}>;
  overview?: TileflowSymbolStyle;
  textColors?: Record<string, {color: TileflowThemeColorValue}>;
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
  collisionPriority?: TileflowLabelCollisionPriority;
  junctions?: boolean;
  language?: TileflowLabelLanguage;
  places?: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  /** Share placement and repeated-name suppression across compatible road classes. */
  roadGrouping?: 'class' | 'network';
  /** Abbreviate recognized road-type words without translating the selected label language. */
  roadNameFormat?: 'full' | 'compact';
  /**
   * Where street names draw. `foreground` (the default) keeps them above buildings and
   * vegetation. `ground` places them above flat footprints and below raised buildings,
   * with map-aligned text by default.
   * Ground names retain their road-class collision order, but foreground symbols are offered
   * first by the renderer; `collisionPriority` cannot make ground names outrank those symbols.
   * Shields and junction numbers keep their foreground placement.
   */
  roadPlacement?: 'ground' | 'foreground';
  /** Defaults to streets, including local street names where their geometry is enabled. */
  roads?: TileflowRoadLabelDetail;
  shields?: TileflowRoadShieldDetail;
  styles?: TileflowLabelStyles;
  water?: TileflowLabelDetail;
};
export type TileflowLabelsModuleOptions = Omit<TileflowLabelsModuleConfig, 'type'>;

/** Closed editorial vocabulary emitted by Tileflow World's canonical POI projection. */
export const tileflowPoiCategories = [
  'arts-entertainment',
  'education',
  'food-drink',
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
] as const;
export type TileflowPoiCategory = (typeof tileflowPoiCategories)[number];
export type TileflowPoiDensity = 1 | 2 | 3 | 4 | 5;
export type TileflowPoiColorMode = 'uniform' | 'category';
/**
 * How POI categories are placed against each other. `importance` places every category in one
 * order, by World's ranks. `categories` gives each category its own layer and places the
 * categories in the order they are listed, the first on top; ranks order each category only.
 */
export type TileflowPoiPlacementOrder = 'categories' | 'importance';
/**
 * The appearance of one POI category. With the default `importance` order every category shares
 * one placement layer, so categories may differ only in properties MapLibre evaluates per feature
 * (image, size, colors, font, offsets); layer-wide properties such as zoom ranges, padding,
 * overlap or `optional` must match, or the module uses `placement.order: 'categories'`.
 */
export type TileflowPoiCategoryStyle = Omit<TileflowMarkerSymbolStyle, 'priority'>;
export type TileflowPoiModuleConfig = {
  type: 'poi';
  categories?: readonly TileflowPoiCategory[];
  color?: TileflowPoiColorMode;
  /** Defaults to 2. World's ranks decide which features are eligible at each zoom. */
  density?: TileflowPoiDensity;
  /** Category overrides of density, with the same zoom-dependent detail allowance. */
  densityByCategory?: Partial<Record<TileflowPoiCategory, TileflowPoiDensity>>;
  /** Zoom for the second extra rank of POI detail. Must exceed 16; defaults to 17. */
  detailZoom?: number;
  icons?: boolean;
  labels?: boolean;
  minZoom?: number;
  placement?: {
    /**
     * Places each pictogram with its name as one unit that needs room for both. Defaults to
     * `true`. Use false to place pictograms and names independently.
     */
    coupleIconAndLabel?: boolean;
    iconPadding?: number;
    /**
     * World POI `type` values whose pictogram explains them. When pictograms and names are both
     * drawn, every other POI needs a name, and these types are drawn as a pictogram alone.
     * Defaults to parking and public toilets.
     */
    iconOnlyTypes?: readonly string[];
    /** Defaults to `importance`. */
    order?: TileflowPoiPlacementOrder;
    /**
     * With the `importance` order, POIs whose World `filter_rank` is at most this value are placed
     * before the map's road and place labels, and the others after them. A map that gives street
     * names priority over POIs (labels `collisionPriority: 'navigation'`) keeps its landmarks this
     * way. Unset, every POI is placed at the module's own position.
     */
    prominentRank?: 0 | 1 | 2 | 3 | 4 | 5;
    /** Collision margin around the name, in pixels. Defaults to 3. */
    textPadding?: number;
  };
  styles?: Partial<Record<TileflowPoiCategory, TileflowPoiCategoryStyle>>;
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
  sky?: Record<string, unknown>;
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
