import assert from 'node:assert/strict';
import test from 'node:test';
import {readTileflowCompilerProvenance} from '../src/cartography/compiler-inspection';
import {tileflowLayerDomains} from '../src/cartography/domains';
import {
  compileRenderSelector,
  compileRenderStack,
  refineRenderTarget,
  renderPass,
  type TileflowRenderSelector,
  tileflowRenderStackLimits,
  withRenderStack,
} from '../src/cartography/render-stack';
import {bindSemanticReferences, createSemanticDataView} from '../src/cartography/semantic-bindings';
import {fixed} from '../src/cartography/values';
import {openMapTiles, resolveTileflowData} from '../src/data';
import {createStyle} from '../src/map';
import {buildings} from '../src/modules/buildings';
import {labels} from '../src/modules/labels';
import {applyCompiledRenderStacks, assembleTileflowLayers} from './layer-ir-fixture';
import {extendStreets} from './map-fixture';

const data = resolveTileflowData({
  type: 'vector-tiles',
  attribution: 'Render stack fixture',
  schema: openMapTiles({
    fields: {
      capital: 'capital_fixture',
      class: 'class_fixture',
      height: 'height_fixture',
      name: 'name_fixture',
      rank: 'rank_fixture',
    },
    layers: {building: 'building_fixture'},
  }),
  url: 'https://example.test/render-stack.json',
});

test('withRenderStack infers its owner and lowers a physical-key-free pass through bindings', () => {
  const module = buildings({mode: '3d'});
  const configured = withRenderStack(module, {
    softShadow: renderPass({
      attachTo: 'buildings.flat.fill',
      feature: 'building',
      phase: 'underlay',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          {geometry: 'polygon', kind: 'geometry'},
          {
            coerce: 'number',
            fallback: 0,
            field: 'height',
            kind: 'compare',
            operator: 'gte',
            value: 5,
          },
        ],
      },
      style: {
        blur: 7,
        color: '#101820',
        minZoom: 16,
        opacity: 0.12,
        translate: [3, 5],
        translateAnchor: 'viewport',
        visibilityGroup: 'building',
        width: 9,
      },
    }),
  });

  assert.equal(module.renderStack, undefined);
  assert.equal(configured.type, 'buildings');
  assert.deepEqual(Object.keys(configured.renderStack), ['softShadow']);
  assert.equal(Object.hasOwn(configured.renderStack.softShadow, 'owner'), false);

  const [compiled] = compileRenderStack(configured, createSemanticDataView(data));
  assert.equal(compiled?.kind, 'layer');
  if (!compiled || compiled.kind !== 'layer') return;
  assert.equal(compiled.owner, 'buildings');
  assert.equal(compiled.target, 'buildings.render.softShadow');
  assert.equal(compiled.template.key, 'buildings.render.softShadow');
  assert.equal(compiled.template.renderer, 'line');
  assert.deepEqual(compiled.template.feature?.dataSource, {
    kind: 'tileflow-data-source',
    name: 'primary',
  });
  assert.deepEqual(compiled.template.feature?.dataLayer, {
    kind: 'tileflow-data-layer',
    name: 'building',
  });
  assert.equal(compiled.template.range?.minZoom, 16);
  const lowered = bindSemanticReferences(compiled, data);
  assert.equal(lowered.template.feature?.dataSource, data.sourceId);
  assert.equal(lowered.template.feature?.dataLayer, 'building_fixture');
  assert.deepEqual(lowered.template.selector, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['>=', ['to-number', ['get', 'height_fixture'], 0], 5],
  ]);
  assert.deepEqual(compiled.template.style.placement, {visibility: 'none'});
  assert.deepEqual(compiled.template.annotations, {'tileflow:3d-toggle': 'building'});
  assert.deepEqual(compiled.template.style.appearance, {
    'line-blur': 7,
    'line-color': '#101820',
    'line-opacity': 0.12,
    'line-translate': [3, 5],
    'line-translate-anchor': 'viewport',
    'line-width': 9,
  });
});

test('closed selectors cover geometry, normalization, match, composition, and zoom gates', () => {
  const selector: TileflowRenderSelector = {
    kind: 'all',
    selectors: [
      {geometry: 'point', kind: 'geometry'},
      {field: 'name', kind: 'has'},
      {
        fallback: '',
        field: 'class',
        kind: 'compare',
        operator: 'eq',
        value: 'city',
      },
      {
        coerce: 'number',
        fallback: 0,
        field: 'capital',
        kind: 'compare',
        operator: 'gt',
        value: 0,
      },
      {field: 'class', kind: 'in', values: ['city', 'town']},
      {
        kind: 'not',
        selector: {field: 'class', kind: 'in', values: ['hamlet']},
      },
      {
        kind: 'match',
        field: 'class',
        branches: [
          {values: ['state', 'province'], result: true},
          {values: ['country'], result: false},
        ],
        otherwise: false,
      },
      {
        kind: 'step',
        fallback: {kind: 'literal', value: false},
        stops: [
          {
            zoom: 2,
            selector: {
              coerce: 'number',
              fallback: 99,
              field: 'rank',
              kind: 'compare',
              operator: 'lte',
              value: 6,
            },
          },
          {
            zoom: 6,
            selector: {kind: 'literal', value: true},
          },
        ],
      },
    ],
  };

  const semanticSelector = compileRenderSelector(selector, createSemanticDataView(data));
  assert.match(JSON.stringify(semanticSelector), /tileflow-data-field/u);
  assert.deepEqual(bindSemanticReferences(semanticSelector, data), [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['has', 'name_fixture'],
    ['==', ['coalesce', ['get', 'class_fixture'], ''], 'city'],
    ['>', ['to-number', ['get', 'capital_fixture'], 0], 0],
    ['match', ['get', 'class_fixture'], ['city', 'town'], true, false],
    ['!', ['match', ['get', 'class_fixture'], ['hamlet'], true, false]],
    ['match', ['get', 'class_fixture'], ['state', 'province'], true, 'country', false, false],
    ['step', ['zoom'], false, 2, ['<=', ['to-number', ['get', 'rank_fixture'], 99], 6], 6, true],
  ]);
});

test('compiled stacks generate every renderer, stable phases, exact refinements, and provenance', () => {
  const configured = withRenderStack(buildings(), {
    shadowSoft: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'underlay',
      renderer: 'line',
      style: {color: '#111111', translate: [3, 5], translateAnchor: 'viewport', width: 9},
    }),
    shadowCore: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'underlay',
      renderer: 'fill',
      style: {color: '#222222', translate: [2, 4], translateAnchor: 'viewport'},
    }),
    beacon: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'overlay',
      renderer: 'circle',
      style: {
        color: '#00FFFF',
        priority: 42,
        radius: 5,
        translate: [1, 2],
        translateAnchor: 'map',
      },
    }),
    volume: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'postRelief',
      renderer: 'extrusion',
      style: {color: '#333333', height: 12},
    }),
    annotation: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'annotation',
      renderer: 'symbol',
      style: {
        priority: 3,
        priorityOrder: 'lower-first',
        text: {field: 'Building', size: 12},
      },
    }),
    finish: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'finish',
      renderer: 'background',
      style: {color: '#000000', opacity: 0.02},
    }),
    tuneFill: refineRenderTarget({
      renderer: 'fill',
      style: {
        opacity: 0.75,
        translate: [4, 6],
        translateAnchor: 'viewport',
      },
      target: 'buildings.flat.fill',
    }),
  });
  const base = assembleTileflowLayers([
    contribution('tileflow-building-outline', 'line', 10, 'buildings.flat.outline'),
    contribution('tileflow-building-fill', 'fill', 20, 'buildings.flat.fill'),
  ]);

  const result = applyCompiledRenderStacks(base, compileAndBind(configured));
  const targets = result.map((layer) => readTileflowCompilerProvenance(layer).at(-1)?.target);
  assert.deepEqual(targets, [
    'buildings.flat.outline',
    'buildings.render.shadowSoft',
    'buildings.render.shadowCore',
    'buildings.flat.fill',
    'buildings.render.beacon',
    'buildings.render.volume',
    'buildings.render.annotation',
    'buildings.render.finish',
  ]);

  const beacon = result.find(
    (layer) => readTileflowCompilerProvenance(layer).at(-1)?.target === 'buildings.render.beacon',
  )!;
  assert.deepEqual(beacon.layout, {'circle-sort-key': -42});
  assert.deepEqual(beacon.paint, {
    'circle-color': '#00FFFF',
    'circle-radius': 5,
    'circle-translate': [1, 2],
    'circle-translate-anchor': 'map',
  });
  assert.equal(beacon.source, data.sourceId);
  assert.equal(beacon['source-layer'], 'building_fixture');
  assert.deepEqual(readTileflowCompilerProvenance(beacon)[0]?.operations, [
    {kind: 'pass', owner: 'buildings', target: 'buildings.render.beacon'},
  ]);
  const annotation = result.find(
    (layer) =>
      readTileflowCompilerProvenance(layer).at(-1)?.target === 'buildings.render.annotation',
  )!;
  assert.equal((annotation.layout as Record<string, unknown>)['symbol-sort-key'], 3);

  const refined = result.find(
    (layer) => readTileflowCompilerProvenance(layer)[0]?.target === 'buildings.flat.fill',
  )!;
  assert.deepEqual(refined.paint, {
    'fill-opacity': 0.75,
    'fill-translate': [4, 6],
    'fill-translate-anchor': 'viewport',
  });
  assert.equal(refined.id, 'tileflow-building-fill');
  assert.deepEqual(readTileflowCompilerProvenance(refined)[0]?.operations, [
    {kind: 'refinement', owner: 'buildings', target: 'buildings.flat.fill'},
  ]);
});

test('cross-owner attachment requires an explicit dependency and missing requirements suppress passes', () => {
  const unsafe = withRenderStack(labels(), {
    borrowed: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'overlay',
      renderer: 'line',
      style: {width: 1},
    }),
  });
  assert.throws(() => compileRenderStack(unsafe, data), {code: 'cross-owner-attachment'});

  const safe = withRenderStack(labels(), {
    borrowed: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'overlay',
      renderer: 'line',
      requirements: ['buildings'],
      style: {width: 1},
    }),
    borrowedAccent: renderPass({
      attachTo: 'labels.render.borrowed',
      phase: 'overlay',
      renderer: 'line',
      style: {color: '#FF00FF', width: 0.5},
    }),
  });
  const base = assembleTileflowLayers([
    contribution('tileflow-label', 'symbol', 10, 'labels.places.city', 'labels'),
  ]);
  assert.deepEqual(applyCompiledRenderStacks(base, compileAndBind(safe)), base);

  const crossOwnerRefinement = withRenderStack(labels(), {
    borrowed: refineRenderTarget({
      renderer: 'fill',
      style: {opacity: 0.5},
      target: 'buildings.flat.fill',
    }),
  });
  assert.throws(() => compileRenderStack(crossOwnerRefinement, data), {
    code: 'cross-owner-refinement',
  });

  const missingTargetWithRequirement = withRenderStack(labels(), {
    roadLabel: refineRenderTarget({
      renderer: 'symbol',
      requirements: ['roads'],
      style: {text: {size: 12}},
      target: 'labels.roads.motorway',
    }),
  });
  assert.deepEqual(
    applyCompiledRenderStacks(base, compileAndBind(missingTargetWithRequirement)),
    base,
  );
});

test('feature bindings are independent from whether the matching renderer domain is enabled', () => {
  const configured = withRenderStack(labels(), {
    sourceOnlyDependency: renderPass({
      attachTo: 'labels.places.city',
      feature: 'building',
      phase: 'underlay',
      renderer: 'line',
      selector: {geometry: 'polygon', kind: 'geometry'},
      style: {width: 1},
    }),
  });
  const base = assembleTileflowLayers([
    contribution('tileflow-label', 'symbol', 10, 'labels.places.city', 'labels'),
  ]);
  const result = applyCompiledRenderStacks(base, compileAndBind(configured));
  const pass = result.find(
    (layer) =>
      readTileflowCompilerProvenance(layer).at(-1)?.target === 'labels.render.sourceOnlyDependency',
  );

  assert.equal(pass?.source, data.sourceId);
  assert.equal(pass?.['source-layer'], 'building_fixture');
  assert.equal(result.length, 2);
});

test('builders reject physical layer escape hatches and selectors reject missing bindings', () => {
  assert.throws(
    () =>
      renderPass({
        attachTo: 'buildings.flat.fill',
        id: 'raw-layer',
        phase: 'overlay',
        renderer: 'fill',
        style: {opacity: 0.5},
      } as never),
    {code: 'unknown-authoring-key'},
  );
  assert.throws(
    () =>
      refineRenderTarget({
        paint: {'fill-opacity': 0.5},
        renderer: 'fill',
        style: {opacity: 0.5},
        target: 'buildings.flat.fill',
      } as never),
    {code: 'unknown-authoring-key'},
  );
  assert.throws(
    () =>
      compileRenderSelector(
        {
          coerce: 'number',
          fallback: 0,
          field: 'bathymetryMinDepth',
          kind: 'compare',
          operator: 'gte',
          value: 1,
        },
        data,
      ),
    {code: 'missing-field-binding'},
  );
});

test('runtime enforces lowercase semantic roots and dot-free render-stack operation names', () => {
  const passInput = {
    attachTo: 'buildings.flat.fill',
    phase: 'overlay' as const,
    renderer: 'fill' as const,
    style: {opacity: 0.5},
  };
  const pass = renderPass(passInput);

  for (const name of ['softShadow', 'soft-shadow', 'soft_shadow', 'soft2']) {
    assert.doesNotThrow(() => withRenderStack(buildings(), {[name]: pass}));
  }
  for (const name of ['SoftShadow', '2soft', '_soft', 'soft.shadow', 'soft shadow']) {
    assert.throws(() => withRenderStack(buildings(), {[name]: pass}), {
      code: 'invalid-operation-name',
    });
  }

  for (const attachTo of [
    'Buildings.flat.fill',
    '1buildings.flat.fill',
    'buildings..fill',
    '.buildings.fill',
    'buildings flat.fill',
  ]) {
    const configured = withRenderStack(buildings(), {
      invalidTarget: renderPass({...passInput, attachTo}),
    });
    assert.throws(() => compileRenderStack(configured, data), {code: 'invalid-target'});
  }
});

test('builders and runtime enforce the public render-stack and selector budgets', () => {
  const literal = (): TileflowRenderSelector => ({kind: 'literal', value: true});
  const nestedSelector = (nodes: number): TileflowRenderSelector => {
    let selector = literal();
    for (let index = 1; index < nodes; index += 1) {
      selector = {kind: 'not', selector};
    }
    return selector;
  };
  const defineSelectorPass = (selector: TileflowRenderSelector) =>
    renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'overlay',
      renderer: 'fill',
      selector,
      style: {opacity: 0.5},
    });

  assert.deepEqual(tileflowRenderStackLimits, {
    maxMatchBranches: 16,
    maxOperations: 64,
    maxRequirements: tileflowLayerDomains.length,
    maxScalarValues: 16,
    maxSelectorChildren: 16,
    maxSelectorDepth: 64,
    maxSelectorNodes: 256,
    maxStepStops: 16,
  });
  assert.ok(Object.isFrozen(tileflowRenderStackLimits));

  assert.doesNotThrow(() =>
    defineSelectorPass({
      kind: 'all',
      selectors: Array.from({length: tileflowRenderStackLimits.maxSelectorChildren}, literal),
    }),
  );
  assert.throws(
    () =>
      defineSelectorPass({
        kind: 'all',
        selectors: Array.from({length: tileflowRenderStackLimits.maxSelectorChildren + 1}, literal),
      }),
    {code: 'invalid-selector'},
  );

  const scalarValues = Array.from(
    {length: tileflowRenderStackLimits.maxScalarValues},
    (_, index) => `value-${index}`,
  );
  assert.doesNotThrow(() => defineSelectorPass({field: 'class', kind: 'in', values: scalarValues}));
  assert.throws(
    () =>
      defineSelectorPass({
        field: 'class',
        kind: 'in',
        values: [...scalarValues, 'overflow'],
      }),
    {code: 'invalid-selector'},
  );

  const matchBranches = Array.from(
    {length: tileflowRenderStackLimits.maxMatchBranches},
    (_, index) => ({result: index % 2 === 0, values: [`branch-${index}`]}),
  );
  assert.doesNotThrow(() =>
    defineSelectorPass({
      branches: matchBranches,
      field: 'class',
      kind: 'match',
      otherwise: false,
    }),
  );
  assert.throws(
    () =>
      defineSelectorPass({
        branches: [...matchBranches, {result: true, values: ['overflow']}],
        field: 'class',
        kind: 'match',
        otherwise: false,
      }),
    {code: 'invalid-selector'},
  );
  assert.throws(
    () =>
      defineSelectorPass({
        branches: [{result: true, values: [...scalarValues, 'overflow']}],
        field: 'class',
        kind: 'match',
        otherwise: false,
      }),
    {code: 'invalid-selector'},
  );

  const stops = Array.from({length: tileflowRenderStackLimits.maxStepStops}, (_, zoom) => ({
    selector: literal(),
    zoom,
  }));
  assert.doesNotThrow(() => defineSelectorPass({fallback: literal(), kind: 'step', stops}));
  assert.throws(
    () =>
      defineSelectorPass({
        fallback: literal(),
        kind: 'step',
        stops: [...stops, {selector: literal(), zoom: stops.length}],
      }),
    {code: 'invalid-selector'},
  );
  for (const invalidStops of [
    [
      {selector: literal(), zoom: 2},
      {selector: literal(), zoom: 2},
    ],
    [
      {selector: literal(), zoom: 3},
      {selector: literal(), zoom: 2},
    ],
    [{selector: literal(), zoom: Number.POSITIVE_INFINITY}],
  ]) {
    assert.throws(
      () =>
        compileRenderSelector(
          {fallback: literal(), kind: 'step', stops: invalidStops},
          createSemanticDataView(data),
        ),
      {code: 'invalid-selector'},
    );
  }

  assert.doesNotThrow(() =>
    defineSelectorPass(nestedSelector(tileflowRenderStackLimits.maxSelectorDepth)),
  );
  assert.throws(
    () => defineSelectorPass(nestedSelector(tileflowRenderStackLimits.maxSelectorDepth + 1)),
    {code: 'selector-too-deep'},
  );

  const exactNodeBudget: TileflowRenderSelector = {
    kind: 'all',
    selectors: [...Array.from({length: 15}, () => nestedSelector(16)), nestedSelector(15)],
  };
  const overflowingNodeBudget: TileflowRenderSelector = {
    kind: 'all',
    selectors: Array.from({length: 16}, () => nestedSelector(16)),
  };
  assert.doesNotThrow(() => defineSelectorPass(exactNodeBudget));
  assert.throws(() => defineSelectorPass(overflowingNodeBudget), {
    code: 'selector-too-large',
  });

  const pass = renderPass({
    attachTo: 'buildings.flat.fill',
    phase: 'overlay',
    renderer: 'fill',
    requirements: tileflowLayerDomains,
    style: {opacity: 0.5},
  });
  const operations = Object.fromEntries(
    Array.from({length: tileflowRenderStackLimits.maxOperations}, (_, index) => [
      `operation${index}`,
      pass,
    ]),
  );
  assert.doesNotThrow(() => withRenderStack(buildings(), operations));
  const overflowingOperations = {...operations, operationOverflow: pass};
  assert.throws(() => withRenderStack(buildings(), overflowingOperations), {
    code: 'too-many-operations',
  });
  assert.throws(
    () =>
      compileRenderStack(
        {renderStack: overflowingOperations, type: 'buildings'} as never,
        createSemanticDataView(data),
      ),
    {code: 'too-many-operations'},
  );
  assert.throws(
    () =>
      renderPass({
        attachTo: 'buildings.flat.fill',
        phase: 'overlay',
        renderer: 'fill',
        requirements: [...tileflowLayerDomains, 'buildings'],
        style: {opacity: 0.5},
      }),
    {code: 'too-many-requirements'},
  );
});

test('resolved map schema preserves public stacks and the semantic compiler materializes them', () => {
  const configured = withRenderStack(buildings(), {
    editorialWash: renderPass({
      attachTo: 'buildings.flat.fill',
      phase: 'overlay',
      renderer: 'fill',
      style: {
        color: fixed('#ABCDEF', {reason: 'Render-stack schema integration fixture.'}),
        opacity: 0.123,
      },
    }),
  });
  const style = createStyle(extendStreets({modules: {buildings: configured}}), {
    preparedAssets: {
      icons: {
        ids: [
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
        ],
        sprite: '/tileflow/test/streets/sprite',
      },
    },
  });
  const layer = style.layers.find(({id}) => id === 'tileflow-buildings-render-editorialWash');
  assert.equal(layer?.type, 'fill');
  assert.deepEqual(layer?.paint, {'fill-color': '#ABCDEF', 'fill-opacity': 0.123});
  assert.equal(layer?.['source-layer'], 'building');
});

function contribution(
  id: string,
  type: string,
  localOrder: number,
  target: string,
  owner: 'buildings' | 'labels' = 'buildings',
) {
  return {
    kind: 'layer' as const,
    layer: {
      id,
      type,
      ...(type === 'background' ? {} : {source: data.sourceId, 'source-layer': 'building_fixture'}),
    },
    localOrder,
    owner,
    slot: owner === 'buildings' ? ('buildings' as const) : ('symbols' as const),
    target,
  };
}

function compileAndBind(module: Parameters<typeof compileRenderStack>[0]) {
  return bindSemanticReferences(compileRenderStack(module, createSemanticDataView(data)), data);
}

function publicTypeAssertions(): void {
  // @ts-expect-error render passes never accept physical IDs.
  renderPass({
    attachTo: 'buildings.flat.fill',
    id: 'raw-layer',
    phase: 'overlay',
    renderer: 'fill',
    style: {opacity: 0.5},
  });
  // @ts-expect-error fill renderers do not accept line-only width.
  renderPass({
    attachTo: 'buildings.flat.fill',
    phase: 'overlay',
    renderer: 'fill',
    style: {width: 2},
  });
  // @ts-expect-error refinements never accept physical paint patches.
  refineRenderTarget({
    paint: {'fill-opacity': 0.5},
    renderer: 'fill',
    style: {opacity: 0.5},
    target: 'buildings.flat.fill',
  });
}

void publicTypeAssertions;
