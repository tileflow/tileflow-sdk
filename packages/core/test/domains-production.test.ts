import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aeroways,
  defineTheme,
  openMapTiles,
  poi,
  resolveTileflowData,
  tileflowPoiImageRoles,
  tileflowWorldV1Schema,
  vectorTiles,
  vegetation,
  water,
} from '../src';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {compileAeroways} from '../src/modules/aeroways/compiler';
import {compileBoundaries} from '../src/modules/boundaries/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
import {compileTransit} from '../src/modules/transit/compiler';
import {compileVegetation} from '../src/modules/vegetation/compiler';
import {compileWater} from '../src/modules/water/compiler';
import {resolveColors, resolveThemeColors, resolveThemeImages} from '../src/themes';
import {assembleTileflowLayers} from './layer-ir-fixture';
import {testLightTheme} from './map-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Bold'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

test('semantic hydro and land roles flow exactly from the selected theme', () => {
  const themed = defineTheme(testLightTheme, {
    colorScheme: 'light',
    id: 'semantic-role-theme',
    version: 1,
    tokens: {
      color: {
        'hydro.depth.m0': '#102030',
        'hydro.depth.m200': '#203040',
        'hydro.depth.m2000': '#304050',
        'hydro.depth.m7000': '#405060',
        'landuse.military': '#506070',
        'landuse.railway': '#607080',
        'poi.medical': '#708090',
      },
    },
  });
  const colors = resolveThemeColors(themed);
  const themedContext = {...context, colors};
  const land = compileLand(undefined, themedContext);
  const bathymetry = contribution(compileWater(undefined, themedContext), 'tileflow-bathymetry');
  const depthExpression = (bathymetry.layer.paint as Record<string, unknown>)[
    'fill-color'
  ] as unknown[];
  const depthColors = new Map<number, unknown>();
  for (let index = 3; index < depthExpression.length; index += 2) {
    depthColors.set(depthExpression[index] as number, depthExpression[index + 1]);
  }

  assert.equal(colors.poi.medical, '#708090');
  assert.equal(
    (contribution(land, 'tileflow-landuse-military').layer.paint as Record<string, unknown>)[
      'fill-color'
    ],
    '#506070',
  );
  assert.equal(
    (contribution(land, 'tileflow-landuse-railway').layer.paint as Record<string, unknown>)[
      'fill-color'
    ],
    '#607080',
  );
  assert.equal(depthColors.get(0), '#102030');
  assert.equal(depthColors.get(-200), '#203040');
  assert.equal(depthColors.get(-2000), '#304050');
  assert.equal(depthColors.get(-11_000), '#405060');
  assert.doesNotMatch(JSON.stringify(depthExpression), /#000(?:000)?\b/iu);
});

test('POI image roles are theme-selectable with an explicit built-in fallback contract', () => {
  const day = defineTheme(testLightTheme, {
    colorScheme: 'light',
    id: 'poi-images-day',
    version: 1,
    tokens: {image: {'poi.food-drink': 'food-day'}},
  });
  const night = defineTheme(testLightTheme, {
    colorScheme: 'dark',
    id: 'poi-images-night',
    version: 1,
    tokens: {image: {'poi.food-drink': 'food-night'}},
  });
  const compileFoodImage = (images: Readonly<Record<string, string>>) => {
    const layer = contribution(
      compilePoi(poi({categories: ['food-drink'], icons: true, labels: false}), {
        ...context,
        images,
      }),
      'tileflow-poi-food-drink-icon',
    );
    return (layer.layer.layout as Record<string, unknown>)['icon-image'];
  };

  assert.deepEqual(tileflowPoiImageRoles['food-drink'], {
    fallback: 'food',
    token: 'poi.food-drink',
  });
  assert.match(JSON.stringify(compileFoodImage(resolveThemeImages(day))), /food-day/u);
  assert.match(JSON.stringify(compileFoodImage(resolveThemeImages(night))), /food-night/u);
  assert.match(JSON.stringify(compileFoodImage({})), /"icon"/u);
  assert.match(JSON.stringify(compileFoodImage({})), /"food"/u);
});

test('park source semantics keep protected areas and urban parks disjoint', () => {
  const mixedData = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {class: 'kind'}, layers: {park: 'protected_and_parks'}}),
      url: '/tiles.json',
    }),
  );
  const mixed = compileLand(undefined, {...context, data: mixedData});
  const legacyPark = contribution(mixed, 'tileflow-landcover-legacy-park');
  const mixedProtected = contribution(mixed, 'tileflow-landcover-protected');
  const urbanPark = contribution(mixed, 'tileflow-landcover-urbanPark');

  assert.equal(legacyPark.layer['source-layer'], 'protected_and_parks');
  assert.equal(mixedProtected.layer['source-layer'], 'protected_and_parks');
  assert.equal(urbanPark.layer['source-layer'], 'landcover');
  assert.equal(matches(legacyPark.layer.filter, {kind: 'protected_area'}), false);
  assert.equal(matches(mixedProtected.layer.filter, {kind: 'protected_area'}), true);
  assert.equal(matches(legacyPark.layer.filter, {kind: 'park'}), true);
  assert.equal(matches(urbanPark.layer.filter, {kind: 'grass', subclass: 'park'}), true);
  assertValid(mixed);

  const protectedOnlyData = resolveTileflowData(
    vectorTiles({
      attribution: '© Tileflow fixture',
      schema: tileflowWorldV1Schema({layers: {park: 'protected_only'}}),
      url: '/world-v1.json',
    }),
  );
  const protectedOnly = compileLand(undefined, {...context, data: protectedOnlyData});
  const protectedArea = contribution(protectedOnly, 'tileflow-landcover-protected');
  assert.equal(protectedArea.layer['source-layer'], 'protected_only');
  assert.equal(protectedArea.layer.filter, undefined);
  assert.equal(
    protectedOnly.some(({layer}) => layer.id === 'tileflow-landcover-legacy-park'),
    false,
  );
  assertValid(protectedOnly);
});

test('every typed grass subclass selects exactly one landcover fill', () => {
  const contributions = compileLand(undefined, context);
  const ids = [
    'tileflow-landcover-grass',
    'tileflow-landcover-scrub',
    'tileflow-landcover-meadow',
    'tileflow-landcover-urbanPark',
    'tileflow-landcover-recreationGround',
    'tileflow-landcover-villageGreen',
    'tileflow-landcover-flowerbed',
  ];
  const layers = ids.map((id) => contribution(contributions, id).layer);
  for (const subclass of [
    undefined,
    'scrub',
    'meadow',
    'park',
    'garden',
    'recreation_ground',
    'village_green',
    'flowerbed',
  ]) {
    const properties = {class: 'grass', ...(subclass ? {subclass} : {})};
    const selected = layers.filter(({filter}) => matches(filter, properties));
    assert.equal(selected.length, 1, `${subclass ?? 'plain grass'} must select exactly one fill`);
  }
});

test('transit modes are disjoint and funiculars remain rail', () => {
  const contributions = compileTransit(undefined, context);
  const ferry = contribution(contributions, 'tileflow-transit-ferry');
  const cableway = contribution(contributions, 'tileflow-transit-cableway');
  const rail = contribution(contributions, 'tileflow-transit-rail-surface');
  const railHatching = contribution(contributions, 'tileflow-transit-rail-hatching-surface');
  const serviceRail = contribution(contributions, 'tileflow-transit-service-rail-surface');

  const funicular = {class: 'transit', subclass: 'funicular'};
  assert.equal(matches(ferry.layer.filter, funicular), false);
  assert.equal(matches(cableway.layer.filter, funicular), false);
  assert.equal(matches(rail.layer.filter, funicular), true);

  const gondola = {class: 'transit', subclass: 'gondola'};
  assert.equal(matches(cableway.layer.filter, gondola), true);
  assert.equal(matches(rail.layer.filter, gondola), false);

  for (const mode of ['light_rail', 'monorail', 'subway', 'tram']) {
    assert.equal(matches(rail.layer.filter, {class: mode}), true, `${mode} should map to rail`);
    assert.equal(matches(cableway.layer.filter, {class: mode}), false);
  }

  const tramService = {class: 'transit', service: 'yard', subclass: 'tram'};
  assert.equal(matches(rail.layer.filter, tramService), false);
  assert.equal(matches(serviceRail.layer.filter, tramService), true);
  assert.equal(matches(railHatching.layer.filter, tramService), true);
  assert.ok(serviceRail.localOrder < railHatching.localOrder);
  assertValid(contributions);
});

test('disputed maritime boundaries retain both strokes with disputed priority', () => {
  const contributions = compileBoundaries(undefined, context);
  const maritime = contribution(contributions, 'tileflow-boundary-maritime');
  const disputed = contribution(contributions, 'tileflow-boundary-disputed');
  const combined = contribution(contributions, 'tileflow-boundary-disputed-maritime');
  const both = {admin_level: 2, disputed: 1, maritime: 1};

  assert.equal(matches(maritime.layer.filter, both), true);
  assert.equal(matches(disputed.layer.filter, both), false);
  assert.equal(matches(combined.layer.filter, both), true);
  assert.ok(maritime.localOrder < combined.localOrder);
  assert.equal(matches(disputed.layer.filter, {...both, maritime: 0}), true);
  assert.equal(matches(combined.layer.filter, {...both, maritime: 0}), false);
  assertValid(contributions);
});

test('water consumes remapped bathymetry capability and omits it when absent', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        capabilities: {bathymetry: true},
        fields: {bathymetryMinDepth: 'depth_floor', bathymetrySortKey: 'depth_order'},
        layers: {bathymetry: 'depth_bands'},
      }),
      url: '/tiles.json',
    }),
  );
  const contributions = compileWater(water({bathymetryContours: {}, bathymetryLabels: {}}), {
    ...context,
    data,
  });
  const bathymetry = contribution(contributions, 'tileflow-bathymetry');
  const bathymetryContours = contribution(contributions, 'tileflow-bathymetry-contours');
  const bathymetryLabels = contribution(contributions, 'tileflow-bathymetry-labels');

  assert.equal(bathymetry.layer['source-layer'], 'depth_bands');
  assert.equal(bathymetry.layer.maxzoom, 10);
  assert.match(JSON.stringify(bathymetry.layer.layout), /depth_order/);
  assert.match(JSON.stringify(bathymetry.layer.paint), /depth_floor/);
  assert.equal(bathymetryContours.layer['source-layer'], 'depth_bands');
  assert.match(JSON.stringify(bathymetryContours.layer.filter), /depth_floor/);
  assert.equal(
    (bathymetryContours.layer.paint as Record<string, unknown>)['line-color'],
    context.colors.hydro.label,
  );
  assert.equal(bathymetryContours.slot, 'hydro');
  assert.equal(bathymetryContours.target, 'water.bathymetryContours');
  assert.equal(bathymetryLabels.layer['source-layer'], 'depth_bands');
  assert.equal(bathymetryLabels.layer.minzoom, 3);
  assert.equal(bathymetryLabels.layer.maxzoom, 10);
  assert.deepEqual((bathymetryLabels.layer.layout as Record<string, unknown>)['text-field'], [
    'to-string',
    ['abs', ['to-number', ['get', 'depth_floor'], 0]],
  ]);
  assert.equal(
    (bathymetryLabels.layer.paint as Record<string, unknown>)['text-color'],
    context.colors.hydro.label,
  );
  assert.equal(bathymetryLabels.slot, 'symbols');
  assert.equal(bathymetryLabels.target, 'water.bathymetryLabels');
  assertValid(contributions);
  assert.equal(
    compileWater(undefined, {...context, data}).some(
      ({layer}) => layer.id === 'tileflow-bathymetry-labels',
    ),
    false,
  );
  assert.equal(
    compileWater(undefined, {...context, data}).some(
      ({layer}) => layer.id === 'tileflow-bathymetry-contours',
    ),
    false,
  );

  const portableData = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const portable = compileWater(water({bathymetryContours: {}, bathymetryLabels: {}}), {
    ...context,
    data: portableData,
  });
  assert.equal(
    portable.some(({layer}) => layer.id === 'tileflow-bathymetry'),
    false,
  );
  assert.equal(
    portable.some(({layer}) => layer.id === 'tileflow-bathymetry-labels'),
    false,
  );
  assert.equal(
    portable.some(({layer}) => layer.id === 'tileflow-bathymetry-contours'),
    false,
  );
});

test('3D vegetation keeps a portable styled fallback and exposes runtime parameters', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const portable = contribution(
    compileVegetation(
      vegetation({
        flat: {color: '#123456', opacity: 0.74},
        mode: '3d',
        threeDimensional: {
          barkColor: '#654321',
          broadleafColors: ['#112233'],
          coniferColors: ['#334455'],
          crownScale: 1.2,
          heightScale: 1.4,
        },
      }),
      {...context, data},
    ),
    'tileflow-vegetation-trees',
  );
  const hosted = contribution(
    compileVegetation(vegetation({mode: '3d'}), context),
    'tileflow-vegetation-trees',
  );

  assert.equal(portable.layer.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(portable.layer.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');
  assert.equal(portable.layer.metadata?.['tileflow:tree-bark-color'], '#654321');
  assert.deepEqual(portable.layer.metadata?.['tileflow:tree-broadleaf-colors'], ['#112233']);
  assert.deepEqual(portable.layer.metadata?.['tileflow:tree-conifer-colors'], ['#334455']);
  assert.equal(portable.layer.metadata?.['tileflow:tree-crown-scale'], 1.2);
  assert.equal(portable.layer.metadata?.['tileflow:tree-height-scale'], 1.4);
  assert.equal((portable.layer.paint as Record<string, unknown>)['circle-color'], '#123456');
  assert.equal((portable.layer.paint as Record<string, unknown>)['circle-opacity'], 0.74);
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');
  assert.equal(
    hosted.layer.metadata?.['tileflow:tree-bark-color'],
    context.colors.vegetation.tree.bark,
  );
  assert.deepEqual(
    hosted.layer.metadata?.['tileflow:tree-broadleaf-colors'],
    context.colors.vegetation.tree.broadleaf,
  );
  assert.deepEqual(
    hosted.layer.metadata?.['tileflow:tree-conifer-colors'],
    context.colors.vegetation.tree.conifer,
  );
  assertValid([portable]);
  assertValid([hosted]);
});

test('default 3D vegetation preserves exact dark semantic tree tokens', () => {
  const tree = {
    bark: '#3A3228',
    broadleaf: ['#284236', '#2F4B3C', '#365441', '#3C5B46'],
    conifer: ['#203A31', '#294237', '#314A3C'],
  } as const;
  const darkTheme = defineTheme(testLightTheme, {
    colorScheme: 'dark',
    id: 'vegetation-dark',
    tokens: {
      color: {
        'vegetation.tree.bark': tree.bark,
        'vegetation.tree.broadleaf.a': tree.broadleaf[0],
        'vegetation.tree.broadleaf.b': tree.broadleaf[1],
        'vegetation.tree.broadleaf.c': tree.broadleaf[2],
        'vegetation.tree.broadleaf.d': tree.broadleaf[3],
        'vegetation.tree.conifer.a': tree.conifer[0],
        'vegetation.tree.conifer.b': tree.conifer[1],
        'vegetation.tree.conifer.c': tree.conifer[2],
      },
    },
    version: 1,
  });
  const darkContext = {...context, colors: resolveThemeColors(darkTheme)};
  const trees = contribution(
    compileVegetation(vegetation({mode: '3d'}), darkContext),
    'tileflow-vegetation-trees',
  );

  assert.deepEqual(darkContext.colors.vegetation.tree, tree);
  assert.equal(trees.layer.metadata?.['tileflow:tree-bark-color'], tree.bark);
  assert.deepEqual(trees.layer.metadata?.['tileflow:tree-broadleaf-colors'], tree.broadleaf);
  assert.deepEqual(trees.layer.metadata?.['tileflow:tree-conifer-colors'], tree.conifer);
  assertValid([trees]);
});

test('current building tones use bound fields and the available semantic theme colors', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          buildingKind: 'legacy_kind',
          buildingTone: 'tone',
          hasBusiness: 'legacy_business',
        },
      }),
      url: '/tiles.json',
    }),
  );
  const buildings = contribution(
    compileBuildings(undefined, {...context, data}),
    'tileflow-buildings-fill',
  );
  const color = JSON.stringify((buildings.layer.paint as Record<string, unknown>)['fill-color']);

  for (const tone of ['active', 'commercial', 'destination']) assert.match(color, new RegExp(tone));
  assert.match(color, /tone/);
  assert.match(color, /legacy_kind/);
  assert.match(color, /legacy_business/);
  assertValid([buildings]);
});

test('aeroways render bound runway references as high-zoom shared-typography symbols', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {class: 'kind', ref: 'runway_designator'},
        layers: {aeroway: 'airport_geometry'},
      }),
      url: '/tiles.json',
    }),
  );
  const contributions = compileAeroways(aeroways({runwayRef: {text: {size: 12}}}), {
    ...context,
    data,
  });
  const runwayRef = contribution(contributions, 'tileflow-aeroway-runway-ref');
  const layout = runwayRef.layer.layout as Record<string, unknown>;

  assert.equal(runwayRef.layer['source-layer'], 'airport_geometry');
  assert.equal(runwayRef.layer.minzoom, 14);
  assert.equal(runwayRef.slot, 'symbols');
  assert.equal(runwayRef.localOrder, 650);
  assert.equal(runwayRef.target, 'aeroways.runwayRef');
  assert.equal(layout['symbol-placement'], 'line-center');
  assert.deepEqual(layout['text-field'], ['to-string', ['get', 'runway_designator']]);
  assert.deepEqual(layout['text-font'], ['Noto Sans Regular']);
  assert.equal(layout['text-size'], 12);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'runway', runway_designator: '09/27'}), true);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'taxiway', runway_designator: 'A'}), false);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'runway'}), false);
  assertValid(contributions);
});

test('the combined production domain output remains MapLibre-valid', () => {
  assertValid([
    ...compileLand(undefined, context),
    ...compileWater(undefined, context),
    ...compileBuildings(undefined, context),
    ...compileVegetation(vegetation({mode: '3d'}), context),
    ...compileTransit(undefined, context),
    ...compileAeroways(undefined, context),
    ...compileBoundaries(undefined, context),
  ]);
});

function contribution(
  contributions: readonly TileflowLayerContribution[],
  id: string,
): TileflowLayerContribution {
  const result = contributions.find(({layer}) => layer.id === id);
  assert.ok(result, `Missing ${id}`);
  return result;
}

function assertValid(contributions: readonly TileflowLayerContribution[]): void {
  const style = {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions),
  };
  assert.deepEqual(validateStyleMin(style), []);
}

function matches(filter: unknown, properties: Record<string, unknown>): boolean {
  return Boolean(evaluate(filter, properties));
}

function evaluate(value: unknown, properties: Record<string, unknown>): unknown {
  if (!Array.isArray(value)) return value;
  const [operator, ...args] = value;
  switch (operator) {
    case '!':
      return !evaluate(args[0], properties);
    case '!=':
      return evaluate(args[0], properties) !== evaluate(args[1], properties);
    case '==':
      return evaluate(args[0], properties) === evaluate(args[1], properties);
    case '>=':
      return Number(evaluate(args[0], properties)) >= Number(evaluate(args[1], properties));
    case 'all':
      return args.every((entry) => Boolean(evaluate(entry, properties)));
    case 'any':
      return args.some((entry) => Boolean(evaluate(entry, properties)));
    case 'geometry-type':
      return 'LineString';
    case 'get':
      return properties[String(args[0])];
    case 'has':
      return Object.prototype.hasOwnProperty.call(properties, String(args[0]));
    case 'match': {
      const input = evaluate(args[0], properties);
      const labels = args[1];
      const matched = Array.isArray(labels) ? labels.includes(input) : labels === input;
      return evaluate(matched ? args[2] : args[3], properties);
    }
    case 'to-number': {
      for (const candidate of args) {
        const number = Number(evaluate(candidate, properties));
        if (Number.isFinite(number)) return number;
      }
      return 0;
    }
    case 'zoom':
      return 16;
    default:
      throw new Error(`Unsupported test expression operator: ${String(operator)}`);
  }
}
