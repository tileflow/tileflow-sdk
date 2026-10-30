import {z} from 'zod';
import {dataReferenceSchema} from './data';

// Requests for the application's runtime style: its sources, layers, feature state and queries.
// Sources and layers use the MapLibre style specification's own names and values; the renderer
// validates them against the specification as MapLibre adds them, so a request that breaks it
// changes nothing. Application identifiers live in their own namespace: they never name, and can
// never collide with, the layers and sources of the map's own style.

const finite = z.number().finite();
/** An application source, layer or image name. */
export const styleIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
/** A layer of a vector tileset; tilesets name them freely. */
const sourceLayer = z.string().min(1).max(256);
/** Any JSON: expressions and property values, which MapLibre validates. */
const json = z.json();
const url = z.string().min(1).max(6144);
const zoom = finite.min(0).max(24);
const bounds = z.tuple([finite, finite, finite, finite]);
const tileLocation = {
  /** A TileJSON address. */
  url: url.optional(),
  /** Tile address templates. */
  tiles: z.array(url).min(1).max(16).optional(),
  bounds: bounds.optional(),
  scheme: z.enum(['xyz', 'tms']).optional(),
  minzoom: zoom.optional(),
  maxzoom: zoom.optional(),
  attribution: z.string().max(4096).optional(),
  volatile: z.boolean().optional(),
};
/** A tiled source names its tiles by TileJSON or by templates, never both. */
const located = (value: {url?: string; tiles?: string[]}) =>
  (value.url === undefined) !== (value.tiles === undefined);

export const geoJSONDataSchema = z.union([
  dataReferenceSchema,
  z.strictObject({url}),
  /** No data yet: features arrive with `updateGeoJSONSource`. */
  z.strictObject({empty: z.literal(true)}),
]);
export type GeoJSONData = z.infer<typeof geoJSONDataSchema>;

export const sourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('geojson'),
    data: geoJSONDataSchema,
    maxzoom: zoom.optional(),
    attribution: z.string().max(4096).optional(),
    buffer: z.number().int().min(0).max(512).optional(),
    filter: json.optional(),
    tolerance: finite.min(0).optional(),
    cluster: z.boolean().optional(),
    clusterRadius: finite.min(0).optional(),
    clusterMaxZoom: zoom.optional(),
    clusterMinPoints: z.number().int().min(2).optional(),
    clusterProperties: z
      .record(z.string().min(1).max(128), json)
      .refine((value) => Object.keys(value).length <= 64)
      .optional(),
    lineMetrics: z.boolean().optional(),
    generateId: z.boolean().optional(),
    promoteId: z.string().min(1).max(128).optional(),
  }),
  z
    .strictObject({
      type: z.literal('vector'),
      ...tileLocation,
      promoteId: z
        .union([z.string().min(1).max(128), z.record(sourceLayer, z.string().min(1).max(128))])
        .optional(),
      encoding: z.enum(['mvt', 'mlt']).optional(),
    })
    .refine(located),
  z
    .strictObject({
      type: z.literal('raster'),
      ...tileLocation,
      tileSize: z.number().int().min(64).max(1024).optional(),
    })
    .refine(located),
  z
    .strictObject({
      type: z.literal('raster-dem'),
      ...tileLocation,
      tileSize: z.number().int().min(64).max(1024).optional(),
      encoding: z.enum(['terrarium', 'mapbox', 'custom']).optional(),
      redFactor: finite.optional(),
      greenFactor: finite.optional(),
      blueFactor: finite.optional(),
      baseShift: finite.optional(),
    })
    .refine(located),
  z.strictObject({
    type: z.literal('image'),
    url,
    /** Top left, top right, bottom right and bottom left, as `[longitude, latitude]`. */
    coordinates: z.tuple([
      z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]),
      z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]),
      z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]),
      z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]),
    ]),
  }),
]);
export type StyleSource = z.infer<typeof sourceSchema>;

export const layerTypes = [
  'fill',
  'line',
  'symbol',
  'circle',
  'heatmap',
  'fill-extrusion',
  'raster',
  'hillshade',
  'color-relief',
  'background',
] as const;
const propertyName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const properties = z.record(propertyName, json).refine((value) => Object.keys(value).length <= 128);

export const layerSchema = z
  .strictObject({
    id: styleIdentifier,
    type: z.enum(layerTypes),
    /** An application source; a background layer has none. */
    source: styleIdentifier.optional(),
    'source-layer': sourceLayer.optional(),
    filter: json.optional(),
    minzoom: zoom.optional(),
    maxzoom: zoom.optional(),
    paint: properties.optional(),
    layout: properties.optional(),
  })
  .refine((layer) => (layer.type === 'background') === (layer.source === undefined));
export type StyleLayer = z.infer<typeof layerSchema>;

/**
 * Where a layer sits among the map's own layers: Core's overlay placements
 * (`tileflowOverlayPlacements`), which every Tileflow style resolves to its own layers in its
 * `tileflow:overlay-placement-manifest`. A layer without a slot lies above the whole map. Listed
 * here so the runtime does not bundle Core's authoring entry; a test keeps the lists equal.
 */
export const layerSlots = [
  'above-water',
  'below-roads',
  'above-roads',
  'above-buildings',
  'below-labels',
  'above-labels',
] as const;
export type LayerSlot = (typeof layerSlots)[number];
const slot = z.enum(layerSlots).optional();
/** Relative to another application layer, which also gives the layer its slot. */
const position = z
  .union([z.strictObject({above: styleIdentifier}), z.strictObject({below: styleIdentifier})])
  .optional();

/** A feature's identifier: a GeoJSON id, or a promoted property's value. */
const featureId = z.union([
  z.string().min(1).max(128),
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
]);
const featureStateValue = z.union([z.boolean(), finite, z.string().max(1024), z.null()]);
const featureTarget = {
  source: styleIdentifier,
  sourceLayer: sourceLayer.optional(),
};
const point = z.strictObject({
  x: finite.min(-32768).max(32768),
  y: finite.min(-32768).max(32768),
});
const queryLimit = z.number().int().min(1).max(100_000).default(1000);

export const addSourceSchema = z.strictObject({id: styleIdentifier, source: sourceSchema});
export const removeSourceSchema = z.strictObject({id: styleIdentifier});
export const setGeoJSONSourceDataSchema = z.strictObject({
  id: styleIdentifier,
  data: geoJSONDataSchema,
});
export const updateGeoJSONSourceSchema = z
  .strictObject({
    id: styleIdentifier,
    /** Features to add, or to replace where their identifier exists: a JSON array of features. */
    add: dataReferenceSchema.optional(),
    /** Identifiers of features to remove; removals apply before additions. */
    remove: z.array(featureId).max(1_000_000).optional(),
  })
  .refine((value) => value.add !== undefined || value.remove !== undefined);
export const addLayerSchema = z.strictObject({layer: layerSchema, slot, position});
export const updateLayerSchema = z.strictObject({layer: layerSchema, slot});
export const moveLayerSchema = z
  .strictObject({id: styleIdentifier, slot, position})
  .refine((value) => value.slot === undefined || value.position === undefined);
export const removeLayerSchema = z.strictObject({id: styleIdentifier});
export const setFeatureStateSchema = z.strictObject({
  ...featureTarget,
  id: featureId,
  state: z
    .record(z.string().min(1).max(128), featureStateValue)
    .refine((value) => Object.keys(value).length <= 64),
});
export const getFeatureStateSchema = z.strictObject({...featureTarget, id: featureId});
export const removeFeatureStateSchema = z
  .strictObject({
    ...featureTarget,
    id: featureId.optional(),
    key: z.string().min(1).max(128).optional(),
  })
  .refine((value) => value.key === undefined || value.id !== undefined);
export const queryRenderedFeaturesSchema = z.strictObject({
  /** A point, a box between two corners, or a polygon; none queries the whole view. */
  geometry: z
    .union([
      z.strictObject({point}),
      z.strictObject({box: z.tuple([point, point])}),
      z.strictObject({polygon: z.array(point).min(3).max(1024)}),
    ])
    .optional(),
  /** Application layers to query; none queries every application layer. */
  layers: z.array(styleIdentifier).max(1024).optional(),
  filter: json.optional(),
  limit: queryLimit,
});
export const querySourceFeaturesSchema = z.strictObject({
  source: styleIdentifier,
  sourceLayers: z.array(sourceLayer).min(1).max(64).optional(),
  filter: json.optional(),
  limit: queryLimit,
});
export const queryClusterSchema = z.strictObject({
  source: styleIdentifier,
  cluster: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  query: z.enum(['children', 'leaves', 'expansionZoom']),
  limit: z.number().int().min(1).max(100_000).default(10),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

export type AddLayerRequest = z.infer<typeof addLayerSchema>;
export type UpdateLayerRequest = z.infer<typeof updateLayerSchema>;
export type MoveLayerRequest = z.infer<typeof moveLayerSchema>;
export type UpdateGeoJSONSourceRequest = z.infer<typeof updateGeoJSONSourceSchema>;
export type SetFeatureStateRequest = z.infer<typeof setFeatureStateSchema>;
export type GetFeatureStateRequest = z.infer<typeof getFeatureStateSchema>;
export type RemoveFeatureStateRequest = z.infer<typeof removeFeatureStateSchema>;
export type QueryRenderedFeaturesRequest = z.infer<typeof queryRenderedFeaturesSchema>;
export type QuerySourceFeaturesRequest = z.infer<typeof querySourceFeaturesSchema>;
export type QueryClusterRequest = z.infer<typeof queryClusterSchema>;
