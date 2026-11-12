import type {MapOptions} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mountTileflowMap, type TileflowMapMountOptions} from '../src/maplibre-mount';

const worldTile =
  `https://cdn.tileflow.dev/tiles/world/world-v1-release-browser/0/0/0.pbf?` +
  `worldDescriptorSha256=${'a'.repeat(64)}&map=map_public`;
const tileResource = 'Tile' as Parameters<NonNullable<MapOptions['transformRequest']>>[1];
const emptyStyle = {version: 8 as const, sources: {}, layers: []};
const container = {ownerDocument: {defaultView: {}}} as unknown as HTMLElement;
const neverLoadScene: TileflowMapMountOptions['loadScene'] = async () => {
  throw new Error('An empty 2D map must not load its 3D renderer');
};

function renderer(Map: unknown): typeof import('maplibre-gl') {
  return {Map, addProtocol() {}} as unknown as typeof import('maplibre-gl');
}

test('cancelled mounting rejects before the renderer resolves and never creates a late map', async () => {
  const abort = new AbortController();
  let resolveRenderer!: (value: typeof import('maplibre-gl')) => void;
  let creations = 0;
  const loaded = new Promise<typeof import('maplibre-gl')>((resolve) => {
    resolveRenderer = resolve;
  });
  const pending = mountTileflowMap({
    container,
    loadMapLibre: () => loaded,
    loadScene: neverLoadScene,
    runtimeStyle: {style: emptyStyle, fontFaces: []},
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  resolveRenderer(
    renderer(
      class {
        constructor() {
          creations++;
        }
      },
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(creations, 0);
});

test('mount reads current camera settings after preload and retires World requests on constructor failure', async () => {
  let resolveRenderer!: (value: typeof import('maplibre-gl')) => void;
  const loaded = new Promise<typeof import('maplibre-gl')>((resolve) => {
    resolveRenderer = resolve;
  });
  let zoom = 3;
  let reads = 0;
  let captured: MapOptions | undefined;
  let duringMount: ReturnType<NonNullable<MapOptions['transformRequest']>>;
  const failure = new Error('WebGL unavailable');
  const errors: unknown[] = [];
  const pending = mountTileflowMap({
    container,
    loadMapLibre: () => loaded,
    loadScene: neverLoadScene,
    runtimeStyle: {style: emptyStyle, fontFaces: []},
    settings: () => {
      reads++;
      return {mapOptions: {zoom}};
    },
    onError: (error) => errors.push(error),
  });
  zoom = 12;
  resolveRenderer(
    renderer(
      class {
        constructor(options: MapOptions) {
          captured = options;
          duringMount = options.transformRequest!(worldTile, tileResource);
          throw failure;
        }
      },
    ),
  );
  await assert.rejects(pending, (error) => error === failure);
  assert.equal(reads, 2);
  assert.equal(captured?.zoom, 12);
  // Session resolution is asynchronous: a request begun during construction settles after
  // rollback, so it must not acquire a URL for the retired World request channel.
  assert.equal((await duringMount!)!.url, worldTile);
  assert.equal((await captured!.transformRequest!(worldTile, tileResource))!.url, worldTile);
  assert.deepEqual(errors, [], 'the mounting caller owns reporting the initial failure');
});

test('failure after map construction removes the map and closes the request scopes', async () => {
  const failure = new Error('An attachment could not read its container');
  let removals = 0;
  let captured: MapOptions | undefined;
  const listeners = new Set<() => void>();
  const maplibre = renderer(
    class {
      constructor(options: MapOptions) {
        captured = options;
      }
      on(_event: string, listener: () => void) {
        listeners.add(listener);
      }
      off(_event: string, listener: () => void) {
        listeners.delete(listener);
      }
      getContainer() {
        throw failure;
      }
      remove() {
        removals++;
      }
    },
  );
  await assert.rejects(
    mountTileflowMap({
      container,
      loadMapLibre: async () => maplibre,
      loadScene: neverLoadScene,
      runtimeStyle: {style: emptyStyle, fontFaces: []},
    }),
    (error) => error === failure,
  );
  assert.equal(removals, 1);
  assert.equal(listeners.size, 0);
  assert.equal((await captured!.transformRequest!(worldTile, tileResource))!.url, worldTile);
});

test('a pre-aborted mount does not call the renderer or settings loaders', async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    mountTileflowMap({
      container,
      loadMapLibre: async () => assert.fail('renderer must not load'),
      loadScene: neverLoadScene,
      runtimeStyle: {style: emptyStyle, fontFaces: []},
      settings: () => assert.fail('settings must not be read'),
      signal: abort.signal,
    }),
    {name: 'AbortError'},
  );
});
