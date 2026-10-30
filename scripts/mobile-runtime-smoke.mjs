import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {crc32, deflateSync} from 'node:zlib';

// Loads the built embedded runtime in desktop engines with a stub native host. The stub plays the
// Android role: it injects the document-start host identity, receives runtime output, and serves
// every opaque transport address from the fixture map, and serves registered payloads on the data
// channel. It proves protocol and renderer behavior, not pixels; the simulator and emulator suites
// own presentation.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = resolve(root, 'packages/mobile-runtime');
const require = createRequire(resolve(runtimeRoot, 'package.json'));
const playwright = require('playwright');
const {values} = parseArgs({options: {browser: {type: 'string', default: 'chromium,webkit'}}});
const engines = values.browser.split(',');
const origin = 'https://tileflow.invalid';
const timeoutMs = 60_000;
const receipt = JSON.parse(await readFile(resolve(runtimeRoot, 'dist/receipt.json'), 'utf8'));
const protocol = JSON.parse(await readFile(resolve(runtimeRoot, 'protocol.json'), 'utf8'));
const contentTypes = {
  'index.html': 'text/html; charset=utf-8',
  'runtime.js': 'text/javascript; charset=utf-8',
  'maplibre.css': 'text/css; charset=utf-8',
};
const runtimeFiles = new Map();
for (const name of Object.keys(contentTypes))
  runtimeFiles.set(name, await readFile(resolve(runtimeRoot, 'dist', name)));

const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const {port: free} = probe.address();
    probe.close(() => resolvePort(free));
  });
});
const fixtureOrigin = `http://127.0.0.1:${port}`;
const fixture = spawn(process.execPath, [resolve(root, 'scripts/mobile-fixture-server.mjs')], {
  env: {...process.env, TILEFLOW_FIXTURE_PORT: String(port)},
  stdio: ['ignore', 'ignore', 'inherit'],
});

/** Mirrors the native transport: one opaque token, optional XYZ suffix, fixture origin only. */
function transportTarget(address) {
  const [token, ...tile] = address.pathname.slice('/resource/'.length).split('/');
  if (!/^[A-Za-z0-9_-]+$/u.test(token) || ![0, 3].includes(tile.length)) return undefined;
  let target = Buffer.from(token, 'base64url').toString('utf8');
  for (const [index, axis] of ['z', 'x', 'y'].entries()) {
    if (tile.length && !/^(0|[1-9][0-9]{0,7})$/u.test(tile[index])) return undefined;
    if (tile.length) target = target.replace(`%7B${axis}%7D`, tile[index]);
  }
  return new URL(target).origin === fixtureOrigin ? target : undefined;
}

/** A PNG of one colour, as an application passes an image to the map. */
function png(width, height, [red, green, blue, alpha]) {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type), body]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(width).fill([red, green, blue, alpha]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A GeoJSON FeatureCollection of points around the fixture map, of at least `bytes`. */
function largeGeoJSON(bytes) {
  const features = [];
  let size = 0;
  for (let index = 0; size < bytes; index += 1) {
    const feature = JSON.stringify({
      type: 'Feature',
      id: index,
      properties: {name: `Point ${index}`, rank: index % 7},
      geometry: {
        type: 'Point',
        coordinates: [-3.75 + (index % 1000) / 10_000, 40.4 + Math.floor(index / 1000) / 1000],
      },
    });
    features.push(feature);
    size += feature.length + 1;
  }
  return Buffer.from(`{"type":"FeatureCollection","features":[${features.join(',')}]}`);
}

async function runEngine(name) {
  const instanceId = randomUUID();
  const browser = await playwright[name].launch({headless: true});
  const outputs = [];
  const failures = [];
  const waiters = new Set();
  const started = performance.now();
  const timings = {};
  const counts = {};
  // The host's data channel: payloads by opaque identifier, released after each request.
  const data = new Map();
  const dataReads = [];
  const register = (bytes) => {
    const id = randomBytes(16).toString('base64url');
    data.set(id, bytes);
    return {
      id,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}});
    await context.route(`${origin}/**`, async (route) => {
      const address = new URL(route.request().url());
      if (address.pathname.startsWith('/data/')) {
        const id = address.pathname.slice('/data/'.length);
        dataReads.push(id);
        const body = data.get(id);
        return body
          ? route.fulfill({body, contentType: 'application/geo+json'})
          : route.fulfill({status: 404});
      }
      if (address.pathname.startsWith('/runtime/')) {
        const file = address.pathname.slice('/runtime/'.length);
        const body = runtimeFiles.get(file);
        return body
          ? route.fulfill({body, contentType: contentTypes[file]})
          : route.fulfill({status: 404});
      }
      const target = address.pathname.startsWith('/resource/') && transportTarget(address);
      if (!target) {
        failures.push(`unexpected transport request ${address.pathname}`);
        return route.fulfill({status: 403});
      }
      const response = await fetch(target, {
        method: route.request().method(),
        headers: route.request().headers(),
      });
      return route.fulfill({
        status: response.status,
        headers: {'content-type': response.headers.get('content-type') ?? ''},
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await context.exposeFunction('tileflowSmokeOutput', (message) => {
      outputs.push(JSON.parse(message));
      for (const check of [...waiters]) check();
    });
    await context.addInitScript(
      (host) => {
        Object.defineProperty(globalThis, 'tileflowHost', {value: host});
        Object.defineProperty(globalThis, 'tileflowNative', {
          value: {postMessage: (message) => globalThis.tileflowSmokeOutput(message)},
        });
      },
      {
        instanceId,
        generation: 1,
        platform: 'android',
        protocol: {minimum: protocol.minimumVersion, maximum: protocol.version},
      },
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
    // The browser logs the deliberate read of released data below.
    let releasedReads = 0;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (releasedReads > 0 && message.text().includes('404')) releasedReads -= 1;
      else failures.push(`console error: ${message.text()}`);
    });

    const waitFor = (label, predicate) =>
      new Promise((resolveWait, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`${name}: timed out waiting for ${label}`));
        }, timeoutMs);
        const check = () => {
          const match = outputs.find(predicate);
          if (!match) return;
          waiters.delete(check);
          clearTimeout(timer);
          timings[label] ??= Math.round(performance.now() - started);
          resolveWait(match);
        };
        waiters.add(check);
        check();
      });
    const envelope = {protocolVersion: protocol.version, instanceId, generation: 1};
    let requestId = 0;
    /** Sends a request and returns its identifier and its answer, without waiting for it. */
    const send = async (method, payload, label = method) => {
      const id = String(++requestId);
      const message = JSON.stringify({...envelope, requestId: id, command: {method, payload}});
      await page.evaluate((value) => globalThis.tileflow.receive(value), message);
      return {id, done: waitFor(label, (candidate) => candidate.requestId === id)};
    };
    /** A result larger than a control message arrives in parts the host reads in turn. */
    const assemble = async (output) => {
      if (output.chunks === undefined) return output;
      let text = '';
      for (let index = 0; index < output.chunks; index += 1) {
        const part = await (await send('readResult', {requestId: output.requestId, index})).done;
        assert.equal(part.error, undefined, `${name}: result part ${index}`);
        text += part.result;
      }
      counts['largest result parts'] = Math.max(counts['largest result parts'] ?? 0, output.chunks);
      return {...output, result: JSON.parse(text)};
    };
    const request = async (method, payload, label = method) =>
      assemble(await (await send(method, payload, label)).done);
    const call = async (method, payload, label) => {
      const output = await request(method, payload, label);
      assert.equal(output.error, undefined, `${name}: ${method} failed: ${output.error?.message}`);
      return output.result;
    };
    const event = (label, predicate) =>
      waitFor(label, (output) => output.requestId === undefined && predicate(output));
    /** Sends a command whose payload the host put on the data channel, as hosts do past 64 KiB. */
    const deferredCall = async (method, payloadData) => {
      const id = String(++requestId);
      const message = JSON.stringify({...envelope, requestId: id, command: {method, payloadData}});
      await page.evaluate((value) => globalThis.tileflow.receive(value), message);
      const output = await assemble(
        await waitFor(`${method} on the data channel`, (candidate) => candidate.requestId === id),
      );
      assert.equal(output.error, undefined, `${name}: ${method} failed: ${output.error?.message}`);
      return output.result;
    };

    await page.goto(`${origin}/runtime/index.html`);
    const hello = await event('hello', (output) => output.event === 'hello');
    assert.deepEqual(
      {...hello, result: undefined},
      {...envelope, event: 'hello', result: undefined},
    );
    assert.equal(hello.result.runtimeHash, receipt.runtimeHash, `${name}: runtime hash`);
    assert.equal(hello.result.protocol.selected, protocol.version, `${name}: negotiation`);

    await page.evaluate(() => globalThis.tileflow.receive('{'));
    const rejected = await event('invalid request', (output) => output.error);
    assert.equal(rejected.error.code, 'invalidRequest');

    await call('initialize', {
      source: {map: 'fixture', manifestUrl: `${fixtureOrigin}/manifest.json`},
      theme: 'light',
      colorScheme: 'light',
    });
    await event('loading', (output) => output.event === 'loading');
    const ready = await event('contentReady', (output) => output.event === 'contentReady');
    assert.equal(ready.result.theme, 'light');
    assert.ok(Math.abs(ready.result.camera.longitude + 3.7) < 0.01, `${name}: initial camera`);

    const theme = await call('setTheme', {theme: 'dark', duration: 0});
    assert.equal(theme.theme, 'dark');
    await event(
      'themeChanged',
      (output) => output.event === 'themeChanged' && output.result.theme === 'dark',
    );
    // Theme transitions report each phase; the settled one carries the theme's route inks.
    const transition = await event(
      'themeTransition ready',
      (output) => output.event === 'themeTransition' && output.result.phase === 'ready',
    );
    assert.equal(transition.result.currentTheme, 'dark');
    assert.equal(transition.result.routeInks.line, '#60a5fa', `${name}: dark route inks`);
    assert.ok(
      outputs.some(
        (output) => output.event === 'themeTransition' && output.result.phase === 'applying',
      ),
      `${name}: applying phase`,
    );
    const camera = await call('getCamera', null);
    assert.ok(Math.abs(camera.latitude - 40.42) < 0.01, `${name}: camera after theme change`);

    // Camera events follow the subscription, its throttle and the reason for each movement.
    const cameraEvents = () => outputs.filter((output) => output.event?.startsWith('camera'));
    assert.deepEqual(cameraEvents(), [], `${name}: camera events before any movement`);
    await call('setEvents', {
      events: {
        cameraMoveStarted: {throttleMs: 0},
        cameraMoved: {throttleMs: 100},
        cameraMoveEnded: {throttleMs: 0},
      },
    });
    const eased = await call('moveCamera', {
      target: {center: {longitude: -3.69, latitude: 40.42}, zoom: 13},
      animation: {type: 'ease', duration: 800},
    });
    assert.equal(eased.completion, 'finished', `${name}: eased movement`);
    const ended = await event('cameraMoveEnded', (output) => output.event === 'cameraMoveEnded');
    const movement = cameraEvents();
    assert.equal(movement[0].event, 'cameraMoveStarted', `${name}: movement start`);
    assert.ok(
      movement.every((output) => output.result.reason === 'api'),
      `${name}: camera reasons ${movement.map((output) => output.result.reason)}`,
    );
    const moved = movement.filter((output) => output.event === 'cameraMoved').length;
    assert.ok(moved >= 2 && moved <= 11, `${name}: ${moved} throttled camera updates`);
    assert.ok(Math.abs(ended.result.camera.longitude + 3.69) < 0.001, `${name}: settled camera`);
    counts['camera updates in 800 ms at a 100 ms throttle'] = moved;
    // An unsubscribed event never crosses the bridge.
    await call('setEvents', {events: {cameraMoveEnded: {throttleMs: 0}}});
    const before = cameraEvents().length;
    await call('moveCamera', {
      target: {center: {longitude: -3.7, latitude: 40.42}, zoom: 14},
      animation: {type: 'ease', duration: 300},
    });
    await waitFor(
      'second settled camera',
      (output) =>
        output.event === 'cameraMoveEnded' && output.result.revision > ended.result.revision,
    );
    assert.deepEqual(
      cameraEvents()
        .slice(before)
        .map((output) => output.event),
      ['cameraMoveEnded'],
      `${name}: unsubscribed camera events`,
    );

    // Each movement answers with how it ended: replaced, stopped or taken over by a gesture.
    const slow = (zoom) => ({
      target: {center: {longitude: -3.7, latitude: 40.42}, zoom},
      animation: {type: 'ease', duration: 5000},
    });
    const replaced = await send('moveCamera', slow(16), 'replaced movement');
    const flight = await send(
      'moveCamera',
      {...slow(13), animation: {type: 'fly', speed: 4}},
      'flight',
    );
    assert.equal((await replaced.done).result.completion, 'cancelled', `${name}: replaced`);
    assert.equal((await flight.done).result.completion, 'finished', `${name}: flight`);
    const stopped = await send('moveCamera', slow(16), 'stopped movement');
    await call('stopCamera', null);
    assert.equal((await stopped.done).result.completion, 'cancelled', `${name}: stopped`);
    await call('setEvents', {
      events: {gestureStarted: {throttleMs: 0}, longPress: {throttleMs: 0}, tap: {throttleMs: 0}},
    });
    const grabbed = await send('moveCamera', slow(16), 'grabbed movement');
    await page.mouse.move(195, 420);
    await page.mouse.down();
    await page.mouse.move(240, 470, {steps: 5});
    await page.mouse.up();
    assert.equal((await grabbed.done).result.completion, 'interrupted', `${name}: gesture`);
    await event('pan gesture', (output) => output.event === 'gestureStarted');
    // A press that holds still is a long press, not a tap.
    await page.mouse.down();
    await event('long press', (output) => output.event === 'longPress');
    await page.mouse.up();
    // Insets centre the camera on the uncovered view and keep the attribution inside it.
    await call('setInsets', {top: 0, left: 0, bottom: 300, right: 0});
    assert.equal(
      await page.evaluate(
        () => globalThis.document.querySelector('.maplibregl-ctrl-bottom-right')?.style.bottom,
      ),
      '300px',
      `${name}: attribution inset`,
    );
    await call('moveCamera', {
      target: {center: {longitude: -3.7, latitude: 40.42}, zoom: 16, pitch: 80},
      animation: {type: 'jump'},
    });
    const centre = await call('project', {longitude: -3.7, latitude: 40.42});
    assert.ok(Math.abs(centre.y - (844 - 300) / 2) < 1, `${name}: inset centre ${centre.y}`);
    // Feature queries keep working once a steep pitch shows the horizon.
    let steep = [];
    for (
      let attempt = 0;
      attempt < 50 && !steep.some((feature) => feature.layer === 'poi');
      attempt++
    ) {
      if (attempt) await new Promise((wait) => setTimeout(wait, 100));
      steep = await call('queryAtPoint', centre);
    }
    assert.ok(
      steep.some((feature) => feature.layer === 'poi'),
      `${name}: features at pitch 80: ${JSON.stringify(steep)}`,
    );
    await call('setInsets', {top: 0, left: 0, bottom: 0, right: 0});
    assert.equal(
      outputs.filter((output) => output.event === 'tap').length,
      0,
      `${name}: taps after a drag and a long press`,
    );

    // Large application data travels over the data channel, verified and read once.
    const geoJSON = largeGeoJSON(5 * 1024 * 1024);
    const reference = register(geoJSON);
    const overlay = (data, id = 'points') => ({id, kind: 'circle', data, size: 2});
    const transfer = performance.now();
    await call('setContent', {annotations: [], overlays: [overlay(reference)]}, 'large content');
    timings[`setContent ${(geoJSON.byteLength / 1048576).toFixed(1)} MiB`] = Math.round(
      performance.now() - transfer,
    );
    data.delete(reference.id);
    assert.deepEqual(dataReads, [reference.id], `${name}: data reads`);
    // Unchanged data is not read again, even under another layer.
    const again = register(geoJSON);
    await call('setContent', {
      annotations: [],
      overlays: [overlay(again), overlay(again, 'points-outline')],
    });
    data.delete(again.id);
    assert.deepEqual(dataReads, [reference.id], `${name}: unchanged data was read again`);
    const failure = async (bytes, mutate) => {
      const target = register(bytes);
      const output = await request('setContent', {
        annotations: [],
        overlays: [overlay({...target, ...mutate})],
      });
      data.delete(target.id);
      return {code: output.error?.code, reason: output.error?.context?.reason};
    };
    const small = Buffer.from('{"type":"FeatureCollection","features":[]}');
    assert.deepEqual(await failure(small, {sha256: '0'.repeat(64)}), {
      code: 'resourceFailed',
      reason: 'dataIntegrity',
    });
    assert.deepEqual(await failure(Buffer.from('{"type":"Feature"}'), {}), {
      code: 'invalidRequest',
      reason: 'invalidGeoJSON',
    });
    releasedReads = 1;
    assert.deepEqual(await failure(small, {id: randomBytes(16).toString('base64url')}), {
      code: 'resourceFailed',
      reason: 'dataUnavailable',
    });

    // The map's scene beyond its theme, through Core's controllers. Animations report their end
    // and cues at the essential level.
    await call('setEvents', {
      events: Object.fromEntries(
        Object.entries(protocol.events)
          .filter(([, value]) => value.level === 'essential')
          .map(([event]) => [event, {throttleMs: 0}]),
      ),
    });
    assert.equal((await call('getRouteInks', null)).line, '#60a5fa', `${name}: route inks`);
    const route = register(
      Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-3.715, 40.415],
                  [-3.7, 40.42],
                  [-3.685, 40.425],
                ],
              },
            },
          ],
        }),
      ),
    );
    await call('setContent', {
      annotations: [],
      overlays: [
        {
          id: 'route-casing',
          kind: 'line',
          data: route,
          ink: 'casing',
          size: 9,
          placement: 'ground',
        },
        {
          id: 'route-line',
          kind: 'line',
          data: route,
          ink: 'line',
          placement: 'ground',
          occludedOpacity: 0.4,
          progress: {end: 0},
        },
      ],
    });
    data.delete(route.id);
    const progress = await call('animateLineProgress', {
      layers: ['route-line'],
      to: {end: 1, light: 0.5},
      duration: 300,
    });
    await event(
      'line progress',
      (output) =>
        output.event === 'animationEnded' && output.result.animation === progress.animation,
    ).then((output) => assert.equal(output.result.finished, true, `${name}: line progress`));
    const unknownLayer = await request('animateLineProgress', {
      layers: ['route-casing'],
      to: {end: 1},
      duration: 0,
    });
    assert.equal(unknownLayer.error?.context?.reason, 'unknownLayer');
    await call('setTheme', {theme: 'light', duration: 0});
    await call('setStyleState', {name: 'emphasis-level', value: 0.5, duration: 0});
    await call('setSun', {sun: {azimuth: 220, altitude: 15}, duration: 0});
    await call('setSun', {
      sun: {date: Date.UTC(2026, 5, 21, 18), location: {longitude: -3.7, latitude: 40.42}},
    });
    const keep = register(
      Buffer.from(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [-3.71, 40.41],
              [-3.69, 40.41],
              [-3.69, 40.43],
              [-3.71, 40.41],
            ],
          ],
        }),
      ),
    );
    await call('setEmphasis', {emphasis: {labels: 0.3, keep}, duration: 0});
    data.delete(keep.id);
    await call('setEmphasis', {emphasis: null});
    const rows = register(
      Buffer.from(
        JSON.stringify([
          [1, 4.5],
          [2, null],
        ]),
      ),
    );
    await call('setBoundaryValues', {values: {joinBy: 'id', rows}});
    data.delete(rows.id);
    await call('setBoundaryValues', {values: null});
    const pin = register(png(24, 32, [233, 87, 63, 255]));
    const darkPin = register(png(24, 32, [255, 255, 255, 255]));
    await call('setImages', {
      images: [{name: 'pin', data: pin, pixelRatio: 2, variants: {dark: darkPin}}],
    });
    data.delete(pin.id);
    data.delete(darkPin.id);
    await call('setDepthMarkers', {
      markers: [
        {
          id: 'cafe',
          coordinate: {longitude: -3.7, latitude: 40.42},
          image: 'pin',
          size: [24, 32],
          anchor: 'bottom',
        },
      ],
    });
    const unknownImage = await request('setDepthMarkers', {
      markers: [
        {id: 'b', coordinate: {longitude: -3.7, latitude: 40.42}, image: 'missing', size: [8, 8]},
      ],
    });
    assert.equal(unknownImage.error?.code, 'invalidRequest', `${name}: marker without image`);
    const brokenImage = register(Buffer.from('not an image'));
    const decoding = await request('setImages', {images: [{name: 'broken', data: brokenImage}]});
    data.delete(brokenImage.id);
    assert.equal(decoding.error?.context?.reason, 'invalidImage', `${name}: undecodable image`);
    await call('setOptions', {viewMode: '2d', quality: 'balanced', vegetation: false});
    await call('setViewMode', {viewMode: '3d', duration: 600});

    // A shot reports its movement once, with its cues, however many frames it moves.
    const settledBefore = outputs.filter((output) => output.event === 'cameraMoveEnded').length;
    const shot = await call('playShot', {
      keyframes: [
        {at: 0, camera: {longitude: -3.7, latitude: 40.42, zoom: 13}},
        {at: 600, camera: {longitude: -3.69, latitude: 40.425, zoom: 14, bearing: 30, pitch: 60}},
      ],
      cues: [{at: 300, id: 'midway'}],
    });
    const shotEnded = await event(
      'shot',
      (output) => output.event === 'animationEnded' && output.result.animation === shot.animation,
    );
    assert.equal(shotEnded.result.finished, true, `${name}: shot finished`);
    assert.ok(
      outputs.some((output) => output.event === 'shotCue' && output.result.cue === 'midway'),
      `${name}: shot cue`,
    );
    const settledShot = outputs.filter((output) => output.event === 'cameraMoveEnded');
    assert.equal(settledShot.length, settledBefore + 1, `${name}: one settled camera per shot`);
    assert.equal(settledShot.at(-1).result.reason, 'api');
    assert.ok(Math.abs(settledShot.at(-1).result.camera.pitch - 60) < 0.01, `${name}: shot end`);
    const long = await call('playShot', {
      keyframes: [
        {at: 0, camera: {longitude: -3.7, latitude: 40.42, zoom: 13}},
        {at: 60_000, camera: {longitude: -3.6, latitude: 40.42, zoom: 13}},
      ],
    });
    await call('stopAnimation', {animation: long.animation});
    const stoppedShot = await event(
      'stopped shot',
      (output) => output.event === 'animationEnded' && output.result.animation === long.animation,
    );
    assert.equal(stoppedShot.result.finished, false, `${name}: stopped shot`);
    await styleSmoke({name, call, request, deferredCall, register, data, timings, counts, page});
    await annotationSmoke({name, call, register, data, counts, page, outputs, event});
    await call('dispose', null);

    const errors = outputs.filter((output) => output.event === 'error' || output.error);
    assert.deepEqual(
      errors.map((output) => output.error?.code ?? output.result.code),
      [
        'invalidRequest',
        'resourceFailed',
        'invalidRequest',
        'resourceFailed',
        'invalidRequest',
        'invalidRequest',
        'invalidRequest',
        // The runtime style's refusals: a paint value MapLibre rejects and an unknown source.
        'invalidRequest',
        'invalidRequest',
      ],
      `${name}: unexpected runtime errors`,
    );
    assert.deepEqual(failures, [], `${name}: browser failures`);
    console.log(
      `${name} ${browser.version()}: ${[
        ...Object.entries(timings).map(([label, ms]) => `${label} ${ms} ms`),
        ...Object.entries(counts).map(([label, count]) => `${label}: ${count}`),
      ].join(', ')}`,
    );
  } finally {
    await browser.close();
  }
}

/** Points on a grid around the fixture map, each with a numeric identifier and a rank. */
function gridPoints(count) {
  const features = Array.from({length: count}, (_, index) => ({
    type: 'Feature',
    id: index,
    properties: {rank: index % 10},
    geometry: {
      type: 'Point',
      coordinates: [-3.9 + (index % 400) / 1000, 40.3 + Math.floor(index / 400) / 1000],
    },
  }));
  return Buffer.from(JSON.stringify({type: 'FeatureCollection', features}));
}

/** Frame intervals in the page while the camera moves, as p50 and p95 in milliseconds. */
async function frameIntervals(page, call, target) {
  const sampling = page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let last;
        const frame = (time) => {
          if (last !== undefined) intervals.push(time - last);
          last = time;
          if (intervals.length < 90) globalThis.requestAnimationFrame(frame);
          else resolve(intervals);
        };
        globalThis.requestAnimationFrame(frame);
      }),
  );
  await call('moveCamera', {...target, animation: {type: 'ease', duration: 1500}});
  const sorted = (await sampling).sort((a, b) => a - b);
  const at = (share) => Math.round(sorted[Math.floor(share * (sorted.length - 1))]);
  return `p50 ${at(0.5)} / p95 ${at(0.95)}`;
}

/**
 * The application's runtime style through the real renderer: 100,000 clustered points, cluster
 * queries, feature state, incremental updates, every query geometry, payloads and results larger
 * than a control message, and all of it surviving a theme change.
 */
async function styleSmoke({
  name,
  call,
  request,
  deferredCall,
  register,
  data,
  timings,
  counts,
  page,
}) {
  const time = async (label, run) => {
    const started = performance.now();
    const result = await run();
    timings[label] = Math.round(performance.now() - started);
    return result;
  };
  const poll = async (label, run, accept) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = await run();
      if (accept(value)) return value;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    throw new Error(`${name}: ${label}`);
  };
  await call('moveCamera', {
    target: {center: {longitude: -3.7, latitude: 40.42}, zoom: 9, pitch: 0, bearing: 0},
    animation: {type: 'jump'},
  });
  const points = gridPoints(100_000);
  const reference = register(points);
  await time(
    `addSource 100k clustered points (${(points.byteLength / 1048576).toFixed(1)} MiB)`,
    () =>
      call('addSource', {
        id: 'points',
        source: {
          type: 'geojson',
          data: reference,
          cluster: true,
          clusterRadius: 50,
          clusterProperties: {rankSum: ['+', ['get', 'rank']]},
        },
      }),
  );
  data.delete(reference.id);
  await call('addLayer', {
    layer: {
      id: 'clusters',
      type: 'circle',
      source: 'points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'],
        'circle-radius': ['step', ['get', 'point_count'], 16, 100, 22, 750, 30],
      },
    },
    slot: 'above-labels',
  });
  await call('addLayer', {
    layer: {
      id: 'point',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 4,
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          '#ff0000',
          '#11b4da',
        ],
      },
    },
  });
  await call('addLayer', {
    layer: {id: 'heat', type: 'heatmap', source: 'points', maxzoom: 9},
    position: {below: 'clusters'},
  });
  const refused = await request('addLayer', {
    layer: {id: 'broken', type: 'circle', source: 'points', paint: {'circle-radius': 'large'}},
  });
  assert.equal(refused.error?.code, 'invalidRequest', `${name}: invalid paint`);
  const unknown = await request('addLayer', {layer: {id: 'x', type: 'line', source: 'missing'}});
  assert.equal(unknown.error?.context?.reason, 'unknownSource', `${name}: unknown source`);
  const clusters = await time('first clusters rendered', () =>
    poll(
      'clusters render',
      () => call('queryRenderedFeatures', {layers: ['clusters']}),
      (features) => features.length > 0,
    ),
  );
  counts['clusters in view at zoom 9'] = clusters.length;
  const largest = clusters.reduce((a, b) =>
    a.properties.point_count >= b.properties.point_count ? a : b,
  );
  assert.equal(largest.layer, 'clusters');
  assert.equal(largest.source, 'points');
  assert.ok(largest.properties.rankSum > 0, `${name}: cluster properties`);
  const cluster = largest.properties.cluster_id;
  const children = await call('queryCluster', {source: 'points', cluster, query: 'children'});
  assert.ok(children.length > 1, `${name}: cluster children`);
  const leaves = await call('queryCluster', {source: 'points', cluster, query: 'leaves', limit: 5});
  assert.equal(leaves.length, 5, `${name}: cluster leaves`);
  // An interactive cluster: a tap finds it, and the map zooms to where it splits.
  const [longitude, latitude] = largest.geometry.coordinates;
  const point = await call('project', {longitude, latitude});
  const expansion = await time('cluster tap: query, expansion zoom', async () => {
    const hit = await call('queryRenderedFeatures', {geometry: {point}, layers: ['clusters']});
    assert.ok(hit.length > 0, `${name}: tapped cluster`);
    return call('queryCluster', {
      source: 'points',
      cluster: hit[0].properties.cluster_id,
      query: 'expansionZoom',
    });
  });
  assert.ok(expansion > 9, `${name}: expansion zoom ${expansion}`);
  timings['frames while panning 100k clustered points (ms)'] = await frameIntervals(page, call, {
    target: {center: {longitude: -3.75, latitude: 40.38}, zoom: expansion},
  });
  // A polygon and a box around the cluster find it; at a steep pitch, so does the whole view.
  const around = (size) => [
    {x: point.x - size, y: point.y - size},
    {x: point.x + size, y: point.y - size},
    {x: point.x + size, y: point.y + size},
    {x: point.x - size, y: point.y + size},
  ];
  await call('moveCamera', {
    target: {center: {longitude, latitude}, zoom: 9},
    animation: {type: 'jump'},
  });
  const centre = await call('project', {longitude, latitude});
  const ring = around(10).map(({x, y}) => ({x: x - point.x + centre.x, y: y - point.y + centre.y}));
  const inPolygon = await poll(
    'polygon query',
    () => call('queryRenderedFeatures', {geometry: {polygon: ring}, layers: ['clusters']}),
    (features) => features.length > 0,
  );
  assert.ok(inPolygon.some((feature) => feature.properties.cluster_id !== undefined));
  const inBox = await call('queryRenderedFeatures', {
    geometry: {box: [ring[0], ring[2]]},
    layers: ['clusters'],
    filter: ['>=', ['get', 'point_count'], 2],
  });
  assert.ok(inBox.length > 0, `${name}: box query`);
  await call('moveCamera', {
    target: {center: {longitude: -3.7, latitude: 40.42}, zoom: 12, pitch: 80},
    animation: {type: 'jump'},
  });
  // Tiles keep arriving after the jump; the view is queried once its features stop changing.
  let steep = [];
  for (let stable = 0, attempt = 0; stable < 5 && attempt < 200; attempt += 1) {
    await new Promise((wait) => setTimeout(wait, 100));
    const next = await call('queryRenderedFeatures', {limit: 100_000});
    stable = next.length > 0 && next.length === steep.length ? stable + 1 : 0;
    steep = next;
  }
  // Above the horizon the view shows sky; strips of the view find nothing the whole view misses.
  const key = (feature) => `${feature.layer}:${feature.id}:${feature.properties.cluster_id}`;
  const stripped = new Set();
  for (let strip = 0; strip < 12; strip += 1) {
    const found = await call('queryRenderedFeatures', {
      geometry: {
        box: [
          {x: 0, y: (844 / 12) * strip},
          {x: 390, y: (844 / 12) * (strip + 1)},
        ],
      },
      limit: 100_000,
    });
    for (const feature of found) stripped.add(key(feature));
  }
  const whole = new Set((await call('queryRenderedFeatures', {limit: 100_000})).map(key));
  const missed = [...stripped].filter((feature) => !whole.has(feature));
  assert.deepEqual(missed, [], `${name}: the whole view at pitch 80 misses features`);
  counts['features in the whole view at pitch 80'] = whole.size;
  await call('moveCamera', {
    target: {center: {longitude, latitude}, zoom: 9, pitch: 0},
    animation: {type: 'jump'},
  });

  // Feature state and the map's style change: everything the application added comes back.
  await call('setFeatureState', {source: 'points', id: '5', state: {selected: true}});
  assert.deepEqual(await call('getFeatureState', {source: 'points', id: '5'}), {selected: true});
  await time('theme change with 100k clustered points', () =>
    call('setTheme', {theme: 'light', duration: 0}),
  );
  assert.deepEqual(await call('getFeatureState', {source: 'points', id: '5'}), {selected: true});
  const restored = await poll(
    'clusters after a theme change',
    () => call('queryRenderedFeatures', {layers: ['clusters']}),
    (features) => features.length > 0,
  );
  counts['clusters after a theme change'] = restored.length;
  await call('removeFeatureState', {source: 'points', id: '5', key: 'selected'});
  assert.deepEqual(await call('getFeatureState', {source: 'points', id: '5'}), {});

  // Features change one by one without sending the rest again.
  await call('addSource', {id: 'live', source: {type: 'geojson', data: {empty: true}}});
  await call('addLayer', {
    layer: {id: 'live', type: 'circle', source: 'live', paint: {'circle-radius': 6}},
    slot: 'below-labels',
  });
  const feature = (id, longitude) => ({
    type: 'Feature',
    id,
    properties: {name: `vehicle ${id}`},
    geometry: {type: 'Point', coordinates: [longitude, latitude]},
  });
  const added = register(
    Buffer.from(JSON.stringify([feature(1, longitude), feature(2, longitude + 0.01)])),
  );
  await call('updateGeoJSONSource', {id: 'live', add: added});
  data.delete(added.id);
  await call('updateGeoJSONSource', {id: 'live', remove: ['1']});
  const live = await poll(
    'incremental features',
    () => call('querySourceFeatures', {source: 'live'}),
    (features) => features.length === 1,
  );
  assert.equal(live[0].properties.name, 'vehicle 2');
  await call('updateLayer', {
    layer: {id: 'live', type: 'circle', source: 'live', paint: {'circle-radius': 9}},
    slot: 'below-labels',
  });
  await call('moveLayer', {id: 'live', position: {above: 'clusters'}});

  // A payload and a result larger than a control message travel in parts.
  const ids = Array.from({length: 12_000}, (_, index) => index);
  const payload = register(
    Buffer.from(
      JSON.stringify({
        layer: {
          id: 'chosen',
          type: 'circle',
          source: 'points',
          filter: ['match', ['id'], ids, true, false],
        },
      }),
    ),
  );
  await time('addLayer with a 64 KiB+ filter on the data channel', () =>
    deferredCall('addLayer', payload),
  );
  data.delete(payload.id);
  const many = await time('cluster leaves, 5,000 features in parts', () =>
    call('queryCluster', {source: 'points', cluster, query: 'leaves', limit: 5000}),
  );
  assert.equal(many.length, Math.min(5000, largest.properties.point_count), `${name}: leaves`);
  for (const id of ['chosen', 'live', 'heat', 'point', 'clusters'])
    await call('removeLayer', {id}).catch(() => undefined);
  await call('removeSource', {id: 'live'});
  await call('removeSource', {id: 'points'});
}

/**
 * Annotations through the real renderer: positions of tracked points every frame the camera moves,
 * taps that name the annotations under them, and a drag that moves an annotation, not the map.
 */
async function annotationSmoke({name, call, register, data, counts, page, outputs, event}) {
  const center = {longitude: -3.7, latitude: 40.42};
  await call('moveCamera', {
    target: {center, zoom: 14, pitch: 0, bearing: 0},
    animation: {type: 'jump'},
  });
  await call('setEvents', {
    events: {
      tap: {throttleMs: 0},
      annotationDragged: {throttleMs: 0},
      trackedPointsMoved: {throttleMs: 0},
    },
  });
  const pins = register(
    Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {id: 'pin', draggable: true},
            geometry: {type: 'Point', coordinates: [center.longitude, center.latitude]},
          },
        ],
      }),
    ),
  );
  await call('addSource', {id: 'pins', source: {type: 'geojson', data: pins, promoteId: 'id'}});
  data.delete(pins.id);
  await call('addLayer', {
    layer: {id: 'pins', type: 'circle', source: 'pins', paint: {'circle-radius': 14}},
  });
  await call('setAnnotationLayers', {layers: ['pins']});

  // Tracked points: the positions of a set arrive without a camera movement, then every frame.
  const tracked = () => outputs.filter((output) => output.event === 'trackedPointsMoved');
  const far = {longitude: 177, latitude: 0};
  await call('setTrackedPoints', {
    revision: 1,
    points: [
      [center.longitude, center.latitude],
      [far.longitude, far.latitude],
    ],
  });
  const first = await event(
    'tracked points',
    (output) => output.event === 'trackedPointsMoved' && output.result.revision === 1,
  );
  const projected = await call('project', center);
  assert.ok(
    Math.abs(first.result.positions[0] - projected.x) < 0.01 &&
      Math.abs(first.result.positions[1] - projected.y) < 0.01,
    `${name}: tracked position ${first.result.positions} and ${JSON.stringify(projected)}`,
  );
  assert.ok(Math.abs(first.result.time - Date.now()) < 5_000, `${name}: tracked time`);
  const before = tracked().length;
  const frames = page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0;
        const started = performance.now();
        const frame = () => {
          count += 1;
          if (performance.now() - started < 600) globalThis.requestAnimationFrame(frame);
          else resolve(count);
        };
        globalThis.requestAnimationFrame(frame);
      }),
  );
  await call('moveCamera', {
    target: {center: {longitude: -3.69, latitude: 40.42}},
    animation: {type: 'ease', duration: 600},
  });
  const drawn = await frames;
  const reports = tracked().length - before;
  counts['tracked point reports per frame during a 600 ms pan'] = (reports / drawn).toFixed(2);
  assert.ok(reports >= drawn * 0.5, `${name}: ${reports} reports for ${drawn} frames`);
  await call('moveCamera', {target: {center}, animation: {type: 'jump'}});

  // A tap names the annotations under it, topmost first.
  const pin = await call('project', center);
  let tap;
  for (let attempt = 0; attempt < 50 && !tap?.result.annotations; attempt += 1) {
    if (attempt) await new Promise((wait) => setTimeout(wait, 100));
    const count = outputs.length;
    await page.mouse.click(pin.x, pin.y);
    tap = await event(
      'annotation tap',
      (output) => output.event === 'tap' && outputs.indexOf(output) >= count,
    );
  }
  assert.deepEqual(tap.result.annotations, [{layer: 'pins', id: 'pin'}], `${name}: tapped pin`);

  // A pan that starts on the draggable pin moves it; the map stays.
  const camera = await call('getCamera', null);
  await page.mouse.move(pin.x, pin.y);
  await page.mouse.down();
  await page.mouse.move(pin.x + 60, pin.y + 40, {steps: 8});
  await page.mouse.up();
  const dragged = await event(
    'annotation drag end',
    (output) => output.event === 'annotationDragged' && output.result.phase === 'ended',
  );
  const phases = outputs
    .filter((output) => output.event === 'annotationDragged')
    .map((output) => output.result.phase);
  assert.equal(phases[0], 'started', `${name}: drag phases ${phases}`);
  const target = await call('unproject', {x: pin.x + 60, y: pin.y + 40});
  const [longitude, latitude] = dragged.result.geometry.coordinates;
  assert.ok(
    Math.abs(longitude - target.longitude) < 1e-4 && Math.abs(latitude - target.latitude) < 1e-4,
    `${name}: dropped at ${dragged.result.geometry.coordinates}`,
  );
  const after = await call('getCamera', null);
  assert.equal(after.longitude, camera.longitude, `${name}: the map did not pan`);
  const stored = await call('querySourceFeatures', {source: 'pins'});
  assert.deepEqual(
    stored[0]?.geometry.coordinates.map((value) => value.toFixed(5)),
    [longitude.toFixed(5), latitude.toFixed(5)],
  );
  await call('setTrackedPoints', {revision: 2, points: []});
  await call('setAnnotationLayers', {layers: []});
  await call('removeLayer', {id: 'pins'});
  await call('removeSource', {id: 'pins'});
}

/** A host that shares no protocol version with the runtime is told so, never left waiting. */
async function runVersionMismatch(name) {
  const browser = await playwright[name].launch({headless: true});
  try {
    const context = await browser.newContext();
    await context.route(`${origin}/**`, async (route) => {
      const file = new URL(route.request().url()).pathname.slice('/runtime/'.length);
      const body = runtimeFiles.get(file);
      return body
        ? route.fulfill({body, contentType: contentTypes[file]})
        : route.fulfill({status: 404});
    });
    const outputs = [];
    let notify;
    await context.exposeFunction('tileflowSmokeOutput', (message) => {
      outputs.push(JSON.parse(message));
      notify?.();
    });
    const host = {instanceId: randomUUID(), generation: 1, platform: 'android'};
    await context.addInitScript(
      (value) => {
        Object.defineProperty(globalThis, 'tileflowHost', {value});
        Object.defineProperty(globalThis, 'tileflowNative', {
          value: {postMessage: (message) => globalThis.tileflowSmokeOutput(message)},
        });
      },
      {...host, protocol: {minimum: protocol.version + 1, maximum: protocol.version + 1}},
    );
    const page = await context.newPage();
    const next = (count) =>
      new Promise((resolveWait, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name}: version mismatch`)), timeoutMs);
        notify = () => {
          if (outputs.length < count) return;
          clearTimeout(timer);
          resolveWait();
        };
        notify();
      });
    await page.goto(`${origin}/runtime/index.html`);
    await next(1);
    assert.equal(outputs[0].event, 'hello');
    assert.equal(outputs[0].result.protocol.selected, null, `${name}: negotiated a version`);
    const message = {
      protocolVersion: protocol.version + 1,
      ...host,
      requestId: '1',
      command: {method: 'getCamera', payload: null},
    };
    await page.evaluate((value) => globalThis.tileflow.receive(value), JSON.stringify(message));
    await next(2);
    assert.equal(outputs[1].error?.code, 'incompatibleRuntime', `${name}: mismatch answer`);
    assert.equal(outputs[1].error?.context?.reason, 'protocolVersion');
  } finally {
    await browser.close();
  }
}

try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`${fixtureOrigin}/manifest.json`);
      if (response.ok) break;
    } catch (error) {
      if (attempt > 50) throw error;
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  for (const engine of engines) {
    await runEngine(engine);
    await runVersionMismatch(engine);
  }
} finally {
  fixture.kill();
}
