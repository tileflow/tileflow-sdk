import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionDiagnostic} from '@tileflow/interactions';
import {createTileflowMap, type TileflowMapStatus} from '../src/index';

/** An element in a document with a window, enough for the map before MapLibre is created. */
function fakeContainer() {
  const attributes = new Map<string, string>();
  const window = {
    cancelAnimationFrame: () => undefined,
    requestAnimationFrame: () => 0,
  };
  const element = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    ownerDocument: {defaultView: window},
    removeAttribute: (name: string) => void attributes.delete(name),
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
  };
  return {attributes, element: element as unknown as HTMLElement};
}

/** Answers manifest requests when the test says so. */
function deferredFetch(t: test.TestContext) {
  const requests: {resolve: (response: Response) => void; url: string}[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    new Promise<Response>((resolve) => requests.push({resolve, url}))) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return requests;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let manifestCounter = 0;
const uniqueManifestUrl = () =>
  `https://maps.example.test/m${(manifestCounter += 1)}/manifest.json`;

test(
  'runtime edits cannot cross a source replacement or survive destruction',
  {timeout: 2_000},
  async (t) => {
    deferredFetch(t);
    const {element} = fakeContainer();
    const map = createTileflowMap(element, {
      source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
    });
    const source = {type: 'geojson', data: {type: 'FeatureCollection', features: []}};
    const previous = assert.rejects(map.addSource('previous', source), {code: 'disposed'});

    map.update({source: {manifestUrl: uniqueManifestUrl(), map: 'london'}});
    await previous;

    const next = assert.rejects(map.addSource('next', source), {code: 'disposed'});
    map.destroy();
    await next;
    await assert.rejects(map.removeSource('next'), {code: 'disposed'});
  },
);

test('a failed manifest rejects queued runtime edits', {timeout: 2_000}, async (t) => {
  const requests = deferredFetch(t);
  const {element} = fakeContainer();
  const map = createTileflowMap(element, {
    onError() {},
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });
  const pending = assert.rejects(map.addSource('points', {type: 'geojson'}));
  await flush();
  requests[0]!.resolve(new Response('not found', {status: 404}));
  await pending;
  map.destroy();
});

test('marks the container for capture while the map loads, and clears it on destroy', async (t) => {
  deferredFetch(t);
  const {attributes, element} = fakeContainer();
  const map = createTileflowMap(
    element,
    {source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'}, theme: 'dark'},
    {captureId: 'hero'},
  );

  assert.equal(attributes.get('data-tileflow-state'), 'loading');
  assert.equal(attributes.get('data-tileflow-map'), 'madrid');
  assert.equal(attributes.get('data-tileflow-theme'), 'dark');
  assert.equal(attributes.get('data-tileflow-capture-id'), 'hero');
  assert.equal(map.getMap(), null);
  assert.equal(map.getThemeController(), null);

  map.destroy();
  assert.equal(attributes.size, 0);
  await assert.rejects(map.ready, {name: 'AbortError'});
});

test('a manifest that answers after destroy reports nothing and creates no map', async (t) => {
  const requests = deferredFetch(t);
  const {element} = fakeContainer();
  const errors: unknown[] = [];
  const statuses: TileflowMapStatus[] = [];
  const map = createTileflowMap(element, {
    onError: (event) => errors.push(event),
    onStatusChange: (status) => statuses.push(status),
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });
  await flush();
  assert.equal(requests.length, 1);
  const reported = statuses.length;

  map.destroy();
  requests[0]!.resolve(new Response('not found', {status: 404}));
  await flush();

  assert.deepEqual(errors, []);
  assert.equal(statuses.length, reported);
  assert.equal(map.getMap(), null);
  // Calls after destroy are ignored instead of reaching a torn-down map.
  map.setTheme('dark');
  map.destroy();
});

test('a missing manifest reports a manifest error, rejects ready and settles in error', async (t) => {
  const requests = deferredFetch(t);
  const {attributes, element} = fakeContainer();
  const codes: string[] = [];
  const map = createTileflowMap(element, {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });
  await flush();
  requests[0]!.resolve(new Response('not found', {status: 404}));

  await assert.rejects(map.ready, /No Tileflow manifest was found/u);
  await flush();
  assert.deepEqual(codes, ['manifest']);
  assert.equal(attributes.get('data-tileflow-state'), 'error');
  assert.equal(map.getStatus().readiness, 'error');
  map.destroy();
});

test('unchanged options do no work, and a changed source asks for its own manifest', async (t) => {
  const requests = deferredFetch(t);
  const {element} = fakeContainer();
  const manifestUrl = uniqueManifestUrl();
  const map = createTileflowMap(element, {source: {manifestUrl, map: 'madrid'}});
  await flush();
  assert.equal(requests.length, 1);

  // An adapter hands over all of its props on every render.
  map.update({mapOptions: {maxZoom: 18}, source: {manifestUrl, map: 'madrid'}});
  map.update({mapOptions: {maxZoom: 18}, source: {manifestUrl, map: 'madrid'}});
  await flush();
  assert.equal(requests.length, 1);

  const otherUrl = uniqueManifestUrl();
  map.update({source: {manifestUrl: otherUrl, map: 'madrid'}});
  await flush();
  assert.deepEqual(
    requests.map((request) => request.url),
    [manifestUrl, otherUrl],
  );
  map.destroy();
});

test('reports each interaction diagnostic once and shows it in the status', async (t) => {
  deferredFetch(t);
  const {attributes, element} = fakeContainer();
  const diagnostics: TileflowInteractionDiagnostic[] = [];
  const invalid = [{ariaLabel: '', coordinate: [500, 0], id: 'broken', kind: 'marker'}] as never;
  const map = createTileflowMap(element, {
    annotations: invalid,
    onInteractionDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });

  const reported = diagnostics.length;
  assert.ok(reported > 0);
  assert.equal(map.getStatus().readiness, 'error');
  assert.equal(attributes.get('data-tileflow-state'), 'error');
  assert.deepEqual(map.getStatus().diagnostics, diagnostics);

  // The same problem in a new array is not reported again.
  map.setAnnotations([...(invalid as unknown as unknown[])] as never);
  assert.equal(diagnostics.length, reported);

  map.setAnnotations([]);
  assert.deepEqual(map.getStatus().diagnostics, []);
  assert.equal(map.getStatus().readiness, 'loading');
  map.destroy();
});

test('a theme change shows in the status before the manifest arrives', async (t) => {
  deferredFetch(t);
  const {attributes, element} = fakeContainer();
  const map = createTileflowMap(element, {
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });

  assert.equal(map.getStatus().theme, undefined);
  map.setTheme('night');
  assert.equal(map.getStatus().theme, 'night');
  assert.equal(attributes.get('data-tileflow-theme'), 'night');
  map.setTheme('system');
  assert.equal(attributes.has('data-tileflow-theme'), false);
  map.destroy();
});

test('rejects invalid style options and views given together with render targets', (t) => {
  deferredFetch(t);
  const {element} = fakeContainer();
  assert.throws(
    () => createTileflowMap(element, {source: {map: ''}}),
    /Invalid Tileflow map options/u,
  );
  assert.throws(
    () =>
      createTileflowMap(element, {
        renderTargets: {onChange: () => undefined, popup: true},
        source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
        views: {popup: () => undefined},
      }),
    /views or renderTargets/u,
  );
  const map = createTileflowMap(element, {
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });
  assert.throws(() => map.update({themeTransition: {duration: -1}}), /themeTransition/u);
  map.destroy();
});

test('an uncontrolled map keeps a requested popup until MapLibre exists', (t) => {
  deferredFetch(t);
  const {element} = fakeContainer();
  const map = createTileflowMap(element, {
    source: {manifestUrl: uniqueManifestUrl(), map: 'madrid'},
  });
  const state = {popup: {id: 'madrid', kind: 'annotation' as const}};

  map.setInteractionState(state);
  assert.deepEqual(map.getInteractionState(), state);
  assert.throws(() => map.setInteractionState({popup: {kind: 'nowhere'}} as never));
  map.destroy();
});
