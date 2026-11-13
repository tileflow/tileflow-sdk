import {
  createTileflowAnnotationClusterIndex,
  type TileflowAnnotationCluster,
  type TileflowAnnotationClusterIndex,
  type TileflowAnnotationClusterOptions,
} from './annotation-clusters';
import {withTileflowClusterLabelFont} from './cluster-label-font';
import type {
  TileflowAnnotation,
  TileflowInteractionCoordinate,
  TileflowInteractionEvent,
  TileflowInteractionInputModality,
  TileflowInteractionJsonValue,
  TileflowResolvedClusterTarget,
} from './contracts';
import type {TileflowMapLibrePositioned} from './maplibre-dom';
import {roleVariable} from './surface-style';
import type {TileflowInteractionDiagnostic} from './validation';

const clusterMetadataKey = 'tileflow:cluster';
const overlayMetadataKey = 'tileflow:overlay';
const placementMetadataKey = 'tileflow:overlay-placement-manifest';

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
  listener: (event: MouseEvent) => void;
  marker: TMarker;
  pointCount: number;
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
  let annotationClusterKey = '';
  let index: TileflowAnnotationClusterIndex | undefined;
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
        // A compiled source arrives with the style; the style event that follows runs this again.
        if (map.isStyleLoaded() === true) {
          report(
            `Overlay "${id}" references unknown source "${overlay.source}".`,
            `${path}/source`,
          );
        }
        continue;
      }
      const signature = JSON.stringify(overlay);
      if (overlays.get(id)?.signature !== signature) removeOverlay(id);
      const anchor = anchors?.[overlay.placement];
      const beforeId = typeof anchor === 'string' && map.getLayer(anchor) ? anchor : undefined;
      const owned: string[] = overlays.get(id)?.layers ?? [];
      for (const layer of overlay.layers) {
        if (map.getLayer(layer.id)) continue;
        const prepared = withTileflowClusterLabelFont(layer, style?.layers ?? []);
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

  const isFocused = ({element}: ClusterMarker<TMarker>) =>
    element.ownerDocument?.activeElement === element;
  const hasFocusedClusterMarker = () => [...clusterMarkers.values()].some(isFocused);

  const removeClusterMarker = (id: number, entry: ClusterMarker<TMarker>) => {
    entry.element.removeEventListener('click', entry.listener);
    entry.marker.remove();
    entry.element.remove();
    clusterMarkers.delete(id);
  };

  const clusterLabel = (count: number) =>
    input.annotationClusters?.formatAriaLabel?.(count) ?? `${count} places`;

  const createClusterMarker = (cluster: TileflowAnnotationCluster) => {
    const element = options.document.createElement('button');
    element.type = 'button';
    element.className = 'tileflow-interaction-cluster';
    element.textContent = cluster.label;
    element.setAttribute('aria-label', clusterLabel(cluster.pointCount));
    element.setAttribute('data-tileflow-interaction', 'cluster');
    configureClusterStyles(element);
    const listener = (event: MouseEvent) => {
      activateCluster(
        {
          annotationIds: cluster.annotationIds,
          clusterId: cluster.clusterId,
          coordinate: cluster.coordinate,
          kind: 'cluster',
          pointCount: cluster.pointCount,
          properties: {point_count: cluster.pointCount},
        },
        // Browsers report a click from Enter or Space with a detail of zero.
        event.detail === 0 ? 'keyboard' : 'pointer',
      );
      if (input.annotationClusters?.expandOnClick !== false) {
        expand(cluster.coordinate, cluster.expansionZoom);
      }
    };
    element.addEventListener('click', listener);
    const marker = options.createMarker({element});
    marker.setLngLat([cluster.coordinate[0], cluster.coordinate[1]]);
    marker.addTo(map);
    clusterMarkers.set(cluster.clusterId, {
      element,
      listener,
      marker,
      pointCount: cluster.pointCount,
    });
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
    const view = index.at(zoom);
    const clusters = new Map(view.clusters.map((cluster) => [cluster.clusterId, cluster]));
    let focusLost = false;
    for (const [id, entry] of [...clusterMarkers]) {
      if (clusters.has(id)) continue;
      focusLost ||= isFocused(entry);
      removeClusterMarker(id, entry);
    }
    for (const [id, cluster] of clusters) {
      if (!clusterMarkers.has(id)) createClusterMarker(cluster);
    }
    options.setHiddenAnnotations?.(view.hiddenAnnotationIds);
    // A keyboard user keeps their place on the map when the button they pressed splits.
    if (focusLost) map.getCanvas().focus?.({preventScroll: true});
  };

  const handleZoom = () => {
    if (index && Math.floor(map.getZoom()) !== renderedZoom) renderAnnotationClusters();
  };

  const syncAnnotationClusters = () => {
    const settings = input.annotationClusters;
    let focusLost = false;
    if (!settings) {
      index = undefined;
    } else {
      index = createTileflowAnnotationClusterIndex(input.annotations ?? [], settings);
      // A rebuilt index renumbers nothing it can promise to keep, so buttons are rebuilt.
      focusLost = hasFocusedClusterMarker();
      for (const [id, entry] of [...clusterMarkers]) removeClusterMarker(id, entry);
    }
    renderAnnotationClusters();
    if (focusLost) map.getCanvas().focus?.({preventScroll: true});
  };

  /** A changed locale reaches existing buttons without splitting them. */
  const refreshClusterLabels = () => {
    for (const {element, pointCount} of clusterMarkers.values()) {
      element.setAttribute('aria-label', clusterLabel(pointCount));
    }
  };

  // A subscription that fails releases the ones made before it, so a runtime that cannot start
  // leaves nothing on the map.
  const stops: (() => void)[] = [];
  try {
    stops.push(on('style.load', syncStyle));
    stops.push(on('styledata', syncStyle));
    stops.push(on('click', handleClick));
    stops.push(on('zoom', handleZoom));
  } catch (error) {
    for (const stop of stops) stop();
    throw error;
  }

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of stops) stop();
      stopHover();
      for (const [id, entry] of [...clusterMarkers]) removeClusterMarker(id, entry);
      // A map that outlives this runtime keeps nothing it added. During an adapter's teardown the
      // map or the marker runtime may already be gone, and there is nothing left to restore.
      try {
        if (index) options.setHiddenAnnotations?.(new Set());
      } catch {}
      try {
        for (const id of [...overlays.keys()]) removeOverlay(id);
        for (const id of [...sources.keys()]) removeSource(id);
      } catch {}
    },
    reconcile(next: TileflowMapLibreDataInput<TAnnotation>) {
      if (disposed) return;
      // Lists and options written inline are new objects each render; only a real change rebuilds.
      const key = clusterInputKey(next);
      const changed = key !== annotationClusterKey;
      annotationClusterKey = key;
      input = next;
      reported.clear();
      syncStyle();
      if (changed) syncAnnotationClusters();
      else refreshClusterLabels();
    },
  });
}

/** Only what changes the groups: annotation positions and the clustering options. */
function clusterInputKey(input: TileflowMapLibreDataInput): string {
  if (!input.annotationClusters) return '';
  const positions = (input.annotations ?? []).map(({coordinate, id}) => [id, ...coordinate]);
  return JSON.stringify([input.annotationClusters, positions]);
}

function compareEntries([left]: [string, unknown], [right]: [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  element.style.borderColor = roleVariable(
    'cluster',
    'ring',
    roleVariable('cluster', 'border-color', '#ffffff'),
  );
  element.style.borderRadius = roleVariable('cluster', 'border-radius', '9999px');
  element.style.borderStyle = 'solid';
  element.style.borderWidth = '2px';
  element.style.boxShadow = roleVariable('cluster', 'shadow', '0 1px 4px rgb(0 0 0 / 0.25)');
  element.style.color = roleVariable('cluster', 'foreground', '#ffffff');
  element.style.cursor = 'pointer';
  element.style.display = 'inline-flex';
  element.style.justifyContent = 'center';
  element.style.minHeight = '2.25rem';
  element.style.minWidth = '2.25rem';
  element.style.padding = '0.25rem';
}
