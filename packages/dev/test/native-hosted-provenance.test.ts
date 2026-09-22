import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {lowerTileflowNativeCompiledStyles} from '../src/native-artifacts';
import {finalizeNativeHostedProvenance} from '../src/native-hosted-provenance';

function fixture(): MapLibreStyle {
	return {version: 8, sources: {tileflow: {type: 'vector', url: 'https://tiles.example/tiles/world/tiles.json'}},
		metadata: {
			'tileflow:overlay-placement-manifest': {schemaVersion: 1, anchors: {
				'above-water': 'road', 'below-roads': 'road', 'above-roads': 'poi',
				'above-buildings': 'poi', 'below-labels': 'poi', 'above-labels': null,
			}},
			'tileflow:interaction-manifest': {version: 2, domains: {poi: {layers: [{
				anchor: 'pointer-coordinate', category: 'food', layerId: 'poi', priority: 2,
				representation: 'marker', source: 'tileflow', sourceLayer: 'poi',
			}]}}},
		},
		layers: [
			{id: 'background', type: 'background'},
			{id: 'road', type: 'line', source: 'tileflow', 'source-layer': 'transportation',
				layout: {'line-cap': ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']}},
			{id: 'poi', type: 'circle', source: 'tileflow', 'source-layer': 'poi'},
		]};
}

test('lowered road branches keep overlay boundaries and POI topmost priorities current', () => {
	const original = fixture();
	const before = structuredClone(original);
	const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
	const candidate = lowered.styles.main!.light!;
	assert.ok(candidate.layers.length > original.layers.length);
	const result = finalizeNativeHostedProvenance(original, candidate, lowered.transformations[0]!.layers);
	const metadata = result.metadata as {
		'tileflow:overlay-placement-manifest': {anchors: Record<string, string | null>};
		'tileflow:interaction-manifest': {domains: {poi: {layers: {layerId: string; priority: number; source: string}[]}}};
	};
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['below-roads'], candidate.layers[1]!.id);
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['above-roads'], 'poi');
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['above-labels'], null);
	const poi = metadata['tileflow:interaction-manifest'].domains.poi.layers[0]!;
	assert.equal(poi.layerId, 'poi');
	assert.equal(poi.priority, result.layers.findIndex((layer) => layer.id === 'poi'));
	assert.equal(poi.source, 'tileflow');
	assert.deepEqual(original, before);
});

test('lowering correspondence cannot silently borrow another layer or accept stale provenance', () => {
	const original = fixture();
	const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
	const candidate = lowered.styles.main!.light!;
	const changes = lowered.transformations[0]!.layers;
	assert.throws(() => finalizeNativeHostedProvenance(original, candidate, []));
	assert.throws(() => finalizeNativeHostedProvenance(original, {...candidate, layers: [...candidate.layers].reverse()}, changes));
	const stale = structuredClone(original);
	const metadata = stale.metadata as Record<string, {domains: {poi: {layers: {priority: number}[]}}}>;
	metadata['tileflow:interaction-manifest']!.domains.poi.layers[0]!.priority = 0;
	assert.throws(() => finalizeNativeHostedProvenance(stale, candidate, changes));
});

test('unchanged styles keep their metadata and identities', () => {
	const original = fixture();
	const result = finalizeNativeHostedProvenance(original, structuredClone(original), []);
	assert.deepEqual(result, original);
	assert.notEqual(result, original);
});
