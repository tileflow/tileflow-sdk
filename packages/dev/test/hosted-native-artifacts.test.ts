import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {serializeCanonicalJson} from '@tileflow/core';
import {
	inferTileflowDataRequirements,
	inferTileflowSourceRequirements,
	type TileflowMapBuildManifestV1,
} from '@tileflow/core/build';
import {prepareTileflowHostedNativeDeployment} from '../src/hosted-native-artifacts';

const digest = (value: unknown) => createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
function fixture() {
	const style: MapLibreStyle = {
		version: 8,
		metadata: {'tileflow:map': 'main', 'tileflow:mapVersion': 1, 'tileflow:theme': 'light',
			'tileflow:colorScheme': 'light', 'tileflow:compiler': 'tileflow-semantic', 'tileflow:compilerVersion': 1},
		sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}],
	};
	const buildManifest: TileflowMapBuildManifestV1 = {schemaVersion: 1, maps: {main: {
		assetSetSha256: 'a'.repeat(64), mapRevisionSha256: 'b'.repeat(64),
		defaultTheme: 'light', lineage: [{id: 'main', mapVersion: 1}], mapVersion: 1,
		semanticCompiler: {name: 'tileflow-semantic', version: 1}, sourceAssets: {fonts: [], icons: []},
		themes: {light: {colorScheme: 'light', dataRequirements: inferTileflowDataRequirements(style),
			sourceRequirements: inferTileflowSourceRequirements(style), styleSha256: digest(style),
			themeId: 'light', themeVersion: 1}},
	}}};
	return {mapId: 'main', buildManifest, styles: {light: style}, teamSources: {}, assets: []};
}

test('native preparation preserves its web input and authored identity', async () => {
	const input = fixture();
	const before = serializeCanonicalJson(input);
	const result = await prepareTileflowHostedNativeDeployment(input);
	assert.equal(serializeCanonicalJson(input), before);
	assert.equal(result.schemaVersion, 2);
	assert.deepEqual(result.renderers.web.styles, input.styles);
	assert.equal(result.renderers.native.buildRecord.profile, 'native-v1');
	assert.equal(result.renderers.native.buildRecord.transformations.length, 1);
	assert.equal(result.renderers.native.buildManifest.maps.main!.mapRevisionSha256,
		result.renderers.web.buildManifest.maps.main!.mapRevisionSha256);
});

test('native incompatibility is discovered without an upload port', async () => {
	const input = fixture();
	Object.assign(input.styles.light, {terrain: {source: 'terrain'}});
	await assert.rejects(prepareTileflowHostedNativeDeployment(input));
});

test('native preparation accepts only exact logical Hosted placeholders, not arbitrary protocols', async () => {
	const input = fixture();
	input.styles.light.sources.places = {type: 'vector', url: 'tileflow://hosted-sources/places'};
	input.buildManifest.maps.main!.themes.light!.styleSha256 = digest(input.styles.light);
	Object.assign(input.teamSources, {places: {tileset: 'places', type: 'vector'}});
	const prepared = await prepareTileflowHostedNativeDeployment(input);
	assert.deepEqual(prepared.renderers.native.styles.light!.sources, input.styles.light.sources);
	assert.equal(JSON.stringify(prepared).includes('artifacts.invalid'), false);
	input.styles.light.sources.places = {type: 'vector', url: 'tileflow://hosted-sources/other'};
	await assert.rejects(prepareTileflowHostedNativeDeployment(input));
});

test('the serialized renderer collection contains finalized overlay and semantic provenance', async () => {
	const input = fixture();
	const style = input.styles.light;
	style.sources.tileflow = {type: 'vector', url: 'https://tiles.example/tiles/world/tiles.json'};
	style.layers.push(
		{id: 'road', type: 'line', source: 'tileflow', 'source-layer': 'transportation',
			layout: {'line-cap': ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']}},
		{id: 'poi', type: 'circle', source: 'tileflow', 'source-layer': 'poi'},
	);
	const semantic = {version: 2, domains: {poi: {
		deduplication: {identity: ['source', 'source-layer', 'feature-id'],
			representationPriority: ['marker', 'icon', 'combined', 'label']},
		fields: {category: 'class', filterRank: 'rank', icon: 'icon', name: 'name', sizeRank: 'rank', type: 'subclass'},
		hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
		identity: 'maplibre-feature-id-if-present',
		layers: [{anchor: 'pointer-coordinate', category: 'food', layerId: 'poi', priority: 2,
			representation: 'marker', source: 'tileflow', sourceLayer: 'poi'}],
	}}};
	style.metadata = {...style.metadata, 'tileflow:interaction-manifest': semantic,
		'tileflow:overlay-placement-manifest': {schemaVersion: 1, anchors: {
			'above-water': 'road', 'below-roads': 'road', 'above-roads': 'poi',
			'above-buildings': 'poi', 'below-labels': 'poi', 'above-labels': null,
		}},
	};
	Object.assign(input.buildManifest.maps.main!.themes.light!, {
		styleSha256: digest(style), dataRequirements: inferTileflowDataRequirements(style),
		sourceRequirements: inferTileflowSourceRequirements(style),
	});
	const before = serializeCanonicalJson(input);
	const result = await prepareTileflowHostedNativeDeployment(input);
	const native = result.renderers.native.styles.light!;
	const metadata = native.metadata as Record<string, unknown>;
	const manifest = metadata['tileflow:interaction-manifest'] as typeof semantic;
	const layers = native.layers as {id: string}[];
	assert.equal(manifest.domains.poi.layers[0]!.priority, layers.findIndex(({id}) => id === 'poi'));
	assert.ok(manifest.domains.poi.layers[0]!.priority > 2);
	assert.equal(result.renderers.native.buildManifest.maps.main!.themes.light!.styleSha256, digest(native));
	assert.equal(serializeCanonicalJson(input), before);
});
