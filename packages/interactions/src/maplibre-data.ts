import Supercluster from 'supercluster';
import type {
  TileflowAnnotation,
  TileflowInteractionCoordinate,
  TileflowInteractionEvent,
  TileflowInteractionInputModality,
  TileflowInteractionJsonValue,
  TileflowResolvedClusterTarget,
} from './contracts';
import type {TileflowMapLibrePositioned} from './maplibre-dom';
import type {TileflowInteractionDiagnostic} from './validation';

const clusterMetadataKey = 'tileflow:cluster';
const overlayMetadataKey = 'tileflow:overlay';
const placementMetadataKey = 'tileflow:overlay-placement-manifest';
const defaultClusterMaxZoom = 14;
const defaultClusterMinPoints = 2;
const defaultClusterRadius = 50;
/** Derived line-background stacks are drawn as cells, so they cannot set a cluster's count. */
const lineBackgroundStack = / lines-v1-t\d+-l\d+-p\d+$/u;

type Json = Readonly<Record<string, unknown>>;

/** A `geojsonSource()` value from `@tileflow/core`. */
export type TileflowMapLibreDataSource = Json & Readonly<{data: unknown; kind: 'geojson'}>;

/** A `clusterOverlay()`, `heatmapOverlay()` or `maplibreOverlay()` value from `@tileflow/core`. */
export type TileflowMapLibreDataOverlay = Readonly<{
  kind: 'maplibre-overlay';
  layers: readonly (Json & Readonly<{id: string; type: string}>)[];
  placement: string;
  source: string;
}>;

export type TileflowAnnotationClusterOptions = Readonly<{
  /** The last zoom that clusters; annotations are separate above it. Defaults to 14. */
  clusterMaxZoom?: number;
  /** The fewest annotations that form a cluster. Defaults to 2. */
  clusterMinPoints?: number;
  /** Cluster radius in CSS pixels. Defaults to 50. */
  clusterRadius?: number;
  /** Zoom in when a cluster is activated. Defaults to true. */
  expandOnClick?: boolean;
  /** The accessible name of a cluster. Defaults to `${count} places`. */
  formatAriaLabel?: (count: number) => string;
}>;

export type TileflowMapLibreDataInput<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<{
    annotationClusters?: TileflowAnnotationClusterOptions | undefined;
    annotations?: readonly TAnnotation[] | undefined;
    dataOverlays?: Readonly<Record<string, TileflowMapLibreDataOverlay>> | undefined;
    dataSources?: Readonly<Record<string, TileflowMapLibreDataSource>> | undefined;
  }>;

export type TileflowMapLibreDataFeature = Readonly<{
  geometry?: unknown;
  id?: number | string;
  layer: Readonly<{id: string}>;
  properties?: Json | null;
  source?: string;
}>;

type DataSource = Readonly<{
  getClusterExpansionZoom?: (clusterId: number) => Promise<number>;
  serialize?: () => Readonly<{data?: unknown}>;
  setData?: (data: never) => unknown;
}>;

/** The MapLibre methods the runtime uses; a `maplibregl.Map` satisfies this. */
export type TileflowMapLibreDataMap = Readonly<{
  addLayer: (layer: never, beforeId?: string) => unknown;
  addSource: (id: string, source: never) => unknown;
  easeTo: (options: {center: [number, number]; zoom: number}) => unknown;
  getCanvas: () => Readonly<{style: {cursor: string}; focus?: (o?: FocusOptions) => void}>;
  getLayer: (id: string) => Readonly<{metadata?: unknown}> | undefined;
  getLayersOrder: () => readonly string[];
  getSource: (id: string) => unknown;
  getStyle: () => unknown;
  getZoom: () => number;
  isStyleLoaded: () => boolean | void;
  off: (event: never, listener: never) => unknown;
  on: (event: never, listener: never) => unknown;
  queryRenderedFeatures: (
    point: never,
    options: Readonly<{layers: string[]}>,
  ) => readonly TileflowMapLibreDataFeature[];
  removeLayer: (id: string) => unknown;
  removeSource: (id: string) => unknown;
}>;

export type TileflowMapLibreDataRuntimeOptions<
  TMap,
  TMarker extends TileflowMapLibrePositioned<TMap>,
> = Readonly<{
  /** Builds the marker that carries one annotation cluster's button. */
  createMarker: (input: Readonly<{element: HTMLElement}>) => TMarker;
  document: Pick<Document, 'createElement'>;
  map: TMap & TileflowMapLibreDataMap;
  onDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
  onInteractionEvent?: (event: TileflowInteractionEvent) => void;
  /** Receives the annotation IDs a cluster stands in for. */
  setHiddenAnnotations?: (annotationIds: ReadonlySet<string>) => void;
}>;

export type TileflowMapLibreDataRuntime<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Readonly<{
  dispose: () => void;
  reconcile: (input: TileflowMapLibreDataInput<TAnnotation>) => void;
}>;

type MapEvent = Readonly<{
  defaultPrevented?: boolean;
  originalEvent?: Readonly<{pointerType?: string; touches?: unknown}>;
  lngLat?: Readonly<{lat: number; lng: number}>;
  point?: unknown;
  preventDefault?: () => void;
}>;

type ClusterMarker<TMarker> = Readonly<{
  element: HTMLButtonElement;
  listener: () => void;
  marker: TMarker;
}>;

/**
 * Keeps application GeoJSON, its overlays and clustered annotations on a mounted map.
 *
 * Runtime sources and overlays take the same `geojsonSource()` and overlay values as a map's config.
 * A source the compiled style already declares is filled rather than added, and an overlay layer
 * it already draws keeps its compiled form. Both return after a style change, which removes
 * whatever the new style does not declare. Layers built by `clusterOverlay()` are found through
 * their metadata, so compiled and runtime clusters expand the same way.
 */
export function createTileflowMapLibreDataRuntime<
  TMap,
  TMarker extends TileflowMapLibrePositioned<TMap>,
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
>(
  options: TileflowMapLibreDataRuntimeOptions<TMap, TMarker>,
): TileflowMapLibreDataRuntime<TAnnotation> {
  const map = options.map;
  const overlays = new Map<string, {layers: string[]; signature: string; source: string}>();
  const sources = new Map<string, {signature: string}>();
  const clusterMarkers = new Map<number, ClusterMarker<TMarker>>();
  const reported = new Set<string>();
  let input: TileflowMapLibreDataInput<TAnnotation> = {};
  let index: Supercluster<{id: string}> | undefined;
  let renderedZoom: number | undefined;
  let clusterLayers: readonly string[] = [];
  let pointLayers: readonly string[] = [];
  let hovered: readonly string[] = [];
  let cursorOwned = false;
  let applying = false;
  let disposed = false;

  const on = (event: string, listener: (event: MapEvent) => void) => {
    (map.on as unknown as (name: string, callback: typeof listener) => unknown)(event, listener);
    return () =>
      (map.off as unknown as (name: string, callback: typeof listener) => unknown)(event, listener);
  };
  const onLayers = (event: string, layers: readonly string[], listener: () => void) => {
    (map.on as unknown as (name: string, ids: string[], callback: () => void) => unknown)(
      event,
      [...layers],
      listener,
    );
    return () =>
      (map.off as unknown as (name: string, ids: string[], callback: () => void) => unknown)(
        event,
        [...layers],
        listener,
      );
  };

  /** Style events repeat a sync, so each problem is reported once per reconciliation. */
  const report = (message: string, path: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    options.onDiagnostic?.({code: 'INVALID_DATA_LAYER', level: 'error', message, path});
  };

  const removeOverlay = (id: string) => {
    for (const layer of overlays.get(id)?.layers ?? []) {
      if (map.getLayer(layer)) map.removeLayer(layer);
    }
    overlays.delete(id);
  };

  const removeSource = (id: string) => {
    for (const [overlayId, overlay] of [...overlays]) {
      if (overlay.source === id) removeOverlay(overlayId);
    }
    if (map.getSource(id)) map.removeSource(id);
    sources.delete(id);
  };

  const syncSources = () => {
    for (const id of sources.keys()) {
      if (!input.dataSources?.[id]) removeSource(id);
    }
    for (const [id, source] of Object.entries(input.dataSources ?? {}).sort(compareEntries)) {
      const {data, kind: _kind, ...definition} = source;
      const signature = JSON.stringify(definition);
      const owned = sources.get(id);
      if (owned && owned.signature !== signature) removeSource(id);

      const current = map.getSource(id) as DataSource | undefined;
      if (!current) {
        map.addSource(id, {...definition, data, type: 'geojson'} as never);
        sources.set(id, {signature});
      } else if (typeof current.setData !== 'function') {
        report(`Source "${id}" already exists and is not GeoJSON.`, `/dataSources/${id}`);
      } else if (current.serialize?.().data !== data) {
        current.setData(data as never);
      }
    }
  };

  const syncOverlays = () => {
    for (const id of overlays.keys()) {
      if (!input.dataOverlays?.[id]) removeOverlay(id);
    }
    const style = map.getStyle() as
      | Readonly<{layers?: readonly Json[]; metadata?: Readonly<Record<string, unknown>>}>
      | undefined;
    const anchors = (style?.metadata?.[placementMetadataKey] as {anchors?: Json} | undefined)
      ?.anchors;
    for (const [id, overlay] of Object.entries(input.dataOverlays ?? {}).sort(compareEntries)) {
      const path = `/dataOverlays/${id}`;
      if (overlay.kind !== 'maplibre-overlay') {
        report(`Overlay "${id}" is not a Tileflow overlay.`, path);
        continue;
      }
      if (!map.getSource(overlay.source)) {
        report(`Overlay "${id}" references unknown source "${overlay.source}".`, `${path}/source`);
        continue;
      }
      const signature = JSON.stringify(overlay);
      if (overlays.get(id)?.signature !== signature) removeOverlay(id);
      const anchor = anchors?.[overlay.placement];
      const beforeId = typeof anchor === 'string' && map.getLayer(anchor) ? anchor : undefined;
      const owned: string[] = overlays.get(id)?.layers ?? [];
      for (const layer of overlay.layers) {
        if (map.getLayer(layer.id)) continue;
        const prepared = withClusterFont(layer, style?.layers ?? []);
        if (!prepared) {
          report(`Layer "${layer.id}" needs font: the style has no label font.`, path);
          continue;
        }
        const metadata = {...(layer.metadata as Json | undefined), [overlayMetadataKey]: id};
        map.addLayer({...prepared, metadata, source: overlay.source} as never, beforeId);
        if (!owned.includes(layer.id)) owned.push(layer.id);
      }
      overlays.set(id, {layers: owned, signature, source: overlay.source});
    }
  };

  /** Pointer feedback belongs to whichever layers are actually on the map now. */
  const syncClusterLayers = () => {
    const clusters: string[] = [];
    const points: string[] = [];
    for (const id of map.getLayersOrder()) {
      const metadata = map.getLayer(id)?.metadata as Json | undefined;
      const cluster = metadata?.[clusterMetadataKey] as Json | undefined;
      if (cluster?.role === 'cluster') clusters.push(id);
      if (cluster?.role === 'point') points.push(id);
    }
    clusterLayers = clusters;
    pointLayers = points;
    const interactive = [...clusters, ...points];
    if (interactive.join('\0') === hovered.join('\0')) return;
    stopHover();
    hovered = interactive;
    if (interactive.length === 0) return;
    const enter = () => {
      cursorOwned = true;
      map.getCanvas().style.cursor = 'pointer';
    };
    const leave = () => {
      if (cursorOwned) map.getCanvas().style.cursor = '';
      cursorOwned = false;
    };
    const stops = [
      onLayers('mouseenter', interactive, enter),
      onLayers('mouseleave', interactive, leave),
    ];
    stopHover = () => {
      for (const stop of stops) stop();
      leave();
      stopHover = () => undefined;
    };
  };
  let stopHover: () => void = () => undefined;

  const syncStyle = () => {
    if (applying || disposed) return;
    applying = true;
    try {
      syncSources();
      syncOverlays();
      syncClusterLayers();
    } catch (error) {
      // A style replacement is in progress; its next style event runs this again.
      if (map.isStyleLoaded() === true) {
        report(error instanceof Error ? error.message : 'Tileflow data layers failed.', '');
      }
    } finally {
      applying = false;
    }
  };

  const activateCluster = (
    target: TileflowResolvedClusterTarget,
    modality: TileflowInteractionInputModality,
  ) =>
    options.onInteractionEvent?.({
      coordinate: target.coordinate,
      inputModality: modality,
      target,
      type: 'target:activate',
    });

  const expand = (center: TileflowInteractionCoordinate, zoom: number) =>
    map.easeTo({center: [center[0], center[1]], zoom});

  const handleClick = (event: MapEvent) => {
    const layers = [...clusterLayers, ...pointLayers];
    if (disposed || layers.length === 0 || !event.point) return;
    const feature = map.queryRenderedFeatures(event.point as never, {layers})[0];
    if (!feature) return;
    event.preventDefault?.();
    const properties = jsonProperties(feature.properties);
    const modality = pointerModality(event);
    const coordinate = pointCoordinate(feature.geometry) ?? eventCoordinate(event);
    if (!coordinate) return;

    if (!clusterLayers.includes(feature.layer.id)) {
      options.onInteractionEvent?.({
        coordinate,
        inputModality: modality,
        target: {
          coordinate,
          feature: {...(feature.id === undefined ? {} : {id: feature.id}), properties},
          kind: 'style-feature',
          layerId: feature.layer.id,
        },
        type: 'target:activate',
      });
      return;
    }

    const clusterId = properties.cluster_id;
    if (typeof clusterId !== 'number' || !feature.source) return;
    activateCluster(
      {
        clusterId,
        coordinate,
        kind: 'cluster',
        pointCount: typeof properties.point_count === 'number' ? properties.point_count : 0,
        properties,
        source: feature.source,
      },
      modality,
    );
    const metadata = map.getLayer(feature.layer.id)?.metadata as Json | undefined;
    if ((metadata?.[clusterMetadataKey] as Json | undefined)?.expandOnClick === false) return;
    const source = map.getSource(feature.source) as DataSource | undefined;
    void source?.getClusterExpansionZoom?.(clusterId).then(
      (zoom) => {
        if (!disposed) expand(coordinate, zoom);
      },
      () => undefined,
    );
  };

  const removeClusterMarker = (id: number, entry: ClusterMarker<TMarker>) => {
    entry.element.removeEventListener('click', entry.listener);
    entry.marker.remove();
    entry.element.remove();
    clusterMarkers.delete(id);
  };

  const createClusterMarker = (cluster: Supercluster.ClusterFeature<Supercluster.AnyProps>) => {
    const count = cluster.properties.point_count;
    const coordinate = cluster.geometry.coordinates as [number, number];
    const clusterId = cluster.properties.cluster_id;
    const settings = input.annotationClusters;
    const element = options.document.createElement('button');
    element.type = 'button';
    element.className = 'tileflow-interaction-cluster';
    element.textContent = String(cluster.properties.point_count_abbreviated);
    element.setAttribute('aria-label', settings?.formatAriaLabel?.(count) ?? `${count} places`);
    element.setAttribute('data-tileflow-interaction', 'cluster');
    configureClusterStyles(element);
    const listener = () => {
      const leaves = index?.getLeaves(clusterId, Infinity) ?? [];
      activateCluster(
        {
          annotationIds: leaves.map((leaf) => leaf.properties.id),
          clusterId,
          coordinate,
          kind: 'cluster',
          pointCount: count,
          properties: {point_count: count},
        },
        'pointer',
      );
      if (settings?.expandOnClick !== false && index) {
        expand(coordinate, index.getClusterExpansionZoom(clusterId));
      }
    };
    element.addEventListener('click', listener);
    const marker = options.createMarker({element});
    marker.setLngLat(coordinate);
    marker.addTo(map);
    clusterMarkers.set(clusterId, {element, listener, marker});
  };

  /** Clusters come from the whole set at one integer zoom, so moving the map changes nothing. */
  const renderAnnotationClusters = () => {
    if (disposed) return;
    if (!index) {
      for (const [id, entry] of [...clusterMarkers]) removeClusterMarker(id, entry);
      options.setHiddenAnnotations?.(new Set());
      renderedZoom = undefined;
      return;
    }
    const zoom = Math.floor(map.getZoom());
    renderedZoom = zoom;
    const hidden = new Set(input.annotations?.map(({id}) => id));
    const clusters = new Map<number, Supercluster.ClusterFeature<Supercluster.AnyProps>>();
    for (const feature of index.getClusters([-180, -90, 180, 90], zoom)) {
      if ('cluster' in feature.properties) {
        const cluster = feature as Supercluster.ClusterFeature<Supercluster.AnyProps>;
        clusters.set(cluster.properties.cluster_id, cluster);
      } else {
        hidden.delete(feature.properties.id);
      }
    }
    let focusLost = false;
    for (const [id, entry] of [...clusterMarkers]) {
      if (clusters.has(id)) continue;
      focusLost ||= entry.element.ownerDocument?.activeElement === entry.element;
      removeClusterMarker(id, entry);
    }
    for (const [id, cluster] of clusters) {
      if (!clusterMarkers.has(id)) createClusterMarker(cluster);
    }
    options.setHiddenAnnotations?.(hidden);
    // A keyboard user keeps their place on the map when the button they pressed splits.
    if (focusLost) map.getCanvas().focus?.({preventScroll: true});
  };

  const handleZoom = () => {
    if (index && Math.floor(map.getZoom()) !== renderedZoom) renderAnnotationClusters();
  };

  const syncAnnotationClusters = () => {
    const settings = input.annotationClusters;
    if (!settings) {
      index = undefined;
    } else {
      const radius = settings.clusterRadius ?? defaultClusterRadius;
      index = new Supercluster<{id: string}>({
        extent: 512,
        maxZoom: Math.floor(settings.clusterMaxZoom ?? defaultClusterMaxZoom),
        minPoints: settings.clusterMinPoints ?? defaultClusterMinPoints,
        radius,
      }).load(
        (input.annotations ?? []).map(({coordinate, id}) => ({
          geometry: {coordinates: [coordinate[0], coordinate[1]], type: 'Point'},
          properties: {id},
          type: 'Feature',
        })),
      );
      // A rebuilt index renumbers nothing it can promise to keep, so buttons are rebuilt.
      for (const [id, entry] of [...clusterMarkers]) removeClusterMarker(id, entry);
    }
    renderAnnotationClusters();
  };

  const stops = [
    on('style.load', syncStyle),
    on('styledata', syncStyle),
    on('click', handleClick),
    on('zoom', handleZoom),
  ];

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of stops) stop();
      stopHover();
      for (const [id, entry] of [...clusterMarkers]) removeClusterMarker(id, entry);
    },
    reconcile(next: TileflowMapLibreDataInput<TAnnotation>) {
      if (disposed) return;
      // Options written inline are new objects each render; only a real change rebuilds buttons.
      const annotationsChanged =
        next.annotations !== input.annotations ||
        JSON.stringify(next.annotationClusters) !== JSON.stringify(input.annotationClusters);
      input = next;
      reported.clear();
      syncStyle();
      if (annotationsChanged) syncAnnotationClusters();
    },
  });
}

function compareEntries([left]: [string, unknown], [right]: [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withClusterFont(
  layer: TileflowMapLibreDataOverlay['layers'][number],
  styleLayers: readonly Json[],
): TileflowMapLibreDataOverlay['layers'][number] | undefined {
  const metadata = layer.metadata as Json | undefined;
  const layout = (layer.layout ?? {}) as Json;
  if ((metadata?.[clusterMetadataKey] as Json | undefined)?.role !== 'count') return layer;
  if (layout['text-font'] !== undefined) return layer;
  for (const candidate of styleLayers) {
    const font = (candidate.layout as Json | undefined)?.['text-font'];
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((face) => typeof face === 'string' && !lineBackgroundStack.test(face))
    ) {
      return {...layer, layout: {...layout, 'text-font': font}};
    }
  }
  return undefined;
}

function pointerModality(event: MapEvent): TileflowInteractionInputModality {
  const original = event.originalEvent;
  return original?.pointerType === 'touch' || original?.touches !== undefined ? 'touch' : 'pointer';
}

function eventCoordinate(event: MapEvent): TileflowInteractionCoordinate | undefined {
  return event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : undefined;
}

function pointCoordinate(geometry: unknown): TileflowInteractionCoordinate | undefined {
  const value = geometry as Readonly<{coordinates?: unknown; type?: unknown}> | undefined;
  const coordinates = value?.coordinates;
  return value?.type === 'Point' &&
    Array.isArray(coordinates) &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
    ? [coordinates[0], coordinates[1]]
    : undefined;
}

function jsonProperties(
  properties: Json | null | undefined,
): Readonly<Record<string, TileflowInteractionJsonValue>> {
  return Object.fromEntries(
    Object.entries(properties ?? {}).filter(([, value]) => value !== undefined),
  ) as Record<string, TileflowInteractionJsonValue>;
}

function configureClusterStyles(element: HTMLElement): void {
  element.style.alignItems = 'center';
  element.style.background = 'var(--tileflow-interaction-cluster-color, #2563eb)';
  element.style.borderColor = 'var(--tileflow-interaction-border-color, #ffffff)';
  element.style.borderRadius = '9999px';
  element.style.borderStyle = 'solid';
  element.style.borderWidth = '2px';
  element.style.boxShadow = 'var(--tileflow-interaction-shadow, 0 1px 4px rgb(0 0 0 / 0.25))';
  element.style.color = 'var(--tileflow-interaction-foreground, #ffffff)';
  element.style.cursor = 'pointer';
  element.style.display = 'inline-flex';
  element.style.justifyContent = 'center';
  element.style.minHeight = '2.25rem';
  element.style.minWidth = '2.25rem';
  element.style.padding = '0.25rem';
}
