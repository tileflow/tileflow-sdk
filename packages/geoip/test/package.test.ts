import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {runInNewContext} from 'node:vm';
import * as source from '../src/index';

const execFileAsync = promisify(execFile);

test('publishes root, contract, client and package metadata entries', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(Object.keys(manifest.exports), [
    '.',
    './contract',
    './client',
    './package.json',
  ]);
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.version, '0.0.0-development');
  assert.equal(manifest.publishConfig.access, 'public');
});

test('preserves the exact source and built root surface', async () => {
  const built = await import('../dist/index.js');
  assert.deepEqual(Object.keys(built).sort(), Object.keys(source).sort());
  assert.equal(typeof built.geolocate, 'function');
  assert.equal(typeof built.geoIpResponseSchema, 'object');
  assert.equal(typeof built.GeoIpError, 'function');
});

test('imports every built entry without browser APIs', async () => {
  const script = `
    for (const name of ['window', 'document', 'geolocation']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser API read during import: ' + name); },
      });
    }
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: Object.defineProperty({}, 'geolocation', {
        get() { throw new Error('GPS read during import'); },
      }),
    });
    for (const entry of ['@tileflow/geoip', '@tileflow/geoip/contract', '@tileflow/geoip/client']) {
      await import(entry);
    }
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('built anonymous access reads NODE_ENV at runtime and warns only in development', async () => {
  const script = `
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    globalThis.fetch = async () => Response.json({
      location: {countryCode: 'PT'},
      schemaVersion: 1,
      status: 'available',
      usage: {units: 0},
    });
    const {geolocate} = await import('@tileflow/geoip/client');
    await geolocate();
    await geolocate();
    console.log(warnings.join('\\n'));
  `;
  const run = async (nodeEnv: string) =>
    execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: new URL('..', import.meta.url),
      env: {...process.env, NODE_ENV: nodeEnv},
    });

  const development = await run('development');
  const production = await run('production');
  assert.equal(
    development.stdout.trim(),
    'Tileflow GeoIP is using anonymous best-effort access. Anonymous access has shared limits and no availability guarantee. For managed production, use geolocate({ mapId }).',
  );
  assert.equal(development.stderr, '');
  assert.equal(production.stdout.trim(), '');
  assert.equal(production.stderr, '');
});

test('built anonymous access runs without a Node process global', async () => {
  const script = `
    globalThis.process = undefined;
    globalThis.fetch = async () => Response.json({
      location: {countryCode: 'PT'},
      schemaVersion: 1,
      status: 'available',
      usage: {units: 0},
    });
    const {geolocate} = await import('@tileflow/geoip/client');
    await geolocate();
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('browser bundles preserve explicit development, production and absent NODE_ENV signals', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'tileflow-geoip-browser-'));
  const tsup = new URL('../../../node_modules/.bin/tsup', import.meta.url);
  try {
    for (const [name, define, expectedWarnings] of [
      ['development', '"development"', 1],
      ['production', '"production"', 0],
      ['absent', 'undefined', 0],
    ] as const) {
      const outputDirectory = join(outputRoot, name);
      const args = [
        tsup.pathname,
        'src/client.ts',
        '--format',
        'iife',
        '--global-name',
        'GeoIpClient',
        '--no-splitting',
        '--out-dir',
        outputDirectory,
        '--platform',
        'browser',
        '--silent',
      ];
      if (define) args.push(`--define.process.env.NODE_ENV=${define}`);
      await execFileAsync(tsup.pathname, args.slice(1), {cwd: new URL('..', import.meta.url)});

      const bundle = join(
        outputDirectory,
        (await readdir(outputDirectory)).find((fileName) => fileName.endsWith('.js'))!,
      );
      const warnings: string[] = [];
      const sandbox = {
        AbortSignal,
        ReadableStream,
        Response,
        TextDecoder,
        TextEncoder,
        URL,
        console: {warn: (message: string) => warnings.push(message)},
      };
      runInNewContext(await readFile(bundle, 'utf8'), sandbox);
      const client = (sandbox as {GeoIpClient: {geolocate(options: unknown): Promise<unknown>}})
        .GeoIpClient;
      await client.geolocate({
        fetch: async () =>
          Response.json({
            location: {countryCode: 'PT'},
            schemaVersion: 1,
            status: 'available',
            usage: {units: 0},
          }),
      });
      assert.equal(warnings.length, expectedWarnings, name);
    }
  } finally {
    await rm(outputRoot, {force: true, recursive: true});
  }
});
