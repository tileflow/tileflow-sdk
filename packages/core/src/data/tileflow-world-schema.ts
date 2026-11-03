/*
 * Tileflow World schema, version 1: the layers, fields and values of Tileflow World vector tiles.
 *
 * The schema is dedicated to the public domain under CC0 1.0
 * (https://creativecommons.org/publicdomain/zero/1.0/). Using it needs no attribution. The data in
 * Tileflow World tiles keeps its own credits.
 */

export const tileflowWorldSchemaVersion = 1;

/**
 * Every layer of the schema by its camel-case key, the name the SDK uses for it, with its name in
 * the tiles. `world` carries what a general-purpose map draws; `world-detail` carries layers only
 * some maps use.
 */
export const tileflowWorldLayers = Object.freeze({
  admin: 'admin',
  aeroway: 'aeroway',
  airportLabel: 'airport_label',
  bathymetry: 'bathymetry',
  building: 'building',
  buildingEntrance: 'building_entrance',
  canopy: 'canopy',
  circularFeature: 'circular_feature',
  housenumLabel: 'housenum_label',
  landcover: 'landcover',
  landuse: 'landuse',
  landuseOverlay: 'landuse_overlay',
  naturalLabel: 'natural_label',
  placeLabel: 'place_label',
  poiLabel: 'poi_label',
  road: 'road',
  roadLabel: 'road_label',
  roadOutline: 'road_outline',
  roadShield: 'road_shield',
  sidewalk: 'sidewalk',
  streetFurniture: 'street_furniture',
  trafficControl: 'traffic_control',
  transitLine: 'transit_line',
  tree: 'tree',
  underground: 'underground',
  water: 'water',
  waterway: 'waterway',
} as const);

export type TileflowWorldLayerName = keyof typeof tileflowWorldLayers;

/** The tilesets of one World release. */
export const tileflowWorldTilesets = ['world', 'world-detail'] as const;
export type TileflowWorldTileset = (typeof tileflowWorldTilesets)[number];

/** Layers published in `world-detail` rather than `world`. */
export const tileflowWorldDetailLayers = Object.freeze([
  'buildingEntrance',
  'transitLine',
  'underground',
] as const satisfies readonly TileflowWorldLayerName[]);

export function tileflowWorldTilesetOf(layer: TileflowWorldLayerName): TileflowWorldTileset {
  return (tileflowWorldDetailLayers as readonly string[]).includes(layer) ? 'world-detail' : 'world';
}

/**
 * Every field the SDK reads by its camel-case key, with its name in the tiles. A key can name a
 * field on several layers: `class` is the class of a road, of a ground area and of a label.
 */
export const tileflowWorldFields = Object.freeze({
  access: 'access',
  activity: 'activity',
  adminLevel: 'admin_level',
  bathymetryMinDepth: 'min_depth',
  bathymetrySortKey: 'sort_key',
  bicycle: 'bicycle',
  canopyClearanceAtZoom15: 'clearance_px_z15',
  canopyCoverPercent: 'cover_pct',
  canopyRank: 'rank',
  capital: 'capital',
  circularClearanceExtraAtZoom15: 'clearance_extra_px_z15',
  circularInnerRadiusMeters: 'inner_radius_m',
  circularKind: 'circle_kind',
  circularOuterRadiusMeters: 'outer_radius_m',
  circularRadiusAtZoom15: 'radius_px_z15',
  circularRadiusMeters: 'radius_m',
  circumference: 'circumference',
  claimedBy: 'claimed_by',
  class: 'class',
  colour: 'colour',
  confidence: 'confidence',
  countryLeft: 'country_left',
  countryRight: 'country_right',
  covered: 'covered',
  crossing: 'crossing',
  diameterCrown: 'diameter_crown',
  direction: 'direction',
  disputed: 'disputed',
  elevation: 'ele',
  expressway: 'expressway',
  extrude: 'extrude',
  filterrank: 'filterrank',
  foot: 'foot',
  genus: 'genus',
  hasParts: 'has_parts',
  hedge: 'hedge',
  height: 'height',
  heightSource: 'height_source',
  horse: 'horse',
  houseNum: 'house_num',
  iata: 'iata',
  icao: 'icao',
  icon: 'icon',
  importanceTier: 'importance_tier',
  indoor: 'indoor',
  intermittent: 'intermittent',
  iso31661: 'iso_3166_1',
  landmarkId: 'landmark_id',
  layer: 'layer',
  leafCycle: 'leaf_cycle',
  leafType: 'leaf_type',
  level: 'level',
  levelMax: 'level_max',
  link: 'link',
  lit: 'lit',
  maritime: 'maritime',
  markings: 'markings',
  minHeight: 'min_height',
  minZoom: 'min_zoom',
  mode: 'mode',
  mtbScale: 'mtb_scale',
  name: 'name',
  nameLatin: 'name_latin',
  network: 'network',
  nightUse: 'night_use',
  official: 'official',
  oneway: 'oneway',
  operator: 'operator',
  ref: 'ref',
  reflen: 'reflen',
  service: 'service',
  shieldKind: 'shield_kind',
  shieldLineLengthMeters: 'shield_line_length_m',
  shieldNetwork: 'shield_network',
  shieldRank: 'shield_rank',
  shieldText: 'shield_text',
  shieldTextColor: 'shield_text_color',
  sizerank: 'sizerank',
  sortKey: 'sort_key',
  species: 'species',
  speciesWikidata: 'species_wikidata',
  structure: 'structure',
  surface: 'surface',
  symbolrank: 'symbolrank',
  toll: 'toll',
  tone: 'tone',
  type: 'type',
  underground: 'underground',
  use: 'use',
} as const);

export type TileflowWorldFieldName = keyof typeof tileflowWorldFields;

/** Name fields: the local name, a Latin-script name, and `name_<lang>` with a BCP 47 code. */
export const tileflowWorldNameLanguagePrefix = 'name_';

/**
 * Languages published at every zoom. From `tileflowWorldAllLanguagesMinZoom`, labels carry every
 * language World publishes. `name`, `name_latin` and the `*-Latn` variants are always present.
 */
export const tileflowWorldOverviewLanguages = Object.freeze([
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'vi',
  'zh',
  'zh-Hans',
  'zh-Hant',
] as const);

export const tileflowWorldAllLanguagesMinZoom = 12;

/** Values of the enumerated fields, by layer. */
export const tileflowWorldVocabularies = Object.freeze({
  airportLabel: Object.freeze({
    class: ['international', 'public', 'regional', 'military', 'private', 'other'],
  }),
  landcover: Object.freeze({class: ['barren', 'crop', 'grass', 'shrub', 'snow', 'trees', 'urban']}),
  landuse: Object.freeze({
    class: [
      'residential',
      'commercial',
      'retail',
      'industrial',
      'education',
      'hospital',
      'civic',
      'religious',
      'cemetery',
      'military',
      'railway',
      'parking',
      'park',
      'garden',
      'pitch',
      'playground',
      'golf',
      'recreation_ground',
      'village_green',
      'wood',
      'scrub',
      'grass',
      'meadow',
      'heath',
      'flowerbed',
      'farmland',
      'orchard',
      'vineyard',
      'sand',
      'beach',
      'rock',
      'ice',
    ],
  }),
  landuseOverlay: Object.freeze({class: ['protected_area', 'wetland', 'activity_area']}),
  naturalLabel: Object.freeze({
    class: [
      'peak',
      'volcano',
      'ocean',
      'sea',
      'bay',
      'strait',
      'lake',
      'reservoir',
      'river',
      'stream',
      'canal',
    ],
  }),
  placeLabel: Object.freeze({
    class: ['continent', 'country', 'state', 'settlement', 'settlement_subdivision', 'island'],
  }),
  road: Object.freeze({
    class: [
      'motorway',
      'trunk',
      'primary',
      'secondary',
      'tertiary',
      'street',
      'service',
      'track',
      'path',
      'pedestrian',
      'busway',
      'raceway',
      'construction',
      'rail',
      'transit',
      'aerialway',
      'ferry',
    ],
    structure: ['bridge', 'tunnel', 'ford'],
    surface: ['paved', 'unpaved'],
  }),
  water: Object.freeze({
    class: ['ocean', 'lake', 'river', 'reservoir', 'pond', 'basin', 'dock', 'swimming_pool'],
  }),
  waterway: Object.freeze({class: ['river', 'stream', 'canal', 'ditch', 'drain']}),
} as const);

/** Ground classes of `landuse` that are natural or agricultural cover rather than urban use. */
export const tileflowWorldNaturalLanduseClasses = Object.freeze([
  'wood',
  'scrub',
  'grass',
  'meadow',
  'heath',
  'flowerbed',
  'farmland',
  'orchard',
  'vineyard',
  'sand',
  'beach',
  'rock',
  'ice',
] as const);
