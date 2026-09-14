import type {MapLibreStyle} from '@tileflow/core';
import {
  resolveTileflowNativeInitialView,
  type TileflowNativeInitialView,
  type TileflowNativeSource,
  type TileflowNativeSourceState,
} from '@tileflow/core/native';

const style: MapLibreStyle = {version: 8, name: 'Direct', sources: {}, layers: []};
const inputs: TileflowNativeSource[] = [
  {kind: 'maplibre', style},
  {kind: 'maplibre', style: 'https://maps.example.test/style.json'},
  {kind: 'tileflow', map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
];
void inputs;
// @ts-expect-error A Tileflow source still requires an explicit manifest URL.
const missingUrl: TileflowNativeSource = {kind: 'tileflow', map: 'main'};
void missingUrl;
// @ts-expect-error A direct source requires style data.
const missingStyle: TileflowNativeSource = {kind: 'maplibre'};
void missingStyle;

export function narrow(state: TileflowNativeSourceState): string | undefined {
  if (state.status !== 'ready') return undefined;
  if (state.kind === 'tileflow') {
    const kind: 'tileflow' = state.source.kind;
    const url: string = state.manifestUrl;
    const map: string = state.map.name;
    const theme: string = state.theme.name;
    const version: 1 = state.manifest.version;
    const view: TileflowNativeInitialView = resolveTileflowNativeInitialView({
      manifestView: state.map.view,
    });
    // @ts-expect-error A Tileflow source is not a direct style.
    void state.source.style;
    // @ts-expect-error Ready snapshots are immutable.
    state.source.map = 'changed';
    return `${kind}:${url}:${map}:${theme}:${version}:${view.zoom}`;
  }
  const kind: 'maplibre' = state.source.kind;
  const value = state.source.style;
  if (typeof value !== 'string') {
    // @ts-expect-error Direct layers are deeply immutable snapshots.
    value.layers.push({id: 'extra'});
  }
  // @ts-expect-error Direct readiness has no fabricated manifest.
  void state.manifest;
  // @ts-expect-error Direct readiness has no fabricated manifest URL.
  void state.manifestUrl;
  // @ts-expect-error Direct readiness has no Tileflow map.
  void state.map;
  // @ts-expect-error Direct readiness has no theme.
  void state.theme;
  return kind;
}

const view = resolveTileflowNativeInitialView({view: {center: [1, 2]}, mapOptionsView: {zoom: 5}});
const tuple: readonly [number, number] = view.center;
void tuple;
// @ts-expect-error A canonical view is immutable.
view.zoom = 4;
// @ts-expect-error The coordinate order is a two-element tuple, not an upstream camera object.
resolveTileflowNativeInitialView({view: {center: {lat: 1, lng: 2}}});
