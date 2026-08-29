import {featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {resolveMap} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {sanFrancisto, sanFrancistoIcons} from '../src';

const sanFrancistoAssetIds = [
  'san-francisto-blueprint-grid',
  'san-francisto-building-hatch',
  'san-francisto-landscape-hatch',
  'san-francisto-poi-node',
  'san-francisto-water-hatch',
] as const;

const expectedAssetFiles = [
  'san-francisto-blueprint-grid.pattern.svg',
  'san-francisto-building-hatch.pattern.svg',
  'san-francisto-landscape-hatch.pattern.svg',
  'san-francisto-poi-node.svg',
  'san-francisto-water-hatch.pattern.svg',
] as const;

const expectedPatternIds = [
  'san-francisto-blueprint-grid',
  'san-francisto-building-hatch',
  'san-francisto-landscape-hatch',
  'san-francisto-water-hatch',
] as const;

const preparedAssets = {
  icons: {
    ids: sanFrancistoAssetIds,
    sprite: '/tileflow/icons/san-francisto/sprite',
  },
} as const;

let compiledCache: ReturnType<typeof createStyleWithInspection> | undefined;

function compileSanFrancisto() {
  compiledCache ??= createStyleWithInspection(sanFrancisto, {preparedAssets});
  return compiledCache;
}

test('San Francisto is a frozen standalone blueprint with its exact view and providers', () => {
  assert.equal(sanFrancisto.id, 'san-francisto');
  assert.equal(sanFrancisto.name, 'Blueprint');
  assert.equal(sanFrancisto.version, 1);
  assert.equal('root' in sanFrancisto, false);
  assert.equal('extends' in sanFrancisto, false);
  assertDeepFrozen(sanFrancisto);

  assert.deepEqual(sanFrancisto.data, {
    generation: 'v1',
    selection: {kind: 'current', product: 'world-v1'},
    type: 'tileflow-world',
  });
  assert.equal(sanFrancisto.projection, 'mercator');
  assert.deepEqual(sanFrancisto.view, {
    bearing: 0,
    center: [-122.3995, 37.795],
    pitch: 0,
    zoom: 15,
  });

  const resolved = resolveMap(sanFrancisto);
  assert.deepEqual(resolved.icons, [sanFrancistoIcons]);
  assert.deepEqual(resolved.glyphs, {
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    kind: 'url',
    url: 'https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf',
  });
  assert.equal(resolved.defaultTheme, 'blueprint');
  assert.equal(resolved.themes.blueprint.id, 'san-francisto-blueprint');
  assert.equal(resolved.themes.blueprint.colorScheme, 'dark');
  assert.equal(resolved.themes.blueprint.typography?.font, 'Noto Sans Regular');
});

test('San Francisto publishes exactly its five original technical assets', async () => {
  assert.deepEqual(
    (await readdir(new URL('../assets/san-francisto/icons/', import.meta.url))).sort(),
    [...expectedAssetFiles],
  );
  assert.deepEqual(sanFrancistoIcons, {
    kind: 'package-directory',
    package: '@tileflow/maps',
    path: 'assets/san-francisto/icons',
  });

  const calloutSvg = await readFile(
    new URL('../assets/san-francisto/icons/san-francisto-poi-node.svg', import.meta.url),
    'utf8',
  );
  assert.match(calloutSvg, /width="36" height="18"/);
  assert.match(calloutSvg, /id="callout-ring"/);
  assert.match(calloutSvg, /id="callout-letter"/);
  assert.match(calloutSvg, /id="callout-leader"/);
  assert.match(calloutSvg, /id="callout-terminal"/);
});

test('San Francisto compiles to a valid self-contained MapLibre style', () => {
  const {style} = compileSanFrancisto();

  assert.equal(style.metadata?.['tileflow:map'], 'san-francisto');
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:theme'], 'blueprint');
  assert.equal(style.metadata?.['tileflow:colorScheme'], 'dark');
  assert.equal(style.sprite, '/tileflow/icons/san-francisto/sprite');
  assert.equal(style.glyphs, 'https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('San Francisto compiles survey contours without hillshade or 3D terrain', () => {
  const {style} = compileSanFrancisto();
  const source = style.sources['san-francisto-contours'];
  const layerIds = style.layers.map(({id}) => id);

  assert.equal(style.terrain, undefined);
  assert.equal(
    layerIds.some((id) => id.includes('hillshade')),
    false,
  );
  assert.equal(source?.type, 'vector');
  assert.equal(source?.minzoom, 9);
  assert.equal(source?.maxzoom, 14);
  assert.equal(
    source?.attribution,
    'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  );

  const contourUrl = new URL(String((source?.tiles as string[] | undefined)?.[0]));
  assert.equal(contourUrl.protocol, 'tileflow-contour:');
  assert.equal(contourUrl.searchParams.get('thresholds'), '9:50,250;11:20,100;13:10,50;14:10,50');

  for (const id of [
    'tileflow-terrain-contour-minor',
    'tileflow-terrain-contour-index',
    'tileflow-terrain-contour-labels',
  ]) {
    assert.ok(layerIds.includes(id), `Missing contour layer ${id}`);
  }

  const contourIndex = layerIds.indexOf('tileflow-terrain-contour-minor');
  assert.ok(contourIndex > layerIds.indexOf('tileflow-background'));
  assert.ok(contourIndex < layerIds.indexOf('tileflow-water'));
  assert.ok(contourIndex < layerIds.findIndex((id) => id.startsWith('tileflow-road-')));
  assert.ok(contourIndex < layerIds.indexOf('tileflow-label-place-city'));
});

test('San Francisto preserves its technical render targets, ordering, and pattern vocabulary', () => {
  const compiled = compileSanFrancisto();
  const targets = compiledTargets(compiled);

  for (const target of [
    'buildings.render.footprintHatch',
    'buildings.render.measuredEdge',
    'buildings.render.prominentOutline',
    'buildings.render.buildingAnnotations',
    'buildings.render.heightAnnotations',
    'land.render.landscapeHatch',
    'land.render.parkHatch',
    'land.render.recreationHatch',
    'land.render.industrialHatch',
    'poi.render.architecturalCallouts',
    'roads.render.majorRoadCenterline',
    'water.render.waterHatch',
    'water.render.intermittentWaterHatch',
  ]) {
    assert.ok(targets.has(target), `Missing San Francisto render target ${target}`);
  }

  assertOrdered(compiled, [
    'buildings.flat.fill',
    'buildings.render.footprintHatch',
    'buildings.flat.outline',
    'buildings.render.measuredEdge',
    'buildings.render.prominentOutline',
    'buildings.render.buildingAnnotations',
    'buildings.render.heightAnnotations',
  ]);
  assertOrdered(compiled, [
    'roads.classes.motorway.surface.fill',
    'roads.render.majorRoadCenterline',
  ]);
  assertOrdered(compiled, ['water.bodies.fill', 'water.render.waterHatch']);
  assertOrdered(compiled, [
    'water.intermittent.bodies.fill',
    'water.render.intermittentWaterHatch',
  ]);

  assert.deepEqual(patternReferences(compiled.style), [...expectedPatternIds]);
  assert.equal(
    compiledLayer(compiled, 'buildings.render.footprintHatch')?.paint?.['fill-pattern'],
    'san-francisto-building-hatch',
  );
  assert.equal(
    compiledLayer(compiled, 'land.render.landscapeHatch')?.paint?.['fill-pattern'],
    'san-francisto-landscape-hatch',
  );
  assert.equal(
    compiledLayer(compiled, 'water.render.waterHatch')?.paint?.['fill-pattern'],
    'san-francisto-water-hatch',
  );
  assert.equal(
    compiledLayer(compiled, 'poi.render.architecturalCallouts')?.layout?.['icon-image'],
    'san-francisto-poi-node',
  );
});

test('San Francisto encodes an architectural line and label hierarchy', () => {
  const compiled = compileSanFrancisto();
  const baseBuilding = compiledLayer(compiled, 'buildings.flat.outline');
  const prominentBuilding = compiledLayer(compiled, 'buildings.render.prominentOutline');
  const motorway = compiledLayer(compiled, 'roads.classes.motorway.surface.fill');
  const trunk = compiledLayer(compiled, 'roads.classes.trunk.surface.fill');
  const primaryRoad = compiledLayer(compiled, 'roads.classes.primary.surface.fill');
  const secondaryRoad = compiledLayer(compiled, 'roads.classes.secondary.surface.fill');
  const roundabout = compiledLayer(compiled, 'roads.roundabouts.fill');
  const districtLabel = compiledLayer(compiled, 'labels.places.neighborhood');
  const primaryLabel = compiledLayer(compiled, 'labels.roads.primary');
  const secondaryLabel = compiledLayer(compiled, 'labels.roads.secondary');
  const minorLabel = compiledLayer(compiled, 'labels.roads.minor');

  assert.ok(baseBuilding);
  assert.ok(prominentBuilding);
  assert.ok(motorway);
  assert.ok(trunk);
  assert.ok(primaryRoad);
  assert.ok(secondaryRoad);
  assert.ok(roundabout);
  assert.ok(districtLabel);
  assert.ok(primaryLabel);
  assert.ok(secondaryLabel);
  assert.ok(minorLabel);

  assert.equal(baseBuilding.paint?.['line-color'], '#91B7C9');
  assert.deepEqual(baseBuilding.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    13.5,
    0.2,
    17,
    0.5,
    20,
    0.72,
  ]);
  assert.equal(prominentBuilding.paint?.['line-color'], '#E8F0E8');
  assert.deepEqual(prominentBuilding.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    0.55,
    17,
    1.15,
    20,
    1.75,
  ]);

  assert.equal(motorway.paint?.['line-color'], '#B7CCD1');
  assert.equal(trunk.paint?.['line-color'], '#B7CCD1');
  assert.equal(primaryRoad.paint?.['line-color'], '#8EAFBE');
  assert.equal(secondaryRoad.paint?.['line-color'], '#8EAFBE');
  assert.ok(
    contrastRatio(String(motorway.paint?.['line-color']), '#061D35') <
      contrastRatio(String(prominentBuilding.paint?.['line-color']), '#061D35'),
  );
  assert.ok(
    contrastRatio(String(primaryRoad.paint?.['line-color']), '#061D35') <
      contrastRatio(String(motorway.paint?.['line-color']), '#061D35'),
  );
  assert.deepEqual(
    [motorway, trunk, primaryRoad, secondaryRoad].map(surfaceLineOpacity),
    [0.86, 0.84, 0.78, 0.66],
  );
  assert.equal(compiledLayer(compiled, 'roads.roundabouts.casing'), undefined);
  assert.equal(roundabout.paint?.['circle-stroke-color'], '#648BA2');
  assert.equal(roundabout.paint?.['circle-stroke-opacity'], 0.42);
  assert.deepEqual(roundabout.paint?.['circle-stroke-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0.35,
    20,
    0.65,
  ]);

  assert.equal(districtLabel.paint?.['text-opacity'], 0.74);
  assert.equal(primaryLabel.paint?.['text-opacity'], 0.7);
  assert.equal(secondaryLabel.paint?.['text-opacity'], 0.5);
  assert.deepEqual(minorLabel.paint?.['text-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    0,
    17,
    0.26,
    20,
    0.36,
  ]);
  assert.ok(
    Number(districtLabel.paint?.['text-opacity']) > Number(primaryLabel.paint?.['text-opacity']),
  );
  assert.ok(
    Number(primaryLabel.paint?.['text-opacity']) > Number(secondaryLabel.paint?.['text-opacity']),
  );
  assert.deepEqual(
    [primaryLabel.minzoom, secondaryLabel.minzoom, minorLabel.minzoom],
    [11, 12, 16],
  );
  assert.deepEqual(
    [
      primaryLabel.layout?.['symbol-spacing'],
      secondaryLabel.layout?.['symbol-spacing'],
      minorLabel.layout?.['symbol-spacing'],
    ],
    [480, 600, 720],
  );
  for (const hiddenClass of [
    'cycleway',
    'footway',
    'pathway',
    'pedestrian',
    'service',
    'steps',
    'track',
  ]) {
    assert.equal(compiledLayer(compiled, `labels.roads.${hiddenClass}`), undefined);
  }
});

test('San Francisto keeps technical overlays honest and inside canonical data contracts', () => {
  const compiled = compileSanFrancisto();
  const callouts = compiledLayer(compiled, 'poi.render.architecturalCallouts');
  const footprintHatch = compiledLayer(compiled, 'buildings.render.footprintHatch');
  const prominentBuildings = compiledLayer(compiled, 'buildings.render.prominentOutline');
  const landscapeHatch = compiledLayer(compiled, 'land.render.landscapeHatch');
  const parkHatch = compiledLayer(compiled, 'land.render.parkHatch');
  const recreationHatch = compiledLayer(compiled, 'land.render.recreationHatch');
  const industrialHatch = compiledLayer(compiled, 'land.render.industrialHatch');
  const residentialLanduse = compiledLayer(compiled, 'land.landuse.residential.fill');
  const roadCenterline = compiledLayer(compiled, 'roads.render.majorRoadCenterline');
  const heightAnnotations = compiledLayer(compiled, 'buildings.render.heightAnnotations');

  assert.ok(callouts);
  assert.ok(footprintHatch);
  assert.ok(prominentBuildings);
  assert.ok(landscapeHatch);
  assert.ok(parkHatch);
  assert.ok(recreationHatch);
  assert.ok(industrialHatch);
  assert.ok(residentialLanduse);
  assert.ok(roadCenterline);
  assert.ok(heightAnnotations);

  const matches = (
    layer: NonNullable<typeof callouts>,
    type: 1 | 2 | 3,
    properties: Record<string, unknown>,
    zoom = 18,
  ) => featureFilter(layer.filter as never).filter({zoom}, {type, properties} as never);

  assert.equal(
    matches(callouts, 1, {category: 'landmark', filter_rank: 0, name: 'Museo', size_rank: 0}),
    true,
  );
  assert.equal(
    matches(callouts, 1, {
      category: 'landmark',
      filter_rank: 1,
      'name:latin': 'Museum',
      size_rank: 8,
    }),
    true,
  );
  assert.equal(
    matches(callouts, 1, {category: 'landmark', filter_rank: 2, name: 'Museo', size_rank: 0}),
    false,
  );
  assert.equal(
    matches(callouts, 1, {category: 'landmark', filter_rank: 0, name: 'Museo', size_rank: 9}),
    false,
  );
  assert.equal(
    matches(callouts, 1, {category: 'transport', filter_rank: 0, name: 'Estación', size_rank: 0}),
    false,
  );
  assert.equal(matches(callouts, 1, {category: 'landmark', filter_rank: 0, size_rank: 0}), false);
  assert.equal(
    matches(callouts, 2, {category: 'landmark', filter_rank: 0, name: 'Museo', size_rank: 0}),
    false,
  );

  assert.equal(callouts.minzoom, 16);
  assert.equal(callouts.layout?.['icon-anchor'], 'right');
  assert.equal(callouts.layout?.['icon-optional'], false);
  assert.equal(callouts.layout?.['text-optional'], false);
  assert.equal(callouts.layout?.['icon-allow-overlap'], false);
  assert.equal(callouts.layout?.['icon-ignore-placement'], false);
  assert.deepEqual(callouts.layout?.['text-field'], [
    'coalesce',
    ['get', 'name'],
    ['get', 'name:latin'],
    ['get', 'name:en'],
    '',
  ]);
  assert.deepEqual(callouts.layout?.['symbol-sort-key'], [
    '+',
    ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
    ['to-number', ['get', 'size_rank'], 17],
  ]);
  assert.equal(compiledLayer(compiled, 'poi.landmark.label'), undefined);

  assert.equal(matches(prominentBuildings, 3, {importance_tier: 2}), true);
  assert.equal(
    matches(prominentBuildings, 3, {building_tone: 'destination', importance_tier: 1}),
    false,
  );
  assert.equal(matches(prominentBuildings, 3, {building_tone: 'destination'}), true);
  assert.equal(matches(prominentBuildings, 3, {building_tone: 'active', render_height: 24}), true);
  assert.equal(
    matches(prominentBuildings, 3, {building_tone: 'commercial', render_height: 23}),
    false,
  );
  assert.equal(matches(footprintHatch, 3, {importance_tier: 2}), true);
  assert.equal(matches(footprintHatch, 3, {}), false);

  for (const landcoverClass of ['wood', 'forest']) {
    assert.equal(matches(landscapeHatch, 3, {class: landcoverClass}), true);
  }
  for (const subclass of ['park', 'garden']) {
    assert.equal(matches(parkHatch, 3, {class: 'grass', subclass}), true);
  }
  for (const properties of [
    {class: 'grass'},
    {class: 'grass', subclass: 'meadow'},
    {class: 'grass', subclass: 'scrub'},
    {class: 'grass', subclass: 'recreation_ground'},
    {class: 'grass', subclass: 'flowerbed'},
  ]) {
    assert.equal(matches(landscapeHatch, 3, properties), false);
    assert.equal(matches(parkHatch, 3, properties), false);
  }

  for (const landuseClass of ['pitch', 'track', 'playground', 'zoo']) {
    assert.equal(matches(recreationHatch, 3, {class: landuseClass}), true);
  }
  for (const landuseClass of ['recreation_ground', 'park', 'cemetery']) {
    assert.equal(matches(recreationHatch, 3, {class: landuseClass}), false);
  }
  for (const landuseClass of ['industrial', 'railway']) {
    assert.equal(matches(industrialHatch, 3, {class: landuseClass}), true);
  }
  for (const landuseClass of ['residential', 'commercial', 'cemetery']) {
    assert.equal(matches(industrialHatch, 3, {class: landuseClass}), false);
    assert.equal(matches(recreationHatch, 3, {class: landuseClass}), false);
  }
  assert.equal(residentialLanduse.paint?.['fill-pattern'], undefined);
  assert.notEqual(landscapeHatch.paint?.['fill-pattern'], industrialHatch.paint?.['fill-pattern']);

  for (const roadClass of ['primary', 'trunk', 'motorway']) {
    assert.equal(matches(roadCenterline, 2, {class: roadClass}), true);
  }
  assert.equal(matches(roadCenterline, 2, {class: 'secondary'}), false);
  assert.equal(matches(roadCenterline, 2, {brunnel: 'bridge', class: 'motorway'}), false);
  assert.equal(matches(roadCenterline, 2, {brunnel: 'tunnel', class: 'motorway'}), false);
  const centerlineIndex = compiledLayerIndex(compiled, 'roads.render.majorRoadCenterline');
  for (const target of [
    'roads.classes.primary.surface.fill',
    'roads.classes.trunk.surface.fill',
    'roads.classes.motorway.surface.fill',
  ]) {
    assert.ok(
      compiledLayerIndex(compiled, target) < centerlineIndex,
      `${target} overpaints centerline`,
    );
  }

  assert.equal(matches(heightAnnotations, 3, {height: 24, importance_tier: 2}), true);
  assert.equal(matches(heightAnnotations, 3, {height: 23, importance_tier: 2}), false);
  assert.equal(matches(heightAnnotations, 3, {building_tone: 'destination', height: 24}), true);
  assert.equal(matches(heightAnnotations, 3, {height: 100, render_height: 100}), false);
  assert.equal(matches(heightAnnotations, 3, {render_height: 100}), false);
  assert.deepEqual(heightAnnotations.layout?.['text-field'], [
    'concat',
    'H ≈ ',
    ['to-string', ['to-number', ['get', 'height'], 0]],
    ' M',
  ]);
});

test('San Francisto omits extrusion, shields, and default Maki pictograms', () => {
  const {style} = compileSanFrancisto();
  const resolved = resolveMap(sanFrancisto);
  const layerIds = style.layers.map(({id}) => id);

  assert.equal(resolved.modules?.buildings?.mode, 'flat');
  assert.equal(resolved.modules?.labels?.shields, 'none');
  assert.equal(resolved.modules?.poi?.icons, false);
  assert.equal(
    style.layers.some(({type}) => type === 'fill-extrusion'),
    false,
  );
  assert.equal(
    layerIds.some((id) => id.includes('shield')),
    false,
  );

  const iconImages = new Set(
    style.layers.flatMap((layer) =>
      collectStrings((layer.layout as Record<string, unknown> | undefined)?.['icon-image']),
    ),
  );
  assert.deepEqual(iconImages, new Set(['san-francisto-poi-node']));

  for (const makiId of [
    'coffee',
    'culture',
    'education',
    'food',
    'health',
    'lodging',
    'major-transit',
    'parking',
    'services',
    'shopping',
  ]) {
    assert.equal(iconImages.has(makiId), false, `Unexpected default Maki pictogram ${makiId}`);
  }
});

function assertDeepFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertDeepFrozen(descriptor.value, visited);
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
  const inspected = compiled.inspection.layers.find(({contributions}) =>
    contributions.some((contribution) => contribution.target === target),
  );
  return inspected ? compiled.style.layers[inspected.index] : undefined;
}

function compiledLayerIndex(
  compiled: ReturnType<typeof createStyleWithInspection>,
  target: string,
): number {
  return (
    compiled.inspection.layers.find(({contributions}) =>
      contributions.some((contribution) => contribution.target === target),
    )?.index ?? -1
  );
}

function assertOrdered(
  compiled: ReturnType<typeof createStyleWithInspection>,
  targets: readonly string[],
): void {
  const indexes = targets.map((target) => compiledLayerIndex(compiled, target));
  for (let index = 0; index < indexes.length; index += 1) {
    assert.ok(indexes[index]! >= 0, `Missing ordered target ${targets[index]}`);
    if (index === 0) continue;
    assert.ok(
      indexes[index - 1]! < indexes[index]!,
      `${targets[index - 1]} must precede ${targets[index]}`,
    );
  }
}

function surfaceLineOpacity(layer: NonNullable<ReturnType<typeof compiledLayer>>): number {
  const value = layer.paint?.['line-opacity'];
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value[0] === 'case' && typeof value.at(-1) === 'number') {
    return value.at(-1) as number;
  }
  throw new TypeError(`Expected a numeric surface line-opacity fallback for ${layer.id}`);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  assert.match(color, /^#[\dA-F]{6}$/iu);
  const channels = [1, 3, 5].map(
    (start) => Number.parseInt(color.slice(start, start + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function patternReferences(style: ReturnType<typeof compileSanFrancisto>['style']): string[] {
  return [
    ...new Set(
      style.layers.flatMap((layer) =>
        Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(
          ([property, value]) =>
            property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
        ),
      ),
    ),
  ].sort();
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, output);
    }
  }
  return output;
}
