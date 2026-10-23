import {createPropertyExpression, latest as styleSpec} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {labels, resolveTileflowData} from '../src/index';
import {compileLabels} from '../src/modules/labels/compiler';
import {compactRoadNameExpression} from '../src/modules/labels/road-names';
import {resolveColors} from '../src/themes';

function textValue(input: unknown, properties: Record<string, unknown>) {
  const compiled = createPropertyExpression(input, styleSpec.layout_symbol['text-field']);
  assert.equal(compiled.result, 'success', JSON.stringify(compiled.value));
  if (compiled.result !== 'success') throw new Error('Invalid road-name expression');
  return compiled.value.evaluate({zoom: 16}, {type: 2, properties}).toString();
}

test('compact road names abbreviate complete type words without changing proper names or references', () => {
  const input = compactRoadNameExpression(['get', 'name']);
  for (const [name, expected] of [
    ['Calle de Alcalá', 'C. de Alcalá'],
    ['CALLE DEL PEZ', 'C. DEL PEZ'],
    ['Avenida de América', 'Av. de América'],
    ['Paseo del Prado', 'Pso. del Prado'],
    ['Plaza de la Puerta del Sol', 'Pl. de la Puerta del Sol'],
    ['Plazamar', 'Plazamar'],
    ['Boulevard de Sébastopol', 'Bd de Sébastopol'],
    ['Rue de Rivoli', 'Rue de Rivoli'],
    ['West 42nd Street', 'W 42nd St'],
    ['East 34th Street', 'E 34th St'],
    ['North Road', 'North Rd'],
    ['West End Avenue', 'West End Ave'],
    ['Martin Luther King Jr. Boulevard', 'Martin Luther King Jr. Blvd'],
    ['Streetcar Lane', 'Streetcar Ln'],
    ['Broadway', 'Broadway'],
    ['Callegari', 'Callegari'],
    ['Gran Vía', 'Gran Vía'],
    ['M-30', 'M-30'],
    ['A', 'A'],
    ['', ''],
    ['青山通り', '青山通り'],
    ['улица Арбат', 'улица Арбат'],
  ])
    assert.equal(textValue(input, {name}), expected, name);
});

test('road-name formatting follows localization, leaves shields alone and honors explicit text fields', () => {
  const context = {
    colors: resolveColors(),
    data: resolveTileflowData(undefined),
    images: {},
    typography: {
      font: 'Noto Sans Regular',
      places: {font: 'Noto Sans Bold'},
      roads: {font: 'Noto Sans Regular'},
      water: {font: 'Noto Sans Regular'},
      poi: {font: 'Noto Sans Regular'},
    },
  };
  const compile = (options: Parameters<typeof labels>[0]) =>
    compileLabels(labels(options), undefined, context);
  const roadText = (options: Parameters<typeof labels>[0]) => {
    const layer = compile(options).find(({target}) => target === 'labels.roads.primary')!.layer;
    return (layer.layout as Record<string, unknown>)['text-field'];
  };
  const feature = {name: 'Avenida de América', 'name:en': 'America Avenue', ref: 'A-2'};
  assert.equal(textValue(roadText({language: 'local'}), feature), 'Avenida de América');
  assert.equal(
    textValue(roadText({language: 'local', roadNameFormat: 'compact'}), feature),
    'Av. de América',
  );
  assert.equal(
    textValue(roadText({language: 'en', roadNameFormat: 'compact'}), feature),
    'America Ave',
  );
  assert.equal(
    textValue(roadText({language: 'de', roadNameFormat: 'compact'}), feature),
    'Av. de América',
  );
  assert.equal(
    textValue(
      roadText({
        roadNameFormat: 'compact',
        styles: {roads: {primary: {text: {field: 'Custom road'}}}},
      }),
      feature,
    ),
    'Custom road',
  );
  const shieldText = (format: 'full' | 'compact') =>
    compile({roadNameFormat: format})
      .filter(({target}) => target.startsWith('labels.shields.'))
      .map(({layer}) => (layer.layout as Record<string, unknown>)['text-field']);
  assert.deepEqual(shieldText('compact'), shieldText('full'));
});
