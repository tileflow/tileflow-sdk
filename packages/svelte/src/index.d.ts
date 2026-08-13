import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
import type {SvelteComponentTyped} from 'svelte';
import type {
  MapLibreStyle,
  TileflowAnalytics,
  TileflowConfig,
  TileflowMapMarker,
  TileflowProjectThemes,
} from '@tileflow/core';

export type TileflowMapMode = 'interactive' | 'image';
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

export type TileflowMapProps = {
  alt?: string;
  analytics?: TileflowAnalytics;
  center?: [number, number];
  captureId?: string;
  className?: string;
  config?: TileflowConfig;
  height?: number | string;
  imageLoading?: HTMLImageElement['loading'];
  imageUrl?: string;
  interactive?: boolean;
  manifestUrl?: string;
  map?: string;
  mapOptions?: TileflowMapOptions;
  mapStyle?: MapLibreStyle;
  markers?: TileflowMapMarker[];
  mode?: TileflowMapMode;
  preferLocalDev?: boolean;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: TileflowProjectThemes;
  tileBaseUrl?: string;
  zoom?: number;
};

export default class TileflowMap extends SvelteComponentTyped<
  TileflowMapProps,
  {load: CustomEvent<MapLibreMap>}
> {}

export {TileflowMap};
