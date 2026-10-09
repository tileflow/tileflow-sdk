import assert from 'node:assert/strict';
import test from 'node:test';
import {labels, land, poi, refineRenderTarget, renderPass, water, withRenderStack} from '../src';
import {type TileflowLayerSlot, tileflowLayerSlots} from '../src/cartography/contributions';
import {compileRenderStack} from '../src/cartography/render-stack';
import {createSemanticDataView} from '../src/cartography/semantic-bindings';
import {resolveTileflowData} from '../src/data';
import {createStyleWithInspection} from '../src/style-inspection';
import {extendStreets} from './map-fixture';

const icons = [
  'coffee',
  'crosswalk',
  'culture',
  'education',
  'food',
  'health',
  'lodging',
  'major-transit',
  'oneway',
  'services',
  'shopping',
  'sidewalk-dot',
];

function compile(modules: Parameters<typeof extendStreets>[0]['modules']) {
  const {inspection} = createStyleWithInspection(extendStreets({modules}), {
    preparedAssets: {icons: {ids: icons, sprite: '/tileflow/test/streets/sprite'}},
  });
  const layers = inspection.layers;
  const ids = layers.map(({id}) => id);
  const ranks = layers.map(({contributions}) =>
    Math.min(...contributions.map(({slot}) => tileflowLayerSlots.indexOf(slot))),
  );
  assert.ok(ranks.every(Number.isFinite), 'Every layer reports its slot');
  const rank = (slot: TileflowLayerSlot) => tileflowLayerSlots.indexOf(slot);
  /** Every ranked layer before `index` is at or below `last`; every one after it is above. */
  const isEdge = (index: number, last: TileflowLayerSlot) =>
    ranks.slice(0, index).every((value) => value <= rank(last)) &&
    ranks.slice(index + 1).every((value) => value >= rank(last));
  return {ids, isEdge, layers};
}

test('band placements draw at band edges in declaration order', () => {
  const {ids, isEdge} = compile({
    labels: withRenderStack(labels(), {
      scanlines: renderPass({
        placement: 'above-roads',
        renderer: 'background',
        style: {opacity: 0.5},
      }),
      scanlineTint: renderPass({
        placement: 'above-roads',
        renderer: 'background',
        style: {opacity: 0.1},
      }),
    }),
    land: withRenderStack(land(), {
      canopy: renderPass({
        feature: 'landcover',
        placement: 'above-relief',
        renderer: 'fill',
        style: {opacity: 0.8},
      }),
    }),
  });

  const scanlines = ids.indexOf('tileflow-labels-render-scanlines');
  assert.ok(scanlines > 0);
  assert.equal(ids.indexOf('tileflow-labels-render-scanlineTint'), scanlines + 1);
  assert.ok(isEdge(scanlines, 'transport-symbols'));
  assert.ok(ids.slice(scanlines + 2).some((id) => id.startsWith('tileflow-boundary')));
  assert.ok(ids.slice(0, scanlines).some((id) => id.startsWith('tileflow-road')));

  const canopy = ids.indexOf('tileflow-land-render-canopy');
  assert.ok(canopy > 0);
  assert.ok(isEdge(canopy, 'terrain'));
  assert.ok(ids.slice(canopy + 1).some((id) => id.startsWith('tileflow-water')));
});

test('a refinement moves its target, and passes placed beside it follow', () => {
  const {ids, isEdge, layers} = compile({
    water: withRenderStack(water(), {
      // Declared before the move: it waits for its anchor to reach the new position.
      rim: renderPass({
        placement: {below: 'water.bodies.fill'},
        renderer: 'line',
        style: {width: 2},
      }),
      raise: refineRenderTarget({placement: 'above-roads', target: 'water.bodies.fill'}),
    }),
  });

  const fill = layers.findIndex(({contributions}) =>
    contributions.some(({target}) => target === 'water.bodies.fill'),
  );
  assert.ok(fill > 0);
  assert.equal(ids.indexOf('tileflow-water-render-rim'), fill - 1);
  assert.ok(isEdge(fill, 'transport-symbols'));
  const origin = layers[fill]!.contributions.find(({target}) => target === 'water.bodies.fill');
  assert.equal(origin?.slot, 'transport-symbols');
  assert.deepEqual(
    origin?.operations.filter(({kind}) => kind === 'refinement'),
    [{kind: 'refinement', owner: 'water', target: 'water.bodies.fill'}],
  );
});

test('an owner made only of render passes satisfies requirements', () => {
  const {ids} = compile({
    poi: withRenderStack(poi({categories: [], icons: false, labels: false}), {
      blip: renderPass({
        feature: 'poi',
        placement: 'below-labels',
        renderer: 'circle',
        style: {radius: 3},
      }),
    }),
    labels: withRenderStack(labels(), {
      halo: renderPass({
        placement: {above: 'poi.render.blip'},
        renderer: 'circle',
        requirements: ['poi'],
        style: {opacity: 0.4, radius: 5},
      }),
    }),
  });

  const blip = ids.indexOf('tileflow-poi-render-blip');
  assert.ok(blip > 0);
  assert.equal(ids.indexOf('tileflow-labels-render-halo'), blip + 1);
});

test('placements are validated where they are declared and compiled', () => {
  assert.throws(
    () =>
      renderPass({
        placement: 'between-roads' as never,
        renderer: 'background',
        style: {opacity: 0.5},
      }),
    {code: 'invalid-placement'},
  );
  assert.throws(
    () =>
      renderPass({
        placement: {beside: 'water.bodies.fill'} as never,
        renderer: 'background',
        style: {opacity: 0.5},
      }),
    {code: 'invalid-placement'},
  );
  assert.throws(() => refineRenderTarget({target: 'water.bodies.fill'} as never), {
    code: 'invalid-refinement',
  });

  const bandWithoutFeature = withRenderStack(land(), {
    canopy: renderPass({placement: 'above-relief', renderer: 'fill', style: {}}),
  });
  assert.throws(
    () => compileRenderStack(bandWithoutFeature, createSemanticDataView(resolveTileflowData())),
    {code: 'missing-inherited-feature'},
  );

  assert.throws(
    () =>
      compile({
        water: withRenderStack(water(), {
          loop: refineRenderTarget({
            placement: {above: 'water.bodies.fill'},
            target: 'water.bodies.fill',
          }),
        }),
      }),
    /cannot be placed beside itself/u,
  );
  assert.throws(
    () =>
      compile({
        water: withRenderStack(water(), {
          rim: renderPass({
            placement: {above: 'water.missing'},
            renderer: 'line',
            style: {width: 1},
          }),
        }),
      }),
    /unknown semantic target water\.missing/u,
  );
});
