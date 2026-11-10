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
// World's road classes for each Tileflow carriageway class that differs from it.
const worldClasses: Record<string, readonly string[]> = {
  minor: ['street'],
  service: ['service', 'busway'],
  track: ['track', 'raceway'],
};

for (const theme of ['light', 'dawn', 'dusk', 'dark']) {
  const style = createStyle(map1777, {theme, preparedAssets});
  const line = (id: string) => {
    const layer = style.layers.find((entry) => entry.id === id);
    assert.ok(layer?.type === 'line', id);
    return layer;
  };
  // The layer that draws a class at a zoom: from z15, motorways and trunks share casings.
  const drawnAt = (id: string, zoom: number) => {
    const own = line(id);
    if (zoom >= (own.minzoom ?? 0) && zoom < (own.maxzoom ?? 24)) return own;
    const shared = line(id.replace(/-(?:motorway|trunk)-/u, '-highzoom-major-'));
    assert.ok(zoom >= (shared.minzoom ?? 0) && zoom < (shared.maxzoom ?? 24), `${id} at z${zoom}`);
    return shared;
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
        let previous = 0;
        for (const zoom of [14, 16, 17.156959, 18, 19, 22]) {
          const casing = drawnAt(`tileflow-road-${structure}-${roadClass}-casing`, zoom);
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
        for (const className of worldClasses[roadClass] ?? [roadClass]) {
          const open = {class: className, link: false};
          const closed = {class: 'construction', type: className, access: 'no', indoor: true};
          assert.ok(matches(ordinary, open));
          assert.ok(!matches(ordinary, closed));
          assert.ok(matches(works, closed));
          assert.ok(!matches(works, open));
          for (const structure of ['bridge', 'tunnel'])
            assert.ok(!matches(works, {...closed, structure}));
          for (const treatment of [
            {},
            {link: true},
            {expressway: true},
            {link: true, access: 'no'},
            {service: 'driveway'},
            {service: 'parking_aisle'},
          ]) {
            // Compare with the layer that draws the open road: highway links have their own.
            const drawing =
              ['motorway', 'trunk'].includes(roadClass) && phase === 'fill' && 'link' in treatment
                ? line(`tileflow-roads-render-${roadClass}-surface-links`)
                : ordinary;
            assert.ok(matches(drawing, {...open, ...treatment}));
            for (const zoom of [15, 17, 19]) {
              assert.equal(
                paint(works, 'line-width', zoom, {...open, ...treatment, class: closed.class}),
                paint(
                  drawing === ordinary ? drawnAt(ordinary.id, zoom) : drawing,
                  'line-width',
                  zoom,
                  {...open, ...treatment},
                ),
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
    for (const [roadClass, classes] of Object.entries(worldClasses)) {
      for (const className of classes)
        assert.ok(matches(line(`tileflow-road-surface-${roadClass}-fill`), {class: className}));
    }
  });

  test(`1777 ${theme} draws highway links once before receiving carriageways`, () => {
    for (const roadClass of ['motorway', 'trunk']) {
      for (const structure of ['surface', 'bridge']) {
        const link = line(`tileflow-roads-render-${roadClass}-${structure}-links`);
        const ordinary = line(`tileflow-road-${structure}-${roadClass}-fill`);
        // Ramp-dependent casing widths draw links' casings in their own layer.
        const casing = line(`tileflow-road-${structure}-${roadClass}-rampCasing`);
        const feature = {
          class: roadClass,
          link: true,
          ...(structure === 'bridge' ? {structure: 'bridge'} : {}),
        };
        assert.ok(matches(link, feature));
        assert.ok(!matches(ordinary, feature));
        assert.ok(matches(casing, feature));
        assert.ok(!matches(link, {...feature, link: false}));
        assert.ok(!matches(link, {...feature, class: 'construction', type: roadClass}));
        assert.ok(!matches(link, {...feature, structure: 'tunnel'}));
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
          {indoor: true},
          {surface: 'unpaved'},
          {access: 'no', surface: 'unpaved', indoor: true},
        ]) {
          for (const zoom of [13.5, 16, 19]) {
            const properties = {...feature, ...treatment};
            // The carriageway layer no longer draws links, so its style is read for the same
            // road as a carriageway. Links keep that colour and opacity; unrestricted links
            // narrow to 72 %, like construction works on a link.
            const carriageway = {...properties, link: false};
            for (const property of ['line-opacity', 'line-color'] as const) {
              assert.deepEqual(
                paint(link, property, zoom, properties),
                paint(ordinary, property, zoom, carriageway),
                `${roadClass} ${structure} ${property}`,
              );
            }
            const width = paint(ordinary, 'line-width', zoom, carriageway) as number;
            const linkWidth = paint(link, 'line-width', zoom, properties) as number;
            const factor = 'access' in treatment ? 1 : 0.72;
            assert.ok(
              Math.abs(linkWidth - width * factor) < 1e-9,
              `${roadClass} ${structure} line-width ${linkWidth} != ${width} × ${factor}`,
            );
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
    assert.equal(paint(path, 'line-opacity', 14, {class: 'path', type: 'footway'}), 0);
    assert.ok(paint(path, 'line-opacity', 14.5, {class: 'path', type: 'footway'}) > 0);
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
