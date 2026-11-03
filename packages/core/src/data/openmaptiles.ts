import type {
  TileflowDataAdapter,
  TileflowDataFieldAccessor,
  TileflowDataLayerPartition,
} from './binding';
import type {TileflowCoreDataFieldName, TileflowCoreDataLayerName} from './index';
import type {TileflowWorldFieldName, TileflowWorldLayerName} from './tileflow-world-schema';

export const openMapTilesContractVersion = 2;

export type ParkLayerSemantics = 'mixed' | 'protected-only';

/** The OpenMapTiles layers Tileflow reads, by the name of their content. */
export type OpenMapTilesLayerBindings = {
  aerodromeLabel: string;
  aeroway: string;
  boundary: string;
  building: string;
  houseNumber: string;
  landcover: string;
  landuse: string;
  mountainPeak: string;
  park: string;
  place: string;
  poi: string;
  road: string;
  roadName: string;
  water: string;
  waterName: string;
  waterway: string;
};

/** The OpenMapTiles fields Tileflow reads, by the name of their content. */
export type OpenMapTilesFieldBindings = {
  access: string;
  adminLevel: string;
  bicycle: string;
  brunnel: string;
  capital: string;
  claimedBy: string;
  class: string;
  disputed: string;
  elevation: string;
  expressway: string;
  foot: string;
  hide3d: string;
  horse: string;
  houseNumber: string;
  iata: string;
  icao: string;
  indoor: string;
  intermittent: string;
  iso: string;
  layer: string;
  level: string;
  maritime: string;
  mtbScale: string;
  name: string;
  nameEnglish: string;
  nameLatin: string;
  network: string;
  oneway: string;
  ramp: string;
  rank: string;
  ref: string;
  refLength: string;
  renderHeight: string;
  renderMinHeight: string;
  service: string;
  subclass: string;
  surface: string;
  toll: string;
};

export type OpenMapTilesSchemaOptions = {
  fields?: Partial<OpenMapTilesFieldBindings>;
  layers?: Partial<OpenMapTilesLayerBindings>;
  semantics?: {
    /** Whether the bound park layer mixes ordinary parks with protected areas. */
    parkLayer?: ParkLayerSemantics;
  };
};

/** Tiles following the OpenMapTiles schema, read through Tileflow World's layers and fields. */
export type OpenMapTilesSchema = {
  type: 'openmaptiles';
  contractVersion: typeof openMapTilesContractVersion;
  fields: OpenMapTilesFieldBindings;
  layers: OpenMapTilesLayerBindings;
  semantics: {
    parkLayer: ParkLayerSemantics;
  };
};

export const canonicalOpenMapTilesLayers = Object.freeze({
  aerodromeLabel: 'aerodrome_label',
  aeroway: 'aeroway',
  boundary: 'boundary',
  building: 'building',
  houseNumber: 'housenumber',
  landcover: 'landcover',
  landuse: 'landuse',
  mountainPeak: 'mountain_peak',
  park: 'park',
  place: 'place',
  poi: 'poi',
  road: 'transportation',
  roadName: 'transportation_name',
  water: 'water',
  waterName: 'water_name',
  waterway: 'waterway',
} as const satisfies OpenMapTilesLayerBindings);

export const canonicalOpenMapTilesFields = Object.freeze({
  access: 'access',
  adminLevel: 'admin_level',
  bicycle: 'bicycle',
  brunnel: 'brunnel',
  capital: 'capital',
  claimedBy: 'claimed_by',
  class: 'class',
  disputed: 'disputed',
  elevation: 'ele',
  expressway: 'expressway',
  foot: 'foot',
  hide3d: 'hide_3d',
  horse: 'horse',
  houseNumber: 'housenumber',
  iata: 'iata',
  icao: 'icao',
  indoor: 'indoor',
  intermittent: 'intermittent',
  iso: 'iso_a2',
  layer: 'layer',
  level: 'level',
  maritime: 'maritime',
  mtbScale: 'mtb_scale',
  name: 'name',
  nameEnglish: 'name:en',
  nameLatin: 'name:latin',
  network: 'network',
  oneway: 'oneway',
  ramp: 'ramp',
  rank: 'rank',
  ref: 'ref',
  refLength: 'ref_length',
  renderHeight: 'render_height',
  renderMinHeight: 'render_min_height',
  service: 'service',
  subclass: 'subclass',
  surface: 'surface',
  toll: 'toll',
} as const satisfies OpenMapTilesFieldBindings);

export function openMapTiles(options: OpenMapTilesSchemaOptions = {}): OpenMapTilesSchema {
  return {
    type: 'openmaptiles',
    contractVersion: openMapTilesContractVersion,
    fields: {...canonicalOpenMapTilesFields, ...options.fields},
    layers: {...canonicalOpenMapTilesLayers, ...options.layers},
    semantics: {parkLayer: options.semantics?.parkLayer ?? 'mixed'},
  };
}

export function isCanonicalOpenMapTilesSchema(schema: OpenMapTilesSchema): boolean {
  return (
    schema.semantics.parkLayer === 'mixed' &&
    Object.entries(canonicalOpenMapTilesLayers).every(
      ([key, value]) => schema.layers[key as keyof OpenMapTilesLayerBindings] === value,
    ) &&
    Object.entries(canonicalOpenMapTilesFields).every(
      ([key, value]) => schema.fields[key as keyof OpenMapTilesFieldBindings] === value,
    )
  );
}

const protectedParkClasses = [
  'national_park',
  'nature_reserve',
  'protected_area',
  'protected_landscape',
  'wilderness_area',
] as const;

const omtEducationClasses = ['school', 'university', 'college', 'kindergarten', 'library'];

const omtRoadConstructionClasses = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'path',
  'raceway',
] as const;

// The World classes OpenMapTiles' landuse and landcover produce through this adapter.
const omtLanduseClasses = [
  'bus_station',
  'cemetery',
  'commercial',
  'dam',
  'education',
  'garages',
  'hospital',
  'industrial',
  'military',
  'neighbourhood',
  'pitch',
  'playground',
  'quarry',
  'quarter',
  'railway',
  'residential',
  'retail',
  'suburb',
  'theme_park',
  'zoo',
];
const omtLandcoverClasses = [
  'beach',
  'farmland',
  'flowerbed',
  'garden',
  'grass',
  'heath',
  'ice',
  'meadow',
  'orchard',
  'park',
  'recreation_ground',
  'rock',
  'sand',
  'scrub',
  'village_green',
  'vineyard',
  'wood',
];

const omtSettlementClasses = ['city', 'town', 'village', 'hamlet', 'isolated_dwelling'];
const omtSubdivisionClasses = ['suburb', 'quarter', 'neighbourhood', 'borough'];

/**
 * Read OpenMapTiles tiles through Tileflow World's layers and fields. A World layer that
 * OpenMapTiles splits over several layers reads each of them; values that differ are translated.
 */
export function openMapTilesAdapter(schema: OpenMapTilesSchema): {
  adapter: TileflowDataAdapter;
  fields: Record<TileflowCoreDataFieldName, string> &
    Partial<Record<TileflowWorldFieldName, string>>;
  layers: Record<TileflowCoreDataLayerName, string> &
    Partial<Record<TileflowWorldLayerName, string>>;
} {
  const f = schema.fields;
  const l = schema.layers;
  const get = (name: string): unknown[] => ['get', name];
  const flag = (name: string): TileflowDataFieldAccessor => ({
    expression: ['==', ['to-number', get(name), 0], 1],
  });

  const roadClass = {
    expression: [
      'match',
      get(f.class),
      'minor',
      'street',
      omtRoadConstructionClasses.map((value) => `${value}_construction`),
      'construction',
      'bus_guideway',
      'busway',
      'path',
      ['match', get(f.subclass), 'pedestrian', 'pedestrian', 'path'],
      ['to-string', get(f.class)],
    ],
  };
  // A road under construction tells the class it is built as, as World does.
  const roadType = {
    expression: [
      'match',
      get(f.class),
      omtRoadConstructionClasses.map((value) => `${value}_construction`),
      [
        'match',
        get(f.class),
        'minor_construction',
        'street',
        ['slice', ['to-string', get(f.class)], 0, ['index-of', '_construction', get(f.class)]],
      ],
      get(f.subclass),
    ],
  };
  const roadFields = {
    class: roadClass,
    link: flag(f.ramp),
    // OpenMapTiles marks travel against the line with -1; World draws both the same way.
    oneway: {expression: ['!=', ['to-number', get(f.oneway), 0], 0]},
    structure: f.brunnel,
    type: roadType,
  } satisfies Partial<Record<TileflowWorldFieldName, TileflowDataFieldAccessor>>;

  const landcoverClass = {
    expression: [
      'match',
      get(f.subclass),
      ['park', 'garden', 'meadow', 'scrub', 'heath', 'recreation_ground', 'village_green'],
      get(f.subclass),
      'flowerbed',
      'flowerbed',
      ['orchard', 'vineyard'],
      get(f.subclass),
      'beach',
      'beach',
      ['forest', 'wood'],
      'wood',
      ['glacier', 'ice'],
      'ice',
      ['bare_rock', 'scree'],
      'rock',
      ['to-string', get(f.class)],
    ],
  };
  const landuseClass = {
    expression: [
      'match',
      get(f.class),
      omtEducationClasses,
      'education',
      ['clinic', 'doctors', 'hospital'],
      'hospital',
      ['stadium', 'track'],
      'pitch',
      ['to-string', get(f.class)],
    ],
  };
  const landusePartitions: TileflowDataLayerPartition[] = [
    {layer: l.landuse, classes: omtLanduseClasses, fields: {class: landuseClass, type: f.class}},
    {
      layer: l.landcover,
      filter: ['!=', get(f.class), 'wetland'],
      classes: omtLandcoverClasses,
      fields: {class: landcoverClass, type: f.subclass},
    },
    ...(schema.semantics.parkLayer === 'mixed'
      ? [
          {
            layer: l.park,
            filter: ['!', ['match', get(f.class), protectedParkClasses, true, false]],
            classes: ['park'],
            fields: {class: {expression: ['literal', 'park']}, type: f.class},
          } satisfies TileflowDataLayerPartition,
        ]
      : []),
  ];

  const overlayPartitions: TileflowDataLayerPartition[] = [
    {
      layer: l.park,
      ...(schema.semantics.parkLayer === 'mixed'
        ? {filter: ['match', get(f.class), protectedParkClasses, true, false]}
        : {}),
      classes: ['protected_area'],
      fields: {class: {expression: ['literal', 'protected_area']}, type: f.class},
    },
    {
      layer: l.landcover,
      filter: ['==', get(f.class), 'wetland'],
      classes: ['wetland'],
      fields: {type: f.subclass},
    },
  ];

  const naturalLabelPartitions: TileflowDataLayerPartition[] = [
    {
      layer: l.mountainPeak,
      classes: ['peak', 'volcano'],
      fields: {filterrank: f.rank, sizerank: f.rank},
    },
    {
      layer: l.waterName,
      classes: ['ocean', 'sea', 'bay', 'strait', 'lake', 'reservoir', 'river'],
      fields: {filterrank: f.rank, sizerank: f.rank, intermittent: flag(f.intermittent)},
    },
    {
      layer: l.waterway,
      filter: ['has', f.name],
      classes: ['river', 'stream', 'canal'],
      fields: {intermittent: flag(f.intermittent)},
    },
  ];

  const placeClass = {
    expression: [
      'match',
      get(f.class),
      omtSettlementClasses,
      'settlement',
      omtSubdivisionClasses,
      'settlement_subdivision',
      'province',
      'state',
      ['to-string', get(f.class)],
    ],
  };

  const layers = {
    admin: l.boundary,
    aeroway: l.aeroway,
    airportLabel: l.aerodromeLabel,
    building: l.building,
    housenumLabel: l.houseNumber,
    landuse: l.landuse,
    landuseOverlay: l.park,
    naturalLabel: l.waterName,
    placeLabel: l.place,
    poiLabel: l.poi,
    road: l.road,
    roadLabel: l.roadName,
    water: l.water,
    waterway: l.waterway,
  };

  return {
    adapter: {
      layers: {
        admin: [
          {
            layer: l.boundary,
            fields: {disputed: flag(f.disputed), maritime: flag(f.maritime)},
          },
        ],
        building: [
          {
            layer: l.building,
            fields: {
              extrude: {
                expression: [
                  '!',
                  ['match', ['to-string', get(f.hide3d)], ['true', '1'], true, false],
                ],
              },
            },
          },
        ],
        landuse: landusePartitions,
        landuseOverlay: overlayPartitions,
        naturalLabel: naturalLabelPartitions,
        placeLabel: [
          {
            layer: l.place,
            fields: {class: placeClass, symbolrank: f.rank, type: f.class},
          },
        ],
        poiLabel: [{layer: l.poi, fields: {filterrank: f.rank, type: f.subclass}}],
        road: [{layer: l.road, fields: roadFields}],
        roadLabel: [{layer: l.roadName, fields: roadFields}],
        water: [{layer: l.water, fields: {intermittent: flag(f.intermittent)}}],
        waterway: [{layer: l.waterway, fields: {intermittent: flag(f.intermittent)}}],
      },
    },
    fields: {
      access: f.access,
      adminLevel: f.adminLevel,
      bicycle: f.bicycle,
      capital: f.capital,
      claimedBy: f.claimedBy,
      class: f.class,
      disputed: f.disputed,
      elevation: f.elevation,
      expressway: f.expressway,
      // Inverted by the building layer below.
      extrude: f.hide3d,
      filterrank: f.rank,
      foot: f.foot,
      height: f.renderHeight,
      horse: f.horse,
      houseNum: f.houseNumber,
      iata: f.iata,
      icao: f.icao,
      indoor: f.indoor,
      intermittent: f.intermittent,
      iso31661: f.iso,
      layer: f.layer,
      level: f.level,
      link: f.ramp,
      maritime: f.maritime,
      minHeight: f.renderMinHeight,
      mtbScale: f.mtbScale,
      name: f.name,
      nameLatin: f.nameLatin,
      network: f.network,
      oneway: f.oneway,
      ref: f.ref,
      reflen: f.refLength,
      service: f.service,
      sizerank: f.rank,
      structure: f.brunnel,
      surface: f.surface,
      symbolrank: f.rank,
      toll: f.toll,
      type: f.subclass,
    },
    layers,
  };
}
