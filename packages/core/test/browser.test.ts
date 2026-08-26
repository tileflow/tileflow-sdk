import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  attachTileflowFairUseNotice,
  attachTileflowMapLifecycle,
  createTileflowMarkerController,
  createTileflowSessionStarter,
  createTileflowTransformRequest,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowWorldRequestBridge,
  type TileflowContourProtocolHandler,
  type TileflowFairUseNotice,
  tileflowMaplibreContourVersion,
  type TileflowMapLifecycleEvent,
  type TileflowWorldProtocolHandler,
} from '../src/browser';
import {createTileflowContourProtocolUrl} from '../src/terrain/contour-protocol';

test('ships the pinned contour generator inside the browser entry without a CDN runtime', async () => {
  const browserEntry = await readFile(new URL('../dist/browser.js', import.meta.url), 'utf8');

  assert.match(browserEntry, /maplibre-contour@0\.1\.0/u);
  assert.doesNotMatch(browserEntry, /unpkg\.com/u);
  assert.doesNotMatch(browserEntry, /import\(["']maplibre-contour["']\)/u);
});

test('loads validated content-addressed font faces before a browser map starts', async (t) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const fontFaceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
  const added: FakeFontFace[] = [];
  const constructed: FakeFontFace[] = [];
  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: ArrayBuffer,
      readonly descriptors: {style?: string; weight?: string} = {},
    ) {
      constructed.push(this);
    }
    async load() {
      return this;
    }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      baseURI: 'https://app.example.test/maps/',
      fonts: {add: (fontFace: FakeFontFace) => added.push(fontFace)},
    },
  });
  Object.defineProperty(globalThis, 'FontFace', {configurable: true, value: FakeFontFace});
  t.after(() => {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    if (fontFaceDescriptor) Object.defineProperty(globalThis, 'FontFace', fontFaceDescriptor);
    else Reflect.deleteProperty(globalThis, 'FontFace');
  });

  const requested: string[] = [];
  await loadTileflowStyleFonts(
    {
      layers: [],
      metadata: {
        'tileflow:fontFaces': [
          {
            family: 'Oxanium Medium',
            source: '../fonts/oxanium-medium-a1.ttf',
            style: 'normal',
            weight: '500',
          },
          {
            family: 'Oxanium SemiBold',
            source: '../fonts/oxanium-semibold-b2.ttf',
            weight: '600',
          },
        ],
      },
      sources: {},
      version: 8,
    },
    {
      fetch: (async (input) => {
        requested.push(String(input));
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {'content-length': '3', 'content-type': 'font/ttf'},
        });
      }) as typeof fetch,
    },
  );

  assert.deepEqual(requested, [
    'https://app.example.test/fonts/oxanium-medium-a1.ttf',
    'https://app.example.test/fonts/oxanium-semibold-b2.ttf',
  ]);
  assert.equal(constructed.length, 2);
  assert.equal(constructed[0]?.source.byteLength, 3);
  assert.deepEqual(
    constructed.map((face) => face.descriptors.weight),
    ['500', '600'],
  );
  assert.deepEqual(added, constructed);
});

test('explicit empty manifest font metadata avoids an extra style request', async () => {
  let fetched = false;
  await loadTileflowStyleFonts('/tileflow/styles/main.json', {
    fontFaces: [],
    fetch: (async () => {
      fetched = true;
      throw new Error('must not fetch');
    }) as typeof fetch,
  });
  assert.equal(fetched, false);
});

test('contour protocol loads the pinned generator lazily and serves self-contained DEM requests', async () => {
  let handler: TileflowContourProtocolHandler | undefined;
  let registrations = 0;
  let moduleLoads = 0;
  const sourceOptions: Array<Record<string, unknown>> = [];
  const contourOptions: Array<Record<string, unknown>> = [];
  const forwarded: Array<{abortController: AbortController; url: string}> = [];

  class FakeDemSource {
    constructor(options: Record<string, unknown>) {
      sourceOptions.push(options);
    }

    contourProtocolUrl(options: Record<string, unknown>) {
      contourOptions.push(options);
      return 'fake-contour://{z}/{x}/{y}?thresholds=fake';
    }

    async contourProtocolV4(request: {url: string}, abortController: AbortController) {
      forwarded.push({abortController, url: request.url});
      return {data: new Uint8Array([7, 8, 9]).buffer};
    }
  }

  const registry = {
    addProtocol(name: string, installed: TileflowContourProtocolHandler) {
      registrations += 1;
      assert.equal(name, 'tileflow-contour');
      handler = installed;
    },
  };
  const registrationOptions = {
    async loadMaplibreContour() {
      moduleLoads += 1;
      return {default: {DemSource: FakeDemSource}};
    },
  };
  registerTileflowContourProtocol(registry, registrationOptions);
  registerTileflowContourProtocol({addProtocol: registry.addProtocol}, registrationOptions);

  assert.equal(tileflowMaplibreContourVersion, '0.1.0');
  assert.equal(registrations, 1);
  assert.equal(moduleLoads, 0);
  assert.ok(handler);
  const protocolTemplate = createTileflowContourProtocolUrl({
    demMaxzoom: 13,
    demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp?token=a%2Bb',
    encoding: 'terrarium',
    maxzoom: 15,
    multiplier: 1,
    overzoom: 2,
    thresholds: {9: [100, 500], 12: [20, 100]},
  });
  const requestUrl = protocolTemplate
    .replace('{z}', '12')
    .replace('{x}', '2134')
    .replace('{y}', '1456');
  const abortController = new AbortController();
  const response = await handler({url: requestUrl}, abortController);

  assert.deepEqual([...new Uint8Array(response.data)], [7, 8, 9]);
  assert.equal(moduleLoads, 1);
  assert.deepEqual(sourceOptions, [
    {
      encoding: 'terrarium',
      maxzoom: 13,
      url: 'https://terrain.example.test/{z}/{x}/{y}.webp?token=a%2Bb',
      worker: false,
    },
  ]);
  assert.deepEqual(contourOptions, [
    {
      contourLayer: 'contours',
      elevationKey: 'ele',
      levelKey: 'level',
      multiplier: 1,
      overzoom: 2,
      thresholds: {9: [100, 500], 12: [20, 100]},
    },
  ]);
  assert.equal(forwarded[0]?.abortController, abortController);
  assert.equal(forwarded[0]?.url, 'fake-contour://12/2134/1456?thresholds=fake');

  const floatingBoundaryUrl = new URL(requestUrl);
  floatingBoundaryUrl.pathname = '/13/2134/1456.pbf';
  floatingBoundaryUrl.searchParams.set('multiplier', '0.07');
  floatingBoundaryUrl.searchParams.set('thresholds', '13:0.7,3.5');
  await handler({url: String(floatingBoundaryUrl)}, new AbortController());

  await assert.rejects(
    handler(
      {url: `${requestUrl}&demUrl=https%3A%2F%2Fevil.example%2F%7Bz%7D`},
      new AbortController(),
    ),
    /parameters/u,
  );
  const negativeDemZoomUrl = new URL(requestUrl);
  negativeDemZoomUrl.searchParams.set('thresholds', '1:250,500');
  await assert.rejects(
    handler({url: String(negativeDemZoomUrl)}, new AbortController()),
    /negative DEM zoom/u,
  );
  const nonIntegralIndexUrl = new URL(requestUrl);
  nonIntegralIndexUrl.searchParams.set('thresholds', '9:60,100');
  await assert.rejects(
    handler({url: String(nonIntegralIndexUrl)}, new AbortController()),
    /whole multiple/u,
  );
  const excessiveDensityUrl = new URL(requestUrl);
  excessiveDensityUrl.searchParams.set('thresholds', '9:10,50');
  await assert.rejects(
    handler({url: String(excessiveDensityUrl)}, new AbortController()),
    /density budget/u,
  );
  const beforeFirstThresholdUrl = new URL(requestUrl);
  beforeFirstThresholdUrl.pathname = '/8/128/128.pbf';
  await assert.rejects(
    handler({url: String(beforeFirstThresholdUrl)}, new AbortController()),
    /tile coordinates/u,
  );
  assert.equal(moduleLoads, 1);
});

test('rejects duplicate font identities even when their source URLs differ', async () => {
  await assert.rejects(
    loadTileflowStyleFonts(
      {
        layers: [],
        metadata: {
          'tileflow:fontFaces': [
            {family: 'Duplicate', source: './fonts/one.woff2'},
            {
              family: 'Duplicate',
              source: './fonts/two.woff2',
              style: 'normal',
              weight: '400',
            },
          ],
        },
        sources: {},
        version: 8,
      },
      {fetch: (() => Promise.reject(new Error('must not fetch'))) as typeof fetch},
    ),
    /duplicate Tileflow style fontFace/u,
  );
});

let installedWorldProtocolHandler: TileflowWorldProtocolHandler | null = null;
const exactBrowserWorldUrl =
  `https://cdn.tileflow.dev/tiles/world/world-v1-release-browser/0/0/0.pbf?` +
  `worldDescriptorSha256=${'a'.repeat(64)}&map=map_public`;
const retiredMutableWorldUrl = 'https://world.tileflow.dev/world/v1/0/0/0.pbf';

test('World bridge follows signed notice activation and shapes an empty tile', async () => {
  const notices: Array<TileflowFairUseNotice | null> = [];
  const requests: Array<{credentials: RequestCredentials | undefined; url: string}> = [];
  let response = new Response(new Uint8Array([1, 2, 3]), {
    headers: {'Tileflow-Fair-Use': 'grace'},
  });
  const {bridge, protocolHandler} = registerTestWorldBridge({
    async fetch(input, init) {
      requests.push({
        credentials: init?.credentials,
        url: input instanceof Request ? input.url : String(input),
      });
      return response;
    },
    onNotice: (notice) => notices.push(notice),
  });
  const transform = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => undefined,
    sessionId: 'ses_stateless',
    transformRequest: () => ({
      headers: {'X-Private': 'must-not-reach-world'},
      url: exactBrowserWorldUrl,
    }),
    worldRequestBridge: bridge,
  });
  const transformed = transform(exactBrowserWorldUrl, 'Tile');
  assert.ok(transformed && !(transformed instanceof Promise));
  assert.match(transformed.url, /^tileflow-world:\/\/request\//u);
  assert.equal(bridge.rewriteUrl(retiredMutableWorldUrl), retiredMutableWorldUrl);
  assert.match(bridge.rewriteUrl(exactBrowserWorldUrl), /^tileflow-world:\/\/request\//u);
  assert.equal(
    bridge.rewriteUrl(`${exactBrowserWorldUrl}&private=secret`),
    `${exactBrowserWorldUrl}&private=secret`,
  );
  assert.ok(protocolHandler);
  const earlyGrace = await protocolHandler(transformed, new AbortController());
  assert.equal(earlyGrace.data.byteLength, 3);
  assert.equal(notices.at(-1), null, 'early GRACE remains silent');
  assert.equal(requests[0]?.credentials, 'omit');
  assert.equal(requests[0]?.url, exactBrowserWorldUrl);

  response = new Response(new Uint8Array([1, 2, 3]), {
    headers: {
      Link: '<https://tileflow.dev/world/claim>; rel="help"',
      'Tileflow-Fair-Use': 'grace',
      'Tileflow-Fair-Use-Notice': 'owner',
    },
  });
  await protocolHandler(transformed, new AbortController());
  assert.equal(notices.at(-1)?.state, 'GRACE');

  response = new Response(new Uint8Array([1, 2, 3]), {
    headers: {'Tileflow-Fair-Use': 'grace'},
  });
  await protocolHandler(transformed, new AbortController());
  assert.equal(notices.at(-1), null, 'early GRACE clears a visible GRACE notice');

  response = new Response(null, {
    status: 429,
    headers: {'Tileflow-Fair-Use': 'grace'},
  });
  const shapedGrace = await protocolHandler(transformed, new AbortController());
  assert.equal(shapedGrace.data.byteLength, 0);
  assert.equal(
    notices.at(-1)?.state,
    'GRACE',
    'a shaped response remains self-explanatory without the notice header',
  );

  response = new Response(null, {
    status: 429,
    headers: {
      Link: '<https://tileflow.dev/world/claim>; rel="help"',
      'Tileflow-Fair-Use': 'claim-required',
      'Tileflow-Fair-Use-Notice': 'owner',
    },
  });
  const shapedClaimRequired = await protocolHandler(transformed, new AbortController());
  assert.equal(shapedClaimRequired.data.byteLength, 0);
  assert.equal(shapedClaimRequired.cacheControl, 'private, no-store');
  assert.equal(notices.at(-1)?.state, 'CLAIM_REQUIRED');
  assert.match(notices.at(-1)?.message ?? '', /temporarily limited/u);
  assert.match(notices.at(-1)?.action ?? '', /manage this map with Tileflow/u);

  response = new Response(new Uint8Array([1, 2, 3]), {
    headers: {
      Link: '<https://tileflow.dev/world/claim>; rel="help"',
      'Tileflow-Fair-Use': 'grace',
      'Tileflow-Fair-Use-Notice': 'owner',
    },
  });
  await protocolHandler(transformed, new AbortController());
  assert.equal(
    notices.at(-1)?.state,
    'CLAIM_REQUIRED',
    'CLAIM_REQUIRED cannot regress to GRACE in one bridge',
  );

  const noticeCountBeforeError = notices.length;
  response = new Response(null, {status: 503});
  await assert.rejects(protocolHandler(transformed, new AbortController()), /failed: 503/u);
  assert.equal(notices.length, noticeCountBeforeError);
  assert.equal(notices.at(-1)?.state, 'CLAIM_REQUIRED');

  response = new Response(new Uint8Array([1, 2, 3]), {
    headers: {'Cache-Control': 'public, max-age=300', 'Tileflow-Fair-Use': 'open'},
  });
  const open = await protocolHandler(transformed, new AbortController());
  assert.equal(open.data.byteLength, 3);
  assert.equal(notices.at(-1), null, 'an observed OPEN response clears a previous notice');
  bridge.dispose();
});

test('World bridge bounds declared and chunked bodies and cancels oversized streams', async () => {
  const maximumWorldTileBytes = 16 * 1024 * 1024;
  const oversizedMessage = 'Tileflow World tile exceeds the maximum response size';
  let response: Response;
  const {bridge, protocolHandler} = registerTestWorldBridge({
    async fetch() {
      return response;
    },
  });
  const request = {
    url: bridge.rewriteUrl(exactBrowserWorldUrl),
  };

  let declaredBodyCancelled = false;
  response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        declaredBodyCancelled = true;
      },
    }),
    {
      headers: {
        'Content-Length': String(maximumWorldTileBytes + 1),
        'X-Body-Secret': 'must-not-appear-in-errors',
      },
    },
  );
  await assert.rejects(protocolHandler(request, new AbortController()), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, oversizedMessage);
    assert.doesNotMatch(error.message, /secret|16777217/u);
    return true;
  });
  assert.equal(declaredBodyCancelled, true);

  response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }),
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        ETag: '"world-etag"',
        Expires: 'Wed, 21 Oct 2037 07:28:00 GMT',
      },
    },
  );
  const chunked = await protocolHandler(request, new AbortController());
  assert.deepEqual([...new Uint8Array(chunked.data)], [1, 2, 3, 4]);
  assert.equal(chunked.cacheControl, 'public, max-age=300');
  assert.equal(chunked.etag, '"world-etag"');
  assert.equal(chunked.expires, 'Wed, 21 Oct 2037 07:28:00 GMT');

  let chunkedBodyCancelled = false;
  response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        chunkedBodyCancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(maximumWorldTileBytes));
        controller.enqueue(new Uint8Array([5]));
      },
    }),
  );
  await assert.rejects(
    protocolHandler(request, new AbortController()),
    (error: unknown) => error instanceof Error && error.message === oversizedMessage,
  );
  assert.equal(chunkedBodyCancelled, true);

  let missingBodyCancelled = false;
  response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        missingBodyCancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9, 9]));
      },
    }),
    {status: 404},
  );
  const missing = await protocolHandler(request, new AbortController());
  assert.equal(missing.data.byteLength, 0);
  assert.equal(missing.cacheControl, 'private, no-store');
  assert.equal(missingBodyCancelled, true);
  bridge.dispose();
});

test('World bridge propagates abort and cancels a pending streamed tile', async () => {
  let streamCancelReason: unknown;
  let fetchStartedResolve!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    fetchStartedResolve = resolve;
  });
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel(reason) {
        streamCancelReason = reason;
      },
    }),
  );
  const {bridge, protocolHandler} = registerTestWorldBridge({
    async fetch() {
      fetchStartedResolve();
      return response;
    },
  });
  const request = {
    url: bridge.rewriteUrl(exactBrowserWorldUrl),
  };
  const abortController = new AbortController();
  const pending = protocolHandler(request, abortController);
  await fetchStarted;
  await Promise.resolve();
  abortController.abort();

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.ok(streamCancelReason instanceof DOMException);
  assert.equal(streamCancelReason.name, 'AbortError');
  bridge.dispose();
});

test('fair-use notice renders the approved compact GRACE pill and strong CLAIM_REQUIRED banner', () => {
  const document = new FakeDocument();
  const container = new FakeElement(document);
  const notice = attachTileflowFairUseNotice(container as unknown as HTMLElement);

  notice.update({
    action: 'Site owner: manage this map with Tileflow.',
    helpUrl: 'https://tileflow.dev/world/claim',
    message: 'Map usage is approaching its temporary limit.',
    state: 'GRACE',
  });

  const grace = container.children[0]!;
  const graceIndicator = grace.children[0]!;
  const graceCopy = grace.children[1]!;
  const graceLink = graceCopy.children[0]!;
  assert.equal(grace.attributes.get('role'), 'status');
  assert.equal(grace.attributes.get('aria-live'), 'polite');
  assert.equal(grace.attributes.get('aria-atomic'), 'true');
  assert.equal(grace.dataset.tileflowFairUseNotice, 'grace');
  assert.equal(grace.style.bottom, '24px');
  assert.equal(grace.style.borderRadius, '999px');
  assert.equal(grace.style.background, 'rgba(252, 250, 244, 0.96)');
  assert.equal(grace.style.width, 'max-content');
  assert.equal(graceIndicator.attributes.get('aria-hidden'), 'true');
  assert.equal(graceIndicator.style.background, '#c58c28');
  assert.equal(graceLink.href, 'https://tileflow.dev/world/claim');
  assert.equal(graceLink.rel, 'noopener noreferrer');
  assert.equal(graceLink.target, '_blank');
  assert.equal(graceCopy.textContent, 'Map usage is approaching its temporary limit. ');
  assert.equal(graceLink.textContent, 'Site owner: manage this map with Tileflow.');

  notice.update({
    action: 'Site owner: manage this map with Tileflow.',
    helpUrl: 'https://tileflow.dev/world/claim',
    message: 'Map usage is temporarily limited.',
    state: 'CLAIM_REQUIRED',
  });
  const claimRequired = container.children[0]!;
  assert.notEqual(claimRequired, grace);
  assert.equal(claimRequired.dataset.tileflowFairUseNotice, 'claim-required');
  assert.equal(claimRequired.style.top, '14px');
  assert.equal(claimRequired.style.background, 'rgba(25, 34, 29, 0.96)');
  assert.equal(claimRequired.children[0]!.textContent, '!');
  assert.match(claimRequired.children[1]!.textContent, /temporarily limited/u);
  assert.equal(
    claimRequired.children[1]!.children[0]!.textContent,
    'Site owner: manage this map with Tileflow.',
  );

  notice.update({
    action: 'Site owner: manage this map with Tileflow.',
    helpUrl: 'https://tileflow.dev/world/claim',
    message: 'Map usage is approaching its temporary limit.',
    state: 'GRACE',
  });
  assert.equal(container.children[0], claimRequired);
  assert.match(claimRequired.children[1]!.textContent, /temporarily limited/u);

  notice.dispose();
  assert.equal(container.children.length, 0);
});

test('map readiness waits two frames and invalidating events cancel stale idle work', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler();
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  assert.deepEqual(states, ['loading']);
  map.emit('idle');
  assert.equal(scheduler.pendingCount, 1);

  scheduler.flushNext();
  assert.deepEqual(states, ['loading']);
  assert.equal(scheduler.pendingCount, 1);

  map.emit('dataloading');
  assert.deepEqual(states, ['loading', 'loading']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  scheduler.flushNext();
  map.emit('styledataloading');
  assert.deepEqual(states, ['loading', 'loading', 'loading']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  map.emit('error');
  assert.deepEqual(states, ['loading', 'loading', 'loading', 'error']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  scheduler.flushNext();
  scheduler.flushNext();
  assert.deepEqual(states, ['loading', 'loading', 'loading', 'error', 'idle']);

  lifecycle.dispose();
});

test('detach and dispose unsubscribe every event and invalidate pending frames', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler();
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  map.emit('idle');
  scheduler.flushNext();
  assert.equal(scheduler.pendingCount, 1);

  lifecycle.invalidate();
  assert.equal(scheduler.pendingCount, 0);
  lifecycle.dispose();
  lifecycle.dispose();

  assert.equal(map.unsubscribeCount, 5);
  assert.equal(map.listenerCount, 0);
  for (const event of lifecycleEvents) map.emit(event);
  scheduler.flushAll();
  assert.deepEqual(states, ['loading']);
});

test('dispose guards stale frame callbacks even when scheduler cancellation is best effort', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler(false);
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  map.emit('idle');
  scheduler.flushNext();
  assert.equal(scheduler.pendingCount, 1);
  lifecycle.dispose();
  scheduler.flushAll();

  assert.deepEqual(states, ['loading']);
  assert.equal(map.listenerCount, 0);
});

test('partial subscription failure rolls back and dispose attempts every unsubscriber', () => {
  const map = new FakeMap();
  const rolledBack: TileflowMapLifecycleEvent[] = [];

  assert.throws(
    () =>
      attachTileflowMapLifecycle({
        map,
        scheduler: new FakeFrameScheduler(),
        setState: () => {},
        subscribe: (_map, event) => {
          if (event === 'styledataloading') throw new Error('subscribe failed');
          return () => rolledBack.push(event);
        },
      }),
    /subscribe failed/,
  );
  assert.deepEqual(rolledBack, ['dataloading', 'load']);

  const unsubscribed: TileflowMapLifecycleEvent[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler: new FakeFrameScheduler(),
    setState: () => {},
    subscribe: (_map, event) => () => {
      unsubscribed.push(event);
      if (event === 'styledataloading') throw new Error('first unsubscribe failure');
      if (event === 'load') throw new Error('later unsubscribe failure');
    },
  });

  assert.throws(() => lifecycle.dispose(), /first unsubscribe failure/);
  assert.deepEqual(unsubscribed, ['error', 'idle', 'styledataloading', 'dataloading', 'load']);
  lifecycle.dispose();
});

test('load resolves the latest handler and starts each session key and style once', () => {
  const calls: string[] = [];
  const sends: Array<{mapId?: string; source: string; styleId?: string}> = [];
  const starter = createTileflowSessionStarter({
    sessionId: 'ses_test',
    source: 'react',
    startSession: (_analytics, input) => {
      calls.push(`session:${input.styleId}`);
      sends.push(input);
    },
  });
  let handler = () => calls.push('load:first');
  let analytics = {apiUrl: 'https://api.example.com', mapId: 'map_1'};
  let styleId = 'style-a';
  const firstMap = new FakeMap();
  const firstLifecycle = attachTileflowMapLifecycle({
    getSession: () => ({analytics, styleId}),
    map: firstMap,
    onLoad: () => handler(),
    scheduler: new FakeFrameScheduler(),
    sessionStarter: starter,
    setState: () => {},
    subscribe: subscribeFakeMap,
  });

  firstMap.emit('load');
  handler = () => calls.push('load:latest');
  firstMap.emit('load');
  styleId = 'style-b';
  firstMap.emit('load');
  firstLifecycle.dispose();

  const secondMap = new FakeMap();
  const secondLifecycle = attachTileflowMapLifecycle({
    getSession: () => ({analytics, styleId}),
    map: secondMap,
    onLoad: () => handler(),
    scheduler: new FakeFrameScheduler(),
    sessionStarter: starter,
    setState: () => {},
    subscribe: subscribeFakeMap,
  });
  secondMap.emit('load');

  analytics = {...analytics, enabled: false};
  styleId = 'style-disabled';
  secondMap.emit('load');
  secondMap.emit('load');
  secondLifecycle.dispose();

  assert.deepEqual(calls, [
    'load:first',
    'session:style-a',
    'load:latest',
    'load:latest',
    'session:style-b',
    'load:latest',
    'load:latest',
    'session:style-disabled',
    'load:latest',
  ]);
  assert.deepEqual(
    sends.map(({mapId, source, styleId: sentStyleId}) => ({mapId, source, styleId: sentStyleId})),
    [
      {mapId: 'map_1', source: 'react', styleId: 'style-a'},
      {mapId: 'map_1', source: 'react', styleId: 'style-b'},
      {mapId: 'map_1', source: 'react', styleId: 'style-disabled'},
    ],
  );
});

test('session starter follows a rotated commercial session identity', () => {
  const sends: string[] = [];
  let sessionId = 'ses_first';
  const starter = createTileflowSessionStarter({
    getSessionId: () => sessionId,
    sessionId,
    source: 'react',
    startSession: (_analytics, input) => sends.push(input.sessionId),
  });
  const analytics = {mapId: 'map_1'};

  assert.equal(starter.start(analytics, 'style_1'), true);
  assert.equal(starter.start(analytics, 'style_1'), false);
  sessionId = 'ses_second';
  assert.equal(starter.start(analytics, 'style_1'), true);
  assert.deepEqual(sends, ['ses_first', 'ses_second']);
});

test('transform request preserves sync user fields and applies analytics to the user URL', () => {
  let resourceType: string | undefined;
  const transform = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => ({apiUrl: 'https://api.example.com', mapId: 'map_1', styleId: 'style_1'}),
    sessionId: 'ses_test',
    transformRequest: (_url: string, nextResourceType?: string) => {
      resourceType = nextResourceType;
      return {
        headers: {'x-test': 'yes'},
        url: 'https://api.example.com/v1/tiles/world/1/2/3.pbf?token=safe',
      };
    },
  });

  const request = transform('https://ignored.example.com/tile.pbf', 'Tile');
  assert.equal(resourceType, 'Tile');
  assert.ok(request && !(request instanceof Promise));
  assert.deepEqual(request.headers, {'x-test': 'yes'});
  const requestUrl = new URL(request.url!);
  assert.equal(requestUrl.searchParams.get('token'), 'safe');
  assert.equal(requestUrl.searchParams.get('session'), 'ses_test');
  assert.equal(requestUrl.searchParams.get('map'), 'map_1');
  assert.equal(requestUrl.searchParams.get('styleId'), 'style_1');
});

test('transform request preserves request-time and resolution-time async analytics policies', async () => {
  let analytics = {apiUrl: 'https://api.example.com', mapId: 'map_before'};
  const requestDeferred = deferred<{url: string}>();
  const resolutionDeferred = deferred<{url: string}>();
  const requestTransform = createTileflowTransformRequest({
    always: true,
    asyncAnalyticsTiming: 'request',
    getAnalytics: () => analytics,
    sessionId: 'ses_test',
    transformRequest: () => requestDeferred.promise,
  });
  const resolutionTransform = createTileflowTransformRequest({
    always: true,
    asyncAnalyticsTiming: 'resolution',
    getAnalytics: () => analytics,
    sessionId: 'ses_test',
    transformRequest: () => resolutionDeferred.promise,
  });

  const requestResult = requestTransform('https://api.example.com/tiles/a/0/0/0.pbf');
  const resolutionResult = resolutionTransform('https://api.example.com/tiles/b/0/0/0.pbf');
  analytics = {...analytics, mapId: 'map_after'};
  requestDeferred.resolve({url: 'https://api.example.com/tiles/a/0/0/0.pbf'});
  resolutionDeferred.resolve({url: 'https://api.example.com/tiles/b/0/0/0.pbf'});

  assert.equal(new URL((await requestResult)!.url!).searchParams.get('map'), 'map_before');
  assert.equal(new URL((await resolutionResult)!.url!).searchParams.get('map'), 'map_after');
});

test('transform request composes the user rewrite with commercial authorization', async () => {
  let authorizedUrl = '';
  const sessionController = {
    sessionId: 'ses_commercial',
    async resolveRequestUrl(
      url: string,
      analytics: {enabled?: boolean; mapId?: string} | undefined,
    ) {
      authorizedUrl = url;
      assert.equal(analytics?.enabled, false);
      assert.equal(analytics?.mapId, 'map_1');
      const nextUrl = new URL(url);
      nextUrl.searchParams.set('grant', 'grant_test');
      return nextUrl.toString();
    },
  };
  const transform = createTileflowTransformRequest({
    getAnalytics: () => ({enabled: false, mapId: 'map_1'}),
    sessionController,
    sessionId: sessionController.sessionId,
    transformRequest: () => ({
      headers: {'x-user': 'preserved'},
      url: 'https://api.example.com/tiles/rewrite/0/0/0.pbf',
    }),
  });

  assert.ok(transform);
  const request = await transform('https://api.example.com/tiles/original/0/0/0.pbf', 'Tile');
  assert.equal(authorizedUrl, 'https://api.example.com/tiles/rewrite/0/0/0.pbf');
  assert.deepEqual(request?.headers, {'x-user': 'preserved'});
  assert.equal(new URL(request!.url).searchParams.get('grant'), 'grant_test');
});

test('transform request can be omitted, remains a no-op when forced, and propagates rejection', async () => {
  assert.equal(
    createTileflowTransformRequest({
      getAnalytics: () => undefined,
      sessionId: 'ses_test',
    }),
    undefined,
  );
  assert.equal(
    createTileflowTransformRequest({
      getAnalytics: () => ({enabled: false, mapId: 'map_1'}),
      sessionId: 'ses_test',
    }),
    undefined,
  );

  const forced = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => undefined,
    sessionId: 'ses_test',
  });
  assert.equal(forced('https://example.com/tile.pbf'), undefined);

  const original = {headers: {'x-test': 'yes'}, url: 'https://example.com/tile.pbf'};
  const disabled = createTileflowTransformRequest({
    getAnalytics: () => ({enabled: false, mapId: 'map_1'}),
    sessionId: 'ses_test',
    transformRequest: () => original,
  });
  assert.equal(disabled?.('https://example.com/original.pbf'), original);

  const expected = new Error('transform failed');
  const rejecting = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => undefined,
    sessionId: 'ses_test',
    transformRequest: () => Promise.reject(expected),
  });
  await assert.rejects(rejecting('https://example.com/tile.pbf') as Promise<unknown>, expected);
});

test('marker replacement cleans previous and partially attached batches and remains reusable', () => {
  type MarkerDefinition = {id: string};
  type Marker = {id: string; removed: number};
  const created: Marker[] = [];
  const attached: string[] = [];
  const controller = createTileflowMarkerController<object, MarkerDefinition, Marker>({
    attach: (marker) => {
      attached.push(marker.id);
      if (marker.id === 'broken') throw new Error('attach failed');
    },
    create: ({id}) => {
      const marker = {id, removed: 0};
      created.push(marker);
      return marker;
    },
    remove: (marker) => {
      marker.removed += 1;
      if (marker.id === 'partial') throw new Error('remove failed');
    },
  });
  const map = {};

  controller.replace(map, [{id: 'old'}]);
  assert.throws(() => controller.replace(map, [{id: 'partial'}, {id: 'broken'}]), /attach failed/);
  assert.deepEqual(
    created.map(({id, removed}) => ({id, removed})),
    [
      {id: 'old', removed: 1},
      {id: 'partial', removed: 1},
      {id: 'broken', removed: 1},
    ],
  );

  controller.clear();
  controller.replace(map, [{id: 'recovered'}]);
  controller.dispose();
  controller.dispose();
  assert.equal(created.at(-1)?.removed, 1);
  assert.deepEqual(attached, ['old', 'partial', 'broken', 'recovered']);
});

function registerTestWorldBridge(input: {
  fetch: typeof fetch;
  onNotice?: (notice: TileflowFairUseNotice | null) => void;
}): {
  bridge: ReturnType<typeof registerTileflowWorldRequestBridge>;
  protocolHandler: TileflowWorldProtocolHandler;
} {
  const bridge = registerTileflowWorldRequestBridge({
    addProtocol(name, handler) {
      assert.equal(name, 'tileflow-world');
      installedWorldProtocolHandler = handler;
    },
    fetch: input.fetch,
    onNotice: input.onNotice ?? (() => {}),
  });
  const protocolHandler = installedWorldProtocolHandler;
  assert.ok(protocolHandler);
  return {bridge, protocolHandler};
}

const lifecycleEvents: TileflowMapLifecycleEvent[] = [
  'load',
  'dataloading',
  'styledataloading',
  'idle',
  'error',
];

class FakeMap {
  readonly listeners = new Map<TileflowMapLifecycleEvent, Set<() => void>>();
  unsubscribeCount = 0;

  get listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }

  emit(event: TileflowMapLifecycleEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
}

function subscribeFakeMap(
  map: FakeMap,
  event: TileflowMapLifecycleEvent,
  listener: () => void,
): () => void {
  const listeners = map.listeners.get(event) ?? new Set();
  listeners.add(listener);
  map.listeners.set(event, listeners);
  let subscribed = true;

  return () => {
    if (!subscribed) return;
    subscribed = false;
    map.unsubscribeCount += 1;
    listeners.delete(listener);
  };
}

class FakeFrameScheduler {
  #callbacks = new Map<number, () => void>();
  #cancellationWorks: boolean;
  #nextFrame = 1;

  constructor(cancellationWorks = true) {
    this.#cancellationWorks = cancellationWorks;
  }

  get pendingCount(): number {
    return this.#callbacks.size;
  }

  cancelFrame = (frame: number): void => {
    if (this.#cancellationWorks) this.#callbacks.delete(frame);
  };

  requestFrame = (callback: () => void): number => {
    const frame = this.#nextFrame++;
    this.#callbacks.set(frame, callback);
    return frame;
  };

  flushAll(): void {
    while (this.#callbacks.size > 0) this.flushNext();
  }

  flushNext(): void {
    const entry = this.#callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return;
    const [frame, callback] = entry;
    this.#callbacks.delete(frame);
    callback();
  }
}

class FakeDocument {
  createElement(): FakeElement {
    return new FakeElement(this);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  href = '';
  parent: FakeElement | null = null;
  rel = '';
  target = '';
  textContent = '';

  constructor(readonly ownerDocument: FakeDocument) {}

  append(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parent?.children.splice(index, 1);
    this.parent = null;
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    for (const child of children) this.append(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {promise, resolve};
}
