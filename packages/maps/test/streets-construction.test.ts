import {
  createPropertyExpression,
  featureFilter,
  latest,
  type LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyleWithInspection} from '@tileflow/core/build';
import {streets} from '../src';
import {streetsPreparedModels} from './streets-assets';

const ids = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));

function paint(
  layer: LineLayerSpecification,
  property: keyof typeof latest.paint_line,
  zoom: number,
  properties: Record<string, unknown>,
) {
  const value = layer.paint?.[property];
  const result = createPropertyExpression(
    Array.isArray(value) && typeof value[0] === 'number' ? ['literal', value] : value,
    latest.paint_line[property],
  );
  assert.equal(result.result, 'success', `${layer.id}: ${property}`);
  if (result.result !== 'success') throw new Error('Invalid road paint');
  return result.value.evaluate({zoom}, {type: 2, properties});
}

test('Streets construction roads have square transverse marks over a faint continuous fill', () => {
  for (const theme of [undefined, 'dawn', 'dark', 'faded', 'monochrome']) {
    const {style, inspection} = createStyleWithInspection(streets, {
      theme,
      preparedAssets: {models: streetsPreparedModels, icons: {ids, sprite: '/test/sprite'}},
    });
    const path = style.layers.find(
      (layer): layer is LineLayerSpecification =>
        layer.type === 'line' && layer.id === 'tileflow-road-surface-footway-fill',
    );
    assert.ok(path);
    const footpath = {class: 'path_construction', subclass: 'footway'};
    assert.deepEqual(paint(path, 'line-dasharray', 18, footpath), [1.5, 1]);
    assert.equal(paint(path, 'line-opacity', 18, footpath), 0.96);
    const marks = style.layers.filter(
      (layer): layer is LineLayerSpecification =>
        layer.type === 'line' &&
        layer.id.startsWith('tileflow-roads-render-construction-') &&
        !layer.id.endsWith('-underlay'),
    );
    assert.equal(marks.length, 8);
    for (const mark of marks) {
      const roadClass = mark.id.replace('tileflow-roads-render-construction-', '');
      const properties = {class: `${roadClass}_construction`, ramp: 0, oneway: 1};
      const filter = featureFilter(mark.filter);
      const underlay = style.layers.find(
        (layer): layer is LineLayerSpecification =>
          layer.type === 'line' && layer.id === `${mark.id}-underlay`,
      );
      assert.ok(underlay, `${roadClass} must retain its faint construction ground`);
      assert.ok(style.layers.indexOf(underlay) < style.layers.indexOf(mark));
      for (const ordinary of style.layers.filter(
        (layer) =>
          layer.type === 'line' &&
          /^tileflow-road-(?:surface|bridge)-.*-(?:casing|fill|rampFill)$/u.test(layer.id),
      )) {
        assert.ok(
          style.layers.indexOf(mark) < style.layers.indexOf(ordinary),
          `${mark.id} must not stripe over ${ordinary.id}`,
        );
      }
      assert.equal(mark.layout?.['line-cap'], 'butt', 'Marks must never become round pills');
      for (const zoom of [15, 16.8, 18, 20]) {
        assert.equal(filter.filter({zoom}, {type: 2, properties}), true);
        for (const brunnel of ['bridge', 'tunnel']) {
          assert.equal(
            filter.filter({zoom}, {type: 2, properties: {...properties, brunnel}}),
            false,
          );
        }
        assert.equal(
          filter.filter({zoom}, {type: 2, properties: {...properties, class: roadClass}}),
          false,
          'Ordinary roads must not receive construction marks',
        );
        const dash = paint(mark, 'line-dasharray', zoom, properties);
        assert.ok(dash[0] < 0.2 && dash[1] < 0.3, 'Marks must be short and frequent');
        for (const ramp of [0, 1]) {
          const feature = {...properties, ramp};
          const target = `roads.classes.${roadClass}.surface.${ramp ? 'rampFill' : 'fill'}`;
          const candidates = new Set(
            inspection.layers
              .filter((layer) =>
                layer.contributions.some((contribution) => contribution.target === target),
              )
              .map(({id}) => id),
          );
          const bases = style.layers.filter(
            (layer): layer is LineLayerSpecification =>
              layer.type === 'line' &&
              candidates.has(layer.id) &&
              (layer.minzoom ?? 0) <= zoom &&
              (layer.maxzoom ?? 24) > zoom &&
              featureFilter(layer.filter).filter({zoom}, {type: 2, properties: feature}),
          );
          assert.equal(
            bases.length,
            1,
            `${roadClass} ramp=${ramp} has one carriageway at z${zoom}`,
          );
          const base = bases[0]!;
          assert.deepEqual(paint(base, 'line-dasharray', zoom, feature), [1, 0]);
          assert.equal(paint(base, 'line-opacity', zoom, feature), 0);
          assert.equal(paint(underlay, 'line-opacity', zoom, feature), 0.16);
          // A solid underlay keeps MapLibre's solid-line shader: it has no dash at all.
          assert.equal(underlay.paint?.['line-dasharray'], undefined);
          assert.equal(
            marks.filter((layer) =>
              featureFilter(layer.filter).filter({zoom}, {type: 2, properties: feature}),
            ).length,
            1,
          );

          assert.ok(
            Math.abs(
              paint(mark, 'line-width', zoom, {...properties, ramp}) -
                paint(base, 'line-width', zoom, {...properties, ramp}),
            ) < 1e-9,
            `${roadClass} marks must follow the carriageway width at z${zoom}`,
          );
          assert.equal(
            paint(underlay, 'line-width', zoom, {...properties, ramp}),
            paint(mark, 'line-width', zoom, {...properties, ramp}),
          );
        }
      }
    }
  }
});
