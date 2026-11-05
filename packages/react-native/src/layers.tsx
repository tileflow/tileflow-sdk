import {useContext, useLayoutEffect, useState} from 'react';
import type * as Style from './style-spec';
import type {Expression} from './contract';
import {layerStyle} from './layer-input';
import type {LayerType} from './layer-input';
import {SourceContext, useCommittedValue, useMap} from './map-context';
import {mapError} from './map-error';

export type LayerProps<S> = Readonly<{
  id: string;
  sourceID?: string;
  sourceLayerID?: string;
  filter?: Expression;
  minZoomLevel?: number;
  maxZoomLevel?: number;
  aboveLayerID?: string;
  belowLayerID?: string;
  layerIndex?: number;
  slot?: string;
  style?: S;
}>;

function Layer({
  type,
  props,
}: {
  type: LayerType;
  props: LayerProps<Readonly<Record<string, unknown>>>;
}) {
  const {controller, style} = useMap();
  const inheritedSource = useContext(SourceContext);
  const [owner] = useState(() => Symbol());
  const source = props.sourceID ?? inheritedSource;
  const properties = {
    id: props.id,
    type,
    ...(source && type !== 'background' ? {source} : {}),
    ...(props.sourceLayerID ? {'source-layer': props.sourceLayerID} : {}),
    ...(props.filter ? {filter: props.filter} : {}),
    ...(props.minZoomLevel === undefined ? {} : {minzoom: props.minZoomLevel}),
    ...(props.maxZoomLevel === undefined ? {} : {maxzoom: props.maxZoomLevel}),
    ...layerStyle(type, props.style),
  };
  const position = {
    ...(props.aboveLayerID ? {aboveLayerId: props.aboveLayerID} : {}),
    ...(props.belowLayerID ? {belowLayerId: props.belowLayerID} : {}),
    ...(props.layerIndex === undefined ? {} : {index: props.layerIndex}),
    ...(props.slot ? {slot: props.slot} : {}),
  };
  const committed = useCommittedValue({properties, position});
  const signature = JSON.stringify({properties, position});
  useLayoutEffect(() => {
    try {
      style.layer(props.id, owner, committed.current.properties, committed.current.position);
    } catch (error) {
      controller.report(mapError(error));
    }
    return () => style.removeLayer(props.id, owner);
  }, [controller, style, props.id, owner, signature, committed]);
  return null;
}

export function FillLayer(props: LayerProps<Style.FillLayerStyle>) {
  return <Layer type="fill" props={props} />;
}
export function LineLayer(props: LayerProps<Style.LineLayerStyle>) {
  return <Layer type="line" props={props} />;
}
export function SymbolLayer(props: LayerProps<Style.SymbolLayerStyle>) {
  return <Layer type="symbol" props={props} />;
}
export function CircleLayer(props: LayerProps<Style.CircleLayerStyle>) {
  return <Layer type="circle" props={props} />;
}
export function HeatmapLayer(props: LayerProps<Style.HeatmapLayerStyle>) {
  return <Layer type="heatmap" props={props} />;
}
export function FillExtrusionLayer(props: LayerProps<Style.FillExtrusionLayerStyle>) {
  return <Layer type="fill-extrusion" props={props} />;
}
export function RasterLayer(props: LayerProps<Style.RasterLayerStyle>) {
  return <Layer type="raster" props={props} />;
}
export function HillshadeLayer(props: LayerProps<Style.HillshadeLayerStyle>) {
  return <Layer type="hillshade" props={props} />;
}
export function ColorReliefLayer(props: LayerProps<Style.ColorReliefLayerStyle>) {
  return <Layer type="color-relief" props={props} />;
}
export function BackgroundLayer(props: LayerProps<Style.BackgroundLayerStyle>) {
  return <Layer type="background" props={props} />;
}
