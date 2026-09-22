import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {lowerTileflowNativeCompiledStyles} from '../src/native-artifacts';
import {finalizeNativeHostedProvenance} from '../src/native-hosted-provenance';

function fixture(): MapLibreStyle {
	return {
		version: 8,
		sources: {tileflow: {type: 'vector', url: 'https://tiles.example/tiles/world/tiles.json'}},
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
		],
	};
}

function poiLayers(style: MapLibreStyle) {
	return (style.metadata as {
		'tileflow:interaction-manifest': {domains: {poi: {layers: {
			layerId: string; priority: number; source: string; sourceLayer: string;
		}[]}}};
	})['tileflow:interaction-manifest'].domains.poi.layers;
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
	};
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['below-roads'], candidate.layers[1]!.id);
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['above-roads'], 'poi');
	assert.equal(metadata['tileflow:overlay-placement-manifest'].anchors['above-labels'], null);
	const poi = poiLayers(result)[0]!;
	assert.equal(poi.layerId, 'poi');
	assert.equal(poi.priority, result.layers.findIndex((layer) => layer.id === 'poi'));
	assert.equal(poi.source, 'tileflow');
	assert.deepEqual(original, before);
	assert.deepEqual(poiLayers(candidate), poiLayers(before), 'The lowered input is not mutated.');
});

test('lowering correspondence cannot silently borrow another layer or accept stale provenance', () => {
	const original = fixture();
	const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
	const candidate = lowered.styles.main!.light!;
	const changes = lowered.transformations[0]!.layers;
	assert.throws(() => finalizeNativeHostedProvenance(original, candidate, []));
	assert.throws(() => finalizeNativeHostedProvenance(original, {...candidate, layers: [...candidate.layers].reverse()}, changes));
	const stale = structuredClone(original);
	poiLayers(stale)[0]!.priority = 0;
	assert.throws(() => finalizeNativeHostedProvenance(stale, candidate, changes));
	for (const patch of [{source: 'other'}, {sourceLayer: 'transportation'}]) {
		const foreign = structuredClone(original);
		Object.assign(poiLayers(foreign)[0]!, patch);
		assert.throws(() => finalizeNativeHostedProvenance(foreign, candidate, changes));
	}
});

test('unchanged styles keep their metadata and identities', () => {
	const original = fixture();
	const result = finalizeNativeHostedProvenance(original, structuredClone(original), []);
	assert.deepEqual(result, original);
	assert.notEqual(result, original);
});

test('ordered numeric spans are the only lowering correspondence', () => {
	const original = fixture();
	const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
	const changes = lowered.transformations[0]!.layers;
	const span = changes[0]!;
	assert.equal(span.inputLayer, 1);
	assert.equal(span.outputStart, 1);
	assert.ok(span.outputCount > 1);
	assert.deepEqual(span.properties, ['line-cap']);
	for (const invalid of [
		[{...span, inputLayer: 0}], [{...span, inputLayer: 99}],
		[{...span, outputStart: 0}], [{...span, outputStart: 2}],
		[{...span, outputCount: 0}], [{...span, outputCount: 33}],
		[{...span, outputCount: span.outputCount + 1}],
		[{...span, properties: []}], [span, span],
	]) {
		assert.throws(() => finalizeNativeHostedProvenance(original, lowered.styles.main!.light!, invalid), {
			code: 'NATIVE_UNSUPPORTED_STYLE',
		});
	}
});

test('multiple expanded input spans preserve intervening POI identity and final priority', () => {
	const original = fixture();
	original.layers.push({...original.layers[1]!, id: 'road-after-poi'});
	const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
	const spans = lowered.transformations[0]!.layers;
	assert.equal(spans.length, 2);
	assert.equal(spans[1]!.inputLayer, 3);
	assert.equal(spans[1]!.outputStart, 2 + spans[0]!.outputCount);
	const result = finalizeNativeHostedProvenance(original, lowered.styles.main!.light!, spans);
	assert.equal(poiLayers(result)[0]!.priority, 1 + spans[0]!.outputCount);
	assert.throws(() => finalizeNativeHostedProvenance(original, lowered.styles.main!.light!, [...spans].reverse()));
	const foreign = structuredClone(lowered.styles.main!.light!);
	foreign.layers[spans[0]!.outputStart]!.source = 'other';
	assert.throws(() => finalizeNativeHostedProvenance(original, foreign, spans));
});
