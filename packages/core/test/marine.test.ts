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
  nautical,
  parseTileflowMap,
  readTileflowNauticalLights,
  readTileflowNotices,
  resolveMarine,
  tileflowBathymetryDemSourceId,
  tileflowBathymetrySourceId,
  tileflowBathymetryV1Schema,
  steadyTileflowNauticalLights,
  tileflowNauticalLightEclipseOpacity,
  tileflowNauticalLightStates,
  tileflowNauticalLightsMetadataKey,
  tileflowNauticalNotice,
  tileflowNauticalPromoteId,
  tileflowNauticalSourceId,
  tileflowNauticalV1Schema,
  tileflowNoticesMetadataKey,
  zoom,
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
  ['tileflow-nautical-harbour-areas', 'navigation_area', 'fill'],
  ['tileflow-nautical-harbour-areas-outline', 'navigation_area', 'line'],
  ['tileflow-nautical-berths', 'navigation_area', 'fill'],
  ['tileflow-nautical-berths-outline', 'navigation_area', 'line'],
  ['tileflow-nautical-reefs', 'reef', 'fill'],
  ['tileflow-nautical-reefs-outline', 'reef', 'line'],
  ['tileflow-nautical-cables', 'navigation_area', 'line'],
  ['tileflow-nautical-routes', 'navigation_area', 'line'],
  ['tileflow-nautical-overhead-cables', 'navigation_area', 'line'],
  ['tileflow-nautical-hazard-areas', 'hazard', 'fill'],
  ['tileflow-nautical-hazard-areas-outline', 'hazard', 'line'],
  ['tileflow-nautical-wreck-areas', 'wreck', 'fill'],
  ['tileflow-nautical-wreck-areas-outline', 'wreck', 'line'],
  ['tileflow-nautical-bridges', 'navigation_area', 'fill'],
  ['tileflow-nautical-bridges-outline', 'navigation_area', 'line'],
  ['tileflow-nautical-bridge-labels', 'navigation_area', 'symbol'],
  ['tileflow-nautical-bridge-labels-lines', 'navigation_area', 'symbol'],
  ['tileflow-nautical-overhead-cable-labels', 'navigation_area', 'symbol'],
  ['tileflow-nautical-overhead-cable-labels-lines', 'navigation_area', 'symbol'],
  ['tileflow-nautical-navigation-area-labels', 'navigation_area', 'symbol'],
  ['tileflow-nautical-reef-labels', 'reef', 'symbol'],
  ['tileflow-nautical-hazard-area-labels', 'hazard', 'symbol'],
  ['tileflow-nautical-wreck-area-labels', 'wreck', 'symbol'],
  ['tileflow-nautical-soundings', 'sounding', 'symbol'],
  ['tileflow-nautical-hazards-marker', 'hazard', 'circle'],
  ['tileflow-nautical-hazards', 'hazard', 'symbol'],
  ['tileflow-nautical-facilities-marker', 'navigation_area', 'circle'],
  ['tileflow-nautical-facilities', 'navigation_area', 'symbol'],
  ['tileflow-nautical-wrecks', 'wreck', 'symbol'],
  ['tileflow-nautical-facilities-lines', 'navigation_area', 'symbol'],
  ['tileflow-nautical-harbours-marker', 'navigation_area', 'circle'],
  ['tileflow-nautical-harbours', 'navigation_area', 'symbol'],
  ['tileflow-nautical-distance-marks-marker', 'aid', 'circle'],
  ['tileflow-nautical-distance-marks', 'aid', 'symbol'],
  ['tileflow-nautical-aids-marker', 'aid', 'circle'],
  ['tileflow-nautical-aids', 'aid', 'symbol'],
  ['tileflow-nautical-notices-marker', 'aid', 'circle'],
  ['tileflow-nautical-notices', 'aid', 'symbol'],
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
  const harbourArea: FilterFeature = {
    geometry: 'Polygon',
    properties: {class: 'harbour', min_zoom: 7, subclass: 'marina'},
  };
  assert.equal(admits(harbours, point({class: 'harbour'}), 11), true);
  // Harbour polygons carry the harbour symbol and name, but no circle.
  assert.equal(admits(harbours, harbourArea, 11), true);
  assert.equal(admits(byId.get('tileflow-nautical-harbours-marker'), harbourArea, 11), false);
  assert.equal(admits(byId.get('tileflow-nautical-harbour-areas'), harbourArea, 11), true);
  assert.equal(admits(byId.get('tileflow-nautical-navigation-areas'), harbourArea, 11), false);

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

type Evaluated = {
  evaluate(
    globals: {zoom: number},
    feature?: {properties: Record<string, unknown>; type?: number},
    featureState?: Record<string, unknown>,
  ): unknown;
};

/** Parse a compiled paint or layout value exactly as MapLibre does. */
function parsed(value: unknown, type: string): Evaluated {
  const result = expression.createExpression(value, {type} as never);
  assert.equal(result.result, 'success', JSON.stringify(result.value));
  return result.value as unknown as Evaluated;
}

test('the Nautical source keys light feature state by provenance', () => {
  for (const marine of [
    'nautical',
    'chart',
    {bathymetry: false, nautical: {sourceId: 'charts'}},
  ] as const) {
    const style = createStyle(extendStreets({marine}), {preparedAssets});
    const nauticalId = typeof marine === 'string' ? tileflowNauticalSourceId : 'charts';
    assert.deepEqual(style.sources[nauticalId]?.promoteId, {light: 'provenance'});
    assert.equal(readTileflowNauticalLights(style.metadata)?.source, nauticalId);
    assert.equal(style.sources[tileflowBathymetrySourceId]?.promoteId, undefined);
  }
  assert.deepEqual(tileflowNauticalPromoteId, {
    [tileflowNauticalV1Schema.layers.lights]: tileflowNauticalV1Schema.fields.provenance,
  });
});

test('Nautical lights flash by feature state and keep their style without it', () => {
  const style = compiledNautical();
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  const marker = byId.get('tileflow-nautical-lights-marker')!;
  assert.deepEqual(readTileflowNauticalLights(style.metadata), {
    layers: ['tileflow-nautical-lights-marker'],
    source: tileflowNauticalSourceId,
    sourceLayer: 'light',
    version: 1,
  });

  const light = {properties: {class: 'major', color: 'white,red'}, type: 1};
  const opacity = parsed(marker.paint?.['circle-opacity'], 'number');
  assert.equal(opacity.evaluate({zoom: 10}, light, {}), 0.55);
  assert.equal(
    opacity.evaluate({zoom: 10}, light, {[tileflowNauticalLightStates.intensity]: 1}),
    0.55,
  );
  assert.equal(
    opacity.evaluate({zoom: 10}, light, {[tileflowNauticalLightStates.intensity]: 0}),
    0.55 * tileflowNauticalLightEclipseOpacity,
  );
  // An alternating light shows the colour its state selects; the first colour by default.
  const colour = parsed(marker.paint?.['circle-color'], 'color');
  const css = (state: Record<string, unknown>) => String(colour.evaluate({zoom: 10}, light, state));
  assert.equal(css({}), css({[tileflowNauticalLightStates.colour]: 0}));
  assert.notEqual(css({}), css({[tileflowNauticalLightStates.colour]: 1}));
  assert.equal(css({[tileflowNauticalLightStates.colour]: 2}), css({}));

  // Light labels never flash.
  assert.doesNotMatch(JSON.stringify(byId.get('tileflow-nautical-lights')), /feature-state/u);
  for (const layer of style.layers) {
    if (layer['source-layer'] !== 'light') {
      assert.doesNotMatch(JSON.stringify(layer), /feature-state/u, layer.id);
    }
  }
});

test('light opacity overrides keep their zoom curve and still flash', () => {
  const theme = defineTheme(testLightTheme, {
    id: 'nautical-flare',
    version: 1,
    colorScheme: 'light',
    tokens: {image: {'nautical.light': 'light'}},
  });
  const style = createStyle(
    extendStreets({
      marine: 'nautical',
      modules: {
        nautical: nautical({
          lights: {
            icon: {
              opacity: zoom.linear([
                [6, 0.5],
                [12, 1],
              ]),
            },
          },
        }),
      },
      themes: {light: theme},
    }),
    {
      preparedAssets: {
        icons: {ids: [...preparedAssets.icons.ids, 'light'], sprite: preparedAssets.icons.sprite},
      },
    },
  );
  assert.deepEqual(validateStyleMin(style as never), []);
  const symbol = style.layers.find(({id}) => id === 'tileflow-nautical-lights')!;
  assert.deepEqual(readTileflowNauticalLights(style.metadata)?.layers, [symbol.id]);
  const opacity = parsed(symbol.paint?.['icon-opacity'], 'number');
  const light = {properties: {class: 'minor'}, type: 1};
  assert.equal(opacity.evaluate({zoom: 12}, light, {}), 1);
  assert.equal(
    opacity.evaluate({zoom: 6}, light, {[tileflowNauticalLightStates.intensity]: 0}),
    0.5 * tileflowNauticalLightEclipseOpacity,
  );
  // Text stays steady while the flare flashes.
  assert.doesNotMatch(JSON.stringify(symbol.paint?.['text-opacity'] ?? null), /feature-state/u);
});

test('animateLights false keeps lights steady and declares no light layers', () => {
  const style = createStyle(
    extendStreets({marine: 'nautical', modules: {nautical: nautical({animateLights: false})}}),
    {preparedAssets},
  );
  assert.equal(style.metadata?.[tileflowNauticalLightsMetadataKey], undefined);
  assert.doesNotMatch(JSON.stringify(style.layers), /feature-state/u);
});

test('the steady copy of a style draws lights exactly as without state', () => {
  const style = compiledNautical();
  const steady = steadyTileflowNauticalLights(style);
  assert.notEqual(steady, style);
  assert.equal(steady.metadata?.[tileflowNauticalLightsMetadataKey], undefined);
  assert.doesNotMatch(JSON.stringify(steady.layers), /feature-state/u);
  assert.deepEqual(validateStyleMin(steady as never), []);
  const marker = (from: typeof style) =>
    from.layers.find(({id}) => id === 'tileflow-nautical-lights-marker')!;
  const light = {properties: {class: 'major', color: 'green'}, type: 1};
  for (const property of ['circle-opacity', 'circle-color'] as const) {
    const type = property === 'circle-color' ? 'color' : 'number';
    assert.deepEqual(
      parsed(marker(steady).paint?.[property], type).evaluate({zoom: 9}, light, {}),
      parsed(marker(style).paint?.[property], type).evaluate({zoom: 9}, light, {}),
    );
  }
  // Every other layer is unchanged, and a style without lights is returned as it is.
  assert.deepEqual(
    steady.layers.filter(({id}) => id !== 'tileflow-nautical-lights-marker'),
    style.layers.filter(({id}) => id !== 'tileflow-nautical-lights-marker'),
  );
  const plain = createStyle(extendStreets({marine: 'none'}), {preparedAssets});
  assert.equal(steadyTileflowNauticalLights(plain), plain);
});

test('inland marks, structures and facilities have their own groups', () => {
  const byId = new Map(compiledNautical().layers.map((layer) => [layer.id, layer]));
  const feature = (
    geometry: FilterFeature['geometry'],
    properties: FilterFeature['properties'],
  ): FilterFeature => ({geometry, properties: {min_zoom: 13, ...properties}});

  // Notices and distance marks are no longer generic aids.
  const aids = byId.get('tileflow-nautical-aids');
  for (const kind of ['notice', 'distance-mark']) {
    assert.equal(admits(aids, feature('Point', {class: kind}), 14), false, kind);
  }
  assert.equal(
    admits(
      byId.get('tileflow-nautical-notices'),
      feature('Point', {class: 'notice', min_zoom: 12}),
      12,
    ),
    true,
  );
  assert.equal(
    admits(
      byId.get('tileflow-nautical-distance-marks'),
      feature('Point', {class: 'distance-mark', min_zoom: 11}),
      11,
    ),
    true,
  );

  // Bridges, berths, facilities and harbours leave the generic navigation areas.
  const areas = byId.get('tileflow-nautical-navigation-areas');
  for (const kind of ['bridge', 'berth', 'facility', 'harbour']) {
    assert.equal(admits(areas, feature('Polygon', {class: kind}), 14), false, kind);
  }
  assert.equal(admits(areas, feature('Polygon', {class: 'restricted'}), 14), true);
  const labels = byId.get('tileflow-nautical-navigation-area-labels');
  assert.equal(admits(labels, feature('Polygon', {class: 'berth', name: 'Quay'}), 14), true);
  assert.equal(admits(labels, feature('Polygon', {class: 'bridge', name: 'Bridge'}), 14), false);

  // Lines stroke the bridge and berth outlines; only polygons are filled.
  for (const id of ['bridges', 'berths']) {
    const kind = id === 'bridges' ? 'bridge' : 'berth';
    assert.equal(
      admits(byId.get(`tileflow-nautical-${id}-outline`), feature('LineString', {class: kind}), 14),
      true,
    );
    assert.equal(
      admits(byId.get(`tileflow-nautical-${id}`), feature('LineString', {class: kind}), 14),
      false,
    );
  }
  assert.equal(
    admits(
      byId.get('tileflow-nautical-overhead-cables'),
      feature('LineString', {class: 'overhead-cable'}),
      14,
    ),
    true,
  );

  // Facility lines carry their symbol at their centre; circles only mark points.
  const slipway = feature('LineString', {class: 'facility', subclass: 'slipway'});
  assert.equal(admits(byId.get('tileflow-nautical-facilities'), slipway, 14), false);
  assert.equal(admits(byId.get('tileflow-nautical-facilities-lines'), slipway, 14), true);
  assert.equal(
    byId.get('tileflow-nautical-facilities-lines')?.layout?.['symbol-placement'],
    'line-center',
  );
  assert.equal(
    admits(
      byId.get('tileflow-nautical-facilities-marker'),
      feature('Polygon', {class: 'facility'}),
      14,
    ),
    false,
  );

  // Clearance labels need a clearance; overhead cables are labelled along their lines.
  const bridgeLabels = byId.get('tileflow-nautical-bridge-labels');
  assert.equal(admits(bridgeLabels, feature('Point', {class: 'bridge'}), 14), false);
  assert.equal(
    admits(bridgeLabels, feature('Point', {class: 'bridge', vertical_clearance: 4}), 14),
    true,
  );
  assert.equal(
    admits(bridgeLabels, feature('LineString', {class: 'bridge', vertical_clearance: 4}), 14),
    false,
  );
  assert.equal(
    admits(
      byId.get('tileflow-nautical-bridge-labels-lines'),
      feature('LineString', {class: 'bridge', vertical_clearance_open: 9}),
      14,
    ),
    true,
  );
  assert.equal(
    byId.get('tileflow-nautical-overhead-cable-labels-lines')?.layout?.['symbol-placement'],
    'line',
  );
});

test('inland labels show clearances, distances and notice information', () => {
  const byId = new Map(compiledNautical().layers.map((layer) => [layer.id, layer]));
  const text = (id: string, properties: Record<string, unknown>, zoomLevel = 16) =>
    parsed(byId.get(id)?.layout?.['text-field'], 'string').evaluate(
      {zoom: zoomLevel},
      {properties, type: 1},
    );

  const bridge = 'tileflow-nautical-bridge-labels';
  assert.equal(text(bridge, {vertical_clearance: 4.59}), 'clearance 4.59 m');
  assert.equal(
    text(bridge, {
      vertical_clearance: 3.6,
      vertical_clearance_closed: 3.6,
      vertical_clearance_open: 12,
    }),
    'closed 3.6 m · open 12 m',
  );
  assert.equal(text(bridge, {vertical_clearance_closed: 2.1}), 'closed 2.1 m');
  assert.equal(text(bridge, {vertical_clearance_open: 30}), 'open 30 m');

  const cable = 'tileflow-nautical-overhead-cable-labels';
  assert.equal(
    text(cable, {vertical_clearance: 30, vertical_clearance_safe: 28.5}),
    'safe clearance 28.5 m',
  );
  assert.equal(text(cable, {vertical_clearance: 30}), 'clearance 30 m');

  const distance = 'tileflow-nautical-distance-marks';
  for (const [unit, label] of [
    ['kilometres', '12 km'],
    ['hectometres', '12 hm'],
    ['metres', '12 m'],
    ['statute-miles', '12 mi'],
    ['nautical-miles', '12 NM'],
    [undefined, '12'],
  ] as const) {
    assert.equal(
      text(distance, {distance: 12, distance_unit: unit as string}),
      label,
      String(unit),
    );
  }
  assert.equal(text(distance, {distance: 12.5, distance_unit: 'kilometres'}, 12), '');

  assert.equal(text('tileflow-nautical-notices', {information: '9'}), '9');
  assert.equal(text('tileflow-nautical-notices', {information: '9'}, 13), '');
});

test('theme tokens choose notice, facility and marina icons from statically known images', () => {
  const images = {
    'nautical.facility': 'facility',
    'nautical.facility.fuel-station': 'fuel',
    'nautical.facility.slipway': 'slipway',
    'nautical.facility.visitor-berth': 'visitor',
    'nautical.harbour': 'harbour',
    'nautical.marina': 'marina',
    'nautical.notice': 'notice',
    'nautical.notice.prohibition': 'notice-prohibition',
  } as const;
  const theme = defineTheme(testLightTheme, {
    id: 'nautical-inland',
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
  assert.deepEqual(validateStyleMin(style as never), []);
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  const icon = (id: string, properties: Record<string, unknown>) =>
    (
      parsed(byId.get(id)?.layout?.['icon-image'], 'resolvedImage').evaluate(
        {zoom: 14},
        {properties, type: 1},
      ) as {name?: string}
    )?.name;

  const facility = 'tileflow-nautical-facilities';
  assert.equal(icon(facility, {subclass: 'fuel-station,pump-out'}), 'fuel');
  // The priority list decides, not the order in the data.
  assert.equal(icon(facility, {subclass: 'boat-hoist,slipway'}), 'slipway');
  assert.equal(icon(facility, {subclass: 'visitors-mooring'}), 'visitor');
  // Variants without their own token, and partial names, fall back to the facility icon.
  assert.equal(icon(facility, {subclass: 'pump-out'}), 'facility');
  assert.equal(icon(facility, {subclass: 'toilets,showers'}), 'facility');
  assert.equal(icon(facility, {subclass: 'slipways'}), 'facility');
  assert.equal(icon(facility, {}), 'facility');
  assert.equal(byId.get('tileflow-nautical-facilities-marker'), undefined);

  const harbour = 'tileflow-nautical-harbours';
  assert.equal(icon(harbour, {subclass: 'marina'}), 'marina');
  assert.equal(icon(harbour, {subclass: 'harbour,marina'}), 'marina');
  assert.equal(icon(harbour, {subclass: 'marina-no-facilities'}), 'marina');
  assert.equal(icon(harbour, {subclass: 'cargo'}), 'harbour');

  const notices = 'tileflow-nautical-notices';
  assert.equal(icon(notices, {subclass: 'prohibition'}), 'notice-prohibition');
  assert.equal(icon(notices, {subclass: 'information'}), 'notice');
  assert.equal(icon(notices, {}), 'notice');
  const colour = parsed(byId.get(notices)?.paint?.['icon-color'], 'color');
  assert.notEqual(
    String(colour.evaluate({zoom: 14}, {properties: {subclass: 'prohibition'}, type: 1})),
    String(colour.evaluate({zoom: 14}, {properties: {subclass: 'information'}, type: 1})),
  );
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
