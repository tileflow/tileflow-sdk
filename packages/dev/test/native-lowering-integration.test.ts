import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {convertFilter, createExpression, featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {serializeCanonicalJson, type MapLibreStyle} from '@tileflow/core';
import {
  TileflowNativeCompatibilityError,
  tileflowNativeBuildRecordSchema,
  tileflowNativeProfileLimits,
  tileflowNativePreparedStyleLimits,
  validateTileflowNativePreparedStyle,
} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts, disposeTileflowBuildArtifacts} from '../src/artifacts';
import {lowerTileflowNativeCompiledStyles} from '../src/native-artifacts';
import {lowerNativeStyleRepresentation, nativeLoweringVersion} from '../src/native-lowering';
import {auditNativeLowering, measureNativeJson as footprint} from './native-lowering-audit-fixture';

const propertyCase = ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt'];
function inputStyle(): MapLibreStyle {
  return {
    version: 8,
    name: 'Finite decision fixture',
    projection: {type: 'globe'},
    sources: {world: {type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf']}},
    layers: [
      {
        id: 'road',
        type: 'line',
        source: 'world',
        'source-layer': 'transportation',
        minzoom: 4.25,
        maxzoom: 22.5,
        filter: ['!=', 'access', 'private'],
        layout: {'line-cap': ['step', ['zoom'], 'butt', 9, propertyCase, 17, 'square']},
        paint: {
          'line-dasharray': [
            'case',
            ['==', ['get', 'class'], 'primary'],
            ['literal', [2, 3]],
            ['literal', [1, 0]],
          ],
        },
      },
    ],
  } as MapLibreStyle;
}
function sha(value: unknown): string {
  return createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
}

test('matches the pinned expression and filter evaluators at range and camera boundaries', () => {
  const original = inputStyle();
  const source = original.layers[0]! as any;
  const before = serializeCanonicalJson(original);
  const lowered = lowerTileflowNativeCompiledStyles({fixture: {light: original}});
  const result = lowered.styles.fixture!.light!;
  assert.deepEqual(validateTileflowNativePreparedStyle(result), []);
  const expressions = ['line-cap', 'line-dasharray'].map((property) => {
    const parsed = createExpression(source[property === 'line-cap' ? 'layout' : 'paint'][property]);
    assert.equal(parsed.result, 'success');
    if (parsed.result !== 'success') throw new Error('Expected a valid fixture expression.');
    return parsed.value;
  });
  const originalFilter = featureFilter(source.filter);
  const physical = result.layers.map((layer: any) => ({
    layer,
    filter: featureFilter(layer.filter),
  }));
  for (const properties of [
    {},
    {class: 'primary'},
    {class: 1},
    {class: null},
    {class: 'primary', access: 'private'},
    {class: 'minor', access: 'public'},
  ]) {
    const feature = {type: 2 as const, properties};
    for (const zoom of [0, 4.2499, 4.25, 8.9999, 9, 9.5, 16.9999, 17, 21.99, 22.5, 24]) {
      const globals = {zoom: Math.floor(zoom)};
      const selected = physical.filter(
        ({layer, filter}) =>
          zoom >= (layer.minzoom ?? 0) &&
          zoom < (layer.maxzoom ?? 24) &&
          filter.filter(globals, feature),
      );
      const expected =
        zoom >= source.minzoom && zoom < source.maxzoom && originalFilter.filter(globals, feature);
      assert.equal(selected.length, Number(expected), JSON.stringify({properties, zoom}));
      if (selected.length) {
        assert.deepEqual(
          selected[0]!.layer.layout['line-cap'],
          expressions[0]!.evaluate(globals, feature),
        );
        assert.deepEqual(
          selected[0]!.layer.paint['line-dasharray'],
          expressions[1]!.evaluate(globals, feature),
        );
      }
    }
  }
  assert.equal(serializeCanonicalJson(original), before);
});

test('does not defer unsafe source, terrain or unknown projection semantics to lowering', () => {
  for (const [change, path] of [
    [
      {sources: {world: {type: 'vector', url: 'pmtiles://https://example.test/file.pmtiles'}}},
      '/sources/world/url',
    ],
    [{terrain: {source: 'world'}}, '/terrain'],
    [{projection: {type: ['step', ['zoom'], 'globe', 10, 'mercator']}}, '/projection'],
  ] as const) {
    assert.throws(
      () =>
        lowerTileflowNativeCompiledStyles({
          fixture: {light: {...inputStyle(), ...change} as MapLibreStyle},
        }),
      (error: unknown) =>
        error instanceof TileflowNativeCompatibilityError &&
        error.issues.some((issue) => issue.path === `/maps/fixture/themes/light/style${path}`),
    );
  }
});

test('bounds expanded serialized bytes without changing the input or byte limit', () => {
  for (const metadata of [{text: 'a'.repeat(4_194_304)}]) {
    const input = inputStyle();
    const layer = input.layers[0]! as any;
    layer.layout = {'line-cap': propertyCase};
    layer.paint = {};
    layer.metadata = metadata;
    const before = sha(input);
    const measured = footprint(input);
    assert.ok(measured.nodes < tileflowNativeProfileLimits.maximumNodes);
    assert.ok(measured.bytes < tileflowNativeProfileLimits.maximumStyleBytes);
    assert.throws(
      () => lowerTileflowNativeCompiledStyles({fixture: {light: input}}),
      (error: unknown) =>
        error instanceof TileflowNativeCompatibilityError &&
        error.issues.some(
          ({code, path}) =>
            code === 'NATIVE_UNSUPPORTED_STYLE' && path === '/maps/fixture/themes/light/style',
        ),
    );
    assert.equal(sha(input), before);
  }
});

test('Streets themes retain identity and audited native transformation spans', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-streets-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await copyFile(
    new URL('./fixtures/native-streets.config.ts', import.meta.url),
    join(cwd, 'tileflow.config.ts'),
  );
  const web = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  t.after(() => disposeTileflowBuildArtifacts(web));
  // Collect both themes before any assertion, so a failing dark budget cannot hide light evidence.
  const measured = Object.entries(web.styles.streets!)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([theme, input]) => {
      const lowered = lowerNativeStyleRepresentation(input, (filter) =>
        convertFilter(structuredClone(filter) as any),
      );
      const audit = auditNativeLowering(input, lowered);
      return {theme, before: audit.before, after: audit.after, duplication: audit.duplication};
    });
  assert.deepEqual(
    measured.map(({theme}) => theme),
    ['dark', 'light'],
  );
  t.diagnostic(JSON.stringify({scope: 'Streets lowering measurements', themes: measured}));
  for (const item of measured) {
    assert.ok(
      item.before.nodes <= tileflowNativeProfileLimits.maximumNodes,
      JSON.stringify(measured),
    );
    assert.ok(
      item.after.nodes > tileflowNativeProfileLimits.maximumNodes,
      JSON.stringify(measured),
    );
    assert.ok(
      item.after.nodes <= tileflowNativePreparedStyleLimits.maximumNodes,
      JSON.stringify(measured),
    );
    assert.ok(
      item.after.bytes <= tileflowNativeProfileLimits.maximumStyleBytes,
      JSON.stringify(measured),
    );
    assert.ok(
      item.after.depth <= tileflowNativeProfileLimits.maximumDepth,
      JSON.stringify(measured),
    );
    assert.ok(
      item.after.layers <= tileflowNativeProfileLimits.maximumLayers,
      JSON.stringify(measured),
    );
  }
  const native = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.', renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(native));
  const record = tileflowNativeBuildRecordSchema.parse(native.nativeBuild);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.preparationVersion, nativeLoweringVersion);
  assert.deepEqual(
    record.transformations.map(({theme}) => theme),
    ['dark', 'light'],
  );
  assert.equal(
    native.buildManifest.maps.streets!.mapRevisionSha256,
    web.buildManifest.maps.streets!.mapRevisionSha256,
  );
  assert.equal(Object.hasOwn(native.manifest, 'transformations'), false);
  for (const item of record.transformations) {
    assert.equal(item.projection, 'globe-to-mercator');
    assert.ok(item.layers.length > 0);
    const original = web.styles.streets![item.theme]!;
    const output = native.styles.streets![item.theme]!;
    assert.notEqual(
      native.buildManifest.maps.streets!.themes[item.theme]!.styleSha256,
      web.buildManifest.maps.streets!.themes[item.theme]!.styleSha256,
    );
    assert.equal('projection' in output, false);
    assert.deepEqual(
      validateTileflowNativePreparedStyle(output, {
        documentUrl: 'https://artifacts.invalid/style.json',
      }),
      [],
    );
    const independentlyLowered = lowerNativeStyleRepresentation(original, (filter) =>
      convertFilter(structuredClone(filter) as any),
    );
    // Font/sprite URL preparation is renderer-owned; structural layer data is unchanged except for lowering.
    assert.deepEqual(output.layers, independentlyLowered.style.layers);
    assert.equal(item.inputLayers, original.layers.length);
    assert.equal(item.outputLayers, output.layers.length);
    assert.deepEqual(item.layers, independentlyLowered.layers);
    for (const span of item.layers) {
      const logical = original.layers[span.inputLayer]! as any;
      for (const physical of output.layers.slice(
        span.outputStart,
        span.outputStart + span.outputCount,
      ) as any[]) {
        const {
          id: _id,
          filter: _filter,
          minzoom: _min,
          maxzoom: _max,
          layout,
          paint,
          ...other
        } = logical;
        const {
          id: _nextId,
          filter: _nextFilter,
          minzoom: _nextMin,
          maxzoom: _nextMax,
          layout: nextLayout,
          paint: nextPaint,
          ...nextOther
        } = physical;
        assert.deepEqual(nextOther, other);
        for (const [group, next, property] of [
          [layout, nextLayout, 'line-cap'],
          [paint, nextPaint, 'line-dasharray'],
        ] as const) {
          const expected = {...group};
          const actual = {...next};
          delete expected[property];
          delete actual[property];
          assert.deepEqual(actual, expected);
        }
        if (physical.layout?.['line-cap'] !== undefined)
          assert.equal(typeof physical.layout['line-cap'], 'string');
        if (physical.paint?.['line-dasharray'] !== undefined)
          assert.ok(
            physical.paint['line-dasharray'].every((value: unknown) => typeof value === 'number'),
          );
      }
    }
  }
});

test('compact grouped predicates agree with the pinned evaluator for every overlapping flag combination', () => {
  const input = inputStyle();
  const layer = input.layers[0]! as any;
  const cap = [
    'case',
    ...Array.from({length: 12}, (_, index) => [
      ['==', ['get', `flag${index}`], true],
      index % 2 === 0 ? 'round' : 'butt',
    ]).flat(),
    'square',
  ];
  layer.layout = {'line-cap': cap};
  layer.paint = {'line-dasharray': [1, 0]};
  const lowered = lowerTileflowNativeCompiledStyles({fixture: {light: input}}).styles.fixture!
    .light!;
  const parsed = createExpression(cap);
  assert.equal(parsed.result, 'success');
  if (parsed.result !== 'success') throw new Error('Expected a valid finite expression.');
  const filters = lowered.layers.map((physical: any) => ({
    physical,
    filter: featureFilter(physical.filter),
  }));
  for (let mask = 0; mask < 4096; mask++) {
    const properties = Object.fromEntries(
      Array.from({length: 12}, (_, index) => [`flag${index}`, Boolean(mask & (1 << index))]),
    );
    const feature = {type: 2 as const, properties};
    const globals = {zoom: 12};
    const selected = filters.filter(({filter}) => filter.filter(globals, feature));
    assert.equal(selected.length, 1, String(mask));
    assert.equal(selected[0]!.physical.layout['line-cap'], parsed.value.evaluate(globals, feature));
  }
});

test('runs the complete two-theme lowering audit through the workspace tsx loader', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const {stdout} = await promisify(execFile)(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), 'scripts/native-lowering-audit.ts'],
    {cwd: root, timeout: 120_000, maxBuffer: 8 * 1024 * 1024},
  );
  const report = JSON.parse(stdout);
  assert.equal(report.scope, 'static-lowering-size-and-order-audit');
  assert.equal(report.nativeVisualQualification, 'pending');
  assert.equal(report.limits.maximumNodes, 160_000);
  assert.equal(report.preparedLimits.maximumNodes, 540_000);
  assert.deepEqual(
    report.themes.map((row: {theme: string}) => row.theme),
    ['dark', 'light'],
  );
  for (const row of report.themes) {
    assert.equal(row.withinInputBudget, true);
    assert.equal(row.withinOutputBudget, true);
    assert.ok(row.before.nodes > 0 && row.after.nodes > 0);
    assert.ok(row.before.bytes > 0 && row.after.bytes > 0);
    assert.ok(row.layers.length > 0);
    assert.ok(row.layers.every((layer: any) => layer.branches.length === layer.outputCount));
  }
});
