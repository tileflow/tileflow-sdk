import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  analyzeTileflowStylePerformance,
  createStyleFromProject,
  validateConfig,
} from '@tileflow/core';
import project from '../tileflow.config';

test('keeps the editorial city recipe on the versioned Streets contract', () => {
  const validation = validateConfig(project);
  assert.deepEqual(validation.messages, []);
  assert.equal(validation.valid, true);

  const style = createStyleFromProject(project, 'editorial-city');
  assert.equal(style.metadata?.['tileflow:basemap'], 'streets');
  assert.equal(style.metadata?.['tileflow:basemapVersion'], 3);
  assert.deepEqual(style.projection, {type: 'globe'});
  assert.partialDeepStrictEqual(style.metadata?.['tileflow:data'], {
    kind: 'vector-tiles',
    revision: 'tileflow-world-v1-recipe-1.1.0-local',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
    url: 'http://127.0.0.1:8080/tiles.json',
    capabilities: {
      bathymetry: true,
      businessCorridor: true,
      globalLandcover: true,
      tree: true,
    },
  });
  assert.equal(style.sources?.tileflow?.url, 'http://127.0.0.1:8080/tiles.json');
  assert.equal(style.sprite, undefined);
  assert.deepEqual(style.light, {
    anchor: 'viewport',
    color: '#FFFFFF',
    intensity: 0.15,
    position: [1.15, 210, 30],
  });
  assert.equal(style.glyphs, 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf');
  assert.equal(style.metadata?.['tileflow:provenance'], undefined);
  assert.equal(style.layers.length >= 90 && style.layers.length <= 120, true);

  const labelFontStacks = style.layers.flatMap((layer) => {
    const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
    return Array.isArray(font) ? font : [];
  });
  assert.equal(
    labelFontStacks.some((font) => String(font).startsWith('Metropolis ')),
    true,
  );
  assert.equal(
    labelFontStacks.some((font) => String(font).startsWith('Noto Sans ')),
    false,
  );

  assert.equal(
    style.layers.some(
      (layer) => typeof layer.id === 'string' && layer.id.startsWith('streets-poi-'),
    ),
    false,
  );
  assert.equal(
    style.layers.some((layer) => layer.id === 'streets-business-corridor'),
    true,
  );

  const countryLabel = style.layers.find((layer) => layer.id === 'streets-label-place-country');
  const cityLabel = style.layers.find((layer) => layer.id === 'streets-label-place-city');
  const countryLayout = countryLabel?.layout as Record<string, unknown> | undefined;
  const cityLayout = cityLabel?.layout as Record<string, unknown> | undefined;
  assert.deepEqual(countryLayout?.['text-font'], ['Metropolis Bold']);
  assert.match(JSON.stringify(cityLayout?.['text-font']), /Metropolis Bold/);
  assert.match(JSON.stringify(cityLayout?.['text-font']), /Metropolis Medium/);
  assert.match(JSON.stringify(cityLayout?.['text-font']), /Metropolis Regular/);
  assert.match(JSON.stringify(cityLayout?.['text-size']), /capital/);
  assert.match(JSON.stringify(cityLayout?.['text-size']), /rank/);

  const waterIndex = style.layers.findIndex((layer) => layer.id === 'streets-water');
  const bathymetryIndex = style.layers.findIndex((layer) => layer.id === 'streets-bathymetry');
  const bathymetry = style.layers[bathymetryIndex];
  assert.equal(bathymetryIndex, waterIndex + 1);
  assert.equal(bathymetry?.['source-layer'], 'bathymetry');
  assert.equal(bathymetry?.maxzoom, 10);
  assert.equal(
    (style.layers[waterIndex]?.paint as Record<string, unknown>)?.['fill-color'],
    '#A2D9F3',
  );
  assert.deepEqual((bathymetry?.paint as Record<string, unknown>)?.['fill-color'], [
    'match',
    ['get', 'min_depth'],
    0,
    '#A2D9F3',
    -200,
    '#98d5f2',
    -1000,
    '#8fd1f1',
    -2000,
    '#85cdf0',
    -4000,
    '#7cc9ef',
    -6000,
    '#72C5EE',
    '#A2D9F3',
  ]);
  assert.deepEqual((bathymetry?.paint as Record<string, unknown>)?.['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    ['match', ['get', 'min_depth'], [0, -200], 0.84, 0],
    3.5,
    ['match', ['get', 'min_depth'], [0, -200], 0.82, 0],
    4.25,
    ['match', ['get', 'min_depth'], [0, -200, -1000], 0.84, 0],
    4.75,
    ['match', ['get', 'min_depth'], [0, -200, -1000, -2000], 0.82, 0],
    5.25,
    ['match', ['get', 'min_depth'], [0, -200, -1000, -2000, -4000], 0.8, 0],
    5.75,
    0.78,
    7,
    0.76,
    9,
    0.56,
    10,
    0,
  ]);

  const globalLandcover = style.layers.find((layer) => layer.id === 'streets-global-landcover');
  const globalLandcoverPaint = globalLandcover?.paint as Record<string, unknown> | undefined;
  assert.deepEqual(globalLandcoverPaint?.['fill-color'], [
    'match',
    ['get', 'class'],
    'barren',
    '#FAFAFA',
    'crop',
    '#DCECCB',
    'grass',
    '#C3F1D5',
    'shrub',
    '#D1E3D9',
    'snow',
    '#F5FAFC',
    'trees',
    '#C6E8D2',
    'urban',
    '#F5E9CE',
    'rgba(0, 0, 0, 0)',
  ]);
});

test('keeps the original POI icons alongside the local street symbols', async () => {
  for (const iconName of [
    'cafe',
    'hospital',
    'hotel',
    'museum',
    'restaurant',
    'school',
    'services',
    'shopping',
    'train',
  ]) {
    const icon = await readFile(new URL(`../icons/${iconName}.svg`, import.meta.url), 'utf8');
    assert.match(icon, /<svg/);
  }

  const oneWay = await readFile(new URL('../icons/oneway.svg', import.meta.url), 'utf8');
  assert.match(oneWay, /width="24" height="18" viewBox="0 0 24 18"/);
  assert.match(oneWay, /d="M3 9h17m-6-6 6 6-6 6"/);
  assert.match(oneWay, /stroke="#FFFFFF"/);
  assert.match(oneWay, /stroke-width="3\.2"/);
  assert.doesNotMatch(oneWay, /#8291A4/);

  const notices = await readFile(
    new URL('../icons/THIRD_PARTY_NOTICES.md', import.meta.url),
    'utf8',
  );
  assert.match(notices, /Google Places icons/);
  assert.match(notices, /Creative Commons Attribution 4\.0/);
});

test('starts selected commercial building footprints at the z14 overview scale', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const businessCorridor = style.layers.find((layer) => layer.id === 'streets-business-corridor');
  const commercialLanduse = style.layers.find((layer) => layer.id === 'streets-landuse-commercial');

  assert.equal(businessCorridor?.['source-layer'], 'business_corridor');
  assert.equal(businessCorridor?.minzoom, 14);
  assert.equal(businessCorridor?.maxzoom, 16);
  assert.deepEqual(businessCorridor?.paint, {
    'fill-color': '#F5E9CE',
    'fill-opacity': 0.82,
  });
  assert.match(JSON.stringify(businessCorridor?.filter), /activity_score/);
  assert.match(JSON.stringify(businessCorridor?.filter), /0\.85/);
  assert.doesNotMatch(JSON.stringify(businessCorridor?.filter), /confidence/);
  assert.equal(commercialLanduse?.['source-layer'], 'landuse');
  assert.equal(commercialLanduse?.minzoom, 12);
  assert.deepEqual(commercialLanduse?.filter, [
    'match',
    ['get', 'class'],
    ['commercial', 'retail'],
    true,
    false,
  ]);
  assert.deepEqual(commercialLanduse?.paint, {
    'fill-color': '#F5E9CE',
    'fill-opacity': 1,
  });
});

test('styles detailed building footprints and authored 3d layers', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const fill = style.layers.find((layer) => layer.id === 'streets-buildings-fill');
  const outline = style.layers.find((layer) => layer.id === 'streets-buildings-fill-outline');
  const waterIndex = style.layers.findIndex((layer) => layer.id === 'streets-water');
  const softShadow = style.layers.find((layer) => layer.id === 'streets-buildings-3d-shadow-soft');
  const coreShadow = style.layers.find((layer) => layer.id === 'streets-buildings-3d-shadow-core');
  const extrusion = style.layers.find((layer) => layer.id === 'streets-buildings-3d');
  const lastRoadIndex = style.layers.reduce(
    (last, layer, index) =>
      typeof layer.id === 'string' && layer.id.startsWith('streets-road-') ? index : last,
    -1,
  );
  const lastRoadLabelIndex = style.layers.reduce(
    (last, layer, index) =>
      typeof layer.id === 'string' && layer.id.startsWith('streets-label-road-') ? index : last,
    -1,
  );
  const fillPaint = fill?.paint as Record<string, unknown> | undefined;
  const outlinePaint = outline?.paint as Record<string, unknown> | undefined;
  const softShadowMetadata = softShadow?.metadata as Record<string, unknown> | undefined;
  const softShadowPaint = softShadow?.paint as Record<string, unknown> | undefined;
  const coreShadowMetadata = coreShadow?.metadata as Record<string, unknown> | undefined;
  const coreShadowPaint = coreShadow?.paint as Record<string, unknown> | undefined;
  const extrusionMetadata = extrusion?.metadata as Record<string, unknown> | undefined;
  const extrusionPaint = extrusion?.paint as Record<string, unknown> | undefined;
  const warmBuildingFilter = [
    'any',
    [
      'match',
      ['coalesce', ['get', 'building_tone'], ''],
      ['active', 'commercial', 'destination'],
      true,
      false,
    ],
    ['==', ['coalesce', ['get', 'building_kind'], 'generic'], 'commercial'],
    ['==', ['get', 'has_business'], true],
    ['==', ['get', 'has_business'], 1],
    ['==', ['get', 'has_business'], '1'],
  ];
  const building3dColor = ['case', warmBuildingFilter, '#ECE5D8', '#DEDFE7'];
  const building3dShadowColor = ['case', warmBuildingFilter, '#BDB9B2', '#ACADB1'];
  const semanticColor = ['case', warmBuildingFilter, '#F5E9CE', '#E4E5EA'];
  const visibleBuildingFilter = ['>=', ['zoom'], 15];
  const visible3dFilter = [
    'all',
    ['!=', ['get', 'hide_3d'], true],
    ['!=', ['get', 'hide_3d'], 1],
    ['!=', ['get', 'hide_3d'], '1'],
    ['!=', ['get', 'has_parts'], true],
    ['!=', ['get', 'has_parts'], 1],
    ['!=', ['get', 'has_parts'], '1'],
  ];

  assert.equal(fill?.minzoom, 15);
  assert.deepEqual(fill?.filter, visibleBuildingFilter);
  assert.deepEqual(fillPaint?.['fill-color'], semanticColor);
  assert.equal(outline?.minzoom, 16);
  assert.deepEqual(outline?.filter, visibleBuildingFilter);
  assert.equal(outlinePaint?.['line-color'], '#BFC2C6');
  assert.deepEqual(outlinePaint?.['line-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0.42,
    16,
    0.62,
    17,
    0.74,
    20,
    0.84,
  ]);
  assert.deepEqual(outlinePaint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0.4,
    16,
    0.55,
    17,
    0.7,
    20,
    0.9,
  ]);
  assert.ok(style.layers.indexOf(softShadow!) < style.layers.indexOf(fill!));
  assert.ok(style.layers.indexOf(coreShadow!) < style.layers.indexOf(fill!));
  assert.ok(lastRoadIndex < style.layers.indexOf(softShadow!));
  assert.ok(lastRoadLabelIndex < style.layers.indexOf(softShadow!));
  assert.equal(softShadow?.type, 'line');
  assert.equal(softShadow?.minzoom, 16);
  assert.deepEqual(softShadow?.filter, visible3dFilter);
  assert.equal(softShadowMetadata?.['tileflow:3d-toggle'], 'building');
  assert.equal(softShadowPaint?.['line-blur'], 7);
  assert.deepEqual(softShadowPaint?.['line-color'], building3dShadowColor);
  assert.equal(softShadowPaint?.['line-opacity'], 0.12);
  assert.deepEqual(softShadowPaint?.['line-translate'], [3, 5]);
  assert.equal(coreShadow?.type, 'fill');
  assert.equal(coreShadow?.minzoom, 16);
  assert.deepEqual(coreShadow?.filter, visible3dFilter);
  assert.equal(coreShadowMetadata?.['tileflow:3d-toggle'], 'building');
  assert.deepEqual(coreShadowPaint?.['fill-color'], building3dShadowColor);
  assert.equal(coreShadowPaint?.['fill-opacity'], 0.1);
  assert.deepEqual(coreShadowPaint?.['fill-translate'], [2, 4]);
  assert.equal(extrusion?.type, 'fill-extrusion');
  assert.equal(extrusion?.minzoom, 15);
  assert.deepEqual(extrusion?.filter, visible3dFilter);
  assert.equal((extrusion?.layout as Record<string, unknown> | undefined)?.visibility, 'none');
  assert.equal(extrusionMetadata?.['tileflow:3d-toggle'], 'building');
  assert.deepEqual(extrusionPaint?.['fill-extrusion-height'], [
    'max',
    0,
    ['to-number', ['coalesce', ['get', 'render_height'], 5], 5],
  ]);
  assert.match(JSON.stringify(extrusionPaint?.['fill-extrusion-base']), /render_min_height/);
  assert.doesNotMatch(JSON.stringify(extrusionPaint), /\["get","height"\]/);
  assert.doesNotMatch(JSON.stringify(extrusionPaint), /\["get","min_height"\]/);
  assert.match(JSON.stringify(extrusionPaint?.['fill-extrusion-base']), /"min"/);
  assert.deepEqual(extrusionPaint?.['fill-extrusion-color'], building3dColor);
  assert.equal(extrusionPaint?.['fill-extrusion-opacity'], 1);
  assert.equal(extrusionPaint?.['fill-extrusion-vertical-gradient'], true);
  assert.equal(
    style.layers.some((layer) => layer.id === 'streets-buildings-landmark-3d'),
    false,
  );
  assert.deepEqual(style.light, {
    anchor: 'viewport',
    color: '#FFFFFF',
    intensity: 0.15,
    position: [1.15, 210, 30],
  });

  const serializedStyle = JSON.stringify(style);
  assert.doesNotMatch(serializedStyle, /fill-extrusion-pattern/);
  assert.doesNotMatch(serializedStyle, /facade_color|facade_material/);
  assert.doesNotMatch(serializedStyle, /roof_color|roof_material/);
  assert.doesNotMatch(serializedStyle, /procedural-effect/);
  assert.doesNotMatch(serializedStyle, /streets-landmarks-3d-config/);
  assert.doesNotMatch(serializedStyle, /landmark-manifest-url/);
  assert.doesNotMatch(serializedStyle, /\.glb(?:\?|"|$)/i);
});

test('keeps restricted links and park paths continuous while separating sidewalks', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const service = style.layers.find(
    (layer) => layer.id === 'streets-road-surface-highzoom-local-fill',
  );
  const serviceDash = (service?.paint as Record<string, unknown> | undefined)?.['line-dasharray'];
  const pathFill = style.layers.find(
    (candidate) => candidate.id === 'streets-road-surface-highzoom-path-fill',
  );
  const pathCasing = style.layers.find(
    (candidate) => candidate.id === 'streets-road-surface-highzoom-path-casing',
  );
  const overviewPaths = style.layers.find(
    (candidate) => candidate.id === 'streets-park-path-overview',
  );
  const pathFillJson = JSON.stringify(pathFill);
  const pathCasingJson = JSON.stringify(pathCasing);
  const serviceDashJson = JSON.stringify(serviceDash);
  assert.equal(pathFill?.minzoom, 16);
  assert.equal(pathCasing?.minzoom, 16);
  assert.equal(overviewPaths?.minzoom, 13);
  assert.equal(overviewPaths?.maxzoom, 16);
  assert.equal(overviewPaths?.['source-layer'], 'transportation');
  assert.match(JSON.stringify(overviewPaths?.filter), /track_construction/);
  assert.match(JSON.stringify(overviewPaths?.filter), /cycleway/);
  assert.match(JSON.stringify(overviewPaths?.filter), /footway/);
  assert.deepEqual(
    (overviewPaths?.paint as Record<string, unknown> | undefined)?.['line-dasharray'],
    [1, 0],
  );
  assert.equal(
    (overviewPaths?.paint as Record<string, unknown> | undefined)?.['line-color'],
    '#50AD90',
  );
  assert.match(pathFillJson, /"subclass"\],\["path","bridleway","corridor"\]/);
  assert.match(pathFillJson, /cycleway/);
  assert.match(pathFillJson, /footway/);
  assert.match(pathFillJson, /pedestrian/);
  assert.match(pathFillJson, /#50AD90/);
  assert.match(pathFillJson, /#FDFDFD/);
  assert.match(pathFillJson, /#B3BDCC/);
  assert.match(pathCasingJson, /#489c82/);
  assert.match(pathCasingJson, /#e4e4e4/);
  assert.match(pathCasingJson, /"unpaved"\],0/);
  assert.doesNotMatch(pathFillJson, /\[3,2\]/);
  assert.doesNotMatch(serviceDashJson, /\[3,2\]/);
  assert.match(
    serviceDashJson,
    /"track","raceway","track_construction","raceway_construction"\],\["literal",\[1,0\]\]/,
  );

  assert.match(serviceDashJson, /\[1,0\]/);
  assert.match(serviceDashJson, /"indoor"\],1\],\["literal",\[1,0\]\]/);
});

test('keeps education grounds green and intermittent streams legible', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const education = style.layers.find(
    (layer) =>
      layer['source-layer'] === 'landuse' &&
      JSON.stringify(layer).includes('university') &&
      JSON.stringify(layer).includes('#DAF0DF'),
  );
  const stream = style.layers.find((layer) => layer.id === 'streets-waterway-stream');
  const streamPaint = stream?.paint as Record<string, unknown> | undefined;

  assert.match(
    JSON.stringify((education?.paint as Record<string, unknown> | undefined)?.['fill-color']),
    /#DAF0DF/,
  );
  assert.equal(stream?.minzoom, 10);
  assert.equal(streamPaint?.['line-color'], '#72CBE7');
  assert.deepEqual(streamPaint?.['line-dasharray'], [1, 0]);
  assert.match(JSON.stringify(streamPaint?.['line-opacity']), /intermittent/);
  assert.match(JSON.stringify(streamPaint?.['line-opacity']), /0\.9/);
  assert.deepEqual(streamPaint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    0.3,
    12,
    0.55,
    13,
    0.9,
    14,
    1.25,
    16,
    2,
  ]);
});

test('renders only explicit sidewalk polygons with the high-zoom pavement pattern', async () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const buildingIndex = style.layers.findIndex((layer) => layer.id === 'streets-buildings-fill');
  const surfaceIndex = style.layers.findIndex((layer) => layer.id === 'streets-sidewalk-surface');
  const patternIndex = style.layers.findIndex((layer) => layer.id === 'streets-sidewalk-pattern');
  const treeIndex = style.layers.findIndex((layer) => layer.id === 'streets-vegetation-trees');
  const roadIndex = style.layers.findIndex(
    (layer) => layer.id === 'streets-road-surface-highzoom-local-fill',
  );
  const labelIndex = style.layers.findIndex((layer) => layer.id === 'streets-label-place-city');
  const surface = style.layers[surfaceIndex];
  const pattern = style.layers[patternIndex];

  assert.equal(surface?.type, 'fill');
  assert.equal(surface?.['source-layer'], 'sidewalk');
  assert.equal(surface?.minzoom, 17);
  assert.equal(pattern?.type, 'fill');
  assert.equal(pattern?.['source-layer'], 'sidewalk');
  assert.equal(pattern?.minzoom, 17);
  assert.equal((pattern?.paint as Record<string, unknown>)?.['fill-pattern'], 'sidewalk-dot');
  assert.ok(surfaceIndex < patternIndex);
  assert.ok(patternIndex < roadIndex);
  assert.ok(roadIndex < buildingIndex);
  assert.ok(buildingIndex < treeIndex);
  assert.ok(treeIndex < labelIndex);
  assert.deepEqual(pattern?.filter, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['match', ['get', 'class'], ['sidewalk', 'pedestrian'], true, false],
  ]);

  const icon = await readFile(new URL('../icons/sidewalk-dot.svg', import.meta.url), 'utf8');
  assert.match(icon, /width="24" height="24"/);
  assert.match(icon, /<pattern[^>]+width="4" height="4"/);
  assert.match(icon, /<rect width="1" height="1"/);
});

test('keeps road width expressions within a bounded complexity budget', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const roadWidths = style.layers.flatMap((layer) => {
    if (typeof layer.id !== 'string' || !layer.id.startsWith('streets-road-')) return [];
    const width = (layer.paint as Record<string, unknown> | undefined)?.['line-width'];
    return Array.isArray(width) ? [width] : [];
  });
  const expressionNodes = (value: unknown): number =>
    Array.isArray(value)
      ? 1 + value.reduce<number>((total, entry) => total + expressionNodes(entry), 0)
      : 1;

  assert.ok(roadWidths.length >= 40);
  assert.ok(
    Math.max(...roadWidths.map((width) => expressionNodes(width))) < 4_500,
    'a consolidated road cohort must keep its feature-dependent tree bounded',
  );
  assert.ok(
    Math.max(...roadWidths.map((width) => JSON.stringify(width).length)) < 26_000,
    'a consolidated road cohort must stay cheap to parse and compile',
  );
  assert.doesNotMatch(JSON.stringify(roadWidths), /__tileflow_fixed_road_border/);
});

test('sweeps z0-z24 and every layer boundary without structural performance spikes', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const report = analyzeTileflowStylePerformance(style);

  assert.equal(report.totalLayers <= 120, true);
  assert.equal(report.styleBytes < 650_000, true);
  assert.ok(report.zooms.length >= 25);
  assert.equal(Math.max(...report.zooms.map((zoom) => zoom.activeLayers)) <= 84, true);
  assert.equal(Math.max(...report.zooms.map((zoom) => zoom.styleLayerFamilies)) <= 68, true);
  assert.equal(Math.max(...report.zooms.map((zoom) => zoom.symbols)) <= 18, true);
  assert.equal(report.zooms[0]?.activeLayers, 5);
  assert.equal(
    (report.zooms.find(({zoom}) => zoom === 16)?.sourceLayers.transportation ?? 0) <= 36,
    true,
  );

  for (let zoom = 1; zoom < report.zooms.length; zoom += 1) {
    const increase = report.zooms[zoom]!.activeLayers - report.zooms[zoom - 1]!.activeLayers;
    assert.equal(
      increase <= 20,
      true,
      `z${report.zooms[zoom]!.zoom} adds ${increase} active layers`,
    );
  }
});

test('keeps overview zoom road buckets within the measured performance budget', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const prematureRoadCasings = style.layers.filter((layer) => {
    const layerId = typeof layer.id === 'string' ? layer.id : '';
    const minimumZoom = typeof layer.minzoom === 'number' ? layer.minzoom : 0;
    return (
      layerId.startsWith('streets-road-') &&
      layerId.endsWith('-casing') &&
      layerId !== 'streets-road-circular-casing' &&
      minimumZoom < 16
    );
  });
  assert.deepEqual(
    prematureRoadCasings.map((layer) => layer.id),
    [],
  );

  for (let zoom = 0; zoom < 16; zoom += 1) {
    const activeLayers = style.layers.filter((layer) => {
      const minimumZoom = typeof layer.minzoom === 'number' ? layer.minzoom : 0;
      const maximumZoom = typeof layer.maxzoom === 'number' ? layer.maxzoom : Infinity;
      return (
        minimumZoom <= zoom &&
        zoom < maximumZoom &&
        (layer.layout as Record<string, unknown> | undefined)?.visibility !== 'none'
      );
    });
    assert.equal(
      activeLayers.length <= 80,
      true,
      `z${zoom} activates ${activeLayers.length} layers`,
    );
  }
});

test('renders exact World V1 roundabouts from point-radius geometry', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const physicalSurface = style.layers.find(
    (layer) => layer.id === 'streets-road-physical-surface',
  );
  const physicalSpace = style.layers.find((layer) => layer.id === 'streets-road-physical-space');
  const casing = style.layers.find((layer) => layer.id === 'streets-road-circular-casing');
  const fill = style.layers.find((layer) => layer.id === 'streets-road-circular-fill');
  const oneWayIndex = style.layers.findIndex((layer) => layer.id === 'streets-road-oneway');
  const casingIndex = style.layers.indexOf(casing!);
  const fillIndex = style.layers.indexOf(fill!);
  const casingPaint = casing?.paint as Record<string, unknown> | undefined;
  const fillPaint = fill?.paint as Record<string, unknown> | undefined;
  const countZoomInputs = (value: unknown): number => {
    if (!Array.isArray(value)) return 0;
    return (
      (value[0] === 'zoom' ? 1 : 0) + value.reduce((sum, entry) => sum + countZoomInputs(entry), 0)
    );
  };

  assert.equal(physicalSurface, undefined);
  assert.equal(physicalSpace, undefined);

  assert.equal(casing?.type, 'circle');
  assert.equal(casing?.['source-layer'], 'circular_feature');
  assert.equal(casing?.minzoom, 15);
  assert.deepEqual(casing?.filter, ['==', ['get', 'circle_kind'], 'road_ring']);
  assert.equal(casingPaint?.['circle-color'], 'rgba(0, 0, 0, 0)');
  assert.equal(casingPaint?.['circle-pitch-alignment'], 'map');
  assert.equal(casingPaint?.['circle-pitch-scale'], 'map');
  assert.match(JSON.stringify(casingPaint?.['circle-radius']), /radius_px_z15/);
  assert.match(JSON.stringify(casingPaint?.['circle-radius']), /outer_radius_m/);
  assert.match(JSON.stringify(casingPaint?.['circle-radius']), /inner_radius_m/);
  assert.doesNotMatch(JSON.stringify(casingPaint?.['circle-radius']), /road_width_m|0\.075/);
  assert.match(JSON.stringify(casingPaint?.['circle-stroke-width']), /outer_radius_m/);
  assert.match(JSON.stringify(casingPaint?.['circle-stroke-width']), /inner_radius_m/);
  assert.equal(fill?.type, 'circle');
  assert.equal(fill?.['source-layer'], 'circular_feature');
  assert.ok(casingIndex < fillIndex);
  assert.ok(fillIndex < oneWayIndex);
  assert.equal(fillPaint?.['circle-stroke-color'], '#B3BDCC');
  assert.doesNotMatch(
    JSON.stringify(fillPaint?.['circle-stroke-width']),
    /road_width_m|0\.91|1\.15/,
  );
  for (const expression of [
    casingPaint?.['circle-radius'],
    casingPaint?.['circle-stroke-width'],
    fillPaint?.['circle-radius'],
    fillPaint?.['circle-stroke-width'],
  ]) {
    assert.equal(countZoomInputs(expression), 1);
  }
});

test('widens z17 clearance roads laterally without extending their endpoints', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const expectedCap = [
    'step',
    ['zoom'],
    [
      'case',
      [
        'any',
        ['==', ['get', 'brunnel'], 'tunnel'],
        ['==', ['get', 'class'], 'steps'],
        ['==', ['get', 'subclass'], 'steps'],
      ],
      'butt',
      'round',
    ],
    17,
    [
      'case',
      [
        'any',
        [
          'any',
          ['==', ['get', 'brunnel'], 'tunnel'],
          ['==', ['get', 'class'], 'steps'],
          ['==', ['get', 'subclass'], 'steps'],
        ],
        ['>', ['to-number', ['coalesce', ['get', 'clearance_extra_px_z15'], 0], 0], 0],
      ],
      'butt',
      'round',
    ],
  ];
  const clearanceDecks = style.layers.filter((layer) => {
    if (
      layer.type !== 'line' ||
      typeof layer.id !== 'string' ||
      !/^streets-road-(surface|bridge)-/u.test(layer.id)
    )
      return false;
    const width = (layer.paint as Record<string, unknown> | undefined)?.['line-width'];
    return JSON.stringify(width).includes('clearance_extra_px_z15');
  });

  assert.ok(clearanceDecks.length > 0);
  for (const layer of clearanceDecks) {
    assert.deepEqual(
      (layer.layout as Record<string, unknown> | undefined)?.['line-cap'],
      expectedCap,
      `${layer.id} must not extend a clearance-enriched endpoint`,
    );
  }

  for (const id of [
    'streets-road-surface-highzoom-path-fill',
    'streets-road-bridge-highzoom-path-fill',
  ]) {
    const layer = style.layers.find((candidate) => candidate.id === id);
    assert.ok(layer, `${id} must remain in the optimized style`);
    assert.deepEqual((layer?.layout as Record<string, unknown>)?.['line-cap'], expectedCap);
    const width = (layer?.paint as Record<string, unknown> | undefined)?.['line-width'];
    assert.doesNotMatch(JSON.stringify(width), /clearance_extra_px_z15/u);
  }
});

test('draws every available pedestrian crossing above the road stack', async () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const crossingIndex = style.layers.findIndex((layer) => layer.id === 'streets-road-crossing');
  const buildingIndex = style.layers.findIndex((layer) => layer.id === 'streets-buildings-fill');
  const crossing = style.layers[crossingIndex];
  const layout = crossing?.layout as Record<string, unknown> | undefined;

  assert.equal(crossing?.type, 'symbol');
  assert.equal(crossing?.['source-layer'], 'street_furniture');
  assert.equal(crossing?.minzoom, 16);
  assert.deepEqual(crossing?.filter, [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['==', ['get', 'subclass'], 'crossing'],
  ]);
  assert.equal(layout?.['icon-image'], 'crosswalk');
  assert.ok(crossingIndex < buildingIndex);
  assert.equal(layout?.['icon-pitch-alignment'], 'map');
  assert.deepEqual(layout?.['icon-rotate'], ['+', ['to-number', ['get', 'direction'], 0], 90]);
  assert.deepEqual(layout?.['icon-size'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0.22,
    16,
    0.3,
    17,
    0.5,
    18,
    0.75,
    19,
    1.05,
    20,
    2,
    21,
    3.5,
    22,
    5.5,
  ]);
  assert.equal(
    style.layers.some(
      (layer, index) =>
        index > crossingIndex &&
        typeof layer.id === 'string' &&
        layer.id.startsWith('streets-road-') &&
        layer.id !== crossing?.id,
    ),
    false,
  );

  const icon = await readFile(new URL('../icons/crosswalk.svg', import.meta.url), 'utf8');
  assert.match(icon, /<svg/);
  assert.match(icon, /width="24" height="14"/);
  assert.equal((icon.match(/<rect/g) ?? []).length, 5);
  assert.equal((icon.match(/width="2" height="14"/g) ?? []).length, 5);
  assert.doesNotMatch(icon, /stroke=|rx=/);
});

test('renders parking surfaces and keeps their access aisles legible', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const parking = style.layers.find((layer) => layer.id === 'streets-landuse-parking');
  const parkingPaint = parking?.paint as Record<string, unknown> | undefined;
  const parkingAisles = style.layers.find(
    (layer) => layer.id === 'streets-road-surface-highzoom-local-fill',
  );
  const parkingAisleWidth = (parkingAisles?.paint as Record<string, unknown> | undefined)?.[
    'line-width'
  ];

  assert.equal(parking?.minzoom, 15);
  assert.deepEqual(parking?.filter, ['match', ['get', 'class'], ['parking'], true, false]);
  assert.equal(parkingPaint?.['fill-color'], '#F0EDED');
  assert.match(JSON.stringify(parkingAisleWidth), /parking_aisle/);
  assert.match(JSON.stringify(parkingAisleWidth), /0\.62/);
  assert.equal(
    style.layers.some((layer) => layer.id === 'streets-road-area'),
    false,
  );
  assert.equal(
    style.layers.some((layer) => layer.id === 'streets-road-pedestrian-area'),
    false,
  );

  const parkingMarker = style.layers.find((layer) => layer.id === 'streets-parking-symbol-disc');
  const parkingLabel = style.layers.find((layer) => layer.id === 'streets-parking-symbol-label');
  assert.equal((parkingMarker?.paint as Record<string, unknown>)?.['text-color'], '#8C78F6');
  assert.equal((parkingLabel?.layout as Record<string, unknown>)?.['text-field'], 'P');
});

test('stages a strong Google-like road surface across the complete zoom range', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const expected = {
    minor: {minzoom: 12},
    motorway: {minzoom: 3.2},
    primary: {minzoom: 6},
    secondary: {minzoom: 7.5},
    tertiary: {minzoom: 9},
    trunk: {minzoom: 5.8},
  } as const;

  for (const [roadClass, road] of Object.entries(expected)) {
    const layer = style.layers.find(
      (candidate) => candidate.id === `streets-road-surface-${roadClass}-fill`,
    );
    const paint = layer?.paint as Record<string, unknown> | undefined;
    const color = JSON.stringify(paint?.['line-color']);
    const casing = style.layers.find(
      (candidate) =>
        candidate.id ===
        `streets-road-surface-highzoom-${['motorway', 'trunk'].includes(roadClass) ? 'major' : ['primary', 'secondary', 'tertiary'].includes(roadClass) ? 'arterial' : 'local'}-casing`,
    );
    const casingColor = JSON.stringify(
      (casing?.paint as Record<string, unknown> | undefined)?.['line-color'],
    );
    const casingWidth = JSON.stringify(
      (casing?.paint as Record<string, unknown> | undefined)?.['line-width'],
    );

    assert.equal(layer?.minzoom, road.minzoom);
    assert.match(color, /#B3BDCC/);
    assert.match(casingColor, /#[0-9a-fA-F]{6}/);
    assert.match(casingWidth, /,16,.*\["\+".*"expressway"/);
    assert.equal((paint?.['line-opacity'] as unknown[] | undefined)?.[0], 'interpolate');
  }

  const transitionWidths = {
    minor: {12: 0.8, 13: 1.2, 14: 1.8, 15: 2.8, 16: 5, 17: 10, 19: 23},
    primary: {15: 7, 16: 11, 17: 24, 19: 52},
    secondary: {15: 5.2, 16: 8, 17: 18, 19: 40},
    tertiary: {15: 3.7, 16: 6, 17: 14, 19: 30},
  } as const;
  const findOneWayWidth = (value: unknown): unknown[] | undefined => {
    if (
      Array.isArray(value) &&
      value[0] === 'match' &&
      JSON.stringify(value[1]) === JSON.stringify(['get', 'oneway'])
    ) {
      return value;
    }
    if (!Array.isArray(value)) return undefined;
    for (const entry of value) {
      const match = findOneWayWidth(entry);
      if (match) return match;
    }
    return undefined;
  };
  for (const [roadClass, widths] of Object.entries(transitionWidths)) {
    const layer = style.layers.find(
      (candidate) => candidate.id === `streets-road-surface-${roadClass}-fill`,
    );
    const expression = (layer?.paint as Record<string, unknown> | undefined)?.[
      'line-width'
    ] as unknown[];
    for (const [level, expectedWidth] of Object.entries(widths)) {
      const stopIndex = expression.indexOf(Number(level));
      const stopOutput = expression[stopIndex + 1];
      const oneWayMatch = findOneWayWidth(stopOutput);
      assert.equal(oneWayMatch?.at(-1), expectedWidth);
      assert.doesNotMatch(JSON.stringify(stopOutput), /road_width_m/);
    }
  }

  const motorway = style.layers.find(
    (candidate) => candidate.id === 'streets-road-surface-motorway-fill',
  );
  const motorwayOpacity = (motorway?.paint as Record<string, unknown> | undefined)?.[
    'line-opacity'
  ];
  assert.match(JSON.stringify(motorwayOpacity), /e-road/);
  assert.match(JSON.stringify(motorwayOpacity), /"ref"/);
  assert.equal((motorwayOpacity as unknown[]).includes(5.8), true);
});

test('keeps structural roads legible and progressively detailed across zooms', async () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const layer = (id: string) => style.layers.find((candidate) => candidate.id === id);
  const paint = (id: string) => layer(id)?.paint as Record<string, unknown> | undefined;

  const waterIndex = style.layers.findIndex((candidate) => candidate.id === 'streets-water');
  const lowTunnelIndex = style.layers.findIndex(
    (candidate) => candidate.id === 'streets-road-tunnel-motorway-fill',
  );
  const surfaceIndex = style.layers.findIndex(
    (candidate) => candidate.id === 'streets-road-surface-motorway-fill',
  );
  const buildingIndex = style.layers.findIndex(
    (candidate) => candidate.id === 'streets-buildings-fill',
  );

  assert.ok(waterIndex < lowTunnelIndex);
  assert.ok(lowTunnelIndex < surfaceIndex);
  assert.ok(surfaceIndex < buildingIndex);

  assert.equal(paint('streets-road-tunnel-motorway-fill')?.['line-color'], '#D9E1E7');
  assert.equal(paint('streets-road-tunnel-motorway-fill')?.['line-opacity'], 0.5);
  assert.deepEqual(
    paint('streets-road-tunnel-motorway-fill')?.['line-width'],
    paint('streets-road-surface-motorway-fill')?.['line-width'],
  );
  assert.equal(layer('streets-road-tunnel-motorway-fill')?.maxzoom, 16);

  assert.equal(paint('streets-road-tunnel-highzoom-major-fill')?.['line-color'], '#D9E1E7');
  assert.equal(paint('streets-road-tunnel-highzoom-major-fill')?.['line-opacity'], 0.5);
  assert.deepEqual(
    paint('streets-road-tunnel-highzoom-major-fill')?.['line-width'],
    paint('streets-road-surface-highzoom-major-fill')?.['line-width'],
  );

  assert.match(
    JSON.stringify(paint('streets-road-bridge-motorway-fill')?.['line-color']),
    /#B3BDCC/,
  );
  assert.doesNotMatch(
    JSON.stringify(paint('streets-road-bridge-motorway-fill')?.['line-color']),
    /#D9E1E7/,
  );
  assert.equal(paint('streets-road-bridge-minor-fill')?.['line-color'], '#D9E1E7');
  assert.equal(paint('streets-road-bridge-highzoom-local-casing')?.['line-color'], '#AAB8C3');
  assert.doesNotMatch(
    JSON.stringify(paint('streets-road-bridge-highzoom-path-fill')?.['line-color']),
    /#FDFDFD/,
  );
  assert.match(
    JSON.stringify(paint('streets-road-bridge-highzoom-path-fill')?.['line-color']),
    /#D9E1E7/,
  );
  assert.equal(paint('streets-road-bridge-highzoom-path-casing')?.['line-color'], '#AAB8C3');

  const serviceTunnelLayers = style.layers.filter(
    (candidate) =>
      typeof candidate.id === 'string' &&
      candidate.id.startsWith('streets-road-tunnel-') &&
      JSON.stringify(candidate.filter).includes('service'),
  );
  assert.deepEqual(serviceTunnelLayers, []);

  assert.equal(layer('streets-road-tunnel-hatch'), undefined);
  const tunnelCasings = style.layers.filter(
    (candidate) =>
      typeof candidate.id === 'string' &&
      candidate.id.startsWith('streets-road-tunnel-') &&
      candidate.id.endsWith('-casing'),
  );
  const tunnelFills = style.layers.filter(
    (candidate) =>
      typeof candidate.id === 'string' &&
      candidate.id.startsWith('streets-road-tunnel-') &&
      candidate.id.endsWith('-fill'),
  );
  assert.equal(tunnelCasings.length > 0, true);
  assert.equal(tunnelFills.length > 0, true);
  assert.equal(
    tunnelCasings.every((candidate) =>
      Boolean((candidate.paint as Record<string, unknown>)?.['line-dasharray']),
    ),
    true,
  );
  assert.equal(
    tunnelCasings.every((candidate) =>
      Boolean((candidate.paint as Record<string, unknown>)?.['line-gap-width']),
    ),
    true,
  );
  const tunnelCasingWidths = JSON.stringify(
    tunnelCasings.map((candidate) => (candidate.paint as Record<string, unknown>)?.['line-width']),
  );
  assert.match(tunnelCasingWidths, /1/);
  assert.doesNotMatch(tunnelCasingWidths, /__tileflow_fixed_road_border/);
  assert.equal(
    tunnelCasings.every(
      (candidate) => (candidate.paint as Record<string, unknown>)?.['line-opacity'] === 1,
    ),
    true,
  );
  assert.equal(
    tunnelFills.every(
      (candidate) => (candidate.paint as Record<string, unknown>)?.['line-opacity'] === 0.5,
    ),
    true,
  );
  const tunnelDash = JSON.stringify(
    tunnelCasings.map(
      (candidate) => (candidate.paint as Record<string, unknown>)?.['line-dasharray'],
    ),
  );
  assert.match(tunnelDash, /\[8,5\]/);
});

test('keeps street zooms light with class-based widths through zoom 22', () => {
  const style = createStyleFromProject(project, 'editorial-city');
  const expectedWidths = {
    minor: 145,
    motorway: 380,
    primary: 285,
    secondary: 240,
    service: 100,
    tertiary: 185,
    track: 8,
    trunk: 330,
  } as const;

  for (const [roadClass, expectedWidth] of Object.entries(expectedWidths)) {
    const layer = style.layers.find(
      (candidate) =>
        candidate.id ===
        `streets-road-surface-highzoom-${['motorway', 'trunk'].includes(roadClass) ? 'major' : ['primary', 'secondary', 'tertiary'].includes(roadClass) ? 'arterial' : 'local'}-fill`,
    );
    const width = (layer?.paint as Record<string, unknown> | undefined)?.[
      'line-width'
    ] as unknown[];
    const finalTreatment = width.at(-1) as unknown[];
    const containsExpectedWidth = (value: unknown): boolean =>
      value === expectedWidth ||
      (Array.isArray(value) && value.some((entry) => containsExpectedWidth(entry)));

    assert.equal(containsExpectedWidth(finalTreatment), true);
  }

  const oneWay = style.layers.find((layer) => layer.id === 'streets-road-oneway');
  const oneWayLayout = oneWay?.layout as Record<string, unknown> | undefined;
  const oneWayPaint = oneWay?.paint as Record<string, unknown> | undefined;
  assert.deepEqual(oneWayLayout?.['text-field'], ['case', ['==', ['get', 'oneway'], -1], '←', '→']);
  assert.equal(oneWayLayout?.['icon-image'], 'oneway');
  assert.equal(oneWayLayout?.['icon-keep-upright'], false);
  assert.deepEqual(oneWayLayout?.['icon-rotate'], ['case', ['==', ['get', 'oneway'], -1], 180, 0]);
  assert.equal(oneWayLayout?.['text-keep-upright'], false);
  assert.equal(oneWayLayout?.['text-pitch-alignment'], 'map');
  assert.equal(oneWayLayout?.['text-rotation-alignment'], 'map');
  assert.deepEqual(oneWayLayout?.['text-size'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    11,
    17,
    17,
    19,
    20,
    22,
    24,
  ]);
  assert.equal(oneWayPaint?.['text-opacity'], 0);
  assert.deepEqual(oneWayPaint?.['icon-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0,
    15.5,
    0.92,
    16,
    1,
  ]);
});

test('covers the canonical cartographic review surfaces with standalone scenes', () => {
  assert.deepEqual(Object.keys(project.scenes).sort(), [
    'barcelona-waterfront',
    'madrid-airport',
    'madrid-center',
    'madrid-close-street',
    'madrid-mobile',
    'madrid-motorway',
    'madrid-neighborhood',
    'madrid-overview',
    'madrid-rural-edge',
    'madrid-sol-close',
    'madrid-transit',
    'madrid-tunnels',
  ]);
  assert.equal(
    Object.values(project.scenes).every(
      (scene) => scene.map === 'editorial-city' && !('target' in scene),
    ),
    true,
  );
  assert.deepEqual(project.scenes['madrid-mobile'].viewport, {
    width: 390,
    height: 844,
    dpr: 2,
  });
  assert.deepEqual(project.scenes['madrid-tunnels'].camera, {
    type: 'center',
    center: [-3.72197, 40.41885],
    zoom: 16,
  });
});

test('workspace Streets commands prepare the packaged CLI before running it', async () => {
  const workspacePackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as {scripts: Record<string, string>};

  assert.equal(workspacePackage.scripts['streets:prepare'], 'turbo build --filter=@tileflow/cli');

  for (const command of [
    'capture:streets',
    'dev:streets',
    'visual:streets',
    'visual:streets:update',
  ]) {
    assert.match(
      workspacePackage.scripts[command] ?? '',
      /^pnpm run streets:prepare && node packages\/cli\/dist\/index\.js /,
      `${command} must not consume stale workspace package output`,
    );
  }

  for (const sceneName of Object.keys(project.scenes)) {
    assert.match(workspacePackage.scripts['visual:streets'] ?? '', new RegExp(sceneName));
    assert.match(workspacePackage.scripts['visual:streets:update'] ?? '', new RegExp(sceneName));
  }
});
