import {
  createPropertyExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundaryChoropleth,
  choroplethColorExpression,
  choroplethScale,
  createBoundaryLookup,
  createStyle,
  joinBoundaryRows,
  parseBoundaryLookupCsv,
  resolveBoundaryAreas,
  tileflowBoundaryAreasV1Schema,
  tileflowBoundaryFamilies,
  type TileflowBoundaryAreas,
} from '../src';
import {createBoundaryFeatureState, type TileflowFeatureStateMap} from '../src/browser';
import {
  madridLookupCsv,
  madridMunicipalityFeatures,
  madridRegionFeature,
  madridRowsByIne,
} from './fixtures/boundaries-spain-ine';
import {extendStreets} from './map-fixture';

const preparedAssets = {
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
} as const;

const unemployment = choroplethScale.step('#fef0d9', [
  [8, '#fdcc8a'],
  [10, '#fc8d59'],
  [12, '#d7301f'],
]);
const missing = '#d9d9d9';
const madridRowsByRef = madridRowsByIne.map(({ine, value}) => ({key: `ES:INE:${ine}`, value}));

type Feature = {id: number; properties: Record<string, unknown>};
type Layer = Record<string, unknown> & {id: string};

function colorOf(
  paint: unknown,
  feature: Feature,
  state: Record<string, unknown> = {},
  zoom = 9,
): string {
  const parsed = createPropertyExpression(paint, latest.paint_fill['fill-color']);
  if (parsed.result !== 'success') {
    throw new Error(parsed.value.map(({message}) => message).join('; '));
  }
  const color = parsed.value.evaluate(
    {zoom},
    {id: feature.id, properties: feature.properties, type: 'Polygon'},
    state,
  ) as {toString(): string};
  return color.toString();
}

function passes(filter: unknown, feature: Feature, zoom = 9): boolean {
  return featureFilter(filter).filter({zoom}, {
    id: feature.id,
    properties: feature.properties,
    type: 3,
  } as never);
}

function compile(boundaryAreas: TileflowBoundaryAreas, overlays = {}) {
  return createStyle(extendStreets({boundaryAreas, overlays}), {preparedAssets});
}

test('resolves the Boundaries family to its TileJSON, source ID and attribution', () => {
  assert.equal(resolveBoundaryAreas(undefined), undefined);
  assert.equal(resolveBoundaryAreas(false), undefined);

  const resolved = resolveBoundaryAreas({family: 'boundaries'}, 'https://api.example.test/base')!;
  assert.equal(resolved.sourceId, 'tileflow-boundaries');
  assert.deepEqual(resolved.source, {
    attribution: '© OpenStreetMap contributors',
    type: 'vector',
    url: 'https://api.example.test/tiles/boundaries/tiles.json',
  });
  assert.deepEqual(resolved.identity, {
    family: 'boundaries',
    kind: 'tileflow-boundaries',
    product: 'boundaries-v1',
    schemaVersion: 1,
    sourceId: 'tileflow-boundaries',
    url: 'https://api.example.test/tiles/boundaries/tiles.json',
  });

  const promoted = resolveBoundaryAreas({
    family: 'boundaries',
    promoteId: 'ref',
    url: 'pmtiles://https://example.test/boundaries-es.pmtiles',
  })!;
  assert.deepEqual(promoted.source.promoteId, {boundary_area: 'ref', boundary_label: 'ref'});
  assert.equal(promoted.source.url, 'pmtiles://https://example.test/boundaries-es.pmtiles');
  assert.equal(promoted.source.attribution, tileflowBoundaryFamilies.boundaries.attribution);

  assert.throws(
    () => resolveBoundaryAreas({family: 'boundaries-official'} as never),
    /Unknown Tileflow Boundaries family/,
  );
  assert.throws(
    () => resolveBoundaryAreas({family: 'boundaries', promoteId: 'wikidata'} as never),
    /promoteId/,
  );
});

test('colors Spanish municipalities by INE code from values compiled into the style', () => {
  const style = compile(
    {family: 'boundaries'},
    {
      unemployment: boundaryChoropleth({
        classes: ['municipality'],
        countries: ['es'],
        id: 'unemployment',
        missingColor: missing,
        outline: {color: '#ffffff', width: 0.75},
        scale: unemployment,
        values: {joinBy: 'ref', rows: madridRowsByRef},
      }),
    },
  );

  assert.deepEqual(style.sources['tileflow-boundaries'], {
    attribution: '© OpenStreetMap contributors',
    type: 'vector',
    url: 'https://api.tileflow.dev/tiles/boundaries/tiles.json',
  });
  const identities = style.metadata?.['tileflow:sources'] as Record<string, unknown>;
  assert.equal(
    (identities['tileflow-boundaries'] as {product: string}).product,
    tileflowBoundaryAreasV1Schema.product,
  );
  assert.deepEqual(validateStyleMin(style as never), []);

  const layers = style.layers as Layer[];
  const ids = layers.map(({id}) => id);
  const fill = layers.find(({id}) => id === 'unemployment-fill')!;
  assert.equal(fill.source, 'tileflow-boundaries');
  assert.equal(fill['source-layer'], 'boundary_area');
  assert.equal(fill.minzoom, 8);
  assert.equal(ids.indexOf('unemployment-outline'), ids.indexOf('unemployment-fill') + 1);
  assert.ok(ids.indexOf('unemployment-fill') < ids.indexOf('tileflow-label-road-junction'));

  const paint = (fill.paint as Record<string, unknown>)['fill-color'];
  const colors = Object.fromEntries(
    madridMunicipalityFeatures.map((feature) => [feature.name, colorOf(paint, feature)]),
  );
  assert.deepEqual(colors, {
    'Alcalá de Henares': 'rgba(215,48,31,1)',
    Alcobendas: 'rgba(254,240,217,1)',
    Alcorcón: 'rgba(252,141,89,1)',
    Fuenlabrada: 'rgba(215,48,31,1)',
    Getafe: 'rgba(252,141,89,1)',
    Leganés: 'rgba(215,48,31,1)',
    Madrid: 'rgba(253,204,138,1)',
    Móstoles: 'rgba(217,217,217,1)',
  });
  for (const feature of madridMunicipalityFeatures) assert.ok(passes(fill.filter, feature));
  assert.equal(passes(fill.filter, madridRegionFeature), false);
  assert.equal(
    passes(fill.filter, {
      id: 1,
      properties: {...madridRegionFeature.properties, class: 'municipality', iso_3166_1: 'PT'},
    }),
    false,
  );
});

test('colors areas from feature-state when no values are compiled', () => {
  const overlay = boundaryChoropleth({
    classes: ['municipality'],
    id: 'live',
    missingColor: missing,
    scale: choroplethScale.linear([
      [0, '#ffffff'],
      [10, '#ff0000'],
    ]),
    state: 'rate',
  });
  const [fill] = overlay.layers as unknown as Layer[];
  const paint = (fill!.paint as Record<string, unknown>)['fill-color'];
  const madrid = madridMunicipalityFeatures[0]!;
  assert.equal(colorOf(paint, madrid, {rate: 5}), 'rgba(255,128,128,1)');
  assert.equal(colorOf(paint, madrid, {rate: 20}), 'rgba(255,0,0,1)');
  assert.equal(colorOf(paint, madrid), 'rgba(217,217,217,1)');
  assert.equal(colorOf(paint, madrid, {rate: 'n/a'}), 'rgba(217,217,217,1)');
  assert.deepEqual(fill!.metadata, {
    'tileflow:boundaryChoropleth': {family: 'boundaries', state: 'rate'},
  });
});

test('colors categories from static values and from feature-state', () => {
  const scale = choroplethScale.categories({left: '#d7191c', right: '#2c7bb6'});
  const madrid = madridMunicipalityFeatures[0]!;
  const getafe = madridMunicipalityFeatures[5]!;
  const staticOverlay = boundaryChoropleth({
    classes: ['municipality'],
    id: 'party',
    missingColor: missing,
    scale,
    values: {
      joinBy: 'id',
      rows: [
        {key: madrid.id, value: 'right'},
        {key: getafe.id, value: 'left'},
        {key: 103, value: 'other'},
      ],
    },
  });
  const staticPaint = ((staticOverlay.layers[0] as Layer).paint as Record<string, unknown>)[
    'fill-color'
  ];
  assert.equal(colorOf(staticPaint, madrid), 'rgba(44,123,182,1)');
  assert.equal(colorOf(staticPaint, getafe), 'rgba(215,25,28,1)');
  assert.equal(colorOf(staticPaint, madridMunicipalityFeatures[2]!), 'rgba(217,217,217,1)');

  const statePaint = choroplethColorExpression(scale, ['feature-state', 'value'], missing);
  assert.equal(colorOf(statePaint, madrid, {value: 'left'}), 'rgba(215,25,28,1)');
  assert.equal(colorOf(statePaint, madrid), 'rgba(217,217,217,1)');
});

test('validates scales, choropleth options and joins against the map declaration', () => {
  assert.throws(() => choroplethScale.linear([[0, '#fff']]), /at least two/);
  assert.throws(
    () =>
      choroplethScale.step('#fff', [
        [5, '#eee'],
        [5, '#ddd'],
      ]),
    /strictly increasing/,
  );
  assert.throws(
    () => boundaryChoropleth({classes: ['ward' as never], id: 'x', scale: unemployment}),
    /Unknown Boundaries class/,
  );
  assert.throws(
    () =>
      boundaryChoropleth({
        classes: ['municipality'],
        id: 'x',
        scale: unemployment,
        values: {joinBy: 'ref', rows: [{key: 'ES:INE:28079', value: 'high'}]},
      }),
    /numeric scale needs finite number values/,
  );
  assert.equal(
    boundaryChoropleth({
      classes: ['province_or_county'],
      id: 'x',
      scale: unemployment,
      tiers: ['secondary'],
    }).layers[0]!.minzoom,
    7,
  );

  const overlay = boundaryChoropleth({
    classes: ['municipality'],
    id: 'by-id',
    scale: unemployment,
    values: {joinBy: 'id', rows: [{key: 101, value: 9}]},
  });
  assert.throws(
    () => createStyle(extendStreets({overlays: {'by-id': overlay}}), {preparedAssets}),
    (error: Error & {code?: string}) => error.code === 'TF_BOUNDARY_AREAS_REQUIRED',
  );
  assert.throws(
    () => compile({family: 'boundaries', promoteId: 'ref'}, {'by-id': overlay}),
    (error: Error & {code?: string}) => error.code === 'TF_BOUNDARY_CHOROPLETH_JOIN',
  );

  const parent = extendStreets({boundaryAreas: {family: 'boundaries'}});
  const child = extendStreets({boundaryAreas: false});
  assert.ok(createStyle(parent, {preparedAssets}).sources['tileflow-boundaries']);
  assert.equal(createStyle(child, {preparedAssets}).sources['tileflow-boundaries'], undefined);
});

test('parses the lookup table and joins rows by codes the polygons do not carry', () => {
  const rows = parseBoundaryLookupCsv(madridLookupCsv);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[4], {
    admin_level: 8,
    class: 'municipality',
    class_tier: 'primary',
    id: 108,
    iso_3166_1: 'ES',
    name: 'Móstoles, "Madrid"',
    ref: 'ES:INE:28092',
    wikidata: 'Q19960',
  });
  const lookup = createBoundaryLookup(rows);

  const byWikidata = joinBoundaryRows(
    [
      {key: 'q2807', value: 3},
      {key: 'Q19960', value: 4},
      {key: 'Q2807', value: 5},
      {key: 'Q0', value: 6},
    ],
    {joinBy: 'wikidata', lookup},
  );
  assert.deepEqual(byWikidata.rows, [
    {key: 101, value: 5},
    {key: 108, value: 4},
  ]);
  assert.equal(byWikidata.joinBy, 'id');
  assert.deepEqual(byWikidata.duplicates, ['Q2807']);
  assert.deepEqual(byWikidata.unmatched, ['Q0']);

  // The Community of Madrid is a region and, by the single-level rule, a province: one ID, two refs.
  const region = joinBoundaryRows([{key: 'es-md', value: 1}], {joinBy: 'iso_3166_2', lookup});
  assert.deepEqual(region.rows, [{key: 100, value: 1}]);
  const regionRefs = joinBoundaryRows([{key: 'ES-MD', value: 1}], {
    joinBy: 'iso_3166_2',
    lookup,
    to: 'ref',
  });
  assert.deepEqual(regionRefs.rows, [
    {key: 'ES-MD', value: 1},
    {key: 'ES:INE:28', value: 1},
  ]);
  const provinceOnly = joinBoundaryRows([{key: 'ES-MD', value: 1}], {
    classes: ['province_or_county'],
    joinBy: 'iso_3166_2',
    lookup,
    to: 'ref',
  });
  assert.deepEqual(provinceOnly.rows, [{key: 'ES:INE:28', value: 1}]);

  const ambiguous = joinBoundaryRows([{key: 'ES30', value: 1}], {
    joinBy: 'nuts',
    lookup: createBoundaryLookup([
      {class: 'region', id: 1, nuts: 'ES30'},
      {class: 'region', id: 2, nuts: 'ES30'},
    ]),
  });
  assert.deepEqual(ambiguous.ambiguous, ['ES30']);
  assert.deepEqual(ambiguous.rows, []);

  const byRef = joinBoundaryRows(madridRowsByRef, {joinBy: 'ref', lookup});
  assert.deepEqual(byRef.rows, [
    {key: 101, value: 9.8},
    {key: 102, value: 12.4},
  ]);
  assert.equal(byRef.unmatched.length, 5);
  assert.deepEqual(
    joinBoundaryRows(madridRowsByRef, {joinBy: 'ref', to: 'ref'}).rows,
    madridRowsByRef,
  );
  assert.throws(() => joinBoundaryRows(madridRowsByRef, {joinBy: 'ref'}), /lookup table/);
  assert.throws(() => parseBoundaryLookupCsv('id,class\n1,"region'), /quoted field/);
  assert.throws(() => parseBoundaryLookupCsv('id,class\n1'), /expected 2/);
});

function fakeMap(promoteId?: string) {
  const states = new Map<string, Record<string, unknown>>();
  const listeners = new Set<() => void>();
  let sourceLoaded = true;
  const key = (target: {id?: number | string; sourceLayer?: string}) =>
    `${target.sourceLayer}/${String(target.id)}`;
  const map: TileflowFeatureStateMap = {
    getSource: (id) => (sourceLoaded && id === 'tileflow-boundaries' ? {} : undefined),
    getStyle: () => ({
      sources: {'tileflow-boundaries': promoteId ? {promoteId: {boundary_area: promoteId}} : {}},
    }),
    off: (_type, listener) => listeners.delete(listener),
    on: (_type, listener) => listeners.add(listener),
    removeFeatureState: (target, stateKey) => {
      const current = states.get(key(target));
      if (current && stateKey) delete current[stateKey];
      if (current && Object.keys(current).length === 0) states.delete(key(target));
    },
    setFeatureState: (target, state) => {
      states.set(key(target), {...states.get(key(target)), ...state});
    },
  };
  return {
    listeners,
    map,
    reloadStyle() {
      sourceLoaded = false;
      states.clear();
      for (const listener of listeners) listener();
      sourceLoaded = true;
      for (const listener of listeners) listener();
    },
    states,
  };
}

test('keeps feature-state in sync with rows and across style reloads', () => {
  const fake = fakeMap();
  const controller = createBoundaryFeatureState(fake.map, {labels: true});
  controller.set({
    joinBy: 'id',
    rows: [
      {key: 101, value: 9.8},
      {key: 102, value: 12.4},
      {key: 103, value: null},
    ],
  });
  assert.deepEqual(Object.fromEntries(fake.states), {
    'boundary_area/101': {value: 9.8},
    'boundary_area/102': {value: 12.4},
    'boundary_label/101': {value: 9.8},
    'boundary_label/102': {value: 12.4},
  });

  controller.set({joinBy: 'id', rows: [{key: 102, value: 7}]});
  assert.deepEqual(Object.fromEntries(fake.states), {
    'boundary_area/102': {value: 7},
    'boundary_label/102': {value: 7},
  });

  fake.reloadStyle();
  assert.deepEqual(fake.states.get('boundary_area/102'), {value: 7});

  assert.throws(
    () => controller.set({joinBy: 'ref', rows: madridRowsByRef}),
    /keyed by id; join the rows to id first/,
  );
  controller.clear();
  assert.equal(fake.states.size, 0);
  controller.dispose();
  assert.equal(fake.listeners.size, 0);
  assert.throws(() => controller.set({joinBy: 'id', rows: []}), /disposed/);

  const promoted = fakeMap('ref');
  const byRef = createBoundaryFeatureState(promoted.map, {state: 'rate'});
  byRef.set({joinBy: 'ref', rows: madridRowsByRef.slice(0, 1)});
  assert.deepEqual(Object.fromEntries(promoted.states), {
    'boundary_area/ES:INE:28079': {rate: 9.8},
  });
});
