import assert from 'node:assert/strict';
import test from 'node:test';
import {safeParseTileflowRuntimeManifest} from '../src/manifest';
import {parseTileflowRuntimeManifest} from '../src/native-manifest-schema';
import {manifest} from './native-manifest-fixture';

function compare(value: unknown): void {
	const host = safeParseTileflowRuntimeManifest(value);
	if (host.success) assert.deepEqual(parseTileflowRuntimeManifest(value), host.data);
	else assert.throws(() => parseTileflowRuntimeManifest(value));
}

test('native uses the canonical manifest grammar and preserves delivery/view/theme constraints', () => {
	compare(manifest());
	for (const change of [{version: 2}, {maps: {}}, {extra: true}, {apiUrl: 'https://api.example.test/path'}]) compare({...manifest(), ...change});
	for (const name of ['light', 'dark', 'system', 'constructor', 'CON', 't'.repeat(64), 't'.repeat(65)]) {
		compare({version: 1, maps: {main: {defaultTheme: name, themes: {[name]: {colorScheme: 'light', styleUrl: './style.json'}}}}});
	}
	for (const styleUrl of ['./style.json', '../style.json', '/style.json', 'style.json', '//foreign.test/s',
		'https://bücher.example.test/style.json', 'https://host.test/%2Fsecret', 'https://user:secret@host.test/s', 'file:///s', 'https://host.test/s#fragment']) {
		const value = manifest(); value.maps.streets.themes.light.styleUrl = styleUrl; compare(value);
	}
	for (const pitch of [-1, 0, 85, 86]) { const value = manifest(); value.maps.streets.view.pitch = pitch; compare(value); }
	for (const change of [{usageMode: 'session'}, {worldGeneration: 'v1'}, {usageMode: 'session', worldGeneration: 'v1'}]) {
		const value = manifest(); Object.assign(value.maps.streets, change); compare(value);
	}
});

test('native retains duplicate font and unknown-field rejection at every nested schema level', () => {
	for (const target of ['view', 'theme', 'font', 'systemThemes']) {
		const value = manifest();
		Object.assign(value.maps.streets.themes.light, {fontFaces: [{family: 'Fixture', source: './font.ttf'}]});
		const entry = value.maps.streets as any;
		Object.assign(target === 'view' ? entry.view : target === 'systemThemes' ? entry.systemThemes : target === 'font'
			? entry.themes.light.fontFaces[0] : entry.themes.light, {extra: true});
		compare(value);
	}
	const value = manifest();
	Object.assign(value.maps.streets.themes.light, {fontFaces: [
		{family: 'Fixture', source: './a.ttf'}, {family: 'Fixture', source: './b.ttf', style: 'normal', weight: '400'},
	]});
	compare(value);
});
