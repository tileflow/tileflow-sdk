import {expression, featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bathymetry,
  createStyle,
  defineTheme,
  disable,
  fixed,
  inferTileflowSourceRequirements,
  parseTileflowMap,
  readTileflowNotices,
  resolveMarine,
  tileflowBathymetryDemSourceId,
  tileflowBathymetrySourceId,
  tileflowBathymetryV1Schema,
  tileflowNauticalNotice,
  tileflowNauticalSourceId,
  tileflowNauticalV1Schema,
  tileflowNoticesMetadataKey,
} from '../src';
import {extendStreets, testLightTheme} from './map-fixture';

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
    class: 'class',
    depth: 'depth',
    id: 'id',
    maxZoom: 'max_zoom',
    minDepth: 'min_depth',
    minZoom: 'min_zoom',
    name: 'name',
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
  assert.equal(tileflowNauticalV1Schema.fields.minZoom, 'min_zoom');
  assert.equal(tileflowNauticalV1Schema.fields.rank, 'rank');
  assert.equal(tileflowNauticalV1Schema.fields.waterLevel, 'water_level');
  assert.equal(tileflowNauticalV1Schema.fields.label, 'label');
  assert.deepEqual(tileflowNauticalV1Schema.geometryTypes, {
    aids: ['Point'],
    coverage: ['Polygon'],
    hazards: ['Point', 'LineString', 'Polygon'],
    lights: ['Point'],
    navigationAreas: ['Point', 'LineString', 'Polygon'],
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
    bands.layers.some(({id}) => id === 'tileflow-bathymetry-color-relief'),
    false,
  );
  assert.equal(
    bands.layers.some(({id}) => id === 'tileflow-bathymetry-relief'),
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
    relief.layers.some(({id}) => id === 'tileflow-bathymetry'),
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
  const colorRelief = byId.get('tileflow-bathymetry-color-relief');
  const hillshade = byId.get('tileflow-bathymetry-relief');
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

  const vectorColor = byId.get('tileflow-bathymetry')?.paint?.['fill-color'] as unknown[];
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
  assert.equal(style.layers.find(({id}) => id === 'tileflow-bathymetry')?.source, 'fixture-depth');
  assert.equal(
    style.layers.some(({id}) => String(id).startsWith('tileflow-nautical-')),
    false,
  );
});

test('prefers bathymetry sidecar, preserves the implicit World fallback, and honors none', () => {
  const fallback = createStyle(extendStreets(), {preparedAssets});
  assert.equal(fallback.layers.find(({id}) => id === 'tileflow-bathymetry')?.source, 'tileflow');

  const sidecar = createStyle(extendStreets({marine: 'bathymetry'}), {preparedAssets});
  assert.equal(
    sidecar.layers.find(({id}) => id === 'tileflow-bathymetry')?.source,
    tileflowBathymetrySourceId,
  );

  const disabled = createStyle(extendStreets({marine: 'none'}), {preparedAssets});
  assert.equal(
    disabled.layers.some(({id}) => id === 'tileflow-bathymetry'),
    false,
  );
  assert.equal(
    disabled.layers.some(({id}) => id === 'tileflow-water'),
    true,
  );
});

const nauticalLayers = [
  ['tileflow-nautical-coverage', 'coverage', 'fill'],
  ['tileflow-nautical-navigation-areas', 'navigation_area', 'fill'],
  ['tileflow-nautical-navigation-areas-outline', 'navigation_area', 'line'],
  ['tileflow-nautical-reefs', 'reef', 'fill'],
  ['tileflow-nautical-reefs-outline', 'reef', 'line'],
  ['tileflow-nautical-cables', 'navigation_area', 'line'],
  ['tileflow-nautical-routes', 'navigation_area', 'line'],
  ['tileflow-nautical-hazard-areas', 'hazard', 'fill'],
  ['tileflow-nautical-hazard-areas-outline', 'hazard', 'line'],
  ['tileflow-nautical-wreck-areas', 'wreck', 'fill'],
  ['tileflow-nautical-wreck-areas-outline', 'wreck', 'line'],
  ['tileflow-nautical-navigation-area-labels', 'navigation_area', 'symbol'],
  ['tileflow-nautical-reef-labels', 'reef', 'symbol'],
  ['tileflow-nautical-hazard-area-labels', 'hazard', 'symbol'],
  ['tileflow-nautical-wreck-area-labels', 'wreck', 'symbol'],
  ['tileflow-nautical-soundings', 'sounding', 'symbol'],
  ['tileflow-nautical-hazards-marker', 'hazard', 'circle'],
  ['tileflow-nautical-hazards', 'hazard', 'symbol'],
  ['tileflow-nautical-wrecks', 'wreck', 'symbol'],
  ['tileflow-nautical-harbours-marker', 'navigation_area', 'circle'],
  ['tileflow-nautical-harbours', 'navigation_area', 'symbol'],
  ['tileflow-nautical-aids-marker', 'aid', 'circle'],
  ['tileflow-nautical-aids', 'aid', 'symbol'],
  ['tileflow-nautical-beacons-marker', 'aid', 'circle'],
  ['tileflow-nautical-beacons', 'aid', 'symbol'],
  ['tileflow-nautical-lights-marker', 'light', 'circle'],
  ['tileflow-nautical-lights', 'light', 'symbol'],
  ['tileflow-nautical-buoys-marker', 'aid', 'circle'],
  ['tileflow-nautical-buoys', 'aid', 'symbol'],
  ['tileflow-nautical-lighthouses-marker', 'aid', 'circle'],
  ['tileflow-nautical-lighthouses', 'aid', 'symbol'],
  ['tileflow-nautical-ports-marker', 'navigation_area', 'circle'],
  ['tileflow-nautical-ports', 'navigation_area', 'symbol'],
] as const;

type FilterFeature = {
  geometry: 'LineString' | 'Point' | 'Polygon';
  properties: Record<string, boolean | number | string>;
};

const geometryTypes = {LineString: 2, Point: 1, Polygon: 3} as const;

/** Evaluate a compiled layer filter exactly as MapLibre does for one tile feature. */
function admits(
  layer: {filter?: unknown} | undefined,
  feature: FilterFeature,
  tileZoom: number,
): boolean {
  assert.ok(layer?.filter, 'layer has a filter');
  const filter = featureFilter(layer.filter as never);
  return filter.filter({zoom: tileZoom}, {
    geometry: [],
    properties: feature.properties,
    type: geometryTypes[feature.geometry],
  } as never);
}

function compiledNautical(marine: 'chart' | 'nautical' = 'nautical') {
  return createStyle(extendStreets({marine}), {preparedAssets});
}

test('nautical compiles every semantic group from the nautical-v1 source layers', () => {
  const style = compiledNautical();
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

  for (const [id, sourceLayer, type] of nauticalLayers) {
    const layer = byId.get(id);
    assert.equal(layer?.source, tileflowNauticalSourceId, `${id} source`);
    assert.equal(layer?.['source-layer'], sourceLayer, `${id} source-layer`);
    assert.equal(layer?.type, type, `${id} type`);
  }
  assert.equal(
    style.layers.filter(({source}) => source === tileflowNauticalSourceId).length,
    nauticalLayers.length,
  );
  // Coverage labels are an explicit opt-in.
  assert.equal(byId.has('tileflow-nautical-coverage-labels'), false);
  assert.deepEqual(validateStyleMin(style as never), []);

  const identities = style.metadata?.['tileflow:sources'] as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(identities[tileflowNauticalSourceId]?.product, 'nautical-v1');
  const requirements = inferTileflowSourceRequirements(style);
  const nautical = requirements.sources[tileflowNauticalSourceId]!;
  assert.deepEqual(
    nautical.sourceLayers.map(({id}) => id),
    ['aid', 'coverage', 'hazard', 'light', 'navigation_area', 'reef', 'sounding', 'wreck'],
  );
  for (const layer of nautical.sourceLayers) {
    assert.ok(
      layer.fields.some(({name}) => name === 'min_zoom'),
      `${layer.id} respects min_zoom`,
    );
  }
  assert.deepEqual(style.metadata?.['tileflow:sourceRequirements'], requirements);
});

test('nautical layers respect each feature min_zoom and select their schema classes', () => {
  const byId = new Map(compiledNautical().layers.map((layer) => [layer.id, layer]));
  const point = (properties: FilterFeature['properties']): FilterFeature => ({
    geometry: 'Point',
    properties: {min_zoom: 11, ...properties},
  });

  for (const [id] of nauticalLayers) {
    assert.match(JSON.stringify(byId.get(id)?.filter), /min_zoom/u, `${id} filters on min_zoom`);
  }

  const buoys = byId.get('tileflow-nautical-buoys-marker');
  assert.equal(admits(buoys, point({class: 'buoy'}), 10), false);
  assert.equal(admits(buoys, point({class: 'buoy'}), 11), true);
  assert.equal(admits(buoys, point({class: 'light-vessel'}), 11), true);
  assert.equal(admits(buoys, point({class: 'beacon'}), 11), false);
  const beacons = byId.get('tileflow-nautical-beacons-marker');
  assert.equal(admits(beacons, point({class: 'beacon'}), 11), true);
  assert.equal(admits(beacons, point({class: 'daymark'}), 11), true);
  assert.equal(admits(beacons, point({class: 'buoy'}), 11), false);
  const lighthouses = byId.get('tileflow-nautical-lighthouses');
  assert.equal(admits(lighthouses, point({class: 'lighthouse', min_zoom: 8}), 8), true);
  assert.equal(admits(lighthouses, point({class: 'buoy'}), 11), false);
  const aids = byId.get('tileflow-nautical-aids');
  assert.equal(admits(aids, point({class: 'mooring', min_zoom: 13}), 13), true);
  assert.equal(admits(aids, point({class: 'mooring', min_zoom: 13}), 12), false);
  for (const drawnElsewhere of ['buoy', 'beacon', 'lighthouse', 'light-float']) {
    assert.equal(admits(aids, point({class: drawnElsewhere}), 14), false, drawnElsewhere);
  }

  const ports = byId.get('tileflow-nautical-ports');
  assert.equal(admits(ports, point({class: 'port', min_zoom: 3}), 3), true);
  assert.equal(admits(ports, point({class: 'harbour', min_zoom: 3}), 3), false);
  const harbours = byId.get('tileflow-nautical-harbours');
  assert.equal(admits(harbours, point({class: 'harbour'}), 11), true);
  assert.equal(
    admits(harbours, {geometry: 'Polygon', properties: {class: 'harbour', min_zoom: 7}}, 11),
    false,
  );

  const line = (properties: FilterFeature['properties']): FilterFeature => ({
    geometry: 'LineString',
    properties: {min_zoom: 8, ...properties},
  });
  const routes = byId.get('tileflow-nautical-routes');
  const cables = byId.get('tileflow-nautical-cables');
  assert.equal(admits(routes, line({class: 'route'}), 8), true);
  assert.equal(admits(routes, line({class: 'traffic-separation'}), 8), true);
  assert.equal(admits(routes, line({class: 'cable'}), 8), false);
  assert.equal(admits(cables, line({class: 'cable'}), 8), true);
  assert.equal(admits(cables, line({class: 'pipeline'}), 8), true);
  assert.equal(admits(cables, line({class: 'route'}), 8), false);

  // Rocks are glyphs; obstructions and platforms have a circle marker.
  const hazardMarker = byId.get('tileflow-nautical-hazards-marker');
  const hazardSymbol = byId.get('tileflow-nautical-hazards');
  const rock = point({class: 'rock', min_zoom: 12, water_level: 'awash'});
  assert.equal(admits(hazardSymbol, rock, 12), true);
  assert.equal(admits(hazardMarker, rock, 12), false);
  assert.equal(admits(hazardMarker, point({class: 'obstruction', min_zoom: 12}), 12), true);
  assert.match(JSON.stringify(hazardSymbol?.layout?.['text-field']), /water_level/u);
  const hazardOutline = byId.get('tileflow-nautical-hazard-areas-outline');
  assert.equal(admits(hazardOutline, line({class: 'obstruction', min_zoom: 10}), 10), true);
  assert.equal(
    admits(byId.get('tileflow-nautical-hazard-areas'), line({class: 'obstruction'}), 10),
    false,
  );

  // Coverage tints only coverage that speaks for every family.
  const coverage = byId.get('tileflow-nautical-coverage');
  const cell = (families: string): FilterFeature => ({
    geometry: 'Polygon',
    properties: {families, min_zoom: 0},
  });
  assert.equal(admits(coverage, cell('aid,light,hazard,wreck,reef,navigation_area'), 4), true);
  assert.equal(admits(coverage, cell('light'), 4), false);
});

test('nautical marks take their schema colour, rank, label, and size', () => {
  const byId = new Map(compiledNautical().layers.map((layer) => [layer.id, layer]));

  for (const id of ['tileflow-nautical-buoys-marker', 'tileflow-nautical-beacons-marker']) {
    assert.match(JSON.stringify(byId.get(id)?.paint?.['circle-color']), /"color"/u, id);
    assert.match(JSON.stringify(byId.get(id)?.paint?.['circle-stroke-color']), /"color"/u, id);
  }
  assert.match(
    JSON.stringify(byId.get('tileflow-nautical-lights-marker')?.paint?.['circle-color']),
    /"color"/u,
  );
  for (const id of [
    'tileflow-nautical-buoys',
    'tileflow-nautical-beacons',
    'tileflow-nautical-lighthouses',
    'tileflow-nautical-lights',
    'tileflow-nautical-ports',
  ]) {
    assert.match(JSON.stringify(byId.get(id)?.layout?.['symbol-sort-key']), /"rank"/u, id);
  }
  const lightLabel = JSON.stringify(byId.get('tileflow-nautical-lights')?.layout?.['text-field']);
  assert.match(lightLabel, /"label"/u);
  assert.match(lightLabel, /"zoom"/u);
  assert.match(JSON.stringify(byId.get('tileflow-nautical-ports')?.layout), /"size"/u);
  assert.match(JSON.stringify(byId.get('tileflow-nautical-ports')?.layout), /"name"/u);
  assert.match(
    JSON.stringify(byId.get('tileflow-nautical-navigation-areas-outline')?.paint),
    /restricted/u,
  );
});

test('a map that draws Nautical declares the not-for-navigation notice', () => {
  for (const marine of ['nautical', 'chart'] as const) {
    assert.deepEqual(readTileflowNotices(compiledNautical(marine).metadata), [
      {
        id: tileflowNauticalNotice.id,
        sources: [tileflowNauticalSourceId],
        text: tileflowNauticalNotice.text,
      },
    ]);
  }
  for (const map of [
    extendStreets({marine: 'bathymetry'}),
    extendStreets({marine: 'none'}),
    extendStreets(),
    extendStreets({marine: 'nautical', modules: {nautical: disable()}}),
  ]) {
    const style = createStyle(map, {preparedAssets});
    assert.equal(style.metadata?.[tileflowNoticesMetadataKey], undefined);
  }
  const custom = createStyle(
    extendStreets({marine: {bathymetry: false, nautical: {sourceId: 'charts'}}}),
    {preparedAssets},
  );
  assert.deepEqual(readTileflowNotices(custom.metadata)[0]?.sources, ['charts']);
});

test('theme image tokens replace nautical circle markers with icons', () => {
  const images = {
    'nautical.buoy': 'buoy',
    'nautical.buoy.cardinal': 'buoy-cardinal',
    'nautical.buoy.port': 'buoy-port',
    'nautical.light': 'light',
    'nautical.lighthouse': 'lighthouse',
  } as const;
  const theme = defineTheme(testLightTheme, {
    id: 'nautical-icons',
    version: 1,
    colorScheme: 'light',
    tokens: {image: images},
  });
  const style = createStyle(extendStreets({marine: 'nautical', themes: {light: theme}}), {
    preparedAssets: {
      icons: {
        ids: [...preparedAssets.icons.ids, ...Object.values(images)],
        sprite: preparedAssets.icons.sprite,
      },
    },
  });
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  for (const group of ['buoys', 'lights', 'lighthouses']) {
    assert.equal(byId.has(`tileflow-nautical-${group}-marker`), false, group);
    assert.ok(byId.get(`tileflow-nautical-${group}`)?.layout?.['icon-image'], group);
  }
  // Groups without a token keep their circle marker.
  assert.equal(byId.get('tileflow-nautical-beacons-marker')?.type, 'circle');

  const buoyImage = byId.get('tileflow-nautical-buoys')?.layout?.['icon-image'];
  const parsed = expression.createExpression(buoyImage, {type: 'resolvedImage'} as never);
  assert.equal(parsed.result, 'success');
  const icon = (properties: Record<string, string>) =>
    (
      parsed.value as {evaluate(globals: unknown, feature: unknown): {name?: string} | undefined}
    ).evaluate({zoom: 12}, {properties})?.name;
  assert.equal(icon({category: 'port', subclass: 'lateral'}), 'buoy-port');
  // A variant without its own token falls back to the group token.
  assert.equal(icon({category: 'starboard', subclass: 'lateral'}), 'buoy');
  assert.equal(icon({category: 'north', subclass: 'cardinal'}), 'buoy-cardinal');
  assert.equal(icon({category: 'yachting', subclass: 'special-purpose'}), 'buoy');
  assert.match(
    JSON.stringify(byId.get('tileflow-nautical-buoys')?.paint?.['icon-color']),
    /"color"/u,
  );
  assert.deepEqual(validateStyleMin(style as never), []);
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
