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

type TileflowMapBaseProps = {
  alt?: string;
  analytics?: TileflowAnalytics;
  center?: [number, number];
  captureId?: string;
  className?: string;
  height?: number | string;
  imageLoading?: HTMLImageElement['loading'];
  imageUrl?: string;
  interactive?: boolean;
  manifestUrl?: string;
  mapOptions?: TileflowMapOptions;
  markers?: TileflowMapMarker[];
  mode?: TileflowMapMode;
  preferLocalDev?: boolean;
  zoom?: number;
};

type TileflowMapStyleInput = {
  config?: TileflowConfig;
  map?: string;
  mapStyle?: MapLibreStyle;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: TileflowProjectThemes;
};

type TileflowMapStyleSourceProps =
  | {
      config: TileflowConfig;
      map?: never;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: TileflowProjectThemes;
    }
  | {
      config?: never;
      map?: string;
      mapStyle: MapLibreStyle;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: string;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl: string;
      themes?: never;
    }
  | {
      config?: never;
      map: string;
      mapStyle?: never;
      styleBaseUrl: string;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map: string;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    }
  | {
      config?: never;
      map?: never;
      mapStyle?: never;
      styleBaseUrl?: never;
      styleUrl?: never;
      themes?: never;
    };

export type TileflowMapProps = TileflowMapBaseProps & TileflowMapStyleSourceProps;

export default class TileflowMap extends SvelteComponentTyped<
  TileflowMapProps,
  {load: CustomEvent<MapLibreMap>}
> {}

export {TileflowMap};
