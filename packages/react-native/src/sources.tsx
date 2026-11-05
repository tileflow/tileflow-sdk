import {forwardRef, useImperativeHandle, useLayoutEffect, useState} from 'react';
import type {ReactNode} from 'react';
import type {GeoJSON, Feature} from 'geojson';
import {SourceContext, useCommittedValue, useMap} from './map-context';
import type {JsonObject, JsonValue} from './native-map-contract';
import type {FeatureCollection} from './contract';
import {mapError} from './map-error';

type SourceProps = Readonly<{id: string; children?: ReactNode; attribution?: string}>;
export type GeoJSONSourceProps = SourceProps & Readonly<{
  shape?: GeoJSON;
  url?: string;
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoomLevel?: number;
  clusterMinPoints?: number;
  clusterProperties?: JsonObject;
  maxZoomLevel?: number;
  buffer?: number;
  tolerance?: number;
  lineMetrics?: boolean;
  generateId?: boolean;
  promoteId?: string;
}>;
export interface GeoJSONSourceRef {
  setData(data: GeoJSON | string): Promise<void>;
  updateData(update: Readonly<{add?: readonly Feature[]; update?: readonly Feature[]; remove?: readonly (string | number)[]}>): Promise<void>;
  getClusterChildren(clusterId: number): Promise<FeatureCollection>;
  getClusterLeaves(clusterId: number, limit?: number, offset?: number): Promise<FeatureCollection>;
  getClusterExpansionZoom(clusterId: number): Promise<number>;
}

function useSource(id: string, properties: JsonObject): void {
  const {controller, style} = useMap();
  const [owner] = useState(() => Symbol());
  const value = useCommittedValue(properties);
  const signature = JSON.stringify(properties);
  useLayoutEffect(() => {
    try { style.source(id, owner, value.current); }
    catch (error) { controller.report(mapError(error)); }
    return () => style.removeSource(id, owner);
  }, [controller, style, id, owner, signature, value]);
}

function defined(values: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(values).filter((pair): pair is [string, JsonValue] => pair[1] !== undefined));
}

export const GeoJSONSource = forwardRef<GeoJSONSourceRef, GeoJSONSourceProps>(function GeoJSONSource(props, ref) {
  const {controller, style} = useMap();
  if (props.shape !== undefined && props.url !== undefined) throw new Error('GeoJSONSource takes shape or url.');
  useSource(props.id, defined({
    type: 'geojson', data: (props.shape as unknown as JsonObject) ?? props.url,
    attribution: props.attribution, cluster: props.cluster, clusterRadius: props.clusterRadius,
    clusterMaxZoom: props.clusterMaxZoomLevel, clusterMinPoints: props.clusterMinPoints,
    clusterProperties: props.clusterProperties, maxzoom: props.maxZoomLevel, buffer: props.buffer,
    tolerance: props.tolerance, lineMetrics: props.lineMetrics, generateId: props.generateId, promoteId: props.promoteId,
  }));
  useImperativeHandle(ref, () => ({
    setData: async (data) => { await style.synchronize(); await controller.call('setGeoJSONSourceData', {id: props.id, data: data as unknown as JsonObject | string}); },
    updateData: async (update) => {
      await style.synchronize();
      await controller.call('updateGeoJSONSource', {id: props.id, update: {
        ...(update.add ? {add: update.add as unknown as readonly JsonObject[]} : {}),
        ...(update.update ? {update: update.update as unknown as readonly JsonObject[]} : {}),
        ...(update.remove ? {remove: update.remove.map(String)} : {}),
      }});
    },
    getClusterChildren: async (clusterId) => {
      await style.synchronize();
      return {type: 'FeatureCollection', features: await controller.call('getClusterChildren', {sourceId: props.id, clusterId}) as Feature[]};
    },
    getClusterLeaves: async (clusterId, limit, offset) => {
      await style.synchronize();
      return {type: 'FeatureCollection', features: await controller.call('getClusterLeaves', {
        sourceId: props.id, clusterId, ...(limit === undefined ? {} : {limit}), ...(offset === undefined ? {} : {offset}),
      }) as Feature[]};
    },
    getClusterExpansionZoom: async (clusterId) => {
      await style.synchronize();
      return await controller.call('getClusterExpansionZoom', {sourceId: props.id, clusterId}) as number;
    },
  }), [controller, style, props.id]);
  return <SourceContext.Provider value={props.id}>{props.children}</SourceContext.Provider>;
});

export type VectorSourceProps = SourceProps & Readonly<{
  url?: string;
  tileUrlTemplates?: readonly string[];
  minZoomLevel?: number;
  maxZoomLevel?: number;
  bounds?: readonly [number, number, number, number];
  scheme?: 'xyz' | 'tms';
  promoteId?: string | Readonly<Record<string, string>>;
}>;
export type RasterSourceProps = Omit<VectorSourceProps, 'promoteId'> & Readonly<{tileSize?: number}>;
export type RasterDemSourceProps = RasterSourceProps & Readonly<{encoding?: 'mapbox' | 'terrarium'}>;

function TileSource({type, props}: {type: 'vector' | 'raster' | 'raster-dem'; props: RasterDemSourceProps & Pick<VectorSourceProps, 'promoteId'>}) {
  useSource(props.id, defined({type, url: props.url, tiles: props.tileUrlTemplates,
    attribution: props.attribution, minzoom: props.minZoomLevel, maxzoom: props.maxZoomLevel,
    bounds: props.bounds, scheme: props.scheme, promoteId: props.promoteId,
    ...(type === 'vector' ? {} : {tileSize: props.tileSize}),
    ...(type === 'raster-dem' ? {encoding: props.encoding} : {}),
  }));
  return <SourceContext.Provider value={props.id}>{props.children}</SourceContext.Provider>;
}
export function VectorSource(props: VectorSourceProps) { return <TileSource type="vector" props={props} />; }
export function RasterSource(props: RasterSourceProps) { return <TileSource type="raster" props={props} />; }
export function RasterDemSource(props: RasterDemSourceProps) { return <TileSource type="raster-dem" props={props} />; }

export type ImageSourceProps = SourceProps & Readonly<{
  url: string;
  coordinates: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
}>;
export function ImageSource(props: ImageSourceProps) {
  useSource(props.id, {type: 'image', url: props.url, coordinates: props.coordinates});
  return <SourceContext.Provider value={props.id}>{props.children}</SourceContext.Provider>;
}
