import assert from 'node:assert/strict';
import test from 'node:test';
import {assertTileflowMapStyleInputs, validateTileflowMapStyleInputs} from '../src/map-style-inputs';

test('accepts Tileflow map and manifest fields without a renderer selector', () => {
	for (const source of [{map: 'madrid'}, {manifestUrl: '/custom/manifest.json', map: 'madrid'}]) {
		for (const theme of [undefined, 'day', 'system']) {
			assert.deepEqual(validateTileflowMapStyleInputs({source, theme}), {ok: true});
		}
	}
});

test('rejects missing, malformed and obsolete renderer sources for JavaScript callers', () => {
	for (const source of [undefined, {}, {kind: 'tileflow', map: 'madrid'},
		{kind: 'maplibre', style: '/style.json'}, {map: 'madrid', style: '/style.json'},
		{map: 'madrid', kind: undefined}, {map: 'con'}, {map: 'madrid', manifestUrl: ''}]) {
		assert.equal(validateTileflowMapStyleInputs({source}).ok, false);
		assert.throws(() => assertTileflowMapStyleInputs({source}), TypeError);
	}
});

test('preserves concrete and system theme validation', () => {
	for (const theme of ['', 'Dark', 'dark_mode', 'con']) {
		assert.equal(validateTileflowMapStyleInputs({source: {map: 'madrid'}, theme}).ok, false, theme);
	}
});
