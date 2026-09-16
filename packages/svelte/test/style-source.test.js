import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';
import {compileTileflowMap} from './component.js';

test('accepts Tileflow map and manifest fields without a renderer selector', () => {
	for (const source of [{map: 'main'}, {manifestUrl: '/custom/manifest.json', map: 'main'}]) {
		for (const theme of [undefined, 'day', 'system']) {
			assert.deepEqual(validateTileflowMapStyleInputs({source, theme}), {ok: true});
		}
	}
});

test('rejects missing, malformed and obsolete renderer sources', () => {
	for (const source of [undefined, {}, {kind: 'tileflow', map: 'main'},
		{kind: 'maplibre', style: '/style.json'}, {map: 'main', style: '/style.json'},
		{map: 'main', kind: undefined}, {map: 'main', manifestUrl: ''}]) {
		assert.equal(validateTileflowMapStyleInputs({source}).ok, false);
	}
});

test('preserves concrete and system theme validation', () => {
	for (const theme of ['', 'Dark', 'dark_mode', 'con']) {
		assert.equal(validateTileflowMapStyleInputs({source: {map: 'main'}, theme}).ok, false, theme);
	}
});

test('component rendering rejects renderer input before mounting', async () => {
	const compiled = await compileTileflowMap('style-source');
	try {
		for (const source of [{kind: 'tileflow', map: 'main'}, {kind: 'maplibre', style: '/style.json'}]) {
			assert.throws(() => render(compiled.component, {props: {source}}).body, /Invalid TileflowMap source/u);
		}
	} finally { await compiled.cleanup(); }
});
