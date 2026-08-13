import type {Map as MapLibreMap} from 'maplibre-gl';
import type {SvelteComponentTyped} from 'svelte';
import type {TileflowMapProps} from './index';

export default class TileflowMap extends SvelteComponentTyped<
  TileflowMapProps,
  {load: CustomEvent<MapLibreMap>}
> {}
