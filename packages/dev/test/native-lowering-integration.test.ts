import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {convertFilter, createExpression, featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {serializeCanonicalJson, type MapLibreStyle} from '@tileflow/core';
import {
  TileflowNativeCompatibilityError,
  tileflowNativeBuildRecordSchema,
  tileflowNativeProfileLimits,
  validateTileflowNativeStyle,
} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts, disposeTileflowBuildArtifacts} from '../src/artifacts';
import {lowerTileflowNativeCompiledStyles} from '../src/native-artifacts';
import {lowerNativeStyleRepresentation, nativeLoweringVersion} from '../src/native-lowering';

const propertyCase = ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt'];
function inputStyle(): MapLibreStyle {
  return {
    version: 8, name: 'Finite decision fixture', projection: {type: 'globe'},
    sources: {world: {type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf']}},
    layers: [{id: 'road', type: 'line', source: 'world', 'source-layer': 'transportation',
      minzoom: 4.25, maxzoom: 22.5,
      filter: ['!=', 'access', 'private'],
      layout: {'line-cap': ['step', ['zoom'], 'butt', 9, propertyCase, 17, 'square']},
      paint: {'line-dasharray': ['case', ['==', ['get', 'class'], 'primary'], ['literal', [2, 3]], ['literal', [1, 0]]]},
    }],
  } as MapLibreStyle;
}
function sha(value: unknown): string {
  return createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
}
function footprint(value: unknown): {nodes: number; depth: number; bytes: number} {
  let nodes = 0;
  let depth = 0;
  const visit = (item: unknown, level: number) => {
    nodes++; depth = Math.max(depth, level);
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      visit(key, level + 1); visit(child, level + 1);
    }
  };
  visit(value, 0);
  return {nodes, depth, bytes: Buffer.byteLength(JSON.stringify(value))};
}

test('matches the pinned expression and filter evaluators at range and camera boundaries', () => {
  const original = inputStyle();
  const source = original.layers[0]! as any;
  const before = serializeCanonicalJson(original);
  const lowered = lowerTileflowNativeCompiledStyles({fixture: {light: original}});
  const result = lowered.styles.fixture!.light!;
  assert.deepEqual(validateTileflowNativeStyle(result), []);
  const expressions = ['line-cap', 'line-dasharray'].map((property) => {
    const parsed = createExpression(source[property === 'line-cap' ? 'layout' : 'paint'][property]);
    assert.equal(parsed.result, 'success');
    if (parsed.result !== 'success') throw new Error('Expected a valid fixture expression.');
    return parsed.value;
  });
  const originalFilter = featureFilter(source.filter);
  const physical = result.layers.map((layer: any) => ({layer, filter: featureFilter(layer.filter)}));
  for (const properties of [{}, {class: 'primary'}, {class: 1}, {class: null},
    {class: 'primary', access: 'private'}, {class: 'minor', access: 'public'}]) {
    const feature = {type: 2 as const, properties};
    for (const zoom of [0, 4.2499, 4.25, 8.9999, 9, 9.5, 16.9999, 17, 21.99, 22.5, 24]) {
      const globals = {zoom: Math.floor(zoom)};
      const selected = physical.filter(({layer, filter}) => zoom >= (layer.minzoom ?? 0) &&
        zoom < (layer.maxzoom ?? 24) && filter.filter(globals, feature));
      const expected = zoom >= source.minzoom && zoom < source.maxzoom && originalFilter.filter(globals, feature);
      assert.equal(selected.length, Number(expected), JSON.stringify({properties, zoom}));
      if (selected.length) {
        assert.deepEqual(selected[0]!.layer.layout['line-cap'], expressions[0]!.evaluate(globals, feature));
        assert.deepEqual(selected[0]!.layer.paint['line-dasharray'], expressions[1]!.evaluate(globals, feature));
      }
    }
  }
  assert.equal(serializeCanonicalJson(original), before);
});

test('does not defer unsafe source, terrain or unknown projection semantics to lowering', () => {
  for (const [change, path] of [
    [{sources: {world: {type: 'vector', url: 'pmtiles://https://example.test/file.pmtiles'}}}, '/sources/world/url'],
    [{terrain: {source: 'world'}}, '/terrain'],
    [{projection: {type: ['step', ['zoom'], 'globe', 10, 'mercator']}}, '/projection'],
  ] as const) {
    assert.throws(() => lowerTileflowNativeCompiledStyles({fixture: {light: {...inputStyle(), ...change} as MapLibreStyle}}),
      (error: unknown) => error instanceof TileflowNativeCompatibilityError &&
        error.issues.some((issue) => issue.path === `/maps/fixture/themes/light/style${path}`));
  }
});

test('bounds expanded serialized nodes and bytes, without changing the input or raising profile limits', () => {
  for (const metadata of [{samples: new Array(45_000).fill(0)}, {text: 'a'.repeat(4_194_304)}]) {
    const input = inputStyle();
    const layer = input.layers[0]! as any;
    layer.layout = {'line-cap': propertyCase};
    layer.paint = {};
    layer.metadata = metadata;
    const before = sha(input);
    const measured = footprint(input);
    assert.ok(measured.nodes < tileflowNativeProfileLimits.maximumNodes);
    assert.ok(measured.bytes < tileflowNativeProfileLimits.maximumStyleBytes);
    assert.throws(() => lowerTileflowNativeCompiledStyles({fixture: {light: input}}),
      (error: unknown) => error instanceof TileflowNativeCompatibilityError &&
        error.issues.some(({code, path}) => code === 'NATIVE_UNSUPPORTED_STYLE' && path === '/maps/fixture/themes/light/style'));
    assert.equal(sha(input), before);
  }
});

test('Streets themes retain structural semantics, identity and audited native transformation spans', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-streets-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(join(cwd, 'tileflow.config.ts'), `import {streets} from '@tileflow/maps';\nexport default streets;\n`);
  const web = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  t.after(() => disposeTileflowBuildArtifacts(web));
  // Measure the real compiled family before enforcing the unchanged output JSON budgets.
  for (const [theme, input] of Object.entries(web.styles.streets!)) {
    const lowered = lowerNativeStyleRepresentation(input, (filter) => convertFilter(structuredClone(filter) as any));
    const measured = {theme, before: footprint(input), after: footprint(lowered.style)};
    assert.ok(measured.after.nodes <= tileflowNativeProfileLimits.maximumNodes, JSON.stringify(measured));
    assert.ok(measured.after.bytes <= tileflowNativeProfileLimits.maximumStyleBytes, JSON.stringify(measured));
  }
  const native = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.', renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(native));
  const record = tileflowNativeBuildRecordSchema.parse(native.nativeBuild);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.preparationVersion, nativeLoweringVersion);
  assert.deepEqual(record.transformations.map(({theme}) => theme), ['dark', 'light']);
  assert.equal(native.buildManifest.maps.streets!.mapRevisionSha256, web.buildManifest.maps.streets!.mapRevisionSha256);
  assert.equal(Object.hasOwn(native.manifest, 'transformations'), false);
  for (const item of record.transformations) {
    assert.equal(item.projection, 'globe-to-mercator');
    assert.ok(item.layers.length > 0);
    const original = web.styles.streets![item.theme]!;
    const output = native.styles.streets![item.theme]!;
    assert.notEqual(native.buildManifest.maps.streets!.themes[item.theme]!.styleSha256,
      web.buildManifest.maps.streets!.themes[item.theme]!.styleSha256);
    assert.equal('projection' in output, false);
    assert.deepEqual(validateTileflowNativeStyle(output, {documentUrl: 'https://artifacts.invalid/style.json'}), []);
    const independentlyLowered = lowerNativeStyleRepresentation(original, (filter) => convertFilter(structuredClone(filter) as any));
    // Font/sprite URL preparation is renderer-owned; structural layer data is unchanged except for lowering.
    assert.deepEqual(output.layers, independentlyLowered.style.layers);
    assert.equal(item.inputLayers, original.layers.length);
    assert.equal(item.outputLayers, output.layers.length);
    assert.deepEqual(item.layers, independentlyLowered.layers);
    for (const span of item.layers) {
      const logical = original.layers[span.inputLayer]! as any;
      for (const physical of output.layers.slice(span.outputStart, span.outputStart + span.outputCount) as any[]) {
        const {id: _id, filter: _filter, minzoom: _min, maxzoom: _max, layout, paint, ...other} = logical;
        const {id: _nextId, filter: _nextFilter, minzoom: _nextMin, maxzoom: _nextMax, layout: nextLayout, paint: nextPaint, ...nextOther} = physical;
        assert.deepEqual(nextOther, other);
        for (const [group, next, property] of [[layout, nextLayout, 'line-cap'], [paint, nextPaint, 'line-dasharray']] as const) {
          const expected = {...group}; const actual = {...next};
          delete expected[property]; delete actual[property];
          assert.deepEqual(actual, expected);
        }
        if (physical.layout?.['line-cap'] !== undefined) assert.equal(typeof physical.layout['line-cap'], 'string');
        if (physical.paint?.['line-dasharray'] !== undefined) assert.ok(physical.paint['line-dasharray'].every((value: unknown) => typeof value === 'number'));
      }
    }
  }
});
