import assert from 'node:assert/strict';
import test from 'node:test';
import {Script} from 'node:vm';
import {defineMap, parseTileflowMap, type TileflowMapScene} from '@tileflow/core';
import {
  createTileflowComparisonRequestHandler,
  tileflowComparisonSchemaVersion,
} from '../src/comparison';
import {renderTileflowComparisonHtml} from '../src/comparison-html';
import {fixtureLightTheme} from './theme-fixture';

const leftHandler = (request: Request) =>
  new Response(`left:${new URL(request.url).pathname}`, {headers: {'x-side': 'left'}});
const rightHandler = (request: Request) =>
  new Response(`right:${new URL(request.url).pathname}`, {headers: {'x-side': 'right'}});

test('renders a self-contained comparison workbench with versioned bridge and review tools', () => {
  const html = renderTileflowComparisonHtml({
    basePath: '',
    initialMode: 'side-by-side',
    left: {
      basePath: '/__left',
      eventsUrl: '/__left/__events',
      label: 'Härad',
      previewUrl: '/__left/?map=harad&theme=paper',
      sidecarUrl: '/__left/__inspection.json?map=harad',
      statusUrl: '/__left/__status',
    },
    right: {
      basePath: '/__right',
      eventsUrl: '/__right/__events',
      label: 'Ferraris',
      previewUrl: '/__right/?map=ferraris&theme=paper',
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
  assert.ok(
    html.indexOf('splitInput.value = String(initialUi.split)') <
      html.indexOf('setMode(initialUi.mode || options.initialMode)'),
  );
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
  assert.match(html, /tileflow capture/);
  assert.match(html, /"--center="/);
  assert.match(html, /side\.map\?\.getContainer\?\.\(\)/);
  assert.match(html, /roundNumber\(camera\.zoom\)/);
  assert.match(html, /target: \{kind: "map"\}/);
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
  harness.element('copy-command').dispatch('click');
  await harness.settle();
  assert.match(harness.clipboardText(), /tileflow capture/);
  assert.equal(harness.maps.right.jumpCalls.length, 0);
});

test('Controls waits safely while the map is replacing its style', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.load('left');
  await harness.settle();
  harness.maps.left.getStyle = () => undefined as never;
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
  assert.equal(harness.element('controls-modules').disabled, true);
  harness.maps.left.getStyle = getStyle;
  harness.pollIntervals();
  await harness.settle();
  assert.equal(harness.element('controls-modules').disabled, false);
});

test('Controls opens above review and history and toggles on the first click', async () => {
  const harness = runComparisonHarness('', {single: true});
  harness.load('left');
  await harness.settle();
  harness.element('map-controls').hidden = true;
  harness.element('wb-review').hidden = false;
  harness.element('wb-history').hidden = false;
  await harness.click('controls-toggle');
  assert.equal(harness.element('map-controls').hidden, false);
  assert.equal(harness.element('wb-review').hidden, true);
  assert.equal(harness.element('wb-history').hidden, true);
  assert.equal(harness.element('wb-history-toggle').attributes.get('aria-expanded'), 'false');
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
  const patch = () =>
    JSON.parse(new URL(harness.element('left-frame').src).searchParams.get('controls')!);
  assert.equal(patch().vegetation.mode, 'auto');
  harness.load('left');
  harness.pollIntervals();
  await harness.settle();
  assert.equal(representation().value, 'auto');
  representation().value = 'inherit';
  representation().dispatch('change');
  harness.flushTimeouts();
  await harness.settle();
  assert.deepEqual(patch(), {vegetation: {threeDimensional: {heightScale: 1.2}}});
  harness.load('left');
  harness.pollIntervals();
  await harness.settle();
  assert.equal(representation().value, 'inherit');
});

test('Controls automatically groups edits, preserves the camera and keeps details expanded', async () => {
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
  const details = modules.querySelectorAll('details')[0]!;
  details.open = true;
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
  const url = new URL(frame.src);
  assert.equal(url.searchParams.get('lng'), '-5');
  assert.equal(url.searchParams.get('zoom'), '5');
  assert.equal(modules.disabled, true);
  harness.load('left');
  harness.pollIntervals();
  await harness.settle();
  assert.equal(modules.disabled, false);
  assert.equal(modules.querySelectorAll('details')[0]!.open, true);
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
  harness.flushTimeouts();
  assert.equal(requests.length, 1);
  requests[0]!.resolve(Response.json({}));
  await harness.settle();
  assert.equal(frame.src, initial);
  assert.equal(requests.length, 2);
  requests[1]!.resolve(Response.json({}));
  await harness.settle();
  assert.deepEqual(JSON.parse(new URL(frame.src).searchParams.get('controls')!), {
    vegetation: {threeDimensional: {heightScale: 3}},
  });
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
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.url.searchParams.has('controls'), false);
  requests[1]!.resolve(Response.json({}));
  await harness.settle();
  const url = new URL(harness.element('left-frame').src);
  assert.equal(url.searchParams.has('controls'), false);
  assert.equal(url.searchParams.get('buildings3d'), 'off');
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
  assert.equal(harness.element('driver').textContent, 'Active map: left');
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
  assert.equal(harness.element('driver').textContent, 'Active map: right');
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

test('copies a complete scene and exploratory command from the real map viewport', async () => {
  const harness = runComparisonHarness();
  harness.maps.left.camera = {
    bearing: 1.123456789,
    center: [-5.123456789, 40.987654321],
    pitch: 2.987654321,
    zoom: 15.213399999999979,
  };
  harness.load('left');
  harness.load('right');

  await harness.click('copy-scene');
  const scene = harness.clipboardText();
  assert.match(scene, /"theme": "theme"/);
  assert.match(scene, /"width": 800/);
  assert.match(scene, /"height": 600/);
  assert.match(scene, /"center": \[\s+-5\.123457,\s+40\.987654/);
  assert.match(scene, /"zoom": 15\.2134/);
  assert.doesNotMatch(scene, /15\.213399999999979/);
  assert.match(scene, /"target": \{\s+"kind": "map"/);
  const sceneMatch = /^'([^']+)': ([\s\S]+),$/u.exec(scene);
  assert.ok(sceneMatch);
  const sceneDefinition = JSON.parse(sceneMatch[2]!) as TileflowMapScene;
  assert.equal(Object.hasOwn(sceneDefinition, 'map'), false);
  assert.doesNotThrow(() =>
    parseTileflowMap(
      defineMap({
        id: 'map',
        version: 1,
        defaultTheme: 'theme',
        themes: {theme: fixtureLightTheme},
        scenes: {[sceneMatch[1]!]: sceneDefinition},
      }),
    ),
  );

  await harness.click('copy-command');
  assert.doesNotMatch(harness.clipboardText(), /--config/u);
  assert.match(
    harness.clipboardText(),
    /^tileflow capture --map map --theme theme --center=-5\.123457,40\.987654 --zoom=15\.2134 --bearing=1\.123457 --pitch=2\.987654 --width=800 --height=600 --dpr=1 --out=comparison-view\.png$/,
  );
});

test('copies the active side config with shell-safe quoting', async () => {
  const harness = runComparisonHarness('', {
    leftCaptureConfig: 'configs/candidate map.ts',
    rightCaptureConfig: "configs/reference's map.ts",
  });
  harness.load('left');
  harness.load('right');

  await harness.click('copy-command');
  assert.match(
    harness.clipboardText(),
    /^tileflow capture --config 'configs\/candidate map\.ts' --map map --theme theme /u,
  );

  await harness.click('driver');
  await harness.click('copy-command');
  assert.match(
    harness.clipboardText(),
    /^tileflow capture --config 'configs\/reference'"'"'s map\.ts' --map map --theme theme /u,
  );
});

test('enforces the Core portable-id boundary for copied scene names', async () => {
  const maximumName = `a${'b'.repeat(63)}`;
  const validHarness = runComparisonHarness();
  validHarness.load('left');
  validHarness.load('right');
  validHarness.element('scene-name').value = maximumName;
  await validHarness.click('copy-scene');
  assert.match(validHarness.clipboardText(), new RegExp(`^'${maximumName}':`, 'u'));

  for (const name of [
    'constructor',
    'prototype',
    'con',
    'aux',
    'com1',
    'lpt9',
    `a${'b'.repeat(64)}`,
    'Mixed-case',
  ]) {
    const harness = runComparisonHarness();
    harness.load('left');
    harness.load('right');
    harness.element('scene-name').value = name;
    await harness.click('copy-scene');
    assert.equal(harness.clipboardText(), '', name);
  }
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

test('Workbench copies fixed-frame context, blocks capture while switching scenes and restores the left driver', async () => {
  const requests: Array<{path: string; body: unknown}> = [];
  const selection = {
    id: 'scene:proof',
    scene: 'proof',
    label: 'Proof',
    map: 'map',
    theme: 'theme',
    url: '/left/?scene=proof',
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
          sides: {left: {generation: 1, status: 'ready', selections: [selection]}},
        };
      if (path === '/context') return {saved: true};
      if (path === '/capture') return {captureId: 'a'.repeat(64)};
      if (path === '/captures') return {records: [], next: null, warnings: []};
      throw new Error('Unexpected Workbench request ' + path);
    },
  });
  harness.load('left');
  await harness.settle();
  await harness.click('wb-copy-context');
  const context = JSON.parse(harness.clipboardText());
  assert.equal(context.definition.viewport.width, 1280);
  assert.equal(context.definition.viewport.height, 800);
  assert.equal(context.displayedGeneration, 1);
  assert.match(context.commands.capture, /--width=1280/);
  harness.element('wb-view').value = selection.id;
  harness.element('wb-view').dispatch('change');
  assert.equal(harness.element('wb-width').value, '640');
  assert.equal(harness.element('wb-capture').disabled, true);
  await harness.click('wb-capture');
  assert.equal(requests.filter((request) => request.path === '/capture').length, 0);
  assert.match(harness.currentUrl(), /view=scene%3Aproof/);
  harness.load('left');
  await harness.settle();
  const frame = harness.element('left-frame') as FakeElement & {src: string};
  const source = frame.src;
  frame.src = source + '&controls=' + encodeURIComponent('{"roads":{"enabled":false}}');
  await harness.click('wb-capture');
  assert.equal(requests.filter((request) => request.path === '/capture').length, 0);
  frame.src = source;
  await harness.click('wb-capture');
  const capture = requests.find((request) => request.path === '/capture')!.body as {
    generation: number;
    definition: {viewport: {width: number}};
  };
  assert.equal(capture.generation, 1);
  assert.equal(capture.definition.viewport.width, 640);
  harness.element('wb-reference').value = 'left|scene:proof';
  await harness.click('wb-add-reference');
  harness.load('right');
  await harness.settle();
  harness.element('right-frame').dispatch('focus');
  assert.equal(harness.element('stage').dataset.driver, 'right');
  harness.clickMode('single');
  assert.equal(harness.element('stage').dataset.driver, 'left');
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
  assert.equal(harness.element('wb-map-field').hidden, true);
});

test('Workbench compares a new revision using the pinned reference camera and frame after navigation', async () => {
  const reference = {
    id: 'a'.repeat(64),
    scene: 'before-edit',
    map: 'map',
    theme: 'theme',
    savedAt: '2026-10-14T10:00:00Z',
    imageUrl: '/before.png',
    definition: {
      map: 'map',
      theme: 'theme',
      camera: {type: 'center', center: [3, 40], zoom: 12, bearing: 0, pitch: 0},
      viewport: {width: 640, height: 480, dpr: 2},
    },
  };
  const after = {...reference, id: 'b'.repeat(64), scene: 'after-edit', imageUrl: '/after.png'};
  let captured: {definition: typeof reference.definition; generation: number} | undefined;
  let compared: unknown;
  const harness = runComparisonHarness('', {
    single: true,
    workbenchRequest: (path, body) => {
      if (path === '')
        return {
          busy: false,
          sides: {
            left: {
              generation: 1,
              status: 'ready',
              selections: [
                {id: 'map:map:theme', map: 'map', theme: 'theme', label: 'Map', url: '/left/'},
              ],
            },
          },
        };
      if (path === '/context') return {saved: true};
      if (path === '/captures')
        return {records: captured ? [after, reference] : [reference], next: null, warnings: []};
      if (path === '/capture') {
        captured = body as typeof captured;
        return {captureId: after.id};
      }
      if (path === '/compare') {
        compared = body;
        return {review: {status: 'comparable', exact: {ratio: 0.1}, warnings: []}};
      }
      throw new Error('Unexpected request ' + path);
    },
  });
  harness.load('left');
  await harness.settle();
  await harness.click('wb-compare-toggle');
  harness.element('wb-before').value = reference.id;
  await harness.click('wb-pin-reference');
  harness.maps.left.camera.center = [-74, 41];
  harness.maps.left.camera.zoom = 8;
  harness.element('wb-width').value = '1000';
  harness.element('wb-height').value = '700';
  await harness.click('wb-capture-compare');
  assert.deepEqual(JSON.parse(JSON.stringify(captured?.definition)), {
    ...reference.definition,
    target: {kind: 'map'},
  });
  assert.equal(captured?.generation, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(compared)), {before: reference.id, after: after.id});
  assert.equal(harness.element('wb-review').hidden, false);
  assert.equal(harness.element('wb-live-picker').hidden, true);
  assert.match(harness.element('wb-review-result').textContent, /10.00%/);
  await harness.click('wb-copy-context');
  assert.equal(JSON.parse(harness.clipboardText()).review.referenceId, reference.id);
});

test('Deleting a capture confirms first and clears a deleted pinned reference', async () => {
  const record = {
    id: 'a'.repeat(64),
    scene: 'reference',
    map: 'map',
    theme: 'theme',
    savedAt: '2026-10-14T10:00:00Z',
    imageUrl: '/before.png',
    definition: {
      map: 'map',
      theme: 'theme',
      camera: {type: 'center', center: [3, 40], zoom: 12},
      viewport: {width: 640, height: 480, dpr: 1},
    },
  };
  let records = [record],
    accept = false,
    deletions = 0;
  const harness = runComparisonHarness('', {
    single: true,
    confirm: (message) => {
      assert.match(message, /permanently removes/);
      return accept;
    },
    workbenchRequest: (path, body) => {
      if (path === '')
        return {
          busy: false,
          sides: {
            left: {
              generation: 1,
              status: 'ready',
              selections: [
                {id: 'map:map:theme', map: 'map', theme: 'theme', label: 'Map', url: '/left/'},
              ],
            },
          },
        };
      if (path === '/captures') return {records, next: null, warnings: []};
      if (path === '/captures/delete') {
        assert.deepEqual(JSON.parse(JSON.stringify(body)), {id: record.id});
        records = [];
        deletions++;
        return {deleted: record.id};
      }
      return {saved: true};
    },
  });
  harness.load('left');
  await harness.settle();
  harness.element('wb-history').hidden = true;
  await harness.click('wb-history-toggle');
  const buttons = harness.element('wb-captures').querySelectorAll('button');
  await Promise.all(
    buttons.find((button) => button.className === 'capture-reference')!.dispatch('click'),
  );
  const remove = buttons.find((button) => button.className === 'capture-delete')!;
  await Promise.all(remove.dispatch('click'));
  assert.equal(deletions, 0);
  assert.equal(harness.element('wb-captures').childElementCount, 1);
  accept = true;
  await Promise.all(remove.dispatch('click'));
  assert.equal(deletions, 1);
  assert.equal(harness.element('wb-captures').childElementCount, 0);
  assert.equal(harness.element('wb-reference-bar').hidden, true);
  assert.equal(harness.element('wb-run-compare').disabled, true);
});

test('Workbench starts with the selected scene frame without reloading its preview', async () => {
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
  assert.equal(harness.element('wb-width').value, '390');
  assert.equal(harness.element('wb-height').value, '844');
  assert.equal(harness.element('scene-dpr').value, '2');
  assert.equal(harness.element('scene-name').value, 'proof');
  await harness.click('wb-copy-context');
  assert.equal(JSON.parse(harness.clipboardText()).definition.viewport.width, 390);
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
  const modeButtons = ['single', 'side-by-side', 'split', 'overlay', 'blink'].map((mode) => {
    const button = new FakeElement();
    button.dataset.mode = mode;
    return button;
  });
  const documentElement = new FakeElement();
  const document = {
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
    querySelectorAll: (selector: string) => (selector === '[data-mode]' ? modeButtons : []),
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
  document.getElementById('scene-name').value = 'comparison-view';
  document.getElementById('scene-dpr').value = '1';
  document.getElementById('wb-width').value = '1280';
  document.getElementById('wb-height').value = '800';
  frames.left.contentDocument = frames.right.contentDocument = {
    documentElement: {dataset: {tileflowArtifactGeneration: '1'}},
  };
  const maps = {
    left: new FakeMap({bearing: 1, center: [-5, 40], pitch: 2, zoom: 5}),
    right: new FakeMap({bearing: 3, center: [20, 10], pitch: 4, zoom: 7}),
  };
  childWindows.left.__tileflowPreviewMap = maps.left;
  childWindows.right.__tileflowPreviewMap = maps.right;

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
  new Script(source).runInNewContext({
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
      if (configs.controlsRequest) {
        const id = ++nextTimeout;
        timeouts.set(id, callback);
        return id;
      }
      callback();
      return 1;
    },
  });

  return {
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
      const button = modeButtons.find((candidate) => candidate.dataset.mode === mode);
      assert.ok(button);
      button.dispatch('click');
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
    async settle() {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
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
  listeners = new Map<string, Set<(event: unknown) => void>>();
  style = {setProperty() {}};
  textContent = '';
  title = '';
  value = '';

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

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

type FakeCamera = {bearing: number; center: [number, number]; pitch: number; zoom: number};

class FakeMap {
  camera: FakeCamera;
  jumpCalls: FakeCamera[] = [];
  listeners = new Map<string, Set<(event?: unknown) => void>>();
  renderedFeatures: unknown[] = [];
  styleLayers: unknown[] = [];

  constructor(camera: FakeCamera) {
    this.camera = structuredClone(camera);
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  getCanvas() {
    return {clientHeight: 600, clientWidth: 800, style: {cursor: ''}};
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

  getStyle() {
    return {layers: this.styleLayers, metadata: {'tileflow:map': 'map', 'tileflow:theme': 'theme'}};
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
