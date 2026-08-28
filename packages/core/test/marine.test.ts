import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bathymetry,
  createStyle,
  fixed,
  inferTileflowSourceRequirements,
  parseTileflowMap,
  resolveMarine,
  tileflowBathymetryDemSourceId,
  tileflowBathymetrySourceId,
  tileflowBathymetryV1Schema,
  tileflowNauticalSourceId,
  tileflowNauticalV1Schema,
} from '../src';
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

test('resolves marine shorthands to stable independent TileJSON sources', () => {
  assert.deepEqual(resolveMarine(undefined), undefined);
  assert.deepEqual(resolveMarine('none'), {});

  const chart = resolveMarine('chart', 'https://api.example.test/base')!;
  assert.equal(chart.bathymetry?.display, 'bands');
  assert.equal(chart.bathymetry?.vector?.sourceId, tileflowBathymetrySourceId);
  assert.equal(
    chart.bathymetry?.vector?.source.url,
    'https://api.example.test/tiles/bathymetry/tiles.json',
  );
  assert.equal(chart.bathymetry?.relief, undefined);
  assert.equal(chart.nautical?.sourceId, tileflowNauticalSourceId);
  assert.equal(chart.nautical?.source.url, 'https://api.example.test/tiles/nautical/tiles.json');
  assert.equal(chart.nautical?.source.attribution, undefined);
  assert.equal(chart.bathymetry?.vector?.identity.product, 'bathymetry-v1');
  assert.equal(chart.nautical?.identity.product, 'nautical-v1');

  assert.equal(resolveMarine('bathymetry')?.nautical, undefined);
  assert.equal(resolveMarine('nautical')?.bathymetry, undefined);

  assert.deepEqual(tileflowBathymetryV1Schema.layers, {
    bands: 'bathymetry',
    contours: 'bathymetry_contour',
    coverage: 'bathymetry_coverage',
    landforms: 'seafloor_landform',
    waterNames: 'water_name',
  });
  assert.deepEqual(tileflowBathymetryV1Schema.fields, {
    minDepth: 'min_depth',
    sortKey: 'sort_key',
  });
  assert.deepEqual(tileflowBathymetryV1Schema.requiredLayers, ['bands']);
  assert.deepEqual(tileflowBathymetryV1Schema.optionalLayers, [
    'contours',
    'coverage',
    'landforms',
    'waterNames',
  ]);

  assert.deepEqual(tileflowNauticalV1Schema.layers, {
    aids: 'aid',
    coverage: 'coverage',
    hazards: 'hazard',
    lights: 'light',
    navigationAreas: 'navigation_area',
    reefs: 'reef',
    soundings: 'sounding',
    wrecks: 'wreck',
  });
  for (const field of [
    'cell',
    'coverage',
    'edition',
    'licence',
    'provider',
    'provenance',
    'scale',
    'update',
  ] as const) {
    assert.equal(tileflowNauticalV1Schema.fields[field], field);
  }
  assert.deepEqual(tileflowNauticalV1Schema.geometryTypes, {
    aids: ['Point'],
    coverage: ['Polygon'],
    hazards: ['Point', 'Polygon'],
    lights: ['Point'],
    navigationAreas: ['Polygon'],
    reefs: ['Polygon'],
    soundings: ['Point'],
    wrecks: ['Point', 'Polygon'],
  });
});

test('loads only the physical Bathymetry sources required by each display', () => {
  const bands = createStyle(
    extendStreets({
      marine: {bathymetry: bathymetry({display: 'bands'}), nautical: false},
    }),
    {preparedAssets},
  );
  assert.equal(bands.sources[tileflowBathymetrySourceId]?.type, 'vector');
  assert.equal(bands.sources[tileflowBathymetryDemSourceId], undefined);
  assert.equal(
    bands.layers.some(({id}) => id === 'streets-bathymetry-color-relief'),
    false,
  );
  assert.equal(
    bands.layers.some(({id}) => id === 'streets-bathymetry-relief'),
    false,
  );

  const relief = createStyle(
    extendStreets({
      marine: {bathymetry: bathymetry({display: 'relief'}), nautical: false},
    }),
    {apiBaseUrl: 'http://127.0.0.1:4888', preparedAssets},
  );
  assert.equal(relief.sources[tileflowBathymetrySourceId], undefined);
  assert.deepEqual(relief.sources[tileflowBathymetryDemSourceId], {
    encoding: 'terrarium',
    tileSize: 512,
    type: 'raster-dem',
    url: 'http://127.0.0.1:4888/tiles/bathymetry/dem/tiles.json',
  });
  assert.equal(
    relief.layers.some(({id}) => id === 'streets-bathymetry'),
    false,
  );

  const hybrid = createStyle(
    extendStreets({
      marine: {
        bathymetry: bathymetry({
          display: 'hybrid',
          relief: {
            multidirectional: true,
            opacity: fixed(0.2, {reason: 'Exercise the public Bathymetry relief opacity'}),
          },
        }),
        nautical: false,
      },
    }),
    {preparedAssets},
  );
  assert.equal(hybrid.sources[tileflowBathymetrySourceId]?.type, 'vector');
  assert.equal(hybrid.sources[tileflowBathymetryDemSourceId]?.type, 'raster-dem');

  const byId = new Map(hybrid.layers.map((layer) => [layer.id, layer]));
  const colorRelief = byId.get('streets-bathymetry-color-relief');
  const hillshade = byId.get('streets-bathymetry-relief');
  assert.equal(colorRelief?.type, 'color-relief');
  assert.equal(colorRelief?.source, tileflowBathymetryDemSourceId);
  assert.match(JSON.stringify(colorRelief?.paint?.['color-relief-color']), /elevation/u);
  assert.equal(colorRelief?.paint?.['color-relief-opacity'], 0.2);
  assert.equal(colorRelief?.paint?.resampling, 'linear');
  assert.equal(hillshade?.type, 'hillshade');
  assert.equal(hillshade?.source, tileflowBathymetryDemSourceId);
  assert.equal(hillshade?.paint?.['hillshade-method'], 'multidirectional');
  assert.deepEqual(hillshade?.paint?.['hillshade-illumination-direction'], [270, 315, 0, 45]);
  assert.deepEqual(hillshade?.paint?.['hillshade-illumination-altitude'], [45, 45, 45, 45]);
  assert.deepEqual(validateStyleMin(hybrid as never), []);

  const vectorColor = byId.get('streets-bathymetry')?.paint?.['fill-color'] as unknown[];
  assert.deepEqual(
    vectorColor.slice(3).filter((_, index) => index % 2 === 0),
    [-11_000, -8_000, -6_000, -4_000, -2_000, -1_000, -500, -200, -100, -50, -20, -10, 0],
  );

  const requirements = inferTileflowSourceRequirements(hybrid);
  assert.deepEqual(requirements.rasterDemSources, {
    [tileflowBathymetryDemSourceId]: {
      encoding: 'terrarium',
      sourceId: tileflowBathymetryDemSourceId,
      tileSize: 512,
      type: 'raster-dem',
    },
  });
  assert.deepEqual(hybrid.metadata?.['tileflow:sourceRequirements'], requirements);
  const identities = hybrid.metadata?.['tileflow:sources'] as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(identities[tileflowBathymetryDemSourceId], {
    encoding: 'terrarium',
    kind: 'tileflow-bathymetry-dem',
    product: 'bathymetry-v1',
    schemaVersion: 1,
    sourceId: tileflowBathymetryDemSourceId,
    tileSize: 512,
    url: 'https://api.tileflow.dev/tiles/bathymetry/dem/tiles.json',
  });
});

test('supports explicit Bathymetry DEM overrides without treating it as a vector source', () => {
  const marine = resolveMarine(
    {
      bathymetry: bathymetry({
        display: 'relief',
        relief: {
          attribution: 'Bathymetry DEM fixture',
          encoding: 'mapbox',
          sourceId: 'fixture-bathymetry-dem',
          tileSize: 256,
          url: 'https://depth.example.test/dem/tiles.json',
        },
      }),
      nautical: false,
    },
    'https://api.example.test',
  )!;

  assert.equal(marine.bathymetry?.vector, undefined);
  assert.deepEqual(marine.bathymetry?.relief?.source, {
    attribution: 'Bathymetry DEM fixture',
    encoding: 'mapbox',
    tileSize: 256,
    type: 'raster-dem',
    url: 'https://depth.example.test/dem/tiles.json',
  });
  assert.equal(marine.bathymetry?.relief?.sourceId, 'fixture-bathymetry-dem');
});

test('supports advanced source overrides while preserving independent selection', () => {
  const map = extendStreets({
    marine: {
      bathymetry: {
        attribution: 'Bathymetry fixture',
        sourceId: 'fixture-depth',
        url: 'https://depth.example.test/tiles.json',
      },
      nautical: false,
    },
  });
  assert.deepEqual(parseTileflowMap(map).marine, map.marine);

  const style = createStyle(map, {preparedAssets});
  assert.equal(style.sources['fixture-depth']?.url, 'https://depth.example.test/tiles.json');
  assert.equal(style.sources['fixture-depth']?.attribution, 'Bathymetry fixture');
  assert.equal(style.sources[tileflowNauticalSourceId], undefined);
  assert.equal(style.layers.find(({id}) => id === 'streets-bathymetry')?.source, 'fixture-depth');
  assert.equal(
    style.layers.some(({id}) => String(id).startsWith('streets-nautical-')),
    false,
  );
});

test('prefers bathymetry sidecar, preserves the implicit World fallback, and honors none', () => {
  const fallback = createStyle(extendStreets(), {preparedAssets});
  assert.equal(fallback.layers.find(({id}) => id === 'streets-bathymetry')?.source, 'tileflow');

  const sidecar = createStyle(extendStreets({marine: 'bathymetry'}), {preparedAssets});
  assert.equal(
    sidecar.layers.find(({id}) => id === 'streets-bathymetry')?.source,
    tileflowBathymetrySourceId,
  );

  const disabled = createStyle(extendStreets({marine: 'none'}), {preparedAssets});
  assert.equal(
    disabled.layers.some(({id}) => id === 'streets-bathymetry'),
    false,
  );
  assert.equal(
    disabled.layers.some(({id}) => id === 'streets-water'),
    true,
  );
});

test('chart composes all nautical semantics and publishes per-source metadata', () => {
  const style = createStyle(extendStreets({marine: 'chart'}), {preparedAssets});
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

  for (const [id, sourceLayer] of [
    ['streets-nautical-soundings', 'sounding'],
    ['streets-nautical-aids-marker', 'aid'],
    ['streets-nautical-aids', 'aid'],
    ['streets-nautical-lighthouses-marker', 'aid'],
    ['streets-nautical-lighthouses', 'aid'],
    ['streets-nautical-lights-marker', 'light'],
    ['streets-nautical-lights', 'light'],
    ['streets-nautical-hazards', 'hazard'],
    ['streets-nautical-wrecks', 'wreck'],
    ['streets-nautical-hazard-areas', 'hazard'],
    ['streets-nautical-hazard-areas-outline', 'hazard'],
    ['streets-nautical-wreck-areas', 'wreck'],
    ['streets-nautical-wreck-areas-outline', 'wreck'],
    ['streets-nautical-coverage-labels', 'coverage'],
    ['streets-nautical-navigation-area-labels', 'navigation_area'],
    ['streets-nautical-reef-labels', 'reef'],
    ['streets-nautical-hazard-area-labels', 'hazard'],
    ['streets-nautical-wreck-area-labels', 'wreck'],
    ['streets-nautical-coverage-outline', 'coverage'],
    ['streets-nautical-navigation-areas', 'navigation_area'],
    ['streets-nautical-navigation-areas-outline', 'navigation_area'],
    ['streets-nautical-reefs', 'reef'],
    ['streets-nautical-reefs-outline', 'reef'],
  ] as const) {
    assert.equal(byId.get(id)?.source, tileflowNauticalSourceId, `${id} source`);
    assert.equal(byId.get(id)?.['source-layer'], sourceLayer, `${id} source-layer`);
  }
  assert.match(JSON.stringify(byId.get('streets-nautical-soundings')?.layout), /depth/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-aids')?.layout), /subclass/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-aids')?.layout), /class/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-aids')?.filter), /lighthouse/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-lighthouses')?.filter), /lighthouse/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-lights')?.layout), /character/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-lights')?.layout), /range_nm/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-lights')?.layout), /direction/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-lights')?.layout), /name/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-hazards')?.layout), /name/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-hazards')?.layout), /depth/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-wrecks')?.layout), /name/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-wrecks')?.layout), /depth/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-coverage-labels')?.layout), /provider/u);
  assert.match(JSON.stringify(byId.get('streets-nautical-coverage-labels')?.filter), /provider/u);
  assert.match(
    JSON.stringify(byId.get('streets-nautical-navigation-area-labels')?.layout),
    /name/u,
  );
  assert.match(
    JSON.stringify(byId.get('streets-nautical-navigation-area-labels')?.filter),
    /class/u,
  );
  for (const id of ['streets-nautical-hazards', 'streets-nautical-wrecks']) {
    assert.match(JSON.stringify(byId.get(id)?.filter), /Point/u, `${id} point geometry`);
  }
  for (const id of ['streets-nautical-hazard-areas', 'streets-nautical-wreck-areas']) {
    assert.match(JSON.stringify(byId.get(id)?.filter), /Polygon/u, `${id} polygon geometry`);
  }
  assert.deepEqual(validateStyleMin(style as never), []);

  const identities = style.metadata?.['tileflow:sources'] as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(identities.tileflow?.kind, 'tileflow-world');
  assert.equal(identities[tileflowBathymetrySourceId]?.product, 'bathymetry-v1');
  assert.equal(identities[tileflowNauticalSourceId]?.product, 'nautical-v1');

  const requirements = inferTileflowSourceRequirements(style);
  assert.deepEqual(Object.keys(requirements.sources), [
    'tileflow',
    tileflowBathymetrySourceId,
    tileflowNauticalSourceId,
  ]);
  const bathymetry = requirements.sources[tileflowBathymetrySourceId]!;
  assert.deepEqual(
    bathymetry.sourceLayers.map(({id}) => id),
    ['bathymetry'],
  );
  assert.deepEqual(
    bathymetry.sourceLayers[0]?.fields.map(({name}) => name),
    ['min_depth', 'sort_key'],
  );
  const nautical = requirements.sources[tileflowNauticalSourceId]!;
  assert.deepEqual(
    nautical.sourceLayers.map(({id}) => id),
    ['aid', 'coverage', 'hazard', 'light', 'navigation_area', 'reef', 'sounding', 'wreck'],
  );
  assert.deepEqual(style.metadata?.['tileflow:sourceRequirements'], requirements);
});

test('rejects auxiliary source ID collisions', () => {
  assert.throws(
    () =>
      createStyle(
        extendStreets({
          marine: {bathymetry: {sourceId: 'shared'}, nautical: {sourceId: 'shared'}},
        }),
        {preparedAssets},
      ),
    /conflicts with another marine source/u,
  );
  assert.throws(
    () =>
      createStyle(extendStreets({marine: {bathymetry: {sourceId: 'tileflow'}, nautical: false}}), {
        preparedAssets,
      }),
    /conflicts with the primary vector source/u,
  );
  assert.throws(
    () =>
      createStyle(
        extendStreets({
          marine: {
            bathymetry: bathymetry({
              display: 'hybrid',
              relief: {sourceId: 'shared'},
              sourceId: 'shared',
            }),
            nautical: false,
          },
        }),
        {preparedAssets},
      ),
    /conflicts with another marine source/u,
  );
  assert.throws(
    () =>
      createStyle(
        extendStreets({
          marine: {
            bathymetry: bathymetry({
              display: 'relief',
              relief: {sourceId: 'tileflow'},
            }),
            nautical: false,
          },
        }),
        {preparedAssets},
      ),
    /conflicts with the primary vector source/u,
  );
});
