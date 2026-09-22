import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {
	assertHostedNativeStyleDocument,
	snapshotHostedNativeManifestIdentity,
} from '../src/hosted-manifest-identity';
import {snapshotMobileConfiguration} from '../src/mobile-configuration';

const apiOrigin = 'https://api.example.test';
const mapId = 'map_abcdefghijklmnop';
const revision = 'a'.repeat(64);
const manifestUrl = `${apiOrigin}/maps/${mapId}/native/manifest.json`;
const styleUrl = `${apiOrigin}/maps/${mapId}/native/v7/light.json`;
const configuration = () => snapshotMobileConfiguration({
	apiOrigin,
	credential: `tf_public_${'b'.repeat(48)}`,
});

type Ready = Extract<TileflowNativeSourceState, {status: 'ready'}>;
function source(): Ready {
	const theme = {colorScheme: 'light' as const, styleUrl, revision};
	const map = {mapId, apiUrl: apiOrigin, usageMode: 'session' as const,
		defaultTheme: 'light', themes: {light: theme}};
	return {
		status: 'ready', generation: 1,
		source: {map: 'streets', manifestUrl}, manifestUrl,
		manifest: {version: 1, maps: {streets: map}},
		map: {name: 'streets', ...map}, theme: {name: 'light', ...theme},
	};
}
function document() {
	return {url: styleUrl, bytes: 256, value: {version: 8, sources: {}, layers: [], metadata: {
		'tileflow:mapId': mapId,
		'tileflow:theme': 'light',
		'tileflow:deploymentVersion': 7,
		'tileflow:nativeStyleSha256': revision,
	}}};
}

test('public Hosted metadata creates a binding only for its exact source and final route', async () => {
	let reads = 0;
	const resolver = createHostedNativeBindingResolver(async () => {
		reads++;
		return configuration();
	});
	try {
		const binding = await resolver.replace(source());
		assert.equal(binding.kind, 'hosted');
		assert.equal(reads, 1);
		assert.equal(JSON.stringify(binding).includes('tf_public_'), false);
		assert.deepEqual(snapshotHostedNativeManifestIdentity(source()), {
			mapId, apiOrigin, deploymentVersion: 7,
		});
		assert.doesNotThrow(() => assertHostedNativeStyleDocument(source(), document()));
	} finally {
		resolver.dispose();
	}
});

test('untrusted source, redirect and Map aliases fail before configuration acquisition', async () => {
	for (const patch of [
		{source: {map: 'streets', manifestUrl: 'https://untrusted.example/manifest.json'}},
		{manifestUrl: 'https://untrusted.example/manifest.json'},
		{manifestUrl: `${apiOrigin}/maps/map_ponmlkjihgfedcba/native/manifest.json`},
		{manifestUrl: `${manifestUrl}?map=${mapId}`},
		{manifestUrl: `${apiOrigin}/maps/${mapId}/manifest.json`},
		{manifestUrl: `${apiOrigin}/maps/${mapId}/native/%6danifest.json`},
		{manifestUrl: `${apiOrigin}:8443/maps/${mapId}/native/manifest.json`},
	]) {
		let reads = 0;
		const resolver = createHostedNativeBindingResolver(async () => {
			reads++;
			return configuration();
		});
		try {
			await assert.rejects(resolver.replace({...source(), ...patch}), {
				code: 'NATIVE_CONFIGURATION_SOURCE_INVALID',
			});
			assert.equal(reads, 0);
		} finally {
			resolver.dispose();
		}
	}
});

test('a manifest cannot choose the credential destination', async () => {
	const foreignOrigin = 'https://other.example';
	const original = source();
	const foreignTheme = {...original.theme,
		styleUrl: `${foreignOrigin}/maps/${mapId}/native/v7/light.json`};
	const foreignMap = {...original.map, apiUrl: foreignOrigin, themes: {light: foreignTheme}};
	const foreignManifestUrl = `${foreignOrigin}/maps/${mapId}/native/manifest.json`;
	const resolver = createHostedNativeBindingResolver(async () => configuration());
	try {
		await assert.rejects(resolver.replace({
			...original, source: {map: 'streets', manifestUrl: foreignManifestUrl},
			manifestUrl: foreignManifestUrl,
			manifest: {version: 1, maps: {streets: foreignMap}}, map: foreignMap, theme: foreignTheme,
		}), {code: 'NATIVE_CONFIGURATION_ORIGIN_MISMATCH'});
	} finally {
		resolver.dispose();
	}
});

test('Hosted manifests require one Map, complete revisions and one deployment version', () => {
	const original = source();
	for (const candidate of [
		{...original, manifest: {version: 1 as const, maps: {...original.manifest.maps, other: original.manifest.maps.streets!}}},
		{...original, theme: {...original.theme, revision: undefined}},
		{...original, theme: {...original.theme, styleUrl: `${apiOrigin}/maps/${mapId}/native/v8/light.json`}},
		{...original, map: {...original.map, mapId: 'map_ponmlkjihgfedcba'}},
	]) {
		assert.throws(() => snapshotHostedNativeManifestIdentity(candidate));
	}
});

test('stale metadata cannot be composed with another protected style or deployment', () => {
	for (const patch of [
		{'tileflow:deploymentVersion': 8},
		{'tileflow:mapId': 'map_ponmlkjihgfedcba'},
		{'tileflow:theme': 'dark'},
		{'tileflow:nativeStyleSha256': 'c'.repeat(64)},
	]) {
		const value = document();
		assert.throws(() => assertHostedNativeStyleDocument(source(), {
			...value, value: {...value.value, metadata: {...value.value.metadata, ...patch}},
		}));
	}
	assert.throws(() => assertHostedNativeStyleDocument(source(), {
		...document(), url: `${apiOrigin}/maps/${mapId}/native/v8/light.json`,
	}));
});

test('non-session metadata does not inspect the Hosted route or configuration', async () => {
	const original = source();
	const direct = {...original, map: {...original.map, usageMode: undefined}};
	const resolver = createHostedNativeBindingResolver(() => {
		throw new Error('Configuration must remain unused.');
	});
	try {
		assert.equal(snapshotHostedNativeManifestIdentity(direct), null);
		assert.deepEqual(await resolver.replace(direct), {kind: 'direct'});
		assert.doesNotThrow(() => assertHostedNativeStyleDocument(direct, document()));
	} finally {
		resolver.dispose();
	}
});
