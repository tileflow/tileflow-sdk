import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  camel,
  operatorName,
  outputs,
  prose,
  readSpecification,
  renderStyle,
  valueType,
} from '../../../scripts/mobile-style.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtime = createRequire(resolve(root, 'packages/mobile-runtime/package.json'));
const maplibre = createRequire(runtime.resolve('maplibre-gl/package.json'));
const manifest = maplibre.resolve('@maplibre/maplibre-gl-style-spec/package.json');
const {version} = JSON.parse(await readFile(manifest, 'utf8'));
const spec = JSON.parse(await readFile(resolve(dirname(manifest), 'dist/latest.json'), 'utf8'));
const rendered = renderStyle(spec, version);

test('the generated style types are current with the renderer specification', async () => {
  for (const [path, content] of Object.entries(rendered))
    assert.equal(await readFile(resolve(root, path), 'utf8'), content, `Regenerate ${path}.`);
});

test('every layer type and property of the specification has a typed member', () => {
  const model = readSpecification(spec);
  const types = Object.keys(spec.layer.type.values);
  assert.deepEqual(
    model.layers.map((layer) => layer.type),
    types,
  );
  const swift = rendered[outputs.swiftLayers];
  const kotlin = rendered[outputs.kotlinLayers];
  for (const type of types) {
    const properties = [
      ...Object.keys(spec[`layout_${type}`] ?? {}),
      ...Object.keys(spec[`paint_${type}`] ?? {}),
    ];
    assert.ok(properties.length > 0, type);
    for (const property of properties) {
      // Each property encodes under its MapLibre name and reads under one identifier on both
      // platforms.
      assert.ok(swift.includes(`(${JSON.stringify(property)}, ${camel(property)})`), property);
      assert.ok(kotlin.includes(`${JSON.stringify(property)} to ${camel(property)},`), property);
    }
  }
  for (const entry of model.enums) {
    assert.ok(swift.includes(`public enum ${entry.name}: String`), entry.name);
    assert.ok(kotlin.includes(`public enum class ${entry.name}(`), entry.name);
  }
});

test('every expression operator has a factory with the same name on both platforms', () => {
  const model = readSpecification(spec);
  const swift = rendered[outputs.swiftExpressions];
  const kotlin = rendered[outputs.kotlinExpressions];
  const names = Object.keys(spec.expression_name.values).filter((name) => name !== 'literal');
  assert.equal(model.operators.length, names.length);
  for (const name of names) {
    const identifier = operatorName(name);
    assert.match(identifier, /^[a-z][A-Za-z0-9]*$/u, name);
    assert.ok(
      swift.includes(`public static func ${identifier}(_ arguments: TileflowExpression...)`),
      name,
    );
    assert.ok(
      kotlin.includes(`public fun ${identifier}(vararg arguments: TileflowExpression)`),
      name,
    );
    assert.ok(swift.includes(`TileflowExpression(operator: ${JSON.stringify(name)}, arguments)`));
  }
  // Keywords of either language take the names the Mapbox SDKs use.
  for (const [name, expected] of [
    ['in', 'inExpression'],
    ['case', 'switchCase'],
    ['object', 'objectExpression'],
    ['typeof', 'typeofExpression'],
    ['==', 'eq'],
    ['+', 'sum'],
    ['to-string', 'toString'],
    ['feature-state', 'featureState'],
  ])
    assert.equal(operatorName(name), expected);
});

test('property types map to platform types', () => {
  assert.deepEqual(valueType('circle-radius', {type: 'number'}), {
    swift: 'Double',
    kotlin: 'Double',
  });
  assert.deepEqual(valueType('line-cap', {type: 'enum', values: {}}), {
    swift: 'TileflowLineCap',
    kotlin: 'TileflowLineCap',
  });
  assert.deepEqual(valueType('text-font', {type: 'array', value: 'string'}), {
    swift: '[String]',
    kotlin: 'List<String>',
  });
  assert.deepEqual(valueType('text-writing-mode', {type: 'array', value: 'enum'}), {
    swift: '[TileflowTextWritingMode]',
    kotlin: 'List<TileflowTextWritingMode>',
  });
  assert.deepEqual(valueType('hillshade-highlight-color', {type: 'colorArray'}), {
    swift: '[TileflowColor]',
    kotlin: 'List<TileflowColor>',
  });
  assert.throws(() => valueType('future', {type: 'hologram'}), /Unsupported property type/u);
});

test('a specification the platforms cannot represent fails to generate', () => {
  const conflicting = structuredClone(spec);
  conflicting.paint_raster.resampling.values = {only: {doc: 'A new value.'}};
  assert.throws(() => readSpecification(conflicting), /different values/u);
  const colliding = structuredClone(spec);
  colliding.expression_name.values.eq = {doc: 'A clash with ==.'};
  assert.throws(() => readSpecification(colliding), /share a name/u);
});

test('specification prose becomes one documentation paragraph', () => {
  assert.equal(
    prose('Uses [`global-state`](https://maplibre.org/x) values.\n\nSecond paragraph.'),
    'Uses `global-state` values.',
  );
  assert.equal(prose('Ends a */ comment'), 'Ends a *&#47; comment');
});
