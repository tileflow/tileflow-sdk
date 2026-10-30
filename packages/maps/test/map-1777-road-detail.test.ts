import {
  createPropertyExpression,
  featureFilter,
  latest,
  type LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle} from '@tileflow/core';
import {map1777} from '../src';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/map-1777/icons/', import.meta.url)).map((file) =>
      file.replace(/(?:\.pattern)?\.svg$/, ''),
    ),
    sprite: '/test/map-1777/sprite',
  },
};

function evaluate(
  value: unknown,
  spec: Parameters<typeof createPropertyExpression>[1],
  zoom: number,
  properties: Record<string, unknown> = {},
) {
  const result = createPropertyExpression(value, spec);
  assert.equal(result.result, 'success');
  if (result.result !== 'success') throw new Error('Invalid cartographic expression');
  return result.value.evaluate({zoom}, {type: 2, properties});
}

const carriageways = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
];

for (const theme of ['light', 'dawn', 'dusk', 'dark']) {
  const style = createStyle(map1777, {theme, preparedAssets});
  const line = (id: string) => {
    const layer = style.layers.find((entry) => entry.id === id);
    assert.ok(layer?.type === 'line', id);
    return layer;
  };
  const matches = (layer: LineLayerSpecification, properties: Record<string, unknown>) =>
    featureFilter(layer.filter).filter({zoom: 18}, {type: 2, properties});
  const paint = (
    layer: LineLayerSpecification,
    property: 'line-width' | 'line-gap-width' | 'line-opacity' | 'line-color',
    zoom: number,
    properties: Record<string, unknown>,
  ) => evaluate(layer.paint?.[property], latest.paint_line[property], zoom, properties);

  test(`1777 ${theme} keeps roads growing beyond zoom 16 without width jumps at detail stops`, () => {
    for (const roadClass of [...carriageways, 'pathway', 'footway', 'cycleway', 'pedestrian']) {
      const properties = {class: roadClass};
      const surface = line(`tileflow-road-surface-${roadClass}-fill`);
      for (const structure of ['surface', 'bridge', 'tunnel']) {
        const fill = line(`tileflow-road-${structure}-${roadClass}-fill`);
        const casing = line(`tileflow-road-${structure}-${roadClass}-casing`);
        let previous = 0;
        for (const zoom of [14, 16, 17.156959, 18, 19, 22]) {
          const width = paint(fill, 'line-width', zoom, properties);
          assert.ok(width > previous, `${roadClass} ${structure} must grow at zoom ${zoom}`);
          assert.equal(width, paint(surface, 'line-width', zoom, properties));
          const stroke = paint(casing, 'line-width', zoom, properties);
          const outer =
            structure === 'tunnel'
              ? paint(casing, 'line-gap-width', zoom, properties) + 2 * stroke
              : stroke;
          assert.ok(outer > width && outer - width < 1.5, `${roadClass} border stays fine`);
          previous = width;
        }
        for (const zoom of [16, 18, 22]) {
          const width = paint(fill, 'line-width', zoom, properties);
          const before = paint(fill, 'line-width', zoom - 0.001, properties);
          const after = paint(fill, 'line-width', zoom + 0.001, properties);
          assert.ok((after - before) / width < 0.003, `${roadClass} jumps at zoom ${zoom}`);
        }
      }
    }
  });

  test(`1777 ${theme} isolates construction ink and preserves carriageway widths`, () => {
    for (const roadClass of carriageways) {
      for (const phase of ['casing', 'fill']) {
        const ordinary = line(`tileflow-road-surface-${roadClass}-${phase}`);
        const works = line(`tileflow-roads-render-${roadClass}-construction-${phase}`);
        if (roadClass !== 'track' || phase !== 'fill') {
          assert.equal(
            ordinary.paint?.['line-dasharray'],
            undefined,
            'Solid roads must use the solid-line shader; tracks retain engraved dashes',
          );
        }
        assert.deepEqual(works.paint?.['line-dasharray'], [2, 1]);
        assert.equal(works.layout?.['line-cap'], 'square');
        for (const className of roadClass === 'track' ? ['track', 'raceway'] : [roadClass]) {
          const open = {class: className, ramp: 0};
          const closed = {class: `${className}_construction`, access: 'no', indoor: 1};
          assert.ok(matches(ordinary, open));
          assert.ok(!matches(ordinary, closed));
          assert.ok(matches(works, closed));
          assert.ok(!matches(works, open));
          for (const brunnel of ['bridge', 'tunnel'])
            assert.ok(!matches(works, {...closed, brunnel}));
          for (const treatment of [
            {},
            {ramp: 1},
            {expressway: 1},
            {ramp: 1, access: 'no'},
            {service: 'driveway'},
            {service: 'parking_aisle'},
          ]) {
            for (const zoom of [15, 17, 19]) {
              assert.equal(
                paint(works, 'line-width', zoom, {...open, ...treatment, class: closed.class}),
                paint(ordinary, 'line-width', zoom, {...open, ...treatment}),
              );
            }
          }
        }
        for (const other of carriageways) {
          assert.ok(
            style.layers.indexOf(works) <
              style.layers.indexOf(line(`tileflow-road-surface-${other}-fill`)),
          );
        }
      }
    }
    for (const [roadClass, aliases] of [
      ['minor', ['residential', 'unclassified']],
      ['service', ['busway', 'bus_guideway']],
    ] as const) {
      for (const alias of aliases)
        assert.ok(matches(line(`tileflow-road-surface-${roadClass}-fill`), {class: alias}));
    }
  });

  test(`1777 ${theme} draws highway links once before receiving carriageways`, () => {
    for (const roadClass of ['motorway', 'trunk']) {
      for (const structure of ['surface', 'bridge']) {
        const link = line(`tileflow-roads-render-${roadClass}-${structure}-links`);
        const ordinary = line(`tileflow-road-${structure}-${roadClass}-fill`);
        const casing = line(`tileflow-road-${structure}-${roadClass}-casing`);
        const feature = {
          class: roadClass,
          ramp: 1,
          ...(structure === 'bridge' ? {brunnel: 'bridge'} : {}),
        };
        assert.ok(matches(link, feature));
        assert.ok(!matches(ordinary, feature));
        assert.ok(matches(casing, feature));
        assert.ok(!matches(link, {...feature, ramp: 0}));
        assert.ok(!matches(link, {...feature, class: `${roadClass}_construction`}));
        assert.ok(!matches(link, {...feature, brunnel: 'tunnel'}));
        assert.ok(style.layers.indexOf(casing) < style.layers.indexOf(link));
        assert.ok(
          style.layers.indexOf(link) <
            style.layers.indexOf(line(`tileflow-road-${structure}-track-fill`)),
        );
        if (structure === 'bridge')
          assert.ok(
            style.layers.indexOf(link) >
              style.layers.indexOf(line('tileflow-road-surface-motorway-fill')),
          );
        for (const treatment of [
          {},
          {access: 'no'},
          {indoor: 1},
          {surface: 'unpaved'},
          {access: 'no', surface: 'unpaved', indoor: 1},
        ]) {
          for (const zoom of [13.5, 16, 19]) {
            const properties = {...feature, ...treatment};
            for (const property of ['line-width', 'line-opacity', 'line-color'] as const) {
              assert.deepEqual(
                paint(link, property, zoom, properties),
                paint(ordinary, property, zoom, properties),
                `${roadClass} ${structure} ${property}`,
              );
            }
          }
        }
      }
    }
  });

  test(`1777 ${theme} introduces fine detail smoothly and gives major names first priority`, () => {
    for (const id of [
      'tileflow-landcover-wood',
      'tileflow-landcover-urbanPark',
      'tileflow-landuse-residential',
    ]) {
      const layer = style.layers.find((entry) => entry.id === id);
      assert.ok(layer?.type === 'fill');
      const start = layer.minzoom!;
      const opacity = (z: number) =>
        evaluate(layer.paint?.['fill-opacity'], latest.paint_fill['fill-opacity'], z);
      assert.equal(opacity(start), 0);
      assert.ok(opacity(start + 0.01) < 0.02);
      assert.ok(opacity(start + 0.5) > 0 && opacity(start + 0.5) < opacity(start + 1));
      assert.equal(opacity(start + 1), opacity(19));
    }
    const tree = style.layers.find((entry) => entry.id === 'tileflow-vegetation-trees');
    assert.ok(tree?.type === 'circle');
    for (const property of ['circle-opacity', 'circle-stroke-opacity'] as const) {
      assert.equal(evaluate(tree.paint?.[property], latest.paint_circle[property], 15), 0);
      assert.ok(evaluate(tree.paint?.[property], latest.paint_circle[property], 15.5) > 0);
    }
    const path = line('tileflow-road-surface-footway-fill');
    assert.equal(paint(path, 'line-opacity', 14, {class: 'path', subclass: 'footway'}), 0);
    assert.ok(paint(path, 'line-opacity', 14.5, {class: 'path', subclass: 'footway'}) > 0);
    let previous = -Infinity;
    for (const name of [
      'Motorway',
      'Trunk',
      'Primary',
      'Secondary',
      'Tertiary',
      'Minor',
      'Service',
      'Paths',
    ]) {
      const label = style.layers.find((entry) => entry.id === `tileflow-labels-render-road${name}`);
      assert.ok(label?.type === 'symbol');
      const priority = label.layout?.['symbol-sort-key'];
      assert.ok(typeof priority === 'number' && priority > previous);
      previous = priority;
      assert.deepEqual(label.layout?.['text-font'], ['Cormorant Garamond Italic']);
      assert.equal(label.layout?.['text-pitch-alignment'], 'map');
      assert.equal(label.layout?.['text-transform'], 'none');
    }
  });
}
