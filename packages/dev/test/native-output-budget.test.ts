import assert from 'node:assert/strict';
import test from 'node:test';
import {serializeCanonicalJson, type MapLibreStyle} from '@tileflow/core';
import {
  TileflowNativeCompatibilityError,
  tileflowNativePreparedStyleLimits,
  tileflowNativeProfileLimits,
  validateTileflowNativePreparedStyle,
  validateTileflowNativeStyle,
} from '@tileflow/core/native-profile';
import {
  assertTileflowNativeGeneratedStyle,
  lowerTileflowNativeCompiledStyles,
  prepareTileflowNativeStyles,
} from '../src/native-artifacts';
import {measureNativeJson} from './native-lowering-audit-fixture';

function style(samples = 0): MapLibreStyle {
  return {
    version: 8, name: 'Bounded native output', projection: {type: 'mercator'},
    sources: {world: {type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf']}},
    layers: [{id: 'road', type: 'line', source: 'world', 'source-layer': 'roads',
      metadata: {samples: new Array(samples).fill(0)},
      layout: {'line-cap': ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']},
    }],
  } as MapLibreStyle;
}
function expectNativeIssue(path: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof TileflowNativeCompatibilityError);
    assert.ok(error.issues.some((issue) => issue.code === 'NATIVE_UNSUPPORTED_STYLE' && issue.path === path));
    assert.doesNotMatch(JSON.stringify(error.issues), /sensitive-value/u);
    return true;
  };
}

test('prepared growth above 160k survives lowering, font preparation and final generation checks', () => {
  const input = style(45_000);
  const before = serializeCanonicalJson(input);
  const result = lowerTileflowNativeCompiledStyles({main: {light: input}});
  const lowered = result.styles.main!.light!;
  assert.ok(measureNativeJson(input).nodes < tileflowNativeProfileLimits.maximumNodes);
  assert.ok(measureNativeJson(lowered).nodes > tileflowNativeProfileLimits.maximumNodes);
  assert.ok(measureNativeJson(lowered).nodes < tileflowNativePreparedStyleLimits.maximumNodes);
  assert.ok(validateTileflowNativeStyle(lowered).length > 0);
  assert.deepEqual(validateTileflowNativePreparedStyle(lowered), []);
  const prepared = prepareTileflowNativeStyles(result.styles, []).main!.light!;
  assert.doesNotThrow(() => assertTileflowNativeGeneratedStyle(prepared, 'main', 'light'));
  assert.equal(serializeCanonicalJson(input), before);
  assert.deepEqual(lowerTileflowNativeCompiledStyles({main: {light: input}}), result);
});

test('the compiler input cannot borrow the output budget even when no lowering is needed', () => {
  const input = style(81_000);
  (input.layers[0] as any).layout = {'line-cap': 'round'};
  assert.ok(measureNativeJson(input).nodes > tileflowNativeProfileLimits.maximumNodes);
  assert.ok(measureNativeJson(input).nodes < tileflowNativePreparedStyleLimits.maximumNodes);
  assert.deepEqual(validateTileflowNativePreparedStyle(input), []);
  assert.throws(() => lowerTileflowNativeCompiledStyles({main: {light: input}}),
    expectNativeIssue('/maps/main/themes/light/style'));
});

test('a bounded input whose six physical copies exceed the output ceiling fails before preparation', () => {
  const input = style(50_000);
  const layer = input.layers[0] as any;
  layer.layout['line-cap'] = ['case', ['==', ['get', 'class'], 'primary'], 'round',
    ['==', ['get', 'class'], 'secondary'], 'square', 'butt'];
  layer.paint = {'line-dasharray': ['case', ['==', ['get', 'surface'], 'paved'], ['literal', [1, 0]], ['literal', [2, 3]]]};
  assert.ok(measureNativeJson(input).nodes < tileflowNativeProfileLimits.maximumNodes);
  const before = serializeCanonicalJson(input);
  assert.throws(() => lowerTileflowNativeCompiledStyles({main: {light: input}}),
    expectNativeIssue('/maps/main/themes/light/style'));
  assert.equal(serializeCanonicalJson(input), before);
});

test('unsupported feature leaves and continuous dash decisions keep exact property pointers', () => {
  for (const [group, property, value] of [
    ['layout', 'line-cap', ['get', 'sensitive-value']],
    ['paint', 'line-dasharray', ['interpolate', ['linear'], ['zoom'], 0, ['literal', [1, 0]], 24, ['literal', [2, 3]]]],
  ] as const) {
    const input = style();
    const layer = input.layers[0] as any;
    layer[group] = {[property]: value};
    const before = serializeCanonicalJson(input);
    assert.throws(() => lowerTileflowNativeCompiledStyles({main: {light: input}}),
      expectNativeIssue(`/maps/main/themes/light/style/layers/0/${group}/${property}`));
    assert.equal(serializeCanonicalJson(input), before);
  }
});

test('decision expansion retains its property budget instead of using the larger style ceiling', () => {
  const input = style();
  (input.layers[0] as any).layout['line-cap'] = ['case',
    ...Array.from({length: 70}, (_, index) => [['==', ['get', `sensitive-value-${index}`], true],
      index % 2 === 0 ? 'round' : 'butt']).flat(), 'square'];
  assert.throws(() => lowerTileflowNativeCompiledStyles({main: {light: input}}),
    expectNativeIssue('/maps/main/themes/light/style/layers/0/layout/line-cap'));
});
