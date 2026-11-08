import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core/native';
import {withTileflowClusterLabelFont} from './native-annotation-clusters';

const clusterMetadataKey = 'tileflow:cluster';
const placementMetadataKey = 'tileflow:overlay-placement-manifest';

type Json = Readonly<Record<string, unknown>>;
type Style = Readonly<{
  layers?: readonly Json[];
  metadata?: Json;
  sources?: Readonly<Record<string, Json>>;
}>;

export type NativeDataLayer = Json & Readonly<{beforeId?: string; id: string; source: string}>;

export type NativeDataSourcePlan = Readonly<{
  /** The style already declares it; MapLibre React Native reuses that source by ID. */
  adopted: boolean;
  /** Cluster layers drawn from this source, compiled or added. */
  clusterLayers: readonly string[];
  data: unknown;
  definition: Json;
  expandOnClick: boolean;
  id: string;
  layers: readonly NativeDataLayer[];
  pointLayers: readonly string[];
}>;

export type NativeDataLayersPlan = Readonly<{
  diagnostics: readonly Readonly<{message: string; path: string}>[];
  /** Overlay layers over a non-GeoJSON style source, such as a hosted vector tileset. */
  layers: readonly NativeDataLayer[];
  sources: readonly NativeDataSourcePlan[];
}>;

/**
 * Plans the native children for runtime `dataSources` and `dataOverlays`, and adopts compiled
 * clustering sources so that a press on them can expand. Pure: renderers only draw the result.
 */
export function planNativeDataLayers(input: {
  dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>> | undefined;
  dataSources?: Readonly<Record<string, TileflowGeoJsonSource>> | undefined;
  style: Style;
}): NativeDataLayersPlan {
  const styleSources = input.style.sources ?? {};
  const styleLayers = input.style.layers ?? [];
  const styleLayerIds = new Set(styleLayers.map(({id}) => String(id)));
  const anchors = (input.style.metadata?.[placementMetadataKey] as {anchors?: Json} | undefined)
    ?.anchors;
  const diagnostics: {message: string; path: string}[] = [];
  const entries = new Map<
    string,
    {
      adopted: boolean;
      clusterLayers: string[];
      data: unknown;
      definition: Json;
      expandOnClick: boolean;
      layers: NativeDataLayer[];
      pointLayers: string[];
    }
  >();
  const freeLayers: NativeDataLayer[] = [];

  const entry = (id: string) => entries.get(id);
  const addRoles = (sourceId: string, layer: Json) => {
    const target = entry(sourceId);
    const cluster = (layer.metadata as Json | undefined)?.[clusterMetadataKey] as Json | undefined;
    if (!target || !cluster) return;
    if (cluster.role === 'cluster') target.clusterLayers.push(String(layer.id));
    if (cluster.role === 'point') target.pointLayers.push(String(layer.id));
    if (cluster.expandOnClick === false) target.expandOnClick = false;
  };

  for (const [id, source] of Object.entries(input.dataSources ?? {}).sort(compare)) {
    const compiled = styleSources[id];
    if (source.kind !== 'geojson' || (compiled && compiled.type !== 'geojson')) {
      diagnostics.push({message: `Source "${id}" is not GeoJSON.`, path: `/dataSources/${id}`});
      continue;
    }
    const {data, kind: _kind, ...definition} = source;
    entries.set(id, {
      adopted: compiled !== undefined,
      clusterLayers: [],
      data,
      // A reused source keeps its compiled cluster options.
      definition: compiled ? {} : definition,
      expandOnClick: true,
      layers: [],
      pointLayers: [],
    });
  }
  // Compiled clusters expand too, so their sources are adopted with their compiled data.
  for (const layer of styleLayers) {
    const sourceId = typeof layer.source === 'string' ? layer.source : undefined;
    const cluster = (layer.metadata as Json | undefined)?.[clusterMetadataKey];
    if (!sourceId || !cluster || entries.has(sourceId)) continue;
    const compiled = styleSources[sourceId];
    if (compiled?.type !== 'geojson') continue;
    entries.set(sourceId, {
      adopted: true,
      clusterLayers: [],
      data: compiled.data,
      definition: {},
      expandOnClick: true,
      layers: [],
      pointLayers: [],
    });
  }
  for (const layer of styleLayers) {
    if (typeof layer.source === 'string') addRoles(layer.source, layer);
  }

  for (const [id, overlay] of Object.entries(input.dataOverlays ?? {}).sort(compare)) {
    const path = `/dataOverlays/${id}`;
    if (overlay.kind !== 'maplibre-overlay') {
      diagnostics.push({message: `Overlay "${id}" is not a Tileflow overlay.`, path});
      continue;
    }
    const target = entry(overlay.source);
    if (!target && !styleSources[overlay.source]) {
      diagnostics.push({
        message: `Overlay "${id}" references unknown source "${overlay.source}".`,
        path: `${path}/source`,
      });
      continue;
    }
    const anchor = anchors?.[overlay.placement];
    const beforeId = typeof anchor === 'string' && styleLayerIds.has(anchor) ? anchor : undefined;
    for (const layer of overlay.layers) {
      if (styleLayerIds.has(layer.id)) continue;
      const prepared = withTileflowClusterLabelFont(layer, styleLayers);
      if (!prepared) {
        diagnostics.push({
          message: `Layer "${layer.id}" needs font: the style has no label font.`,
          path,
        });
        continue;
      }
      const native: NativeDataLayer = {
        ...prepared,
        ...(beforeId ? {beforeId} : {}),
        id: layer.id,
        source: overlay.source,
      };
      if (target) {
        target.layers.push(native);
        addRoles(overlay.source, layer);
      } else {
        freeLayers.push(native);
      }
    }
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    layers: Object.freeze(freeLayers),
    sources: Object.freeze([...entries].map(([id, value]) => Object.freeze({id, ...value}))),
  });
}

function compare([left]: [string, unknown], [right]: [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
