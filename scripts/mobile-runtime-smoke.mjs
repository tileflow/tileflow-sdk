import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

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
    const request = async (method, payload, label = method) => {
      const id = String(++requestId);
      const message = JSON.stringify({...envelope, requestId: id, command: {method, payload}});
      await page.evaluate((value) => globalThis.tileflow.receive(value), message);
      return waitFor(label, (candidate) => candidate.requestId === id);
    };
    const call = async (method, payload, label) => {
      const output = await request(method, payload, label);
      assert.equal(output.error, undefined, `${name}: ${method} failed: ${output.error?.message}`);
      return output.result;
    };
    const event = (label, predicate) =>
      waitFor(label, (output) => output.requestId === undefined && predicate(output));

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
    await call('setCamera', {
      camera: {longitude: -3.69, latitude: 40.42, zoom: 13},
      duration: 800,
    });
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
    await call('setCamera', {camera: {longitude: -3.7, latitude: 40.42, zoom: 14}, duration: 300});
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
    await call('dispose', null);

    const errors = outputs.filter((output) => output.event === 'error' || output.error);
    assert.deepEqual(
      errors.map((output) => output.error?.code ?? output.result.code),
      ['invalidRequest', 'resourceFailed', 'invalidRequest', 'resourceFailed'],
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
