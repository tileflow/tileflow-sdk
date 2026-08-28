import assert from 'node:assert/strict';
import test from 'node:test';
import {Script} from 'node:vm';
import {defineRootMap, parseTileflowMap, type TileflowMapScene} from '@tileflow/core';
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
  assert.equal(harness.element('driver').textContent, 'Interact: left');
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
  assert.equal(harness.element('driver').textContent, 'Interact: right');
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
              effects: [
                {
                  kind: 'patch',
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
              effects: [],
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
        'compilerEffects.land.landcover.urbanPark.fill.patch',
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
      defineRootMap({
        id: 'map',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
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

function runComparisonHarness(
  search = '',
  configs: {
    leftCaptureConfig?: string;
    leftSidecar?: unknown;
    rightCaptureConfig?: string;
    rightSidecar?: unknown;
  } = {},
) {
  const origin = 'http://localhost';
  const location = {href: `${origin}/${search}`, origin};
  const elements = new Map<string, FakeElement>();
  const modeButtons = ['side-by-side', 'split', 'overlay', 'blink'].map((mode) => {
    const button = new FakeElement();
    button.dataset.mode = mode;
    return button;
  });
  const documentElement = new FakeElement();
  const document = {
    body: new FakeElement(),
    documentElement,
    createElement: () => new FakeElement(),
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
      previewUrl: '/left/',
      ...(configs.leftSidecar === undefined
        ? {}
        : {sidecarUrl: '/left/__inspection/map/theme.json'}),
      statusUrl: '/left/__status',
    },
    right: {
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
  });
  const source = /<script type="module">\s*([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(source);
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  let clipboardText = '';
  new Script(source).runInNewContext({
    AbortController,
    DOMException,
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    Image: class {},
    Option: class {},
    URL,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    clearInterval() {},
    clearTimeout() {},
    document,
    fetch: (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
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
        location.href = href;
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
    setInterval: () => 1,
    setTimeout(callback: () => void) {
      callback();
      return 1;
    },
  });

  return {
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
      frames[side].dispatch('load');
    },
    maps,
    async settle() {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    },
  };
}

class FakeElement {
  attributes = new Map<string, string>();
  children: unknown[] = [];
  className = '';
  contentWindow?: unknown;
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
