import {createExpression, featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
import {openMapTiles, poi, resolveTileflowData, vectorTiles} from '../src';
import {labelFieldExpression} from '../src/cartography/localization';
import {bindSemanticReferences, createSemanticDataView} from '../src/cartography/semantic-bindings';
import {compilePoi} from '../src/modules/poi/compiler';
import {resolveColors} from '../src/themes';
import {assembleTileflowLayers} from './layer-ir-fixture';

function context(data = resolveTileflowData(undefined)) {
  return {
    colors: resolveColors(),
    data: createSemanticDataView(data),
    images: {},
    typography: {
      font: 'Noto Sans Regular',
      places: {font: 'Noto Sans Regular'},
      roads: {font: 'Noto Sans Regular'},
      water: {font: 'Noto Sans Regular'},
      poi: {font: 'Noto Sans Regular'},
    },
  };
}

function expressionFor(language: string, data = resolveTileflowData(undefined)) {
  return bindSemanticReferences(labelFieldExpression(language, context(data)), data);
}

function read(expression: unknown, properties: Record<string, unknown>) {
  const parsed = createExpression(expression);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error('Invalid localized label');
  return parsed.value.evaluate({zoom: 16}, {type: 'Point', properties});
}

test('explicit languages select translations, regional fallbacks and then local names', () => {
  const names = {name: '東京', name_latin: 'Tokio', name_en: 'Tokyo', name_es: 'Tokio en español'};
  assert.equal(read(expressionFor('en'), names), 'Tokyo');
  assert.equal(read(expressionFor('es-MX'), names), 'Tokio en español');
  assert.equal(read(expressionFor('es-MX-u-ca-gregory'), names), 'Tokio en español');
  assert.equal(read(expressionFor('fr'), names), '東京');
  assert.equal(read(expressionFor('local'), names), '東京');
  assert.equal(read(expressionFor('en'), {...names, name_en: ''}), '東京');
  assert.equal(read(expressionFor('fr'), {name: '', name_latin: 'Tokio'}), 'Tokio');
  assert.equal(read(expressionFor('en'), {}), '');
  assert.equal(
    read(expressionFor('zh-TW'), {name: 'Local', 'name_zh-Hant': '繁體', name_zh: '中文'}),
    '繁體',
  );
});

test('one auto artifact follows the renderer locale and respects translated field bindings', () => {
  const data = resolveTileflowData(
    vectorTiles({
      url: '/tiles.json',
      attribution: 'Test',
      schema: openMapTiles({
        fields: {name: 'local_label', nameEnglish: 'english_label', nameLatin: 'latin_label'},
      }),
    }),
  );
  const expression = expressionFor('auto', data);
  const styleSpec = createRequire(import.meta.url).resolve('@maplibre/maplibre-gl-style-spec');
  const names = {
    local_label: '東京',
    latin_label: 'Latin',
    english_label: 'Tokyo',
    'name:es': 'Tokio',
    'name:en': 'Do not bypass the configured English field',
    'name:zh-Hant': '東京繁體',
  };
  for (const [locale, expected] of [
    ['en-US', 'Tokyo'],
    ['es-ES', 'Tokio'],
    ['zh-TW', '東京繁體'],
    ['fr-FR', '東京'],
  ]) {
    // A renderer chooses its locale once; fresh processes exercise real locale resolution.
    const result = execFileSync(
      process.execPath,
      [
        '-e',
        `const {createExpression}=require(process.argv[1]);
       const parsed=createExpression(JSON.parse(process.argv[2]));
       if(parsed.result!=='success')throw new Error(JSON.stringify(parsed.value));
       process.stdout.write(JSON.stringify(parsed.value.evaluate({zoom:16},{type:'Point',properties:JSON.parse(process.argv[3])})));`,
        styleSpec,
        JSON.stringify(expression),
        JSON.stringify(names),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LANG: `${locale!.replace('-', '_')}.UTF-8`,
          LC_ALL: `${locale!.replace('-', '_')}.UTF-8`,
        },
      },
    );
    assert.equal(JSON.parse(result), expected, locale);
  }
});

test('POI eligibility uses the displayed name and excludes empty source names', () => {
  const data = resolveTileflowData(undefined);
  const layers = assembleTileflowLayers(compilePoi(poi({density: 5}), context(data), 'es'), data);
  const accepts = (names: Record<string, string>) =>
    layers.some((layer) =>
      featureFilter(layer.filter as never).filter(
        {zoom: 18},
        {
          type: 1,
          properties: {class: 'retail', filterrank: 5, sizerank: 16, type: 'shop', ...names},
        },
      ),
    );
  assert.equal(accepts({name: '', name_es: ''}), false);
  assert.equal(accepts({name: '', name_es: 'Tienda'}), true);
  assert.equal(accepts({name: 'お店'}), true);
  const auto = assembleTileflowLayers(compilePoi(poi(), context(data), 'auto'), data);
  assert.deepEqual(
    validateStyleMin({
      version: 8,
      glyphs: 'https://example.test/{fontstack}/{range}.pbf',
      sprite: 'https://example.test/sprite',
      sources: {tileflow: {type: 'vector', url: 'https://example.test/tiles.json'}},
      layers: auto,
    } as never),
    [],
  );
});
