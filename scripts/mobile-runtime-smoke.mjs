import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

// Loads the built embedded runtime in desktop engines with a stub native host. The stub plays the
// Android role: it injects the document-start host identity, receives runtime output, and serves
// every opaque transport address from the fixture map. It proves protocol and renderer startup,
// not pixels; the simulator and emulator suites own presentation.
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

async function runEngine(name) {
  const instanceId = randomUUID();
  const browser = await playwright[name].launch({headless: true});
  const outputs = [];
  const failures = [];
  const waiters = new Set();
  const started = performance.now();
  const timings = {};
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}});
    await context.route(`${origin}/**`, async (route) => {
      const address = new URL(route.request().url());
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
      {instanceId, generation: 1, platform: 'android'},
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
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
    const call = async (method, payload) => {
      const id = String(++requestId);
      const message = JSON.stringify({...envelope, requestId: id, command: {method, payload}});
      await page.evaluate((value) => globalThis.tileflow.receive(value), message);
      const output = await waitFor(method, (candidate) => candidate.requestId === id);
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
    await call('dispose', null);

    const errors = outputs.filter((output) => output.event === 'error' || output.error);
    assert.deepEqual(errors, [rejected], `${name}: unexpected runtime errors`);
    assert.deepEqual(failures, [], `${name}: browser failures`);
    console.log(
      `${name} ${browser.version()}: ${Object.entries(timings)
        .map(([label, ms]) => `${label} ${ms} ms`)
        .join(', ')}`,
    );
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
  for (const engine of engines) await runEngine(engine);
} finally {
  fixture.kill();
}
