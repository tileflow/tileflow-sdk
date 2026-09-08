import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {
  applyOptionalGeoIpInitialViewport,
  type InitialViewportCamera,
  runInitialViewportExample,
} from '../examples/initial-viewport';

const mapId = 'map_1234567890abcdef';

test('bundles the browser consumer example without a Node process global', async () => {
  const require = createRequire(import.meta.url);
  const {build} = createRequire(require.resolve('tsup'))('esbuild');
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../examples/initial-viewport.ts', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'geoIpExample',
    write: false,
  });
  const example = runInNewContext(`${bundle.outputFiles[0].text}; geoIpExample`, {
    Response,
    TextDecoder,
    TextEncoder,
    URL,
  });
  assert.equal(
    JSON.stringify(await example.runInitialViewportExample()),
    JSON.stringify({center: [-9.1393, 38.7223], zoom: 8}),
  );
});

test('executes the deterministic fixture without a network request', async () => {
  assert.deepEqual(await runInitialViewportExample(), {
    center: [-9.1393, 38.7223],
    zoom: 8,
  });
});

test('applies one optional initial viewport from a useful managed GeoIP position', async () => {
  const camera = createCamera();
  const result = await applyOptionalGeoIpInitialViewport(camera, {
    apiUrl: 'https://api.example.test',
    fetch: fixture({
      location: {position: [-9.1393, 38.7223]},
      schemaVersion: 1,
      status: 'available',
      usage: {units: 1},
    }),
    mapId,
  });

  assert.equal(result, true);
  assert.deepEqual(camera.viewport, {center: [-9.1393, 38.7223], zoom: 8});
});

test('preserves the fallback for absent positions, unavailable results and GeoIP errors', async () => {
  for (const response of [
    {
      location: {countryCode: 'PT'},
      schemaVersion: 1,
      status: 'available' as const,
      usage: {units: 1},
    },
    {location: null, schemaVersion: 1, status: 'unavailable' as const, usage: {units: 0}},
  ]) {
    const camera = createCamera();
    assert.equal(
      await applyOptionalGeoIpInitialViewport(camera, {
        apiUrl: 'https://api.example.test',
        fetch: fixture(response),
        mapId,
      }),
      false,
    );
    assert.equal(camera.viewport, null);
  }

  const camera = createCamera();
  assert.equal(
    await applyOptionalGeoIpInitialViewport(camera, {
      fetch: async () => new Response('unavailable', {status: 503}),
      apiUrl: 'https://api.example.test',
      mapId,
    }),
    false,
  );
  assert.equal(camera.viewport, null);
});

test('does not request or replace an explicit initial viewport', async () => {
  const camera = createCamera({center: [2.3522, 48.8566], zoom: 12});
  let calls = 0;

  assert.equal(
    await applyOptionalGeoIpInitialViewport(camera, {
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
      apiUrl: 'https://api.example.test',
      mapId,
    }),
    false,
  );
  assert.equal(calls, 0);
  assert.deepEqual(camera.viewport, {center: [2.3522, 48.8566], zoom: 12});
});

test('does not request when the user has already interacted', async () => {
  const camera = createCamera();
  camera.interacted = true;
  let calls = 0;

  assert.equal(
    await applyOptionalGeoIpInitialViewport(camera, {
      apiUrl: 'https://api.example.test',
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
      mapId,
    }),
    false,
  );
  assert.equal(calls, 0);
});

test('does not replace a viewport after the user interacts while GeoIP is pending', async () => {
  const camera = createCamera();
  let resolve: ((response: Response) => void) | undefined;
  const pending = applyOptionalGeoIpInitialViewport(camera, {
    apiUrl: 'https://api.example.test',
    fetch: async () =>
      new Promise<Response>((accept) => {
        resolve = accept;
      }),
    mapId,
  });

  camera.interacted = true;
  resolve?.(
    Response.json({
      location: {position: [-9.1393, 38.7223]},
      schemaVersion: 1,
      status: 'available',
      usage: {units: 1},
    }),
  );

  assert.equal(await pending, false);
  assert.equal(camera.viewport, null);
});

function fixture(response: unknown): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.example.test/v1/geoip');
    assert.equal(request.headers.get('Authorization'), null);
    assert.deepEqual(await request.json(), {mapId});
    return Response.json(response);
  };
}

function createCamera(explicit: InitialViewportCamera['viewport'] = null) {
  return {
    interacted: false,
    viewport: explicit,
    hasExplicitViewport() {
      return explicit !== null;
    },
    hasUserInteracted() {
      return this.interacted;
    },
    setInitialViewport(viewport: NonNullable<InitialViewportCamera['viewport']>) {
      this.viewport = viewport;
    },
  } satisfies InitialViewportCamera & {interacted: boolean};
}
