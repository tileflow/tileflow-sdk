import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {defineMap, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {soundings, soundingsIcons} from '../src';

const soundingsIconIds = [
  'soundings-buoy-cardinal',
  'soundings-buoy-port',
  'soundings-buoy-starboard',
  'soundings-harbor',
  'soundings-light-flare',
  'soundings-lighthouse',
  'soundings-paper-grain',
  'soundings-rock-awash',
  'soundings-water-dots',
  'soundings-wreck',
] as const;

const preparedAssets = {
  icons: {ids: soundingsIconIds, sprite: '/tileflow/icons/soundings/sprite'},
} as const;

test('Soundings is a frozen independent map with only its own asset directory', async () => {
  assert.equal(Object.isFrozen(soundings), true);
  assert.equal('root' in soundings, false);
  assert.equal('extends' in soundings, false);
  assert.deepEqual(resolveMap(soundings).icons, [soundingsIcons]);

  const source = await readFile(new URL('../src/official/soundings.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
  assert.doesNotMatch(
    source,
    /@tileflow\/core\/recipe|defineModuleEffects|semanticField|semanticLayer/u,
  );
});

test('Soundings compiles a focused bathymetric chart from World and Bathymetry', () => {
  const compiled = createStyleWithInspection(soundings, {preparedAssets});
  const {style} = compiled;
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

  assert.equal(style.metadata?.['tileflow:map'], 'soundings');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.deepEqual(soundings.view, {
    bearing: 0,
    center: [-5.6, 36.05],
    pitch: 0,
    zoom: 6.75,
  });
  assert.equal(
    (soundings.marine as {bathymetry?: {display?: string}}).bathymetry?.display,
    'hybrid',
  );
  assert.equal((soundings.marine as {nautical?: unknown}).nautical, false);
  assert.equal('nautical' in soundings.modules, false);
  assert.equal(style.sources['tileflow-bathymetry']?.type, 'vector');
  assert.equal(
    style.sources['tileflow-bathymetry']?.url,
    'https://api.tileflow.dev/tiles/bathymetry/tiles.json',
  );
  assert.deepEqual(style.sources['tileflow-bathymetry-dem'], {
    encoding: 'terrarium',
    tileSize: 512,
    type: 'raster-dem',
    url: 'https://api.tileflow.dev/tiles/bathymetry/dem/tiles.json',
  });
  assert.equal(style.sources['tileflow-nautical'], undefined);
  assert.equal(style.sprite, '/tileflow/icons/soundings/sprite');
  assert.deepEqual(validateStyleMin(style as never), []);

  assert.equal(byId.get('tileflow-background')?.paint?.['background-color'], '#EADDB9');
  assert.equal(
    byId.get('tileflow-background')?.paint?.['background-pattern'],
    'soundings-paper-grain',
  );
  assert.equal(byId.get('tileflow-water')?.paint?.['fill-color'], '#F7FBF8');

  for (const pattern of [
    /^tileflow-road-/u,
    /^tileflow-buildings?-/u,
    /^tileflow-address/u,
    /^tileflow-aeroway/u,
    /^tileflow-transit-(?:rail|cableway)/u,
  ]) {
    assert.equal(
      style.layers.some(({id}) => pattern.test(id)),
      false,
      `Soundings emitted excluded terrestrial layer family ${pattern.source}`,
    );
  }

  const bathymetry = byId.get('tileflow-bathymetry');
  const bathymetryColorRelief = byId.get('tileflow-bathymetry-color-relief');
  const bathymetryRelief = byId.get('tileflow-bathymetry-relief');
  const bathymetryContours = byId.get('tileflow-bathymetry-contours');
  const bathymetryLabels = byId.get('tileflow-bathymetry-labels');
  assert.ok(bathymetry);
  assert.equal(bathymetry['source-layer'], 'bathymetry');
  assert.match(JSON.stringify(bathymetry.paint?.['fill-color']), /#BBDDDC/u);
  assert.match(JSON.stringify(bathymetry.paint?.['fill-color']), /#F8FAF5/u);
  const bathymetryDepthStops = (bathymetry.paint?.['fill-color'] as unknown[])
    .slice(3)
    .filter((_, index) => index % 2 === 0);
  assert.deepEqual(
    bathymetryDepthStops,
    [-11_000, -8_000, -6_000, -4_000, -2_000, -1_000, -500, -200, -100, -50, -20, -10, 0],
  );
  assert.equal(bathymetryColorRelief?.type, 'color-relief');
  assert.equal(bathymetryColorRelief?.source, 'tileflow-bathymetry-dem');
  assert.match(JSON.stringify(bathymetryColorRelief?.paint?.['color-relief-color']), /elevation/u);
  assert.equal(bathymetryColorRelief?.paint?.['color-relief-opacity'], 0.18);
  assert.equal(bathymetryColorRelief?.paint?.resampling, 'linear');
  assert.equal(bathymetryRelief?.type, 'hillshade');
  assert.equal(bathymetryRelief?.source, 'tileflow-bathymetry-dem');
  assert.equal(bathymetryRelief?.paint?.['hillshade-method'], 'multidirectional');
  assert.deepEqual(
    bathymetryRelief?.paint?.['hillshade-illumination-direction'],
    [270, 315, 0, 45],
  );
  assert.deepEqual(bathymetryRelief?.paint?.['hillshade-illumination-altitude'], [45, 45, 45, 45]);
  assert.equal(bathymetryRelief?.paint?.['hillshade-exaggeration'], 0.24);
  assert.ok(
    style.layers.findIndex(({id}) => id === 'tileflow-bathymetry-relief') <
      style.layers.findIndex(({id}) => id === 'tileflow-bathymetry-labels'),
  );
  assert.ok(bathymetryContours);
  assert.equal(bathymetryContours['source-layer'], 'bathymetry');
  assert.equal(bathymetryContours.paint?.['line-color'], '#466F73');
  assert.deepEqual(bathymetryContours.paint?.['line-dasharray'], [4, 2]);
  assert.match(JSON.stringify(bathymetryContours.filter), /min_depth/u);
  assert.match(JSON.stringify(bathymetryContours.filter), /"<"/u);
  assert.ok(bathymetryLabels);
  assert.equal(bathymetryLabels['source-layer'], 'bathymetry');
  assert.equal(bathymetryLabels.layout?.['symbol-placement'], 'line');
  assert.equal(bathymetryLabels.layout?.['symbol-spacing'], 320);
  const bathymetryLabelExpression = bathymetryLabels.layout?.['text-field'];
  assert.deepEqual(bathymetryLabelExpression, [
    'concat',
    ['to-string', ['abs', ['to-number', ['get', 'min_depth'], 0]]],
    ' m',
  ]);
  for (const depth of [
    -11_000, -8_000, -6_000, -4_000, -2_000, -1_000, -500, -200, -100, -50, -20, -10, 0,
  ]) {
    assert.equal(
      evaluateBathymetryLabel(bathymetryLabelExpression, {min_depth: depth}),
      `${Math.abs(depth)} m`,
      `unlabelled Bathymetry stop ${depth}`,
    );
  }

  assert.equal(
    style.layers.some((layer) => layer.source === 'tileflow-nautical'),
    false,
  );

  const pierOutline = compiledLayer(compiled, 'water.render.pierOutline');
  const pierDeck = compiledLayer(compiled, 'water.render.pierDeck');
  assert.equal(pierOutline?.['source-layer'], 'transportation');
  assert.equal(pierOutline?.paint?.['line-color'], '#263D3F');
  assert.match(JSON.stringify(pierOutline?.filter), /pier/u);
  assert.equal(pierDeck?.['source-layer'], 'transportation');
  assert.equal(pierDeck?.paint?.['line-color'], '#EADDB9');
  assert.equal(style.layers.indexOf(pierOutline!) + 1, style.layers.indexOf(pierDeck!));

  const ferryLabels = compiledLayer(compiled, 'transit.render.ferryLabels');
  assert.equal(ferryLabels?.['source-layer'], 'transportation_name');
  assert.equal(ferryLabels?.layout?.['symbol-placement'], 'line');
  assert.equal(ferryLabels?.layout?.['text-field']?.[1], 'name');
  assert.match(JSON.stringify(ferryLabels?.filter), /ferry/u);

  assert.equal(
    compiledLayer(compiled, 'water.render.chartDots')?.paint?.['fill-pattern'],
    'soundings-water-dots',
  );
  assert.equal(
    compiledLayer(compiled, 'water.render.intermittentChartDots')?.paint?.['fill-pattern'],
    'soundings-water-dots',
  );

  for (const id of [
    'tileflow-boundary-maritime',
    'tileflow-boundary-disputed',
    'tileflow-boundary-disputed-maritime',
  ]) {
    assert.equal(byId.get(id)?.paint?.['line-color'], '#B12A73', `${id} lost technical magenta`);
  }
  assert.equal(byId.get('tileflow-transit-ferry')?.paint?.['line-color'], '#466F73');
  assert.deepEqual(byId.get('tileflow-transit-ferry')?.paint?.['line-dasharray'], [7, 2, 1, 2]);

  assert.equal(
    [...byId.keys()].some((id) => id.startsWith('tileflow-poi-')),
    false,
    'broad World POI categories leaked into the nautical chart',
  );
  for (const id of [
    'tileflow-poi-buoy-cardinal-icon',
    'tileflow-poi-buoy-port-icon',
    'tileflow-poi-buoy-starboard-icon',
    'tileflow-poi-light-icon',
    'tileflow-poi-lighthouse-icon',
    'tileflow-poi-rock-awash-icon',
    'tileflow-poi-wreck-icon',
  ]) {
    assert.equal(byId.has(id), false, `${id} leaked experimental Nautical content`);
  }
});

test('Soundings degrades cleanly on generic OpenMapTiles without bathymetry', () => {
  const data = vectorTiles({
    attribution: 'Generic OpenMapTiles fixture',
    schema: openMapTiles({
      capabilities: {
        bathymetry: false,
        businessCorridor: false,
        globalLandcover: false,
        tree: false,
      },
    }),
    tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  });
  const generic = defineMap({
    id: 'soundings-generic',
    version: 1,
    extends: soundings,
    data,
    marine: 'none',
  });
  const compiled = createStyleWithInspection(generic, {preparedAssets});
  const {style} = compiled;
  const ids = new Set(style.layers.map(({id}) => id));
  const targets = compiledTargets(compiled);

  assert.equal(ids.has('tileflow-bathymetry'), false);
  assert.equal(ids.has('tileflow-bathymetry-contours'), false);
  assert.equal(ids.has('tileflow-bathymetry-labels'), false);
  assert.equal(ids.has('tileflow-bathymetry-color-relief'), false);
  assert.equal(ids.has('tileflow-bathymetry-relief'), false);
  assert.equal(style.sources['tileflow-bathymetry-dem'], undefined);
  assert.equal(ids.has('tileflow-water'), true);
  assert.equal(ids.has('tileflow-water-intermittent'), true);
  assert.equal(targets.has('water.render.chartDots'), true);
  assert.equal(targets.has('water.render.intermittentChartDots'), true);
  assert.equal(targets.has('water.render.pierOutline'), true);
  assert.equal(targets.has('water.render.pierDeck'), true);
  assert.equal(targets.has('transit.render.ferryLabels'), true);
  assert.deepEqual(validateStyleMin(style as never), []);
});

function evaluateBathymetryLabel(
  value: unknown,
  properties: Readonly<Record<string, unknown>>,
): unknown {
  if (!Array.isArray(value)) return value;
  switch (value[0]) {
    case 'get':
      return properties[String(value[1])];
    case 'to-number': {
      const resolved = Number(evaluateBathymetryLabel(value[1], properties));
      return Number.isFinite(resolved) ? resolved : evaluateBathymetryLabel(value[2], properties);
    }
    case 'abs':
      return Math.abs(Number(evaluateBathymetryLabel(value[1], properties)));
    case 'to-string':
      return String(evaluateBathymetryLabel(value[1], properties));
    case 'concat':
      return value
        .slice(1)
        .map((entry) => String(evaluateBathymetryLabel(entry, properties)))
        .join('');
    default:
      throw new Error(`Unsupported Bathymetry label test expression: ${String(value[0])}`);
  }
}

function compiledTargets(compiled: ReturnType<typeof createStyleWithInspection>): Set<string> {
  return new Set(
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.map((contribution) => contribution.target),
    ),
  );
}

function compiledLayer(compiled: ReturnType<typeof createStyleWithInspection>, target: string) {
  const layerId = compiled.inspection.layers.find((layer) =>
    layer.contributions.some((contribution) => contribution.target === target),
  )?.id;
  return compiled.style.layers.find((layer) => layer.id === layerId);
}
