import assert from 'node:assert/strict';
import test from 'node:test';
import {Script} from 'node:vm';
import {defineMap, parseTileflowMap, type TileflowMapScene} from '@tileflow/core';
import {
  createTileflowComparisonRequestHandler,
  tileflowComparisonSchemaVersion,
} from '../src/comparison';
import {renderTileflowComparisonHtml} from '../src/comparison-html';
import type {DevtoolsHost} from '../src/devtools/types';
import {previewSceneClient} from '../src/preview-scene';
import {fixtureLightTheme} from './theme-fixture';

const leftHandler = (request: Request) =>
  new Response(`left:${new URL(request.url).pathname}`, {headers: {'x-side': 'left'}});
const rightHandler = (request: Request) =>
  new Response(`right:${new URL(request.url).pathname}`, {headers: {'x-side': 'right'}});

test('renders a map-only workspace with a versioned bridge and no capture or comparison chrome', () => {
  const html = renderTileflowComparisonHtml({
    basePath: '',
    initialMode: 'side-by-side',
    left: {
      basePath: '/__left',
      eventsUrl: '/__left/__events',
      label: 'Baedeker',
      previewUrl: '/__left/?map=baedeker&theme=paper',
      sidecarUrl: '/__left/__inspection.json?map=baedeker',
      statusUrl: '/__left/__status',
    },
    right: {
      basePath: '/__right',
      eventsUrl: '/__right/__events',
      label: '1777',
      previewUrl: '/__right/?map=map-1777&theme=paper',
      statusUrl: '/__right/__status',
    },
    schemaVersion: 1,
    title: 'Historical maps',
  });

  assert.match(html, /data-mode="side-by-side"/);
  assert.match(html, /data-mode="split"/);
  assert.match(html, /data-mode="overlay"/);
  assert.match(html, /data-mode="blink"/);
  assert.match(html, /tileflow:comparison-set-camera/);
  assert.match(html, /const bridgeSchemaVersion = 1/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /singleQueryValue\(query, "split"\)/);
  assert.match(html, /singleQueryValue\(query, "alpha"\)/);
  assert.match(html, /side\.sidecarPromise = undefined/);
  assert.match(html, /side\.sidecarAbort\?\.abort\(\)/);
  assert.match(html, /side\.loadEpoch !== epoch/);
  assert.match(html, /selectedInspection\?\.side === side/);
  assert.match(html, /The selected map reloaded; click a rendered feature again/);
  assert.match(html, /function currentSidecarUrl\(side\)/);
  assert.match(html, /metadata\?\.\["tileflow:theme"\]/);
  assert.match(html, /queryRenderedFeatures/);
  assert.match(html, /selectedInspection\.features\[selectedInspection\.featureIndex\]/);
  assert.match(html, /Rendered feature at inspected point/);
  assert.match(html, /evaluateBasicZoomValue/);
  assert.match(html, /Unsupported or data-driven expression; no approximate curve is shown/);
  assert.match(html, /sampled every 0\.25 zoom/);
  assert.match(html, /Sprite atlas/);
  assert.match(html, /spriteAssetUrl\(base, "\.json"\)/);
  assert.match(html, /urlBelongsToSide\(base, side\)/);
  for (const id of [
    'capture-settings',
    'copy-scene',
    'copy-command',
    'wb-capture',
    'wb-review',
    'wb-history',
    'wb-live-tools',
    'wb-selection-context',
    'controls-copy',
    'controls-close',
    'controls-owner',
    'wb-view',
    'wb-map',
    'wb-scene',
  ])
    assert.doesNotMatch(html, new RegExp('id="' + id + '"'));
  assert.doesNotMatch(html, /class="(?:brandbar|toolbar|pane-label|statusbar)"/);
  assert.match(html, /__workbench-runtime\/devtools\.js/);
  assert.match(html, /roundNumber\(camera\.zoom\)/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /aria-controls="inspector"/);
  assert.match(html, /message\.requestId !== side\.lastCameraRequestId/);
  assert.match(html, /generation < side\.artifactGeneration/);
  assert.match(html, /data-tileflow-capture-id="tileflow-comparison"/);
  assert.doesNotMatch(html, /unpkg|jsdelivr|fonts\.googleapis/iu);
  const script = /<script type="module">\s*([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script, {filename: 'comparison-browser.js'}));
});

test('single-map Workbench loads one viewer and retains camera and inspection controls', async () => {
  const harness = runComparisonHarness('?mode=blink&driver=right', {single: true});
  harness.load('left');
  await harness.settle();
  assert.equal(harness.element('stage').dataset.mode, 'single');
  assert.equal(harness.element('stage').dataset.driver, 'left');
  assert.equal(harness.element('right-frame').listeners.has('load'), false);
  harness.element('inspect-toggle').dispatch('click');
  assert.equal(harness.element('inspector').hidden, false);
  assert.equal(harness.maps.right.jumpCalls.length, 0);
});

test('Inspect row hover previews geometry without changing the selected edit target', async () => {
  const harness = runComparisonHarness('', {single: true});
  const container = Object.assign(new FakeElement(), {clientHeight: 600, clientWidth: 800});
  let offset = 0;
  Object.assign(harness.maps.left, {
    getContainer: () => container,
    project: ([x, y]: number[]) => ({x: x * 10 + offset, y: y * 10}),
  });
  const selected = {
    geometry: {type: 'Point', coordinates: [2, 3]},
    id: 1,
    layer: {id: 'selected'},
    properties: {},
  };
  const hovered = {
    geometry: {type: 'Point', coordinates: [7, 8]},
    id: 2,
    layer: {id: 'hovered'},
    properties: {},
  };
  harness.maps.left.renderedFeatures = [selected, hovered];
  harness.load('left');
  await harness.settle();
  harness.host.inspect(true);
  harness.maps.left.emit('click', {point: {x: 20, y: 30}, lngLat: {lng: 2, lat: 3}});
  const side = harness.host.active();
  const overlay = container.children[0] as FakeElement;
  const circle = () => overlay.children[0] as FakeElement;
  assert.equal(circle().attributes.get('cx'), '20');

  side.hoverFeature!(1);
  assert.equal(circle().attributes.get('cx'), '70');
  assert.equal(harness.host.selection()!.featureIndex, 0);
  assert.equal(side.getInspectedFeature!(), selected);
  // The preview follows the camera while leaving the selected feature untouched.
  offset = 5;
  harness.maps.left.emit('move');
  assert.equal(circle().attributes.get('cx'), '75');
  side.hoverFeature!(-1);
  assert.equal(circle().attributes.get('cx'), '25');
  assert.equal(side.getInspectedFeature!(), selected);
  side.hoverFeature!(999);
  assert.equal(circle().attributes.get('cx'), '25');

  side.hoverFeature!(1);
  harness.host.selectFeature(1);
  side.hoverFeature!(-1);
  assert.equal(side.getInspectedFeature!(), hovered);
  assert.equal(circle().attributes.get('cx'), '75');
  // Reconnecting must remove the old overlay and discard the old hover data.
  harness.load('left');
  assert.equal(overlay.removed, true);
  side.hoverFeature!(1);
  assert.equal(container.children.length, 1);
});

test('Controls waits safely while the map is replacing its style', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.maps.left.getStyle = () => undefined as never;
  harness.load('left');
  await harness.settle();
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  await harness.settle();
  assert.equal(harness.element('map-controls').hidden, false);
  assert.equal(harness.element('controls-modules').disabled, true);
});

test('Controls recovers after a temporary style gap without changing the map generation', async () => {
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: () => Response.json(controlsFixture),
  });
  harness.load('left');
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  const getStyle = harness.maps.left.getStyle.bind(harness.maps.left);
  await harness.settle();
  harness.maps.left.getStyle = () => undefined as never;
  harness.pollIntervals();
  await harness.settle();
  assert.equal(harness.element('controls-modules').disabled, false);
  harness.maps.left.getStyle = getStyle;
  harness.pollIntervals();
  await harness.settle();
  assert.equal(harness.element('controls-modules').disabled, false);
});

test('Controls toggles on the first click', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.load('left');
  await harness.settle();
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  assert.equal(harness.element('map-controls').hidden, false);
  await harness.click('controls-toggle');
  assert.equal(harness.element('map-controls').hidden, true);
});

const controlsFixture = {
  map: 'map',
  theme: 'theme',
  modules: [
    {id: 'roads', enabled: true, fields: []},
    {
      id: 'vegetation',
      enabled: true,
      fields: [
        {
          path: 'mode',
          label: 'Tree representation',
          value: '3d',
          choices: ['3d', 'auto', 'flat'],
          inherit: true,
        },
        {path: 'threeDimensional.heightScale', label: 'Height', value: 1, min: 0, max: 10},
      ],
    },
  ],
};

test('Vegetation Auto inherits the map and returning to it removes only the mode override', async () => {
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      Response.json(url.pathname.endsWith('/__controls') ? controlsFixture : {}),
  });
  harness.load('left');
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  await harness.settle();
  const modules = harness.element('controls-modules');
  const representation = () => modules.querySelectorAll('select')[0]!;
  assert.equal(representation().value, 'inherit');
  assert.equal((representation().options[0] as FakeElement).textContent, 'Auto · Always 3D');
  // Keep another authored change while switching representation and back to Auto.
  const height = modules.querySelectorAll('input').find((input) => input.type === 'number')!;
  height.value = '1.2';
  height.dispatch('input');
  representation().value = 'auto';
  representation().dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  const patch = () => JSON.parse(new URL(harness.previewUrl()).searchParams.get('controls')!);
  assert.equal(patch().vegetation.mode, 'auto');
  harness.pollIntervals();
  await harness.settle();
  assert.equal(representation().value, 'auto');
  representation().value = 'inherit';
  representation().dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.deepEqual(patch(), {vegetation: {threeDimensional: {heightScale: 1.2}}});
  harness.pollIntervals();
  await harness.settle();
  assert.equal(representation().value, 'inherit');
});

test('Controls automatically groups edits, preserves the camera and keeps active module fields visible', async () => {
  const compiled: URL[] = [];
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) => {
      if (url.pathname.endsWith('/__controls')) return Response.json(controlsFixture);
      compiled.push(url);
      return Response.json({});
    },
  });
  harness.load('left');
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  await harness.settle();
  const modules = harness.element('controls-modules');
  const fields = modules.querySelectorAll('fieldset')[0]!;
  assert.equal(fields.hidden, false);
  const height = modules.querySelectorAll('input').find((input) => input.type === 'number')!;
  for (const value of ['1.2', '1.4', '1.6']) {
    height.value = value;
    height.dispatch('input');
  }
  assert.equal(compiled.length, 0);
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(compiled.length, 1);
  assert.deepEqual(JSON.parse(compiled[0]!.searchParams.get('controls')!), {
    vegetation: {threeDimensional: {heightScale: 1.6}},
  });
  const frame = harness.element('left-frame');
  const url = new URL(harness.previewUrl());
  assert.equal(url.searchParams.get('lng'), '-5');
  assert.equal(url.searchParams.get('zoom'), '5');
  assert.equal(modules.disabled, false);
  assert.equal(frame.src, '/left/');
  assert.equal(
    modules.querySelectorAll('input').find((input) => input.type === 'number'),
    height,
  );
  harness.pollIntervals();
  await harness.settle();
  assert.equal(modules.disabled, false);
  assert.equal(fields.hidden, false);
});

test('Controls discards an obsolete compile and applies the latest edit without another click', async () => {
  const requests: {url: URL; resolve: (response: Response) => void}[] = [];
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      url.pathname.endsWith('/__controls')
        ? Response.json(controlsFixture)
        : new Promise<Response>((resolve) => requests.push({url, resolve})),
  });
  harness.load('left');
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  await harness.settle();
  const frame = harness.element('left-frame'),
    initial = frame.src;
  const height = harness
    .element('controls-modules')
    .querySelectorAll('input')
    .find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  harness.flushTimeouts();
  height.value = '3';
  height.dispatch('input');
  const modules = harness.element('controls-modules');
  assert.equal(modules.disabled, false);
  assert.equal(harness.element('controls-runtime').disabled, false);
  const camera = {center: [-3, 41] as [number, number], zoom: 14, bearing: 30, pitch: 45};
  harness.maps.left.camera = camera;
  harness.flushTimeouts();
  assert.equal(requests.length, 1);
  requests[0]!.resolve(Response.json({}));
  await harness.settle();
  assert.equal(frame.src, initial);
  assert.equal(harness.maps.left.styleCalls.length, 0);
  assert.equal(requests.length, 2);
  requests[1]!.resolve(Response.json({}));
  await harness.settle();
  assert.deepEqual(JSON.parse(new URL(harness.previewUrl()).searchParams.get('controls')!), {
    vegetation: {threeDimensional: {heightScale: 3}},
  });
  assert.equal(harness.maps.left.styleCalls.length, 1);
  assert.deepEqual(harness.maps.left.camera, camera);
  assert.equal(new URL(harness.previewUrl()).searchParams.get('zoom'), '14');
  assert.equal(
    modules.querySelectorAll('input').find((input) => input.type === 'number'),
    height,
  );
});

test('3D and animation update the existing runtime without fetching or replacing the style', async () => {
  const compiled: URL[] = [];
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) => {
      if (url.pathname.endsWith('/__controls')) return Response.json(controlsFixture);
      compiled.push(url);
      return Response.json({});
    },
  });
  harness.load('left');
  await harness.settle();
  const camera = structuredClone(harness.maps.left.camera);
  harness.element('controls-3d').checked = true;
  harness.element('controls-3d').dispatch('change');
  harness.element('controls-animation').value = '800';
  harness.element('controls-animation').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  const query = new URL(harness.previewUrl()).searchParams;
  assert.equal(query.get('buildings3d'), 'on');
  assert.equal(query.get('animation'), '800');
  assert.equal(compiled.length, 0);
  assert.equal(harness.maps.left.styleCalls.length, 0);
  assert.equal(harness.element('left-frame').src, '/left/');
  assert.deepEqual(harness.maps.left.camera, camera);
  harness.element('controls-3d').checked = false;
  harness.element('controls-3d').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('buildings3d'), 'off');
  assert.deepEqual(harness.maps.left.camera, camera);
});

test('scene style changes keep custom 3D layers above reinserted surfaces without remounting', async () => {
  const ground = {id: 'ground', type: 'fill'};
  const labels = {id: 'labels', type: 'symbol'};
  const buildings = {id: 'buildings-3d', type: 'custom'};
  const trees = {id: 'trees-3d', type: 'custom'};
  const overlay = {id: 'overlay', type: 'custom'};
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      Response.json(
        url.pathname.endsWith('/__controls') ? controlsFixture : {layers: [ground, labels]},
      ),
  });
  harness.load('left');
  await harness.settle();
  const map = harness.maps.left;
  map.styleLayers = [ground, buildings, trees, {id: 'old-label', type: 'symbol'}, labels, overlay];
  const setStyle = map.setStyle.bind(map);
  map.setStyle = (style, options) => {
    setStyle(style, options);
    // MapLibre excludes custom layers from style diffs. Reinserted source layers land
    // above the still-mounted custom layers, which must keep their relative anchors.
    map.styleLayers = [buildings, trees, overlay, ...map.styleLayers];
  };
  harness.element('controls-3d').checked = true;
  const height = harness
    .element('controls-modules')
    .querySelectorAll('input')
    .find((input) => input.type === 'number')!;
  for (const value of ['2', '3']) {
    height.value = value;
    height.dispatch('input');
    harness.flushTimeouts();
    await harness.settle();
    assert.deepEqual(map.getLayersOrder(), [
      'ground',
      'buildings-3d',
      'trees-3d',
      'labels',
      'overlay',
    ]);
    assert.equal(map.getLayer('buildings-3d'), buildings);
    assert.equal(map.getLayer('trees-3d'), trees);
    assert.equal(map.getLayer('overlay'), overlay);
    assert.equal(new URL(harness.previewUrl()).searchParams.get('buildings3d'), 'on');
    assert.equal(harness.element('left-frame').src, '/left/');
  }
});

test('restorable styles strip renderer timing flags before reaching style validation', async () => {
  const saved = {
    version: 8,
    collectResourceTiming: true,
    sources: {
      tiles: {type: 'vector', url: 'https://example.test/tiles.json', collectResourceTiming: true},
    },
    layers: [],
  };
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      Response.json(url.pathname.endsWith('/__controls') ? controlsFixture : saved),
  });
  harness.load('left');
  await harness.settle();
  const height = harness
    .element('controls-modules')
    .querySelectorAll('input')
    .find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.settle();
  const applied = harness.maps.left.styleCalls.at(-1)!.style as typeof saved;
  assert.equal('collectResourceTiming' in applied, false);
  assert.equal('collectResourceTiming' in applied.sources.tiles, false);
  assert.equal(applied.sources.tiles.url, saved.sources.tiles.url);
  assert.equal(saved.sources.tiles.collectResourceTiming, true);
});

test('an edit superseded during font preparation never reaches MapLibre', async () => {
  let finishFonts!: () => void;
  let preparations = 0;
  const harness = runComparisonHarness('', {
    single: true,
    prepareScene: () =>
      ++preparations === 1
        ? new Promise<void>((resolve) => {
            finishFonts = resolve;
          })
        : Promise.resolve(),
    controlsRequest: (url) =>
      Response.json(url.pathname.endsWith('/__controls') ? controlsFixture : {}),
  });
  harness.load('left');
  await harness.settle();
  const height = harness
    .element('controls-modules')
    .querySelectorAll('input')
    .find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(preparations, 1);
  height.value = '4';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(harness.maps.left.styleCalls.length, 0);
  finishFonts();
  await harness.settle();
  assert.equal(harness.maps.left.styleCalls.length, 1);
  assert.deepEqual(JSON.parse(new URL(harness.previewUrl()).searchParams.get('controls')!), {
    vegetation: {threeDimensional: {heightScale: 4}},
  });
  assert.equal(harness.element('left-frame').src, '/left/');
});

test('a failed compile leaves the map and editable values intact, and a later edit recovers', async () => {
  let failed = true;
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      url.pathname.endsWith('/__controls')
        ? Response.json(controlsFixture)
        : failed
          ? Response.json({error: 'Invalid setting'}, {status: 400})
          : Response.json({}),
  });
  harness.load('left');
  await harness.settle();
  const modules = harness.element('controls-modules');
  const height = modules.querySelectorAll('input').find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(harness.element('controls-status').hidden, false);
  assert.equal(modules.disabled, false);
  assert.equal(harness.maps.left.styleCalls.length, 0);
  assert.equal(height.value, '2');
  failed = false;
  height.value = '3';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(harness.maps.left.styleCalls.length, 1);
  assert.equal(harness.element('controls-status').hidden, true);
  assert.equal(harness.element('left-frame').src, '/left/');
});

test('theme changes share the latest-edit queue and never replace focused module fields', async () => {
  const requests: {url: URL; resolve: (response: Response) => void}[] = [];
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      url.pathname.endsWith('/__controls')
        ? Response.json({...controlsFixture, theme: url.searchParams.get('theme')})
        : !url.searchParams.has('controls')
          ? Response.json({layers: []}) // Theme swatches read base styles independently of edits.
          : new Promise<Response>((resolve) => requests.push({url, resolve})),
    workbenchRequest: (path) =>
      path === ''
        ? {
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections: ['theme', 'dark'].map((theme) => ({
                  id: 'map:map:' + theme,
                  map: 'map',
                  theme,
                  url: '/left/?map=map&theme=' + theme,
                })),
              },
            },
          }
        : {saved: true},
  });
  harness.load('left');
  await harness.settle();
  const modules = harness.element('controls-modules');
  const height = modules.querySelectorAll('input').find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  harness.flushTimeouts();
  harness.element('wb-theme').value = 'dark';
  harness.element('wb-theme').dispatch('change');
  height.value = '3';
  height.dispatch('input');
  harness.focus(height);
  harness.flushTimeouts();
  await harness.settle();
  harness.pollIntervals();
  await harness.settle();
  assert.equal(harness.element('wb-theme').value, 'dark');
  assert.equal(modules.disabled, false);
  assert.equal(harness.activeElement(), height);
  assert.equal(
    modules.querySelectorAll('input').find((input) => input.type === 'number'),
    height,
  );
  assert.equal(height.value, '3');
  requests[0]!.resolve(Response.json({}));
  await harness.settle();
  assert.equal(harness.maps.left.styleCalls.length, 0);
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.url.pathname, /\/dark.json$/);
  assert.deepEqual(JSON.parse(requests[1]!.url.searchParams.get('controls')!), {
    vegetation: {threeDimensional: {heightScale: 3}},
  });
  requests[1]!.resolve(
    Response.json({metadata: {'tileflow:map': 'map', 'tileflow:theme': 'dark'}}),
  );
  await harness.settle();
  harness.pollIntervals();
  await harness.settle();
  assert.equal(harness.maps.left.metadata['tileflow:theme'], 'dark');
  assert.equal(harness.activeElement(), height);
  assert.equal(harness.element('left-frame').src, '/left/');
});

test('Controls rejects incomplete input and Reset supersedes a pending compilation', async () => {
  const requests: {url: URL; resolve: (response: Response) => void}[] = [];
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: (url) =>
      url.pathname.endsWith('/__controls')
        ? Response.json(controlsFixture)
        : new Promise<Response>((resolve) => requests.push({url, resolve})),
  });
  harness.load('left');
  harness.element('map-controls').hidden = true;
  await harness.click('controls-toggle');
  await harness.settle();
  const height = harness
    .element('controls-modules')
    .querySelectorAll('input')
    .find((input) => input.type === 'number')!;
  height.value = '2';
  height.dispatch('input');
  height.value = '';
  height.dispatch('input');
  harness.flushTimeouts();
  assert.equal(requests.length, 0);
  height.value = '3';
  height.dispatch('input');
  harness.flushTimeouts();
  await harness.click('controls-reset');
  harness.flushTimeouts();
  requests[0]!.resolve(Response.json({}));
  await harness.settle();
  // Reset matches the already displayed original style; no second compile is necessary.
  assert.equal(requests.length, 1);
  const url = new URL(harness.previewUrl());
  assert.equal(url.searchParams.has('controls'), false);
  assert.equal(url.searchParams.get('buildings3d'), 'on');
});

test('single-map router serves only its configured side and advanced Workbench', async () => {
  const handler = createTileflowComparisonRequestHandler({
    left: {basePath: '/map', handler: leftHandler, label: 'Streets', previewUrl: '/map/'},
  });
  const shell = await handler(new Request('http://localhost/'));
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Inspect the map/);
  assert.equal(
    (await handler(new Request('http://localhost/map/style.json'))).headers.get('x-side'),
    'left',
  );
  assert.equal((await handler(new Request('http://localhost/right/'))).status, 404);
});

test('serializes labels and URLs without allowing an inline-script breakout', () => {
  const attack = '</script><script>globalThis.compromised=true</script>';
  const html = renderTileflowComparisonHtml({
    basePath: '',
    initialMode: 'overlay',
    left: {
      basePath: '/left',
      eventsUrl: '/left/__events',
      label: attack,
      previewUrl: '/left/?map=one&note=%3C/script%3E',
      statusUrl: '/left/__status',
    },
    right: {
      basePath: '/right',
      eventsUrl: '/right/__events',
      label: 'Right',
      previewUrl: '/right/?map=two',
      statusUrl: '/right/__status',
    },
    schemaVersion: 1,
    title: attack,
  });

  assert.doesNotMatch(html, /<title><\/script>/);
  assert.doesNotMatch(html, /const options = \{[^;]*<\/script>/s);
  assert.match(html, /&lt;\/script&gt;/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test('seeds camera from the URL driver deterministically and does not echo passive jumps', () => {
  const harness = runComparisonHarness('?driver=right');

  harness.load('left');
  assert.equal(new URL(harness.currentUrl()).searchParams.has('zoom'), false);
  assert.equal(harness.maps.left.jumpCalls.length, 0);

  harness.load('right');
  const synchronized = new URL(harness.currentUrl());
  assert.equal(synchronized.searchParams.get('driver'), 'right');
  assert.equal(synchronized.searchParams.get('lng'), '20');
  assert.equal(synchronized.searchParams.get('lat'), '10');
  assert.equal(synchronized.searchParams.get('zoom'), '7');
  assert.deepEqual(harness.maps.left.jumpCalls, [
    {bearing: 3, center: [20, 10], pitch: 4, zoom: 7},
  ]);
  assert.deepEqual(harness.maps.right.jumpCalls, []);

  harness.flushAnimationFrames();
  assert.deepEqual(harness.maps.right.jumpCalls, []);
});

test('keeps the selected driver when a mode resize emits a passive camera event', () => {
  const harness = runComparisonHarness('?driver=left&lng=-5&lat=40&zoom=5&bearing=1&pitch=2');
  harness.load('left');
  harness.load('right');
  harness.flushAnimationFrames();

  harness.clickMode('split');
  harness.maps.right.camera = {bearing: 8, center: [30, 25], pitch: 9, zoom: 8};
  harness.maps.right.emit('movestart', {});
  harness.maps.right.emit('move', {});
  harness.maps.right.emit('moveend', {});
  harness.flushAnimationFrames();

  const afterSplit = new URL(harness.currentUrl());
  assert.equal(afterSplit.searchParams.get('mode'), 'split');
  assert.equal(afterSplit.searchParams.get('driver'), 'left');
  assert.equal(afterSplit.searchParams.get('lng'), '-5');
  assert.deepEqual(harness.maps.right.jumpCalls.at(-1), {
    bearing: 1,
    center: [-5, 40],
    pitch: 2,
    zoom: 5,
  });

  harness.clickMode('overlay');
  assert.equal(new URL(harness.currentUrl()).searchParams.get('driver'), 'left');
});

test('still promotes and synchronizes an explicitly user-initiated camera move', () => {
  const harness = runComparisonHarness('?driver=left&lng=-5&lat=40&zoom=5&bearing=1&pitch=2');
  harness.load('left');
  harness.load('right');
  harness.flushAnimationFrames();

  const originalEvent = {type: 'wheel'};
  harness.maps.right.camera = {bearing: 4, center: [21, 11], pitch: 6, zoom: 9};
  harness.maps.right.emit('movestart', {originalEvent});
  harness.maps.right.emit('move', {originalEvent});
  harness.maps.right.emit('moveend', {originalEvent});
  harness.flushAnimationFrames();

  const synchronized = new URL(harness.currentUrl());
  assert.equal(synchronized.searchParams.get('driver'), 'right');
  assert.equal(synchronized.searchParams.get('lng'), '21');
  assert.deepEqual(harness.maps.left.jumpCalls.at(-1), {
    bearing: 4,
    center: [21, 11],
    pitch: 6,
    zoom: 9,
  });
});

test('selects the inspected side and exposes every bounded rendered feature', () => {
  const harness = runComparisonHarness();
  harness.load('left');
  harness.load('right');
  harness.element('inspect-toggle').dispatch('click');
  harness.maps.right.renderedFeatures = [
    {geometry: {type: 'Polygon'}, id: 1, layer: {id: 'top'}, properties: {name: 'Top'}},
    {geometry: {type: 'LineString'}, id: 2, layer: {id: 'below'}, properties: {name: 'Below'}},
  ];
  harness.maps.right.styleLayers = [
    {
      id: 'top',
      paint: {
        'fill-opacity': ['interpolate', ['cubic-bezier', 0.42, 0, 0.58, 1], ['zoom'], 0, 0, 24, 1],
      },
      type: 'fill',
    },
  ];
  harness.maps.right.emit('click', {lngLat: {lat: 10, lng: 20}, point: {x: 4, y: 5}});

  assert.equal(new URL(harness.currentUrl()).searchParams.get('driver'), 'right');
  const inspection = harness.element('inspection');
  const pickerLabel = inspection.children[1] as FakeElement;
  const picker = pickerLabel.children[1] as FakeElement;
  assert.equal(picker.children.length, 2);
  const curveMessage = harness.element('curve-output').children[0] as FakeElement;
  assert.match(curveMessage.textContent, /no approximate curve is shown/);
});

test('emits semantic attribution from the selected compiler-sidecar layer', async () => {
  const token = {
    authoringPath: 'themes.dark.tokens.color.landcover.urbanPark',
    category: 'color',
    token: 'landcover.urbanPark',
  };
  const harness = runComparisonHarness('', {
    leftSidecar: {
      layers: [
        {
          contributions: [
            {
              authoringPaths: [token.authoringPath],
              operations: [
                {
                  kind: 'refinement',
                  owner: 'land',
                  target: 'land.landcover.urbanPark.fill',
                },
              ],
              owner: 'land',
              slot: 'land',
              target: 'land.landcover.urbanPark.fill',
              themeTokens: [token],
            },
            {
              operations: [],
              owner: 'land',
              slot: 'land',
              target: 'land.landcover.grass.fill',
            },
          ],
          id: 'park',
          index: 3,
          type: 'fill',
        },
      ],
      map: 'map',
      schemaVersion: 1,
      theme: 'dark',
    },
  });
  harness.load('left');
  harness.load('right');
  harness.element('inspect-toggle').dispatch('click');
  harness.maps.left.renderedFeatures = [
    {geometry: {type: 'Polygon'}, id: 1, layer: {id: 'park'}, properties: {}},
  ];
  harness.maps.left.styleLayers = [{id: 'park', type: 'fill'}];
  harness.maps.left.emit('click', {lngLat: {lat: 10, lng: 20}, point: {x: 4, y: 5}});
  await harness.settle();

  const output = JSON.parse(harness.element('sidecar-output').textContent) as {
    semanticAttribution: Array<Record<string, unknown>>;
  };
  assert.deepEqual(output.semanticAttribution, [
    {
      semanticOwner: 'land',
      semanticTarget: 'land.landcover.urbanPark.fill',
      authoringPaths: [
        'modules.land',
        'themes.dark.tokens.color.landcover.urbanPark',
        'modules.land.renderStack',
      ],
      themeTokens: [token],
    },
    {
      semanticOwner: 'land',
      semanticTarget: 'land.landcover.grass.fill',
      authoringPaths: ['modules.land'],
    },
  ]);
});

test('routes the shell and two existing handlers without changing side routes', async () => {
  const handler = createTileflowComparisonRequestHandler({
    left: {
      basePath: '/compare/left',
      handler: leftHandler,
      label: 'Left',
      previewUrl: '/compare/left/?map=left-map&theme=day',
      sidecarUrl: '/compare/left/__inspection.json?map=left-map&theme=day',
    },
    right: {
      basePath: '/compare/right',
      handler: rightHandler,
      label: 'Right',
      previewUrl: '/compare/right/?map=right-map&theme=night',
    },
    basePath: '/compare',
    initialMode: 'split',
  });

  const root = await handler(new Request('http://localhost/compare?mode=overlay'));
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type') ?? '', /text\/html/);
  const contentSecurityPolicy = root.headers.get('content-security-policy') ?? '';
  assert.match(contentSecurityPolicy, /default-src 'none'/);
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /script-src 'nonce-[^']+'/);
  const rootHtml = await root.text();
  assert.match(rootHtml, /"initialMode":"split"/);
  const nonce = /script-src 'nonce-([^']+)'/u.exec(contentSecurityPolicy)?.[1];
  assert.ok(nonce);
  assert.equal(rootHtml.includes(`<script type="module" nonce="${nonce}">`), true);
  assert.equal(rootHtml.includes(`<style nonce="${nonce}">`), true);

  const head = await handler(new Request('http://localhost/compare/', {method: 'HEAD'}));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const left = await handler(new Request('http://localhost/compare/left/styles/left-map/day.json'));
  assert.equal(left.headers.get('x-side'), 'left');
  assert.equal(await left.text(), 'left:/compare/left/styles/left-map/day.json');

  const right = await handler(new Request('http://localhost/compare/right/__events'));
  assert.equal(right.headers.get('x-side'), 'right');
  assert.equal(await right.text(), 'right:/compare/right/__events');

  const missing = await handler(new Request('http://localhost/compare/elsewhere'));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {error: 'Not found'});

  const method = await handler(new Request('http://localhost/compare', {method: 'POST'}));
  assert.equal(method.status, 405);
});

test('redacts path-bearing comparison label suffixes from the public shell', async () => {
  const handler = createTileflowComparisonRequestHandler({
    left: {
      basePath: '/left',
      handler: leftHandler,
      label: 'Candidate · /Users/alice/private/tileflow.candidate.ts',
      previewUrl: '/left/',
    },
    right: {
      basePath: '/right',
      handler: rightHandler,
      label: 'Reference · C:\\Users\\alice\\private\\tileflow.reference.ts',
      previewUrl: '/right/',
    },
  });

  const html = await (await handler(new Request('http://localhost/'))).text();
  assert.doesNotMatch(html, /Users|private/);
  assert.match(html, /Candidate · tileflow\.candidate\.ts/);
  assert.match(html, /Reference · tileflow\.reference\.ts/);
});

test('validates same-origin owned URLs and disjoint bounded route prefixes', () => {
  const base = {
    left: {
      basePath: '/left',
      handler: leftHandler,
      label: 'Left',
      previewUrl: '/left/',
    },
    right: {
      basePath: '/right',
      handler: rightHandler,
      label: 'Right',
      previewUrl: '/right/',
    },
  };

  assert.equal(tileflowComparisonSchemaVersion, 1);
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        right: {...base.right, basePath: '/left/nested', previewUrl: '/left/nested/'},
      }),
    /disjoint/,
  );
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        left: {...base.left, previewUrl: 'https://example.test/left/'},
      }),
    /previewUrl/,
  );
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        left: {...base.left, previewUrl: '/right/'},
      }),
    /remain below/,
  );
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        left: {...base.left, sidecarUrl: '/left/../../secret'},
      }),
    /sidecarUrl/,
  );
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        left: {...base.left, captureConfig: '/Users/alice/private/tileflow.config.ts'},
      }),
    /captureConfig/,
  );
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        ...base,
        left: {...base.left, captureConfig: '../private/tileflow.config.ts'},
      }),
    /captureConfig/,
  );
});

test('Workbench publishes viewport context and changes theme without replacing its camera', async () => {
  const requests: Array<{path: string; body: unknown}> = [];
  const selection = {
    id: 'map:map:faded',
    label: 'Faded',
    map: 'map',
    theme: 'faded',
    url: '/left/?map=map&theme=faded',
    camera: {type: 'center', center: [2, 41], zoom: 7},
    viewport: {width: 640, height: 480, dpr: 1},
  };
  const harness = runComparisonHarness('', {
    single: true,
    cleanupSecurityError: true,
    workbenchRequest: (path, body) => {
      requests.push({path, body});
      if (path === '')
        return {
          busy: false,
          sides: {
            left: {
              generation: 1,
              status: 'ready',
              selections: [
                {
                  ...selection,
                  id: 'map:map:theme',
                  theme: 'theme',
                  url: '/left/?map=map&theme=theme',
                },
                selection,
              ],
            },
          },
        };
      if (path === '/context') return {saved: true};
      if (path === '/capture') return {captureId: 'a'.repeat(64)};
      if (path === '/captures') return {records: [], next: null, warnings: []};
      throw new Error('Unexpected Workbench request ' + path);
    },
  });
  harness.load('left');
  await harness.settle();
  harness.pollIntervals();
  await harness.settle();
  const context = (
    requests.find((request) => request.path === '/context')!.body as {
      context: {
        definition: {viewport: {width: number; height: number}};
        displayedGeneration: number;
      };
    }
  ).context;
  assert.equal(context.definition.viewport.width, 800);
  assert.equal(context.definition.viewport.height, 600);
  assert.equal(context.displayedGeneration, 1);
  const camera = structuredClone(harness.maps.left.camera);
  harness.element('wb-theme').value = selection.theme;
  harness.element('wb-theme').dispatch('change');
  assert.match(harness.currentUrl(), /view=map%3Amap%3Afaded/);
  harness.flushTimeouts();
  await harness.settle();
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'faded');
  assert.deepEqual(harness.maps.left.camera, camera);
  assert.equal(requests.filter((request) => request.path === '/capture').length, 0);
});

test('Controls resolves the active map theme and populates its theme selector from the catalog', async () => {
  const harness = runComparisonHarness('', {
    single: true,
    workbenchRequest: (path) =>
      path === ''
        ? {
            busy: false,
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections: [
                  {
                    id: 'map:map:theme',
                    map: 'map',
                    theme: 'theme',
                    label: 'Map · theme',
                    url: '/left/?map=map&theme=theme',
                  },
                  {
                    id: 'map:map:dark',
                    map: 'map',
                    theme: 'dark',
                    label: 'Map · dark',
                    url: '/left/?map=map&theme=dark',
                  },
                ],
              },
            },
          }
        : {saved: true},
  });
  harness.load('left');
  await harness.settle();

  assert.deepEqual(
    (harness.element('wb-theme').options as FakeElement[]).map((option) => option.value),
    ['theme', 'dark'],
  );
  assert.equal(harness.element('wb-theme').value, 'theme');
  assert.equal(harness.element('wb-theme-field').hidden, false);
  assert.equal(harness.element('wb-time-of-day-field').hidden, true);
});

test('Workbench respects the command’s scene without exposing a scene selector', async () => {
  const harness = runComparisonHarness('', {
    single: true,
    leftPreviewUrl: '/left/?scene=proof',
    workbenchRequest: (path) =>
      path === ''
        ? {
            busy: false,
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections: [
                  {
                    id: 'scene:proof',
                    scene: 'proof',
                    map: 'map',
                    theme: 'theme',
                    label: 'Proof',
                    viewport: {width: 390, height: 844, dpr: 2},
                  },
                ],
              },
            },
          }
        : {saved: true},
  });
  harness.load('left');
  await harness.settle();
  assert.equal(harness.element('wb-theme').value, 'theme');
  assert.equal(harness.element('left-frame').src, '/left/?scene=proof');
});

test('Workbench API routes cannot shadow previews and bundled UI fonts are served locally', async () => {
  const left = {basePath: '/left', handler: leftHandler, label: 'Left', previewUrl: '/left/'};
  for (const url of ['/', '/left/api', '/__workbench-fonts'])
    assert.throws(() =>
      createTileflowComparisonRequestHandler({
        left,
        workbench: {url, handle: () => new Response()},
      }),
    );
  const handler = createTileflowComparisonRequestHandler({
    left,
    workbench: {url: '/__workbench', handle: () => Response.json({schemaVersion: 1})},
  });
  const response = await handler(new Request('http://localhost/__workbench-fonts/mona-sans.woff2'));
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.ok((await response.arrayBuffer()).byteLength > 1000);
  assert.equal(
    (
      await handler(
        new Request('http://localhost/__workbench-fonts/mona-sans.woff2', {method: 'POST'}),
      )
    ).status,
    405,
  );
  assert.equal(
    (await (await handler(new Request('http://localhost/__workbench'))).json()).schemaVersion,
    1,
  );
});

function runComparisonHarness(
  search = '',
  configs: {
    single?: boolean;
    confirm?: (message: string) => boolean;
    controlsRequest?: (url: URL) => Response | Promise<Response>;
    prepareScene?: () => Promise<void>;
    cleanupSecurityError?: boolean;
    workbenchRequest?: (path: string, body?: unknown) => unknown;
    leftCaptureConfig?: string;
    leftPreviewUrl?: string;
    leftSidecar?: unknown;
    rightCaptureConfig?: string;
    rightSidecar?: unknown;
  } = {},
) {
  const origin = 'http://localhost';
  const location = {href: `${origin}/${search}`, origin};
  const elements = new Map<string, FakeElement>();
  const documentElement = new FakeElement();
  const document = {
    activeElement: undefined as FakeElement | undefined,
    body: new FakeElement(),
    documentElement,
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: () => new FakeElement(),
    createTextNode: (text: string) => ({textContent: text}),
    getElementById(id: string) {
      let element = elements.get(id);
      if (!element) {
        element = new FakeElement();
        elements.set(id, element);
      }
      return element;
    },
    querySelectorAll: () => [],
  };
  const animationFrames = new Map<number, () => void>();
  let nextAnimationFrame = 0;
  const createChildWindow = () => {
    const messageListeners = new Set<(event: unknown) => void>();
    const parent = {};
    return {
      location: {href: `${origin}/preview`, origin},
      parent,
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (type === 'message') messageListeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        if (type === 'message') messageListeners.delete(listener);
        if (configs.cleanupSecurityError)
          throw Object.assign(new Error('Previous frame navigated'), {name: 'SecurityError'});
      },
      postMessage(data: unknown, targetOrigin: string) {
        for (const listener of messageListeners) {
          listener({data, origin: targetOrigin, source: parent});
        }
      },
      requestAnimationFrame(callback: () => void) {
        const id = ++nextAnimationFrame;
        animationFrames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id: number) {
        animationFrames.delete(id);
      },
      __tileflowPreviewMap: undefined as FakeMap | undefined,
    };
  };
  const childWindows = {left: createChildWindow(), right: createChildWindow()};
  const frames = {
    left: document.getElementById('left-frame'),
    right: document.getElementById('right-frame'),
  };
  frames.left.contentWindow = childWindows.left;
  frames.right.contentWindow = childWindows.right;
  frames.left.contentDocument = frames.right.contentDocument = {
    documentElement: {dataset: {tileflowArtifactGeneration: '1'}},
  };
  const maps = {
    left: new FakeMap({bearing: 1, center: [-5, 40], pitch: 2, zoom: 5}),
    right: new FakeMap({bearing: 3, center: [20, 10], pitch: 4, zoom: 7}),
  };
  childWindows.left.__tileflowPreviewMap = maps.left;
  childWindows.right.__tileflowPreviewMap = maps.right;
  for (const side of ['left', 'right'] as const) {
    const child = childWindows[side];
    const setQuery = (name: string, value: string) => {
      const url = new URL(child.location.href);
      url.searchParams.set(name, value);
      child.location.href = url.href;
    };
    new Script(previewSceneClient).runInNewContext({
      globalThis: child,
      map: maps[side],
      URL,
      location: child.location,
      history: {
        replaceState: (_: unknown, _unused: string, url: string) => {
          child.location.href = url;
        },
      },
      previewSearchParameters: new URLSearchParams(),
      previewFontFaces: [],
      loadTileflowStyleFonts: configs.prepareScene ?? (async () => undefined),
      threeDimensionalControl: {
        setEnabled: (value: boolean) => setQuery('buildings3d', value ? 'on' : 'off'),
      },
      treeControl: {setEnabled: () => undefined, update: () => undefined},
      mountCoreScene: () => undefined,
      updateGlobeBackdrop: () => undefined,
      writeCameraToUrl: () => {
        const camera = maps[side].camera;
        for (const [name, value] of Object.entries({
          lng: camera.center[0],
          lat: camera.center[1],
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        }))
          setQuery(name, String(value));
      },
    });
  }

  const html = renderTileflowComparisonHtml({
    basePath: '',
    initialMode: 'side-by-side',
    left: {
      basePath: '/left',
      ...(configs.leftCaptureConfig ? {captureConfig: configs.leftCaptureConfig} : {}),
      eventsUrl: '/left/__events',
      label: 'Left',
      previewUrl: configs.leftPreviewUrl ?? '/left/',
      ...(configs.leftSidecar === undefined
        ? {}
        : {sidecarUrl: '/left/__inspection/map/theme.json'}),
      statusUrl: '/left/__status',
    },
    right: configs.single
      ? undefined
      : {
          basePath: '/right',
          ...(configs.rightCaptureConfig ? {captureConfig: configs.rightCaptureConfig} : {}),
          eventsUrl: '/right/__events',
          label: 'Right',
          previewUrl: '/right/',
          ...(configs.rightSidecar === undefined
            ? {}
            : {sidecarUrl: '/right/__inspection/map/theme.json'}),
          statusUrl: '/right/__status',
        },
    schemaVersion: 1,
    title: 'Comparison',
    ...(configs.workbenchRequest ? {workbenchUrl: '/__workbench'} : {}),
  });
  const source = /<script type="module">\s*([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(source);
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  let clipboardText = '';
  const timeouts = new Map<number, () => void>();
  const intervals: (() => void)[] = [];
  let nextTimeout = 0;
  const testHooks = {} as {setMode: (mode: string) => void; host: DevtoolsHost};
  new Script(
    source + '\ntestHooks.setMode = setMode; testHooks.host = globalThis.__tileflowDevtoolsHost;',
  ).runInNewContext({
    testHooks,
    AbortController,
    DOMException,
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    Image: class {},
    Option: class extends FakeElement {
      constructor(label: string, value = label) {
        super();
        this.textContent = label;
        this.value = value;
      }
    },
    URL,
    URLSearchParams,
    structuredClone,
    queueMicrotask,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    clearInterval() {},
    confirm: (message: string) => configs.confirm?.(message) ?? false,
    clearTimeout(id: number) {
      timeouts.delete(id);
    },
    document,
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (configs.controlsRequest && (url.includes('/__controls?') || url.includes('/styles/'))) {
        return Promise.resolve(configs.controlsRequest(new URL(url)));
      }
      if (url.includes('/__controls?'))
        return Promise.resolve(
          Response.json({...controlsFixture, theme: new URL(url).searchParams.get('theme')}),
        );
      if (url.includes('/styles/'))
        return Promise.resolve(
          Response.json({
            layers: [],
            metadata: {
              'tileflow:map': 'map',
              'tileflow:theme': new URL(url).pathname.split('/').at(-1)!.replace('.json', ''),
            },
          }),
        );
      if (configs.workbenchRequest && url.startsWith('/__workbench')) {
        const result = configs.workbenchRequest(
          url.slice('/__workbench'.length),
          init?.body ? JSON.parse(String(init.body)) : undefined,
        );
        return Promise.resolve(result).then((body) => ({ok: true, json: async () => body}));
      }
      if (configs.workbenchRequest && url.endsWith('/__status'))
        return Promise.resolve({
          ok: true,
          json: async () => ({status: 'ready', generation: 1, lastGoodGeneration: 1}),
        });
      const sidecar = url.includes('/left/__inspection/')
        ? configs.leftSidecar
        : url.includes('/right/__inspection/')
          ? configs.rightSidecar
          : undefined;
      return sidecar === undefined
        ? new Promise(() => undefined)
        : Promise.resolve({json: async () => sidecar, ok: true});
    },
    history: {
      state: undefined,
      replaceState(_state: unknown, _unused: string, href: string) {
        location.href = String(href);
      },
    },
    location,
    matchMedia: () => ({addEventListener() {}, matches: false}),
    navigator: {
      clipboard: {
        writeText: async (value: string) => {
          clipboardText = value;
        },
      },
    },
    performance: {now: () => 0},
    setInterval(callback: () => void) {
      intervals.push(callback);
      return intervals.length;
    },
    setTimeout(callback: () => void) {
      const id = ++nextTimeout;
      timeouts.set(id, callback);
      return id;
    },
  });

  return {
    focus: (element: FakeElement) => {
      document.activeElement = element;
    },
    activeElement: () => document.activeElement,
    host: testHooks.host,
    flushTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const callback of pending) callback();
    },
    pollIntervals() {
      for (const callback of intervals) callback();
    },
    async click(id: string) {
      await Promise.all(document.getElementById(id).dispatch('click'));
    },
    clickMode(mode: string) {
      testHooks.setMode(mode);
    },
    clipboardText: () => clipboardText,
    currentUrl: () => location.href,
    element(id: string) {
      return document.getElementById(id);
    },
    flushAnimationFrames() {
      while (animationFrames.size > 0) {
        const pending = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of pending) callback();
      }
    },
    load(side: 'left' | 'right') {
      childWindows[side].location.href = new URL(frames[side].src, origin).href;
      frames[side].dispatch('load');
    },
    maps,
    previewUrl: () => childWindows.left.location.href,
    async settle() {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    },
  };
}

class FakeElement {
  constructor(readonly tagName = '') {}
  src = '';
  type = '';
  open = false;
  checked = false;
  required = false;
  min = '';
  max = '';
  attributes = new Map<string, string>();
  children: unknown[] = [];
  className = '';
  contentWindow?: unknown;
  contentDocument?: unknown;
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  removed = false;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  style = {setProperty() {}};
  textContent = '';
  title = '';
  value = '';
  tabIndex = -1;

  get childElementCount() {
    return this.children.length;
  }

  get options() {
    return this.children;
  }

  checkValidity() {
    return (
      this.type !== 'number' ||
      ((!this.required || this.value !== '') &&
        Number(this.value) >= Number(this.min) &&
        Number(this.value) <= Number(this.max))
    );
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => {
      if (!(child instanceof FakeElement)) return [];
      const matches =
        selector === 'details[open]'
          ? child.tagName === 'details' && child.open
          : child.tagName === selector;
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  append(...children: unknown[]) {
    this.children.push(...children);
    const firstValuedChild = children.find(
      (child): child is FakeElement => child instanceof FakeElement && child.value !== '',
    );
    if (this.value === '' && firstValuedChild) this.value = firstValuedChild.value;
  }

  dispatch(type: string, event: unknown = {}) {
    return [...(this.listeners.get(type) ?? [])].map((listener) => listener(event));
  }

  focus() {}

  replaceChildren(...children: unknown[]) {
    this.children = children;
  }

  select() {}

  remove() {
    this.removed = true;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
}

function timeSegment(harness: ReturnType<typeof runComparisonHarness>, moment: string) {
  const segment = harness
    .element('wb-time-of-day')
    .querySelectorAll('button')
    .find((item) => item.value === moment);
  assert.ok(segment);
  return segment;
}

function selectedMoment(harness: ReturnType<typeof runComparisonHarness>) {
  return harness
    .element('wb-time-of-day')
    .querySelectorAll('button')
    .find((item) => item.attributes.get('aria-checked') === 'true')?.value;
}

type FakeCamera = {bearing: number; center: [number, number]; pitch: number; zoom: number};

class FakeMap {
  camera: FakeCamera;
  jumpCalls: FakeCamera[] = [];
  listeners = new Map<string, Set<(event?: unknown) => void>>();
  renderedFeatures: unknown[] = [];
  styleLayers: unknown[] = [];
  metadata = {'tileflow:map': 'map', 'tileflow:theme': 'theme'};
  styleCalls: {style: unknown; options: unknown}[] = [];
  triggerRepaint() {}
  setStyle(style: {layers?: unknown[]; metadata?: typeof this.metadata}, options: unknown) {
    this.styleCalls.push({style, options});
    this.styleLayers = style.layers ?? this.styleLayers;
    this.metadata = style.metadata ?? this.metadata;
  }

  constructor(camera: FakeCamera) {
    this.camera = structuredClone(camera);
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  getCanvas() {
    return {
      clientHeight: 600,
      clientWidth: 800,
      style: {cursor: ''},
      getContext: () => ({isContextLost: () => false}),
    };
  }

  getCenter() {
    return {lat: this.camera.center[1], lng: this.camera.center[0]};
  }

  getContainer() {
    return {clientHeight: 600, clientWidth: 800};
  }

  getBearing() {
    return this.camera.bearing;
  }

  getPitch() {
    return this.camera.pitch;
  }
  getMaxPitch() {
    return 85;
  }
  easeTo(options: Partial<FakeCamera>, event?: unknown) {
    this.camera = {...this.camera, ...options};
    this.emit('move', event);
    this.emit('moveend', event);
  }

  getStyle() {
    return {layers: this.styleLayers, metadata: this.metadata};
  }

  getLayersOrder() {
    return (this.styleLayers as {id: string}[]).map((layer) => layer.id);
  }

  getLayer(id: string) {
    return (this.styleLayers as {id: string; type: string}[]).find((layer) => layer.id === id);
  }

  moveLayer(id: string, before?: string) {
    const layer = this.getLayer(id)!;
    this.styleLayers = this.styleLayers.filter((entry) => entry !== layer);
    const index =
      before === undefined ? this.styleLayers.length : this.getLayersOrder().indexOf(before);
    this.styleLayers.splice(index, 0, layer);
  }

  getZoom() {
    return this.camera.zoom;
  }

  jumpTo(camera: FakeCamera) {
    this.camera = structuredClone(camera);
    this.jumpCalls.push(structuredClone(camera));
    this.emit('move');
    this.emit('moveend');
  }

  loaded() {
    return true;
  }

  off(type: string, listener: (event?: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  on(type: string, listener: (event?: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  once(type: string, listener: (event?: unknown) => void) {
    this.on(type, listener);
  }

  queryRenderedFeatures() {
    return this.renderedFeatures;
  }

  resize() {}
}

test('Controls groups preset families and applies time segments with pointer and keyboard', async () => {
  const camera = {type: 'center', center: [0, 0], zoom: 10};
  const selections = ['theme', 'dark', 'faded', 'dark-faded', 'standalone'].map((theme) => ({
    id: `map:map:${theme}`,
    map: 'map',
    theme,
    label: theme,
    camera,
    url: `/left/?map=map&theme=${theme}`,
  }));
  const harness = runComparisonHarness('', {
    single: true,
    workbenchRequest: (path) =>
      path === ''
        ? {
            busy: false,
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections,
                timeOfDay: {
                  map: {
                    theme: {day: 'theme', dawn: 'theme', night: 'dark'},
                    faded: {day: 'faded', dawn: 'dark-faded', night: 'dark-faded'},
                  },
                },
              },
            },
          }
        : {saved: true},
  });
  harness.load('left');
  await harness.settle();
  const values = (id: string) =>
    (harness.element(id).options as FakeElement[]).map((option) => option.value);
  assert.deepEqual(values('wb-theme'), ['theme', 'faded', 'standalone']);
  assert.deepEqual(values('wb-time-of-day'), ['day', 'dawn', 'dusk', 'night']);
  assert.equal(timeSegment(harness, 'dusk').disabled, true);
  assert.equal(timeSegment(harness, 'day').tabIndex, 0);
  assert.equal(harness.element('wb-time-of-day-field').hidden, false);
  // Two presets may share one style; preserve the explicit moment when switching family.
  const initialFrame = harness.element('left-frame').src;
  timeSegment(harness, 'dawn').dispatch('click');
  assert.equal(selectedMoment(harness), 'dawn');
  assert.equal(timeSegment(harness, 'dawn').tabIndex, 0);
  assert.equal(timeSegment(harness, 'day').tabIndex, -1);
  assert.equal(harness.element('left-frame').src, initialFrame);
  assert.match(harness.currentUrl(), /time-of-day=dawn/);
  harness.element('wb-theme').value = 'faded';
  harness.element('wb-theme').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'dark-faded');
  assert.equal(selectedMoment(harness), 'dawn');
  harness.element('wb-theme').value = 'theme';
  harness.element('wb-theme').dispatch('change');
  // Keyboard navigation skips the disabled Dusk segment.
  timeSegment(harness, 'dawn').dispatch('keydown', {key: 'ArrowRight', preventDefault() {}});
  assert.equal(selectedMoment(harness), 'night');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'dark');
  assert.equal(harness.element('wb-theme').value, 'theme');
  assert.match(harness.currentUrl(), /view=map%3Amap%3Adark/);
  harness.element('wb-theme').value = 'faded';
  harness.element('wb-theme').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'dark-faded');
  assert.equal(selectedMoment(harness), 'night');
  timeSegment(harness, 'night').dispatch('keydown', {key: 'ArrowRight', preventDefault() {}});
  assert.equal(selectedMoment(harness), 'day');
  timeSegment(harness, 'day').dispatch('keydown', {key: 'End', preventDefault() {}});
  assert.equal(selectedMoment(harness), 'night');
  timeSegment(harness, 'night').dispatch('keydown', {key: 'Home', preventDefault() {}});
  assert.equal(selectedMoment(harness), 'day');
  harness.element('wb-theme').value = 'standalone';
  harness.element('wb-theme').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'standalone');
  assert.equal(harness.element('wb-time-of-day-field').hidden, true);
});

test('Streets theme cards use Default, Faded, Monochrome order while preserving legacy IDs and time of day', async () => {
  const requests: Array<{path: string; body: any}> = [];
  const variants = {
    light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'},
    faded: {day: 'faded', dawn: 'dawn-faded', dusk: 'dusk-faded', night: 'dark-faded'},
    monochrome: {
      day: 'monochrome',
      dawn: 'dawn-monochrome',
      dusk: 'dusk-monochrome',
      night: 'dark-monochrome',
    },
  };
  const selections = Object.values(variants)
    .flatMap((times) => Object.values(times))
    .sort()
    .map((theme) => ({
      id: `map:map:${theme}`,
      map: 'map',
      theme,
      label: theme,
      url: `/left/?map=map&theme=${theme}`,
    }));
  const harness = runComparisonHarness('', {
    single: true,
    leftPreviewUrl: '/left/?map=map&theme=light',
    workbenchRequest: (path, body) => {
      requests.push({path, body});
      return path === ''
        ? {sides: {left: {generation: 1, status: 'ready', selections, timeOfDay: {map: variants}}}}
        : {saved: true};
    },
  });
  harness.maps.left.metadata['tileflow:theme'] = 'light';
  Object.assign(harness.maps.left.metadata, {'tileflow:extends': ['streets']});
  harness.load('left');
  await harness.settle();
  const options = harness.element('wb-theme').options as FakeElement[];
  assert.deepEqual(
    options.map(({textContent}) => textContent),
    ['Default', 'Faded', 'Monochrome'],
  );
  assert.deepEqual(
    options.map(({value}) => value),
    ['light', 'faded', 'monochrome'],
  );
  assert.deepEqual(
    (harness.element('wb-palettes').children as FakeElement[]).map(
      (card) => (card.children[1] as FakeElement).textContent,
    ),
    ['Default', 'Faded', 'Monochrome'],
  );
  assert.equal(harness.element('wb-theme').value, 'light');
  assert.equal(selectedMoment(harness), 'day');
  harness.pollIntervals();
  await harness.settle();
  const context = requests.filter(({path}) => path === '/context').at(-1)?.body.context;
  assert.equal(context.definition.theme, 'light');
  assert.deepEqual(context.appearance, {
    theme: 'Default',
    themeId: 'light',
    timeOfDay: 'day',
    concreteThemeId: 'light',
  });
  timeSegment(harness, 'night').dispatch('click');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'dark');
  assert.equal(harness.element('wb-theme').value, 'light');
  assert.equal(selectedMoment(harness), 'night');
});

test('1777 exposes a single Default family while switching all four time presets', async () => {
  const variants = {light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'}};
  const selections = Object.values(variants.light).map((theme) => ({
    id: `map:map:${theme}`,
    map: 'map',
    theme,
    label: theme,
    url: `/left/?map=map&theme=${theme}`,
  }));
  const harness = runComparisonHarness('', {
    single: true,
    leftPreviewUrl: '/left/?map=map&theme=light',
    workbenchRequest: (path) =>
      path === ''
        ? {sides: {left: {generation: 1, status: 'ready', selections, timeOfDay: {map: variants}}}}
        : {saved: true},
  });
  Object.assign(harness.maps.left.metadata, {
    'tileflow:theme': 'light',
    'tileflow:extends': ['map-1777'],
  });
  harness.load('left');
  await harness.settle();
  assert.deepEqual(
    (harness.element('wb-theme').options as FakeElement[]).map(({textContent}) => textContent),
    ['Default'],
  );
  for (const [moment, concrete] of Object.entries(variants.light)) {
    timeSegment(harness, moment).dispatch('click');
    harness.flushTimeouts();
    await harness.settle();
    assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), concrete);
    assert.equal(selectedMoment(harness), moment);
    assert.equal(harness.element('wb-theme').value, 'light');
  }
});

test('custom map theme cards retain catalog order and their Light display name', async () => {
  const variants = {
    light: {day: 'light', night: 'dark'},
    faded: {day: 'faded', night: 'dark-faded'},
    monochrome: {day: 'monochrome', night: 'dark-monochrome'},
  };
  const selections = ['monochrome', 'dark-monochrome', 'faded', 'dark-faded', 'light', 'dark'].map(
    (theme) => ({
      id: `map:map:${theme}`,
      map: 'map',
      theme,
      label: theme,
      url: `/left/?map=map&theme=${theme}`,
    }),
  );
  const harness = runComparisonHarness('', {
    single: true,
    leftPreviewUrl: '/left/?map=map&theme=light',
    workbenchRequest: (path) =>
      path === ''
        ? {sides: {left: {generation: 1, status: 'ready', selections, timeOfDay: {map: variants}}}}
        : {saved: true},
  });
  harness.maps.left.metadata['tileflow:theme'] = 'light';
  harness.load('left');
  await harness.settle();
  assert.deepEqual(
    (harness.element('wb-theme').options as FakeElement[]).map(({value}) => value),
    ['monochrome', 'faded', 'light'],
  );
  assert.deepEqual(
    (harness.element('wb-palettes').children as FakeElement[]).map(
      (card) => (card.children[1] as FakeElement).textContent,
    ),
    ['Monochrome', 'Faded', 'Light'],
  );
});

test('single-map user navigation updates the URL without requiring a second viewer', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.load('left');
  await harness.settle();
  const originalEvent = {type: 'wheel'};
  harness.maps.left.emit('movestart', {originalEvent});
  harness.maps.left.camera = {center: [-3.7, 40.4], zoom: 17, bearing: 45, pitch: 30};
  harness.maps.left.emit('move', {originalEvent});
  harness.maps.left.emit('moveend', {originalEvent});
  harness.flushAnimationFrames();
  const query = new URL(harness.currentUrl()).searchParams;
  assert.equal(query.get('lng'), '-3.7');
  assert.equal(query.get('zoom'), '17');
  assert.equal(query.get('bearing'), '45');
  assert.equal(harness.maps.right.jumpCalls.length, 0);
});

test('appearance waits for the command’s map and rejects saved URLs for a different map', async () => {
  const selections = [
    {id: 'map:other:dark', map: 'other', theme: 'dark', url: '/left/?map=other&theme=dark'},
    {id: 'scene:other', map: 'other', theme: 'dark', scene: 'other'},
    {id: 'map:map:theme', map: 'map', theme: 'theme', url: '/left/?map=map&theme=theme'},
    {id: 'map:map:faded', map: 'map', theme: 'faded', url: '/left/?map=map&theme=faded'},
  ];
  const harness = runComparisonHarness('?view=map%3Aother%3Adark', {
    single: true,
    workbenchRequest: (path) =>
      path === '' ? {sides: {left: {generation: 1, status: 'ready', selections}}} : {saved: true},
  });
  await harness.settle();
  assert.equal(harness.element('wb-theme').disabled, true);
  harness.load('left');
  await harness.settle();
  assert.equal(harness.element('left-frame').src, '/left/');
  assert.equal(harness.element('wb-theme').value, 'theme');
  assert.deepEqual(
    (harness.element('wb-theme').options as FakeElement[]).map((option) => option.value),
    ['theme', 'faded'],
  );
  harness.element('wb-theme').value = 'faded';
  harness.element('wb-theme').dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('map'), 'map');
});

test('appearance restores a same-map theme and an explicit aliased moment', async () => {
  const harness = runComparisonHarness('?view=map%3Amap%3Afaded&time-of-day=dawn', {
    single: true,
    leftPreviewUrl: '/left/?scene=proof',
    workbenchRequest: (path) =>
      path === ''
        ? {
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections: [
                  {id: 'scene:proof', scene: 'proof', map: 'map', theme: 'theme'},
                  ...['theme', 'faded'].map((theme) => ({
                    id: 'map:map:' + theme,
                    map: 'map',
                    theme,
                    url: '/left/?map=map&theme=' + theme,
                  })),
                ],
                timeOfDay: {map: {theme: {day: 'theme'}, faded: {day: 'faded', dawn: 'faded'}}},
              },
            },
          }
        : {saved: true},
  });
  await harness.settle();
  assert.equal(harness.element('left-frame').src, '/left/?scene=proof');
  assert.equal(harness.element('wb-theme').disabled, true);
  harness.load('left');
  await harness.settle();
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'faded');
  assert.equal(harness.element('wb-theme').value, 'faded');
  assert.equal(selectedMoment(harness), 'dawn');
  // A theme without Dawn falls back to its own supported moment.
  harness.element('wb-theme').value = 'theme';
  harness.element('wb-theme').dispatch('change');
  assert.equal(selectedMoment(harness), 'day');
  harness.flushTimeouts();
  await harness.settle();
  assert.equal(new URL(harness.previewUrl()).searchParams.get('theme'), 'theme');
});

test('themes and modules are available while Streets tiles are still loading', async () => {
  const harness = runComparisonHarness('', {
    single: true,
    controlsRequest: () => Response.json(controlsFixture),
    workbenchRequest: (path) =>
      path === ''
        ? {
            sides: {
              left: {
                generation: 1,
                status: 'ready',
                selections: ['theme', 'dark'].map((theme) => ({
                  id: 'map:map:' + theme,
                  map: 'map',
                  theme,
                  url: '/left/?map=map&theme=' + theme,
                })),
                timeOfDay: {map: {theme: {day: 'theme', night: 'dark'}}},
              },
            },
          }
        : {saved: true},
  });
  harness.maps.left.loaded = () => false;
  harness.load('left');
  await harness.settle();
  assert.equal(harness.element('stage').dataset.tileflowState, 'loading');
  assert.equal(harness.element('wb-theme').value, 'theme');
  assert.equal(timeSegment(harness, 'night').disabled, false);
  assert.equal(harness.element('controls-modules').disabled, false);
  assert.ok(harness.element('controls-modules').childElementCount > 0);
  timeSegment(harness, 'night').dispatch('click');
  harness.flushTimeouts();
  await harness.settle();
  const query = new URL(harness.previewUrl()).searchParams;
  assert.equal(query.get('theme'), 'dark');
  assert.equal(query.get('lng'), '-5');
  assert.equal(query.get('zoom'), '5');
});

test('Beacon camera commands update the single-map bridge without being rolled back', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.load('left');
  await harness.settle();
  harness.maps.left.camera = {center: [-3, 40], zoom: 13, bearing: 0, pitch: 0};
  const event = {tileflowDevtools: true};
  harness.maps.left.emit('movestart', event);
  harness.maps.left.emit('move', event);
  harness.maps.left.emit('moveend', event);
  harness.flushAnimationFrames();
  assert.equal(new URL(harness.currentUrl()).searchParams.get('zoom'), '13');
  assert.deepEqual(harness.maps.left.camera.center, [-3, 40]);
  assert.equal(harness.maps.right.jumpCalls.length, 0);
});
