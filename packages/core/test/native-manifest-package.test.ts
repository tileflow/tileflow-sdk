import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('the built native entry acquires, validates and selects without ambient runtime services', async () => {
  const script = `
		import assert from 'node:assert/strict';
		let reads = 0;
		for (const name of ['window', 'document', 'navigator', 'fetch', 'FontFace', 'URL',
			'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'EventTarget', 'XMLHttpRequest']) {
			Object.defineProperty(globalThis, name, {configurable: true, get() {
				reads++; throw new Error('Forbidden global: ' + name);
			}});
		}
		const native = await import('@tileflow/core/native');
		const body = JSON.stringify({version: 1, maps: {main: {defaultTheme: 'light', themes: {
			light: {colorScheme: 'light', styleUrl: './styles/main/light.json'},
		}}}});
		const bytes = Uint8Array.from(body, (character) => character.charCodeAt(0));
		const acquire = () => {
			let offset = 0;
			return {cancel() {}, response: Promise.resolve({
				url: 'https://maps.example.test/native/manifest.json', status: 200,
				reader: {cancel() {}, async read(maximumBytes) {
					if (offset === bytes.length) return {done: true};
					const value = bytes.slice(offset, offset + maximumBytes); offset += value.length;
					return {done: false, value};
				}},
			})};
		};
		const loaded = await native.loadTileflowNativeManifest('https://maps.example.test/manifest.json', {acquire});
		assert.equal(loaded.manifest.maps.main.themes.light.styleUrl, 'https://maps.example.test/native/styles/main/light.json');
		const controller = native.createTileflowNativeSourceController({acquire});
		await controller.replace({kind: 'tileflow', map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'});
		assert.equal(controller.state.status, 'ready');
		assert.equal(controller.state.theme.name, 'light');
		await controller.replace({kind: 'tileflow', map: 'missing', manifestUrl: 'https://maps.example.test/manifest.json'});
		assert.equal(controller.state.error.code, 'NATIVE_MAP_NOT_FOUND');
		controller.dispose(); controller.dispose();
		assert.equal(reads, 0);
	`;
  const {stdout, stderr} = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: packageRoot,
      timeout: 10_000,
    },
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('loader and controller remain exclusive to native and preserve the package export map', async () => {
  for (const name of ['index', 'browser', 'build', 'runtime', 'native-profile']) {
    const output = await readFile(new URL(`../dist/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      output,
      /createTileflowNativeSourceController|NATIVE_MANIFEST_UTF8_INVALID|whatwg-url\/lib\/url-state-machine/u,
    );
  }
  const declarations = await readFile(new URL('../dist/native.d.ts', import.meta.url), 'utf8');
  for (const name of [
    'loadTileflowNativeManifest',
    'createTileflowNativeSourceController',
    'TileflowNativeSourceState',
    'TileflowNativeManifestAcquire',
  ]) {
    assert.ok(declarations.includes(name));
  }
  const output = await readFile(new URL('../dist/native.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    output,
    /\bcreateTileflowSessionController\b|\bgetTileflowStyleFontFaces\b|\bloadTileflowManifest\b/u,
  );
});
