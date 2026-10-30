import type {DataReference} from './data';
import {type FeatureCollection, featuresProblem, geoJSONProblem} from './geojson';
import {ProtocolError} from './protocol';
import {
  type AddLayerRequest,
  type GeoJSONData,
  type GetFeatureStateRequest,
  type LayerSlot,
  layerSlots,
  type MoveLayerRequest,
  type QueryClusterRequest,
  type QueryRenderedFeaturesRequest,
  type QuerySourceFeaturesRequest,
  type RemoveFeatureStateRequest,
  type SetFeatureStateRequest,
  type StyleLayer,
  type StyleSource,
  type UpdateGeoJSONSourceRequest,
  type UpdateLayerRequest,
} from './style-contract';

// The application's runtime style: its sources, layers and feature state, kept apart from the
// map's own style. The registry holds what the application asked for and puts it back after
// every style change, such as a theme change, which replaces the map's style. Requests apply in
// the order they arrive, each once the style can take it, and a request MapLibre refuses changes
// nothing.

export const maximumSources = 256;
export const maximumLayers = 1024;
const sourcePrefix = '__tileflow_source_';
const layerPrefix = '__tileflow_layer_';
/** Layers of `setContent`, which keep their own place; the order check looks past them. */
const contentPrefix = '__tileflow_app_';
const placementManifest = 'tileflow:overlay-placement-manifest';
const sceneSlotIndex = layerSlots.indexOf('above-buildings');

type Point = {x: number; y: number};
type Feature = FeatureCollection['features'][number];
type FeatureId = string | number;
type StateValue = boolean | number | string | null;
type Listener = (event?: unknown) => void;
type QueriedFeature = {
  id?: FeatureId;
  source: string;
  sourceLayer?: string;
  layer?: {id: string};
  geometry?: unknown;
  properties?: Record<string, unknown> | null;
  state?: Record<string, unknown>;
};
type ClusterSource = {
  getClusterChildren(cluster: number): Promise<unknown[]>;
  getClusterLeaves(cluster: number, limit: number, offset: number): Promise<unknown[]>;
  getClusterExpansionZoom(cluster: number): Promise<number>;
};
type GeoJSONSourceHandle = Partial<ClusterSource> & {
  setData(data: unknown): unknown;
  updateData(diff: {remove?: FeatureId[]; add?: Feature[]}): unknown;
};

/** The MapLibre capabilities the registry uses; tests pass their own. */
export type StyleMap = {
  addSource(id: string, source: unknown): unknown;
  getSource(id: string): unknown;
  removeSource(id: string): unknown;
  addLayer(layer: unknown, beforeId?: string): unknown;
  getLayer(id: string): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
  setFilter(layer: string, filter: unknown): unknown;
  setLayerZoomRange(layer: string, minzoom: number, maxzoom: number): unknown;
  getLayersOrder(): string[];
  getStyle(): unknown;
  setFeatureState(
    target: {source: string; sourceLayer?: string; id: FeatureId},
    state: unknown,
  ): unknown;
  removeFeatureState(
    target: {source: string; sourceLayer?: string; id?: FeatureId},
    key?: string,
  ): unknown;
  queryRenderedFeatures(geometry: unknown, options: unknown): QueriedFeature[];
  querySourceFeatures(source: string, options: unknown): QueriedFeature[];
  getCanvas(): {clientWidth: number; clientHeight: number};
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  /** MapLibre's style, for polygon queries and its loaded state. */
  style?: {
    _loaded?: boolean;
    queryRenderedFeatures?(geometry: Point[], options: unknown, transform: unknown): unknown;
  };
  /** MapLibre's camera transform; tests set `transform` directly. */
  _camera?: {transform?: Transform};
  transform?: Transform;
};
type Transform = {pitch: number; cameraToCenterDistance: number; centerPoint: {y: number}};

type SourceEntry = {
  id: string;
  spec: StyleSource;
  /** Inline or emptied GeoJSON, as the source last received it. */
  collection?: FeatureCollection;
  /** Features by identifier, once the application updates them one by one. */
  features?: Map<FeatureId, Feature>;
};
type LayerEntry = {layer: StyleLayer; slot?: LayerSlot};

const internalSource = (id: string) => `${sourcePrefix}${id}`;
const internalLayer = (id: string) => `${layerPrefix}${id}`;
const external = (id: string) =>
  id.startsWith(layerPrefix)
    ? id.slice(layerPrefix.length)
    : id.startsWith(sourcePrefix)
      ? id.slice(sourcePrefix.length)
      : undefined;
const invalid = (message: string, reason?: 'invalidGeoJSON' | 'unknownLayer' | 'unknownSource') =>
  new ProtocolError('invalidRequest', message, reason ? {reason} : undefined);
const empty = (): FeatureCollection => ({type: 'FeatureCollection', features: []});
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** MapLibre's messages name internal identifiers; the application knows its own. */
const clean = (message: string) =>
  message.replaceAll(layerPrefix, '').replaceAll(sourcePrefix, '').slice(0, 1024);

/**
 * A feature identifier as MapLibre keys feature state: tiles carry numeric identifiers, so a
 * numeric string means its number; other strings are promoted property values.
 */
export function featureStateId(id: FeatureId): FeatureId {
  return typeof id === 'string' && /^(0|[1-9][0-9]{0,15})$/u.test(id) && Number.isSafeInteger(+id)
    ? Number(id)
    : id;
}

/** The pitch from which rendered queries run in horizontal bands. */
export const steepPitch = 60;
/** The height of a query band in CSS pixels. */
export const bandHeight = 64;

/** Clips a closed polygon to the horizontal band from `top` to `bottom`; undefined when empty. */
export function clipBand(
  polygon: readonly Point[],
  top: number,
  bottom: number,
): Point[] | undefined {
  let ring = polygon.slice(0, -1);
  for (const [limit, inside] of [
    [top, (point: Point) => point.y >= top],
    [bottom, (point: Point) => point.y <= bottom],
  ] as const) {
    const clipped: Point[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index]!;
      const next = ring[(index + 1) % ring.length]!;
      if (inside(current)) clipped.push(current);
      if (inside(current) !== inside(next)) {
        const share = (limit - current.y) / (next.y - current.y);
        clipped.push({x: current.x + (next.x - current.x) * share, y: limit});
      }
    }
    ring = clipped;
    if (ring.length < 3) return undefined;
  }
  return [...ring, ring[0]!];
}

/** A closed polygon cut into horizontal bands, top to bottom. */
export function bands(polygon: readonly Point[], height: number): Point[][] {
  const ys = polygon.map((point) => point.y);
  const output: Point[][] = [];
  for (let top = Math.min(...ys); top < Math.max(...ys); top += height) {
    const band = clipBand(polygon, top, Math.min(top + height, Math.max(...ys)));
    if (band) output.push(band);
  }
  return output.length > 0 ? output : [[...polygon]];
}

export function createStyleRegistry(
  map: StyleMap,
  input: {
    /** Reads and parses JSON the host registered on the data channel. */
    readJSON: (reference: DataReference, signal: AbortSignal) => Promise<unknown>;
    warn: (message: string) => void;
  },
) {
  const sources = new Map<string, SourceEntry>();
  /** Application layers in the order the application arranged them, bottom to top. */
  let layers: LayerEntry[] = [];
  /** Feature state by source and source layer, then by feature. */
  const states = new Map<string, Map<FeatureId, Record<string, StateValue>>>();
  let anchors: Partial<Record<LayerSlot, string | null>> | undefined;
  let disposed = false;
  let capturing = false;
  let orderStale = false;
  let tail: Promise<unknown> = Promise.resolve();

  const transform = () => map._camera?.transform ?? map.transform;
  const stateKey = (source: string, sourceLayer?: string) => `${source}\n${sourceLayer ?? ''}`;
  const styleLoaded = () => map.style?._loaded !== false;

  /** Runs a MapLibre change, failing with MapLibre's own message when it refuses it. */
  function apply<T>(run: () => T): T {
    const errors: string[] = [];
    const listener: Listener = (event) => {
      const error = (event as {error?: unknown} | undefined)?.error;
      errors.push(error instanceof Error ? error.message : String(error ?? 'Refused.'));
    };
    map.on('error', listener);
    capturing = true;
    let result: T;
    try {
      result = run();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'The map refused the change.');
    } finally {
      capturing = false;
      map.off('error', listener);
    }
    if (errors.length > 0) throw invalid(clean(errors[0]!));
    return result!;
  }

  /** Requests apply one at a time, in order, once the style can take them. */
  function serial<T>(signal: AbortSignal, run: () => Promise<T> | T): Promise<T> {
    const next = tail.then(async () => {
      if (disposed) throw new ProtocolError('disposed', 'The map is disposed.');
      signal.throwIfAborted();
      await styleReady(signal);
      return run();
    });
    tail = next.catch(() => undefined);
    return next;
  }

  function styleReady(signal: AbortSignal): Promise<void> {
    if (styleLoaded()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        map.off('style.load', done);
        signal.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => {
        map.off('style.load', done);
        reject(new ProtocolError('cancelled', 'The request was cancelled.'));
      };
      map.on('style.load', done);
      signal.addEventListener('abort', stop, {once: true});
    });
  }

  function readAnchors() {
    const style = map.getStyle() as
      {layers?: {id: string; type?: string}[]; metadata?: Record<string, unknown>} | undefined;
    const manifest = style?.metadata?.[placementManifest] as
      {anchors?: Record<string, unknown>} | undefined;
    if (manifest?.anchors && typeof manifest.anchors === 'object') {
      anchors = Object.fromEntries(
        layerSlots.map((slot) => {
          const anchor = manifest.anchors![slot];
          return [slot, typeof anchor === 'string' ? anchor : null];
        }),
      );
      return;
    }
    // A style without Tileflow's placements: every slot but the top lies under its labels.
    const labels = style?.layers?.find((layer) => layer.type === 'symbol')?.id ?? null;
    anchors = Object.fromEntries(
      layerSlots.map((slot) => [slot, slot === 'above-labels' ? null : labels]),
    );
  }

  const slotIndex = (entry: LayerEntry) =>
    entry.slot === undefined ? layerSlots.length : layerSlots.indexOf(entry.slot);
  /** The map layer a layer's slot sits under; undefined means the top of the map. */
  function anchorOf(entry: LayerEntry): string | undefined {
    if (entry.slot === undefined) return undefined;
    if (!anchors) readAnchors();
    const anchor = anchors?.[entry.slot];
    return anchor && map.getLayer(anchor) ? anchor : undefined;
  }
  /** The application's layers bottom to top: by slot, then as the application arranged them. */
  const sorted = () =>
    layers
      .map((entry, index) => ({entry, index}))
      .sort((a, b) => slotIndex(a.entry) - slotIndex(b.entry) || a.index - b.index)
      .map(({entry}) => entry);
  /** The layer that `entry` goes under: the next application layer of its slot group, or its anchor. */
  function beforeIdOf(entry: LayerEntry): string | undefined {
    const order = sorted();
    const anchor = anchorOf(entry);
    for (const other of order.slice(order.indexOf(entry) + 1)) {
      const id = internalLayer(other.layer.id);
      if (anchorOf(other) === anchor && map.getLayer(id)) return id;
    }
    return anchor;
  }

  function sourceSpec(entry: SourceEntry): unknown {
    if (entry.spec.type !== 'geojson') return entry.spec;
    const data = entry.features
      ? {type: 'FeatureCollection', features: [...entry.features.values()]}
      : 'url' in entry.spec.data
        ? entry.spec.data.url
        : (entry.collection ?? empty());
    return {...entry.spec, data};
  }
  function layerSpec(entry: LayerEntry): unknown {
    const {source, ...layer} = entry.layer;
    return {
      ...layer,
      id: internalLayer(layer.id),
      ...(source === undefined ? {} : {source: internalSource(source)}),
    };
  }
  function addToMap(entry: LayerEntry) {
    apply(() => map.addLayer(layerSpec(entry), beforeIdOf(entry)));
    // MapLibre reports some refusals without throwing; a layer that is not there failed.
    if (!map.getLayer(internalLayer(entry.layer.id)))
      throw invalid(`Layer ${entry.layer.id} was refused.`);
  }
  function applyStates(source: string) {
    for (const [key, features] of states) {
      const [owner, sourceLayer] = key.split('\n') as [string, string];
      if (owner !== source) continue;
      for (const [id, state] of features)
        map.setFeatureState(
          {source: internalSource(source), ...(sourceLayer ? {sourceLayer} : {}), id},
          state,
        );
    }
  }

  /**
   * Puts back what a style change dropped, in order: sources with their current data, layers in
   * their slots, and feature state. Runs in the style's load event, before it draws.
   */
  function restore() {
    if (disposed) return;
    readAnchors();
    for (const entry of sources.values()) {
      if (map.getSource(internalSource(entry.id))) continue;
      try {
        apply(() => map.addSource(internalSource(entry.id), sourceSpec(entry)));
        applyStates(entry.id);
      } catch {
        input.warn(`Application source ${entry.id} could not be restored.`);
      }
    }
    for (const entry of sorted()) {
      if (map.getLayer(internalLayer(entry.layer.id))) continue;
      try {
        addToMap(entry);
      } catch {
        input.warn(`Application layer ${entry.layer.id} could not be restored.`);
      }
    }
    orderStale = true;
  }

  /**
   * Keeps each slot group in order under its anchor, and the slots from `aboveBuildings` up above
   * the 3D layers the map adds under the same anchor later, such as its buildings. Runs when the
   * map settles after another part of the map changed its layers.
   */
  function ensureOrder() {
    if (disposed || !orderStale || layers.length === 0) return;
    orderStale = false;
    const order = map.getLayersOrder().filter((id) => !id.startsWith(contentPrefix));
    const index = new Map(order.map((id, position) => [id, position]));
    const groups = new Map<string | undefined, LayerEntry[]>();
    for (const entry of sorted()) {
      if (!index.has(internalLayer(entry.layer.id))) continue;
      const anchor = anchorOf(entry);
      groups.set(anchor, [...(groups.get(anchor) ?? []), entry]);
    }
    for (const [anchor, group] of groups) {
      const limit = anchor === undefined ? order.length : index.get(anchor)!;
      const positions = group.map((entry) => index.get(internalLayer(entry.layer.id))!);
      let floor = -1;
      if (group.some((entry) => slotIndex(entry) >= sceneSlotIndex))
        for (let position = 0; position < limit; position += 1) {
          const layer = map.getLayer(order[position]!) as
            | {type?: string; renderingMode?: string; implementation?: {renderingMode?: string}}
            | undefined;
          const mode = layer?.renderingMode ?? layer?.implementation?.renderingMode;
          if (
            !order[position]!.startsWith(layerPrefix) &&
            (layer?.type === 'fill-extrusion' || (layer?.type === 'custom' && mode === '3d'))
          )
            floor = position;
        }
      const ordered = positions.every(
        (position, at) => position < limit && (at === 0 || position > positions[at - 1]!),
      );
      if (ordered && positions[0]! > floor) continue;
      for (const entry of group)
        try {
          map.moveLayer(internalLayer(entry.layer.id), anchor);
        } catch {
          // The style is changing; the next settled frame checks again.
          orderStale = true;
        }
    }
  }

  const onStyleLoad = () => restore();
  const onStyleData = () => {
    if (!capturing) orderStale = true;
  };
  const onIdle = () => ensureOrder();
  map.on('style.load', onStyleLoad);
  map.on('styledata', onStyleData);
  map.on('idle', onIdle);

  function requireSource(id: string): SourceEntry {
    const entry = sources.get(id);
    if (!entry) throw invalid(`The map holds no application source ${id}.`, 'unknownSource');
    return entry;
  }
  function requireLayer(id: string): LayerEntry {
    const entry = layers.find((candidate) => candidate.layer.id === id);
    if (!entry) throw invalid(`The map holds no application layer ${id}.`, 'unknownLayer');
    return entry;
  }
  function requireGeoJSON(id: string) {
    const entry = requireSource(id);
    if (entry.spec.type !== 'geojson') throw invalid(`Source ${id} is not a GeoJSON source.`);
    return entry as SourceEntry & {spec: Extract<StyleSource, {type: 'geojson'}>};
  }
  function geoJSONSource(id: string): GeoJSONSourceHandle {
    return map.getSource(internalSource(id)) as GeoJSONSourceHandle;
  }

  async function readCollection(data: GeoJSONData, signal: AbortSignal) {
    if (!('id' in data)) return undefined;
    const value = await input.readJSON(data, signal);
    const problem = geoJSONProblem(value);
    if (problem !== undefined) throw invalid(`GeoJSON is invalid at ${problem}.`, 'invalidGeoJSON');
    return value as FeatureCollection;
  }

  /** The identifier MapLibre keys a GeoJSON feature by. */
  const keyOf = (entry: SourceEntry, feature: Feature): FeatureId | undefined => {
    const promoteId = entry.spec.type === 'geojson' ? entry.spec.promoteId : undefined;
    const id = promoteId ? feature.properties?.[promoteId] : feature.id;
    return typeof id === 'string' || typeof id === 'number' ? id : undefined;
  };
  /** A removal names a feature by string; it may be keyed by its number. */
  const resolveKey = (features: Map<FeatureId, Feature>, id: FeatureId) => {
    if (features.has(id)) return id;
    const other = typeof id === 'string' ? featureStateId(id) : String(id);
    return features.has(other) ? other : undefined;
  };
  function indexFeatures(entry: SourceEntry): Map<FeatureId, Feature> {
    if (entry.features) return entry.features;
    const features = new Map<FeatureId, Feature>();
    for (const feature of entry.collection?.features ?? []) {
      const key = keyOf(entry, feature);
      if (key === undefined || features.has(key))
        throw invalid(
          `Source ${entry.id} needs a unique identifier on every feature to update features one by one.`,
        );
      features.set(key, feature);
    }
    entry.features = features;
    return features;
  }

  function wireFeature(feature: QueriedFeature) {
    const source = external(feature.source);
    const layer = feature.layer ? external(feature.layer.id) : undefined;
    return {
      id: feature.id ?? null,
      ...(source === undefined ? {} : {source}),
      ...(feature.sourceLayer ? {sourceLayer: feature.sourceLayer} : {}),
      ...(layer === undefined ? {} : {layer}),
      geometry: feature.geometry ?? null,
      properties: feature.properties ?? {},
      state: feature.state ?? {},
    };
  }
  /** A cluster query answers plain GeoJSON features of the source. */
  const wireClusterFeature = (source: string) => (feature: unknown) => {
    const value = feature as {id?: FeatureId; geometry?: unknown; properties?: unknown};
    return {
      id: value.id ?? null,
      source,
      geometry: value.geometry ?? null,
      properties: value.properties ?? {},
      state: {},
    };
  };

  function renderedGeometry(request: QueryRenderedFeaturesRequest): Point[] | undefined {
    const canvas = map.getCanvas();
    const geometry = request.geometry;
    if (geometry && 'point' in geometry) return [geometry.point];
    let ring: Point[];
    if (geometry && 'polygon' in geometry) {
      ring = [...geometry.polygon];
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first.x !== last.x || first.y !== last.y) ring.push(first);
    } else {
      const [a, b] = geometry
        ? geometry.box
        : [
            {x: 0, y: 0},
            {x: canvas.clientWidth, y: canvas.clientHeight},
          ];
      const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [upper, lower] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      ring = [
        {x: left, y: upper},
        {x: right, y: upper},
        {x: right, y: lower},
        {x: left, y: lower},
        {x: left, y: upper},
      ];
    }
    // Core's horizon correction keeps every geometry working at steep pitches, including parts
    // above the horizon, so the query is not clipped to the ground.
    return ring;
  }

  /** A feature of an inline GeoJSON source, by the identifier MapLibre keys it by. */
  function storedFeature(sourceId: string, id: FeatureId) {
    const entry = sources.get(sourceId);
    if (!entry || entry.spec.type !== 'geojson' || 'url' in entry.spec.data) return undefined;
    try {
      const features = indexFeatures(entry);
      const key = resolveKey(features, id);
      return key === undefined ? undefined : {entry, features, key, feature: features.get(key)!};
    } catch {
      return undefined;
    }
  }

  return {
    /** Whether the registry is applying a change, whose refusal it reports itself. */
    get capturing() {
      return capturing;
    },
    /**
     * Features of the given application layers within `tolerance` CSS pixels of a point, topmost
     * first, at once and outside the request order: taps and drags need the frame on screen.
     */
    hitTest(point: Point, layerIds: readonly string[], tolerance: number) {
      if (disposed || !styleLoaded()) return [];
      const shown = layerIds.map(internalLayer).filter((id) => map.getLayer(id));
      if (shown.length === 0) return [];
      let features: QueriedFeature[];
      try {
        features = map.queryRenderedFeatures(
          [
            [point.x - tolerance, point.y - tolerance],
            [point.x + tolerance, point.y + tolerance],
          ],
          {layers: shown},
        );
      } catch {
        return [];
      }
      return features.flatMap((feature) => {
        const layer = feature.layer ? external(feature.layer.id) : undefined;
        const source = external(feature.source);
        if (layer === undefined || source === undefined || feature.id === undefined) return [];
        return [{layer, source, id: feature.id, properties: feature.properties ?? {}}];
      });
    },
    /** The geometry an inline GeoJSON source holds for a feature, as the application sent it. */
    featureGeometry(sourceId: string, id: FeatureId): Feature['geometry'] | undefined {
      return storedFeature(sourceId, id)?.feature.geometry;
    },
    /**
     * Moves a feature of an inline GeoJSON source at once, for a drag. The source keeps the new
     * geometry, so a style change restores the feature where it was dragged.
     */
    moveFeature(sourceId: string, id: FeatureId, geometry: Feature['geometry']): boolean {
      if (disposed || !styleLoaded()) return false;
      const stored = storedFeature(sourceId, id);
      if (!stored) return false;
      const moved = {...stored.feature, geometry} as Feature;
      try {
        apply(() => geoJSONSource(sourceId).updateData({add: [moved]}));
      } catch {
        return false;
      }
      stored.features.set(stored.key, moved);
      return true;
    },
    addSource(request: {id: string; source: StyleSource}, signal: AbortSignal) {
      return serial(signal, async () => {
        if (sources.has(request.id))
          throw invalid(`The map already holds an application source ${request.id}.`);
        if (sources.size >= maximumSources)
          throw invalid(`The map holds at most ${maximumSources} application sources.`);
        const collection =
          request.source.type === 'geojson'
            ? await readCollection(request.source.data, signal)
            : undefined;
        signal.throwIfAborted();
        if (sources.has(request.id))
          throw invalid(`The map already holds an application source ${request.id}.`);
        const entry: SourceEntry = {
          id: request.id,
          spec: request.source,
          ...(collection ? {collection} : {}),
        };
        apply(() => map.addSource(internalSource(request.id), sourceSpec(entry)));
        sources.set(request.id, entry);
        return null;
      });
    },
    removeSource(request: {id: string}, signal: AbortSignal) {
      return serial(signal, () => {
        requireSource(request.id);
        const users = layers.filter((entry) => entry.layer.source === request.id);
        if (users.length > 0)
          throw invalid(
            `Source ${request.id} is used by ${users.map((entry) => entry.layer.id).join(', ')}.`,
          );
        if (map.getSource(internalSource(request.id)))
          apply(() => map.removeSource(internalSource(request.id)));
        sources.delete(request.id);
        for (const key of [...states.keys()])
          if (key.startsWith(`${request.id}\n`)) states.delete(key);
        return null;
      });
    },
    setGeoJSONSourceData(request: {id: string; data: GeoJSONData}, signal: AbortSignal) {
      return serial(signal, async () => {
        requireGeoJSON(request.id);
        const collection = await readCollection(request.data, signal);
        signal.throwIfAborted();
        const entry = requireGeoJSON(request.id);
        const spec = {...entry.spec, data: request.data};
        const next: SourceEntry = {id: entry.id, spec, ...(collection ? {collection} : {})};
        const data = sourceSpec(next) as {data: unknown};
        apply(() => geoJSONSource(entry.id).setData(data.data));
        sources.set(entry.id, next);
        return null;
      });
    },
    updateGeoJSONSource(request: UpdateGeoJSONSourceRequest, signal: AbortSignal) {
      return serial(signal, async () => {
        const entry = requireGeoJSON(request.id);
        if ('url' in entry.spec.data)
          throw invalid(
            `Source ${request.id} loads its data from an address; set its data instead.`,
          );
        let added: Feature[] = [];
        if (request.add) {
          const value = await input.readJSON(request.add, signal);
          const problem = featuresProblem(value);
          if (problem !== undefined)
            throw invalid(`Features are invalid at ${problem}.`, 'invalidGeoJSON');
          added = value as Feature[];
        }
        signal.throwIfAborted();
        const current = requireGeoJSON(request.id);
        const features = indexFeatures(current);
        const keys = added.map((feature) => keyOf(current, feature));
        if (keys.some((key) => key === undefined) || new Set(keys).size !== keys.length)
          throw invalid('Each added feature needs a unique identifier.');
        const removed = (request.remove ?? [])
          .map((id) => resolveKey(features, id))
          .filter((key): key is FeatureId => key !== undefined);
        apply(() =>
          geoJSONSource(current.id).updateData({
            ...(removed.length ? {remove: removed} : {}),
            ...(added.length ? {add: added} : {}),
          }),
        );
        for (const key of removed) features.delete(key);
        added.forEach((feature, index) => features.set(keys[index]!, feature));
        return null;
      });
    },
    addLayer(request: AddLayerRequest, signal: AbortSignal) {
      return serial(signal, () => {
        const {layer, position} = request;
        if (layers.some((entry) => entry.layer.id === layer.id))
          throw invalid(`The map already holds an application layer ${layer.id}.`);
        if (layers.length >= maximumLayers)
          throw invalid(`The map holds at most ${maximumLayers} application layers.`);
        if (layer.source !== undefined) requireSource(layer.source);
        const reference = position
          ? requireLayer('above' in position ? position.above : position.below)
          : undefined;
        const entry: LayerEntry = {layer, slot: reference ? reference.slot : request.slot};
        const previous = layers;
        const at = reference
          ? layers.indexOf(reference) + (position && 'above' in position ? 1 : 0)
          : layers.length;
        layers = [...layers.slice(0, at), entry, ...layers.slice(at)];
        try {
          addToMap(entry);
        } catch (error) {
          layers = previous;
          if (map.getLayer(internalLayer(layer.id))) map.removeLayer(internalLayer(layer.id));
          throw error;
        }
        return null;
      });
    },
    updateLayer(request: UpdateLayerRequest, signal: AbortSignal) {
      return serial(signal, () => {
        const current = requireLayer(request.layer.id);
        if (request.layer.source !== undefined) requireSource(request.layer.source);
        const next: LayerEntry = {layer: request.layer, slot: request.slot};
        const id = internalLayer(next.layer.id);
        const index = layers.indexOf(current);
        const replace = (entry: LayerEntry) => {
          layers = layers.map((candidate, at) => (at === index ? entry : candidate));
        };
        const before = current.layer;
        const after = next.layer;
        if (
          before.type !== after.type ||
          before.source !== after.source ||
          before['source-layer'] !== after['source-layer'] ||
          current.slot !== next.slot ||
          !map.getLayer(id)
        ) {
          // A layer of another kind or source is a new layer in the same place.
          if (map.getLayer(id)) map.removeLayer(id);
          replace(next);
          try {
            addToMap(next);
          } catch (error) {
            replace(current);
            if (map.getLayer(id)) map.removeLayer(id);
            try {
              addToMap(current);
            } catch {
              input.warn(`Application layer ${current.layer.id} could not be restored.`);
            }
            throw error;
          }
          return null;
        }
        const changes: (() => unknown)[] = [];
        for (const [group, set] of [
          ['paint', (name: string, value: unknown) => map.setPaintProperty(id, name, value)],
          ['layout', (name: string, value: unknown) => map.setLayoutProperty(id, name, value)],
        ] as const) {
          const old = before[group] ?? {};
          const now = after[group] ?? {};
          for (const name of new Set([...Object.keys(old), ...Object.keys(now)]))
            if (!equal(old[name], now[name])) changes.push(() => set(name, now[name] ?? null));
        }
        if (!equal(before.filter, after.filter))
          changes.push(() => map.setFilter(id, after.filter ?? null));
        if (before.minzoom !== after.minzoom || before.maxzoom !== after.maxzoom)
          changes.push(() => map.setLayerZoomRange(id, after.minzoom ?? 0, after.maxzoom ?? 24));
        try {
          apply(() => {
            for (const change of changes) change();
          });
          replace(next);
        } catch (error) {
          // Put the layer back as it was.
          map.removeLayer(id);
          try {
            addToMap(current);
          } catch {
            input.warn(`Application layer ${current.layer.id} could not be restored.`);
          }
          throw error;
        }
        return null;
      });
    },
    moveLayer(request: MoveLayerRequest, signal: AbortSignal) {
      return serial(signal, () => {
        const entry = requireLayer(request.id);
        const position = request.position;
        const reference = position
          ? requireLayer('above' in position ? position.above : position.below)
          : undefined;
        if (reference === entry) throw invalid('A layer cannot move relative to itself.');
        const moved: LayerEntry = {...entry, slot: reference ? reference.slot : request.slot};
        const rest = layers.filter((candidate) => candidate !== entry);
        const at = reference
          ? rest.indexOf(reference) + (position && 'above' in position ? 1 : 0)
          : rest.length;
        layers = [...rest.slice(0, at), moved, ...rest.slice(at)];
        const id = internalLayer(entry.layer.id);
        if (map.getLayer(id)) apply(() => map.moveLayer(id, beforeIdOf(moved)));
        return null;
      });
    },
    removeLayer(request: {id: string}, signal: AbortSignal) {
      return serial(signal, () => {
        const entry = requireLayer(request.id);
        const id = internalLayer(entry.layer.id);
        if (map.getLayer(id)) apply(() => map.removeLayer(id));
        layers = layers.filter((candidate) => candidate !== entry);
        return null;
      });
    },
    setFeatureState(request: SetFeatureStateRequest, signal: AbortSignal) {
      return serial(signal, () => {
        requireSource(request.source);
        const id = featureStateId(request.id);
        apply(() =>
          map.setFeatureState(
            {
              source: internalSource(request.source),
              ...(request.sourceLayer ? {sourceLayer: request.sourceLayer} : {}),
              id,
            },
            request.state,
          ),
        );
        const key = stateKey(request.source, request.sourceLayer);
        const features = states.get(key) ?? new Map<FeatureId, Record<string, StateValue>>();
        features.set(id, {...features.get(id), ...request.state});
        states.set(key, features);
        return null;
      });
    },
    getFeatureState(request: GetFeatureStateRequest, signal: AbortSignal) {
      return serial(signal, () => {
        requireSource(request.source);
        return (
          states
            .get(stateKey(request.source, request.sourceLayer))
            ?.get(featureStateId(request.id)) ?? {}
        );
      });
    },
    removeFeatureState(request: RemoveFeatureStateRequest, signal: AbortSignal) {
      return serial(signal, () => {
        requireSource(request.source);
        const id = request.id === undefined ? undefined : featureStateId(request.id);
        apply(() =>
          map.removeFeatureState(
            {
              source: internalSource(request.source),
              ...(request.sourceLayer ? {sourceLayer: request.sourceLayer} : {}),
              ...(id === undefined ? {} : {id}),
            },
            request.key,
          ),
        );
        const key = stateKey(request.source, request.sourceLayer);
        const features = states.get(key);
        if (!features) return null;
        if (id === undefined) states.delete(key);
        else if (request.key === undefined) features.delete(id);
        else {
          const state = {...features.get(id)};
          delete state[request.key];
          features.set(id, state);
        }
        return null;
      });
    },
    queryRenderedFeatures(request: QueryRenderedFeaturesRequest, signal: AbortSignal) {
      return serial(signal, () => {
        for (const id of request.layers ?? []) requireLayer(id);
        const ids = (request.layers ?? layers.map((entry) => entry.layer.id))
          .map(internalLayer)
          .filter((id) => map.getLayer(id));
        const geometry = renderedGeometry(request);
        if (ids.length === 0 || !geometry) return [];
        const options = {
          layers: ids,
          ...(request.filter === undefined ? {} : {filter: request.filter}),
        };
        const features = apply(() => {
          if (geometry.length === 1) return map.queryRenderedFeatures(geometry[0], options);
          // Core's horizon correction applies as the map's own query runs; this runs it first.
          map.queryRenderedFeatures([0, 0], {layers: []});
          const style = map.style;
          const current = transform();
          const query = (polygon: Point[]) => {
            if (style?.queryRenderedFeatures && current)
              return style.queryRenderedFeatures(polygon, options, current) as QueriedFeature[];
            const xs = polygon.map((point) => point.x);
            const ys = polygon.map((point) => point.y);
            return map.queryRenderedFeatures(
              [
                [Math.min(...xs), Math.min(...ys)],
                [Math.max(...xs), Math.max(...ys)],
              ],
              options,
            );
          };
          if ((current?.pitch ?? 0) < steepPitch) return query(geometry);
          // At a steep pitch MapLibre misses features near the horizon in a query that reaches far
          // into the distance, while bands of the same area find them; the bands' results join,
          // each feature once.
          const seen = new Set<string>();
          const joined: QueriedFeature[] = [];
          for (const band of bands(geometry, bandHeight))
            for (const feature of query(band)) {
              const key = `${feature.layer?.id}\n${feature.source}\n${feature.sourceLayer ?? ''}\n${
                feature.id ?? JSON.stringify([feature.geometry, feature.properties])
              }`;
              if (seen.has(key)) continue;
              seen.add(key);
              joined.push(feature);
            }
          return joined;
        });
        return features.slice(0, request.limit).map(wireFeature);
      });
    },
    querySourceFeatures(request: QuerySourceFeaturesRequest, signal: AbortSignal) {
      return serial(signal, () => {
        requireSource(request.source);
        const filter = request.filter === undefined ? {} : {filter: request.filter};
        const groups = request.sourceLayers ?? [undefined];
        const output: ReturnType<typeof wireFeature>[] = [];
        const seen = new Set<string>();
        for (const sourceLayer of groups) {
          const features = apply(() =>
            map.querySourceFeatures(internalSource(request.source), {
              ...(sourceLayer ? {sourceLayer} : {}),
              ...filter,
            }),
          );
          for (const feature of features) {
            // Tiles repeat features that cross them; one copy of each identified feature remains.
            if (feature.id !== undefined) {
              const key = `${sourceLayer ?? ''}\n${typeof feature.id}:${feature.id}`;
              if (seen.has(key)) continue;
              seen.add(key);
            }
            // MapLibre computes a feature's geometry in a getter, which spreading would drop.
            output.push(
              wireFeature({
                id: feature.id,
                source: internalSource(request.source),
                sourceLayer: feature.sourceLayer,
                geometry: feature.geometry,
                properties: feature.properties,
                state: feature.state,
              }),
            );
            if (output.length >= request.limit) return output;
          }
        }
        return output;
      });
    },
    queryCluster(request: QueryClusterRequest, signal: AbortSignal) {
      return serial(signal, async () => {
        const entry = requireGeoJSON(request.source);
        if (!entry.spec.cluster) throw invalid(`Source ${request.source} does not cluster.`);
        const source = geoJSONSource(entry.id) as ClusterSource;
        try {
          switch (request.query) {
            case 'expansionZoom':
              return await source.getClusterExpansionZoom(request.cluster);
            case 'children':
              return (await source.getClusterChildren(request.cluster)).map(
                wireClusterFeature(entry.id),
              );
            case 'leaves':
              return (
                await source.getClusterLeaves(request.cluster, request.limit, request.offset)
              ).map(wireClusterFeature(entry.id));
          }
        } catch (error) {
          if (error instanceof ProtocolError) throw error;
          throw invalid(`Source ${request.source} holds no cluster ${request.cluster}.`);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('style.load', onStyleLoad);
      map.off('styledata', onStyleData);
      map.off('idle', onIdle);
      for (const entry of layers) {
        const id = internalLayer(entry.layer.id);
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          // The map is going away.
        }
      }
      for (const id of sources.keys())
        try {
          if (map.getSource(internalSource(id))) map.removeSource(internalSource(id));
        } catch {
          // The map is going away.
        }
      layers = [];
      sources.clear();
      states.clear();
    },
  };
}
export type StyleRegistry = ReturnType<typeof createStyleRegistry>;
