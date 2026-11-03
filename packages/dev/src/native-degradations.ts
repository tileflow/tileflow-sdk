import {
  type MapLibreStyle,
  readTileflowBuildings3D,
  readTileflowNauticalLights,
  readTileflowStreetLights,
  readTileflowVegetation3D,
  readTileflowVegetationDisplay,
  resolveTileflowVegetationRepresentation,
  steadyTileflowNauticalLights,
  tileflowBuildingsMetadataKey,
  tileflowSkyMetadataKey,
  tileflowStreetLightsMetadataKey,
  tileflowVegetationMetadataKey,
} from '@tileflow/core';
import {
  createTileflowNativeDegradation,
  normalizeTileflowNativeDegradations,
  type TileflowNativeDegradation,
  tileflowNativeDegradationsMetadataKey,
} from '@tileflow/core/native-profile';

type Json = Record<string, unknown>;
type Layer = Json & {id: string; type: string};

/** Thrown when a capability cannot be degraded without breaking what the map promises. */
export class NativeDegradationError extends Error {
  constructor(readonly path: string) {
    super('This map feature cannot be left out of the native representation.');
    this.name = 'NativeDegradationError';
  }
}

export type NativeDegradedStyle = Readonly<{
  style: MapLibreStyle;
  /** Input layer indexes left out, ascending. */
  removedLayers: number[];
  /** For each output layer, its input index, or -1 for a layer preparation added. */
  inputIndexes: number[];
  degradations: TileflowNativeDegradation[];
}>;

/**
 * Sources whose tiles Tileflow's browser runtime derives through a protocol. A record names the
 * source as its subject; the native style leaves the source and its layers out.
 */
const derivedSourceProtocols = [
  // Contour lines and labels generated from elevation tiles.
  {protocol: /^tileflow-contour:\/\//iu, feature: 'deviceContours'},
  // The green portions of paths, clipped to green ground; the complete ground-coloured paths
  // drawn below them remain.
  {protocol: /^tileflow-path-ground:\/\//iu, feature: 'pathGround'},
] as const;
/** Style metadata only Tileflow's browser 3D runtime reads; native styles do not carry it. */
const sceneMetadataKeys = [
  tileflowBuildingsMetadataKey,
  tileflowVegetationMetadataKey,
  tileflowStreetLightsMetadataKey,
  tileflowSkyMetadataKey,
];
/** World's building fields, as Core's 3D buildings read them. */
const heightField = 'render_height';
const baseField = 'render_min_height';
const hiddenField = 'hide_3d';
const defaultSceneMinzoom = 15;
const defaultBuildingEntrance = 0.3;

function object(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
}

/**
 * Leave out or replace what native maps cannot draw, recording each change, before the
 * representation lowering runs. The input is a compiled web style and is not modified.
 *
 * - Nautical lights shine steadily.
 * - Contour sources and the green path portions generated in the browser, and images embedded as
 *   data URIs, are removed with their layers.
 * - The 3D scene: building extrusion passes are shown, or one is generated from the buildings
 *   design; landmarks, building models, 3D trees and street lights are recorded and their
 *   metadata dropped.
 * - Terrain displacement is removed; a sky and a globe projection are recorded (the lowering
 *   removes and records them in the build record).
 * - `resampling` is removed from hillshade and colour-relief layers.
 * - Cooperative symbol overlap is recorded (the lowering replaces it).
 */
export function degradeTileflowNativeStyle(web: MapLibreStyle): NativeDegradedStyle {
  const degradations: TileflowNativeDegradation[] = [];
  const lights = readTileflowNauticalLights(web.metadata);
  const steady = steadyTileflowNauticalLights(web);
  const inputLayers = steady.layers as Layer[];
  if (lights) {
    const present = new Set(inputLayers.map((layer) => layer.id));
    degradations.push(
      createTileflowNativeDegradation('nauticalLightRhythm', {
        layers: lights.layers.filter((id) => present.has(id)),
      }),
    );
  }
  const metadata: Json = {...object(steady.metadata)};
  const sources: Json = {...object(steady.sources)};

  // Sources native maps cannot load, with every layer drawing them: tiles the browser derives
  // (contours, the green portions of paths) and images embedded as data URIs. Local builds write
  // embedded images as files first; a Hosted map has no file to serve them from.
  const removed = new Set<number>();
  for (const id of Object.keys(sources).sort()) {
    const source = object(sources[id]);
    const urls = [source?.url, ...(Array.isArray(source?.tiles) ? source.tiles : [])];
    const feature =
      derivedSourceProtocols.find(({protocol}) =>
        urls.some((url) => typeof url === 'string' && protocol.test(url)),
      )?.feature ??
      (source?.type === 'image' && typeof source.url === 'string' && /^data:/iu.test(source.url)
        ? 'embeddedImages'
        : undefined);
    if (!feature) continue;
    const layers = inputLayers.flatMap((layer, index) =>
      layer.source === id ? [{layer, index}] : [],
    );
    for (const {index} of layers) removed.add(index);
    delete sources[id];
    degradations.push(
      createTileflowNativeDegradation(feature, {
        subject: id,
        layers: layers.map(({layer}) => layer.id),
      }),
    );
  }
  for (const key of Object.keys(metadata))
    if (/^tileflow:contour/iu.test(key)) delete metadata[key];

  // Hillshade and colour relief keep drawing with the engine's own resampling.
  const resampled: string[] = [];
  let layers: Layer[] = inputLayers.map((layer, index) => {
    if (removed.has(index)) return layer;
    const paint = object(layer.paint);
    if (
      (layer.type === 'hillshade' || layer.type === 'color-relief') &&
      paint?.resampling !== undefined
    ) {
      resampled.push(layer.id);
      const {resampling: _resampling, ...rest} = paint;
      return {...layer, paint: rest};
    }
    return layer;
  });
  if (resampled.length)
    degradations.push(createTileflowNativeDegradation('reliefResampling', {layers: resampled}));

  const cooperative = layers.flatMap((layer, index) => {
    if (removed.has(index) || layer.type !== 'symbol') return [];
    const layout = object(layer.layout);
    return layout?.['icon-overlap'] === 'cooperative' || layout?.['text-overlap'] === 'cooperative'
      ? [layer.id]
      : [];
  });
  if (cooperative.length)
    degradations.push(createTileflowNativeDegradation('symbolOverlap', {layers: cooperative}));

  // The 3D scene: native maps show buildings as extrusions and nothing else of it.
  let inserted: {after: number; layer: Layer} | undefined;
  const buildings = readTileflowBuildings3D(metadata);
  if (buildings) {
    const passes = layers.flatMap((layer, index) =>
      !removed.has(index) &&
      layer.type === 'fill-extrusion' &&
      object(layer.metadata)?.['tileflow:3d-toggle'] === 'building'
        ? [index]
        : [],
    );
    if (passes.length) {
      for (const index of passes) layers[index] = shown(layers[index]!);
      degradations.push(
        createTileflowNativeDegradation('scene3d', {
          layers: passes.map((index) => layers[index]!.id),
        }),
      );
    } else {
      inserted = {
        after: extrusionPosition(layers, removed, buildings),
        layer: buildingExtrusion(layers, buildings),
      };
      degradations.push(createTileflowNativeDegradation('scene3d'));
    }
    if (buildings.landmarks || buildings.models?.length)
      degradations.push(createTileflowNativeDegradation('models3d'));
  }
  const vegetation = readTileflowVegetationDisplay(metadata);
  if (
    readTileflowVegetation3D(metadata) &&
    resolveTileflowVegetationRepresentation(vegetation, {supports3D: true, viewMode: '3d'}) === '3d'
  ) {
    const fallback = resolveTileflowVegetationRepresentation(vegetation, {
      supports3D: false,
      viewMode: '3d',
    });
    degradations.push(
      createTileflowNativeDegradation('trees3d', {fallback: fallback === 'flat' ? 'flat' : 'none'}),
    );
  }
  if (readTileflowStreetLights(metadata))
    degradations.push(createTileflowNativeDegradation('streetLights'));
  for (const key of sceneMetadataKeys) delete metadata[key];

  const root = steady as MapLibreStyle & {terrain?: unknown; sky?: unknown};
  if (root.terrain !== undefined) degradations.push(createTileflowNativeDegradation('terrain3d'));
  if (root.sky !== undefined) degradations.push(createTileflowNativeDegradation('sky'));
  if (object(root.projection)?.type === 'globe')
    degradations.push(createTileflowNativeDegradation('globe'));

  // Assemble the output layers and their input indexes.
  const output: Layer[] = [];
  const inputIndexes: number[] = [];
  if (inserted && inserted.after < 0) {
    output.push(inserted.layer);
    inputIndexes.push(-1);
  }
  for (const [index, layer] of layers.entries()) {
    if (!removed.has(index)) {
      output.push(layer);
      inputIndexes.push(index);
    }
    if (inserted && inserted.after === index) {
      output.push(inserted.layer);
      inputIndexes.push(-1);
    }
  }
  layers = output;
  const records = normalizeTileflowNativeDegradations(degradations);
  metadata[tileflowNativeDegradationsMetadataKey] = records;
  rebindReferences(metadata, inputLayers, removed, layers);

  const {terrain: _terrain, ...rest} = root;
  const style = {...rest, sources, layers, metadata} as MapLibreStyle;
  return {
    style,
    removedLayers: [...removed].sort((a, b) => a - b),
    inputIndexes,
    degradations: records,
  };
}

function shown(layer: Layer): Layer {
  const layout = object(layer.layout);
  if (layout?.visibility !== 'none') return layer;
  const {visibility: _visibility, ...rest} = layout;
  return Object.keys(rest).length
    ? {...layer, layout: rest}
    : (Object.fromEntries(Object.entries(layer).filter(([key]) => key !== 'layout')) as Layer);
}

/** Above the map's own building layers and below their labels; else below the first symbol. */
function extrusionPosition(
  layers: readonly Layer[],
  removed: ReadonlySet<number>,
  buildings: NonNullable<ReturnType<typeof readTileflowBuildings3D>>,
): number {
  let last = -1;
  for (const [index, layer] of layers.entries()) {
    if (removed.has(index) || layer.type === 'symbol') continue;
    if (layer.source === buildings.source && layer['source-layer'] === buildings.layers.building)
      last = index;
  }
  if (last >= 0) return last;
  const symbol = layers.findIndex((layer, index) => !removed.has(index) && layer.type === 'symbol');
  return symbol >= 0 ? symbol - 1 : layers.length - 1;
}

/** The plain extrusion Core's 3D buildings stand in for: same source, colour and entrance. */
function buildingExtrusion(
  layers: readonly Layer[],
  buildings: NonNullable<ReturnType<typeof readTileflowBuildings3D>>,
): Layer {
  const ids = new Set(layers.map((layer) => layer.id));
  let id = 'tileflow-buildings-native-extrusion';
  for (let suffix = 1; ids.has(id); suffix++) id = `tileflow-buildings-native-extrusion-${suffix}`;
  const entrance = buildings.entrance;
  const [from, to] = (entrance && entrance.buildings) || [
    defaultSceneMinzoom,
    defaultSceneMinzoom + defaultBuildingEntrance,
  ];
  const height = ['max', 0, ['to-number', ['coalesce', ['get', heightField], 5], 5]];
  const base = ['max', 0, ['min', ['to-number', ['coalesce', ['get', baseField], 0], 0], height]];
  // As on the web: `entrance: false` or an empty band shows the buildings whole from `from`.
  const rise = (value: unknown) =>
    entrance !== false && to > from
      ? ['interpolate', ['linear'], ['zoom'], from, 0, to, value]
      : value;
  return {
    id,
    type: 'fill-extrusion',
    source: buildings.source,
    'source-layer': buildings.layers.building,
    minzoom: from,
    filter: [
      'all',
      ['!=', ['get', hiddenField], true],
      ['!=', ['get', hiddenField], 1],
      ['!=', ['get', hiddenField], '1'],
    ],
    paint: {
      'fill-extrusion-base': rise(base),
      'fill-extrusion-color': buildings.color,
      'fill-extrusion-height': rise(height),
      'fill-extrusion-opacity': rise(1),
      'fill-extrusion-vertical-gradient': buildings.verticalGradient,
    },
    metadata: {'tileflow:3d-toggle': 'building', 'tileflow:domain': 'buildings'},
  };
}

/**
 * Layer references in metadata follow the output layers: POI priorities become their layer's new
 * index; an overlay anchor on a removed layer moves to the next layer that remains. A POI layer
 * cannot be removed.
 */
function rebindReferences(
  metadata: Json,
  input: readonly Layer[],
  removed: ReadonlySet<number>,
  output: readonly Layer[],
): void {
  if (!removed.size && output.length === input.length) return;
  const indexes = new Map(output.map((layer, index) => [layer.id, index]));
  const interactions = object(metadata['tileflow:interaction-manifest']);
  const domains = object(interactions?.domains);
  const poi = object(domains?.poi);
  if (interactions && domains && poi && Array.isArray(poi.layers)) {
    const layers = poi.layers.map((entry) => {
      const value = object(entry);
      const index = typeof value?.layerId === 'string' ? indexes.get(value.layerId) : undefined;
      if (!value || index === undefined)
        throw new NativeDegradationError('/metadata/tileflow:interaction-manifest');
      return {...value, priority: index};
    });
    metadata['tileflow:interaction-manifest'] = {
      ...interactions,
      domains: {...domains, poi: {...poi, layers}},
    };
  }
  const overlays = object(metadata['tileflow:overlay-placement-manifest']);
  const anchors = object(overlays?.anchors);
  if (overlays && anchors) {
    const next = (anchor: unknown): unknown => {
      if (typeof anchor !== 'string' || indexes.has(anchor)) return anchor;
      const start = input.findIndex((layer) => layer.id === anchor);
      if (start < 0) return anchor;
      for (let index = start + 1; index < input.length; index++)
        if (!removed.has(index)) return input[index]!.id;
      return null;
    };
    metadata['tileflow:overlay-placement-manifest'] = {
      ...overlays,
      anchors: Object.fromEntries(
        Object.entries(anchors).map(([placement, anchor]) => [placement, next(anchor)]),
      ),
    };
  }
}
