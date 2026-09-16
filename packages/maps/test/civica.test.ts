import {
  createPropertyExpression,
  featureFilter,
  latest as mapLibreStyleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import test from 'node:test';
import {resolveMap, tileflowWorldV1Schema} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {civica, civicaFonts, civicaIcons} from '../src';

const iconIds = [
  'civica-industrial-hatch',
  'civica-orchard',
  'civica-paper-grain',
  'civica-park-groves',
  'civica-poi-airport',
  'civica-poi-civic-star',
  'civica-poi-dot',
  'civica-poi-food',
  'civica-poi-garden',
  'civica-poi-hospital',
  'civica-poi-lodging',
  'civica-poi-monument',
  'civica-poi-museum',
  'civica-poi-shopping',
  'civica-poi-transit',
  'civica-water-lines',
] as const;
const preparedAssets = {icons: {ids: iconIds, sprite: '/tileflow/icons/civica/sprite'}};
const compiled = createStyleWithInspection(civica, {preparedAssets});
type Layer = (typeof compiled.style.layers)[number];

function layerFor(target: string, zoom?: number): Layer {
  const inspected = compiled.inspection.layers.find(({contributions}) =>
    contributions.some((contribution) => contribution.target === target),
  );
  assert.ok(inspected, `Missing Cívica semantic target ${target}`);
  const selected =
    zoom === undefined
      ? inspected
      : compiled.inspection.layers.find(
          ({contributions, index}) =>
            contributions.some((contribution) => contribution.target === target) &&
            visibleAt(compiled.style.layers[index]!, zoom),
        );
  assert.ok(selected, `Missing Cívica semantic target ${target} at z${zoom}`);
  const layer = compiled.style.layers[selected.index];
  assert.ok(layer);
  return layer;
}

function evaluate(
  layer: Layer,
  property: string,
  zoom: number,
  properties: Record<string, unknown> = {},
): unknown {
  const specifications = mapLibreStyleSpec as unknown as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const specification =
    specifications[`paint_${layer.type}`]?.[property] ??
    specifications[`layout_${layer.type}`]?.[property];
  assert.ok(specification, `Missing MapLibre property specification ${property}`);
  const value = layer.paint?.[property] ?? layer.layout?.[property] ?? specification.default;
  const parsed = createPropertyExpression(value, specification as never);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error(`Cannot evaluate ${property}`);
  return parsed.value.evaluate(
    {zoom},
    {
      type: 'Feature',
      properties,
      geometry: {type: 'Point', coordinates: [0, 0]},
    } as never,
    {},
  );
}

function visibleAt(layer: Layer, zoom: number): boolean {
  return (
    layer.layout?.visibility !== 'none' &&
    (layer.minzoom ?? 0) <= zoom &&
    zoom < (layer.maxzoom ?? 24)
  );
}

function acceptsPoi(
  category: string,
  zoom: number,
  candidate: Partial<{
    category: string;
    rank: number | string;
    sizeRank: number | string;
    minZoom: number;
    type: string;
  }> = {},
) {
  const fields = tileflowWorldV1Schema().fields;
  const input = {category, rank: 1, sizeRank: 5, minZoom: 0, type: 'monument', ...candidate};
  const names = {
    category: fields.poiCategory,
    rank: fields.poiFilterRank,
    sizeRank: fields.poiSizeRank,
    minZoom: fields.minZoom,
    type: fields.poiType,
  };
  const properties = Object.fromEntries(
    Object.entries(input).flatMap(([name, value]) =>
      value === undefined ? [] : [[names[name as keyof typeof names], value]],
    ),
  );
  const layer = layerFor(`poi.${category}`);
  if (!visibleAt(layer, zoom)) return false;
  return featureFilter(layer.filter as never).filter({zoom}, {
    type: 1,
    properties,
  } as never);
}

test('Cívica is a standalone print map with a closed local artwork and font vocabulary', async () => {
  const resolved = resolveMap(civica);
  assert.equal(civica.name, 'Cívica');
  assert.equal('extends' in civica, false);
  assert.equal(Object.isFrozen(civica), true);
  assert.deepEqual(resolved.icons, [civicaIcons]);
  assert.deepEqual(resolved.fonts, [civicaFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.equal(resolved.projection, 'mercator');
  assert.equal(resolved.terrain, 'none');
  assert.deepEqual(validateStyleMin(compiled.style as never), []);
  assert.equal(compiled.style.metadata?.['tileflow:extends'], undefined);
  assert.equal(compiled.style.terrain, undefined);
  assert.equal(
    compiled.style.layers.some(({type}) => type === 'fill-extrusion'),
    false,
  );

  const packagedIds = (await readdir(new URL('../assets/civica/icons/', import.meta.url)))
    .map((file) => file.replace(/(?:\.pattern)?\.svg$/u, ''))
    .sort();
  assert.deepEqual(packagedIds, [...iconIds]);
  for (const layer of compiled.style.layers) {
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      if (!property.endsWith('-pattern')) continue;
      assert.equal(typeof value, 'string');
      assert.ok(packagedIds.includes(String(value)), `${layer.id} has a foreign pattern`);
    }
    const image = layer.layout?.['icon-image'];
    if (image !== undefined) {
      assert.equal(typeof image, 'string');
      assert.ok(packagedIds.includes(String(image)), `${layer.id} has a foreign symbol`);
    }
  }
});

test('Cívica hands regional landcover to city blocks and then building footprints as zoom grows', () => {
  const regional = layerFor('land.globalLandcover');
  const residential = layerFor('land.landuse.residential.fill');
  const district = layerFor('buildings.render.districtFootprints');
  const building = layerFor('buildings.flat.fill');
  const regionalOpacity = [4, 8, 10].map((z) => Number(evaluate(regional, 'fill-opacity', z)));
  assert.ok(regionalOpacity[0]! > regionalOpacity[1]!);
  assert.equal(regionalOpacity[2], 0);
  assert.equal(visibleAt(regional, 11), false);
  assert.equal(visibleAt(residential, 8), true);
  assert.ok(
    Number(evaluate(residential, 'fill-opacity', 12)) >
      Number(evaluate(residential, 'fill-opacity', 18)),
    'The regional block wash should recede behind detailed footprints',
  );
  assert.equal(visibleAt(district, 12), false);
  assert.equal(Number(evaluate(district, 'fill-opacity', 13)), 0);
  assert.ok(Number(evaluate(district, 'fill-opacity', 14)) > 0);
  assert.equal(
    featureFilter(district.filter as never).filter({zoom: 14}, {
      type: 3,
      properties: {},
    } as never),
    true,
    'District footprints must accept polygons before the ordinary z15 building deck',
  );
  assert.equal(visibleAt(building, 14), false);
  assert.equal(visibleAt(district, 15), false);
  assert.equal(visibleAt(building, 15), true);
  assert.equal(
    Number(evaluate(district, 'fill-opacity', 15)),
    Number(evaluate(building, 'fill-opacity', 15)),
    'District and detail footprint opacity should meet without a visual jump',
  );
  assert.equal(Number(evaluate(building, 'fill-opacity', 16)), 1);
});

test('Cívica retains road hierarchy at city, neighborhood, and street scales', () => {
  const motorway = layerFor('roads.classes.motorway.surface.fill');
  const minor = layerFor('roads.classes.minor.surface.fill');
  const service = layerFor('roads.classes.service.surface.fill');
  assert.equal(visibleAt(motorway, 7), true);
  assert.equal(visibleAt(minor, 10), false);
  assert.equal(visibleAt(service, 12), false);
  const classField = tileflowWorldV1Schema().fields.class;
  let previousMinorWidth = 0;
  for (const zoom of [12, 14, 16, 19, 22]) {
    const motorwayWidth = Number(
      evaluate(layerFor('roads.classes.motorway.surface.fill', zoom), 'line-width', zoom, {
        [classField]: 'motorway',
      }),
    );
    const minorWidth = Number(
      evaluate(layerFor('roads.classes.minor.surface.fill', zoom), 'line-width', zoom, {
        [classField]: 'minor',
      }),
    );
    assert.ok(motorwayWidth > minorWidth, `Motorway hierarchy was lost at z${zoom}`);
    assert.ok(minorWidth > previousMinorWidth, `Local streets stopped growing at z${zoom}`);
    previousMinorWidth = minorWidth;
  }
});

test('Cívica draws city-scale land and buildings as flat masses without outline defaults', () => {
  const targets = new Set(
    compiled.inspection.layers.flatMap(({contributions}) =>
      contributions.map(({target}) => target),
    ),
  );
  for (const target of [
    'buildings.flat.outline',
    'land.landcover.urbanPark.outline',
    'land.landcover.wood.outline',
    'water.bodies.outline',
    'roads.areas.pedestrian.outline',
    'roads.sidewalks.outline',
    'roads.roundabouts.casing',
    ...['primary', 'secondary', 'tertiary', 'minor', 'service', 'pedestrian'].map(
      (roadClass) => `roads.classes.${roadClass}.surface.casing`,
    ),
  ]) {
    assert.equal(targets.has(target), false, `Unwanted Cívica outline ${target}`);
  }
  assert.equal(
    [...targets].some((target) => /^roads\.classes\.[^.]+\.tunnel\.hatch$/u.test(target)),
    false,
    'Compiler-default tunnel hatching must stay disabled',
  );
  assert.equal(visibleAt(layerFor('roads.roundabouts.fill'), 16), true);
  assert.equal(visibleAt(layerFor('roads.classes.primary.bridge.fill', 16), 16), true);
  assert.equal(visibleAt(layerFor('roads.classes.motorway.surface.casing'), 9), true);
  const fields = tileflowWorldV1Schema().fields;
  for (const [target, subclass, color] of [
    ['land.landcover.urbanPark.fill', 'park', '#A8B965'],
    ['land.landcover.grass.fill', 'grass', '#B7C985'],
  ] as const) {
    const area = layerFor(target, 16);
    const properties = {[fields.class]: 'grass', [fields.subclass]: subclass};
    assert.deepEqual(
      evaluate(area, 'fill-color', 16, properties),
      evaluate({...area, paint: {'fill-color': color}}, 'fill-color', 16, properties),
    );
    assert.equal(Number(evaluate(area, 'fill-opacity', 16, properties)), 1);
  }
  const water = layerFor('water.bodies.fill');
  assert.equal(water.paint?.['fill-color'], '#B4C8D9');
  assert.equal(Number(evaluate(water, 'fill-opacity', 16)), 1);
});

test('Cívica keeps park paths, textures, trees, and address detail out of the district drawing', () => {
  const fields = tileflowWorldV1Schema().fields;
  for (const [roadClass, minimumZoom, labelZoom] of [
    ['cycleway', 17, 18],
    ['footway', 17.5, 18],
    ['track', 17.5, 18],
    ['pathway', 18, 19],
    ['steps', 19, 20],
  ] as const) {
    const path = layerFor(`roads.classes.${roadClass}.surface.fill`);
    assert.equal(visibleAt(path, 16), false, `${roadClass} clutters the district drawing`);
    assert.equal(visibleAt(path, minimumZoom - 0.01), false);
    assert.equal(visibleAt(path, minimumZoom), true);
    const properties = {
      [fields.class]: roadClass === 'track' ? 'track' : 'path',
      [fields.subclass]: roadClass === 'pathway' ? 'path' : roadClass,
      [fields.surface]: 'paved',
      [fields.access]: 'yes',
    };
    assert.deepEqual(evaluate(path, 'line-dasharray', minimumZoom, properties), [1, 0]);
    const label = layerFor(`labels.roads.${roadClass}`);
    assert.equal(visibleAt(label, labelZoom - 0.01), false);
    assert.equal(visibleAt(label, labelZoom), true);
  }
  assert.equal(visibleAt(layerFor('roads.classes.pedestrian.surface.fill'), 14), true);
  for (const layer of compiled.style.layers) {
    if (layer.paint?.['fill-pattern'] === undefined) continue;
    for (const zoom of [14, 16, 18]) {
      assert.equal(visibleAt(layer, zoom), false, `${layer.id} adds texture at z${zoom}`);
    }
  }
  const trees = layerFor('vegetation.trees');
  assert.equal(visibleAt(trees, 18), false);
  assert.equal(visibleAt(trees, 19), true);
  assert.equal(Number(evaluate(trees, 'circle-stroke-width', 19)), 0);
  for (const target of ['roads.sidewalks.surface', 'addresses.labels']) {
    assert.equal(visibleAt(layerFor(target), 19), false);
    assert.equal(visibleAt(layerFor(target), 20), true);
  }
});

test('Cívica replaces broad place names with street names and progressively ranked destinations', () => {
  const city = layerFor('labels.places.city');
  const neighborhood = layerFor('labels.places.neighborhood');
  const road = layerFor('labels.roads.minor');
  const landmark = layerFor('poi.landmark');
  const retail = layerFor('poi.retail');
  const address = layerFor('addresses.labels');
  assert.equal(visibleAt(city, 8), true);
  assert.equal(visibleAt(city, 16), false);
  assert.equal(visibleAt(neighborhood, 13), true);
  assert.equal(visibleAt(neighborhood, 18), false);
  assert.equal(visibleAt(road, 13), false);
  assert.equal(visibleAt(road, 16), true);
  assert.ok((landmark.minzoom ?? 0) < (retail.minzoom ?? 0));
  assert.ok((retail.minzoom ?? 0) < (address.minzoom ?? 0));
  for (const layer of [landmark, retail]) {
    assert.equal(layer.layout?.['icon-allow-overlap'], false);
    assert.equal(layer.layout?.['text-allow-overlap'], false);
    assert.equal(layer.layout?.['icon-optional'], false);
    assert.equal(layer.layout?.['text-optional'], false);
    assert.ok(layer.layout?.['icon-image']);
    assert.ok(layer.layout?.['text-field']);
  }
});

test('Cívica keeps category and producer guards when refining its multiscale POI schedule', () => {
  const categories = [
    'landmark',
    'arts-entertainment',
    'park-nature',
    'transport',
    'religion',
    'education',
    'public-services',
    'medical',
    'lodging',
    'sport-leisure',
    'food-drink',
    'retail',
    'visitor-amenity',
  ];
  assert.equal(acceptsPoi('landmark', 14, {rank: 1}), true);
  assert.equal(acceptsPoi('landmark', 12.9), false);
  assert.equal(acceptsPoi('landmark', 13), true);
  assert.equal(acceptsPoi('landmark', 14, {rank: 2}), false);
  assert.equal(acceptsPoi('landmark', 15, {rank: 2}), true);
  assert.equal(acceptsPoi('landmark', 15, {rank: 3}), false);
  assert.equal(acceptsPoi('landmark', 17, {rank: 3}), true);
  assert.equal(acceptsPoi('landmark', 17, {rank: 4}), false);
  assert.equal(acceptsPoi('landmark', 15, {minZoom: 16}), false);
  assert.equal(acceptsPoi('landmark', 16, {minZoom: 16}), true);
  assert.equal(acceptsPoi('landmark', 14, {minZoom: undefined}), true);
  assert.equal(acceptsPoi('transport', 16, {type: 'station'}), true);
  assert.equal(acceptsPoi('transport', 16, {type: 'airport'}), false);
  for (const category of categories) {
    assert.equal(acceptsPoi(category, 18), true, `${category} rejects a valid candidate`);
    assert.equal(
      acceptsPoi(category, 18, {rank: 3}),
      ['landmark', 'arts-entertainment', 'park-nature', 'transport', 'medical'].includes(category),
      `${category} lost its category-specific density cap`,
    );
    for (const otherCategory of categories.filter((other) => other !== category)) {
      assert.equal(
        acceptsPoi(category, 18, {category: otherCategory}),
        false,
        `${category} incorrectly renders ${otherCategory} as its own symbol`,
      );
    }
    assert.equal(acceptsPoi(category, 18, {category: undefined}), false);
    for (const rank of [undefined, -1, 'invalid', 4]) {
      assert.equal(acceptsPoi(category, 18, {rank}), false, `${category} accepts rank ${rank}`);
    }
    for (const sizeRank of [undefined, -1, 'invalid', 17]) {
      assert.equal(
        acceptsPoi(category, 18, {sizeRank}),
        false,
        `${category} accepts size rank ${sizeRank}`,
      );
    }
  }
});

test('Cívica gives stations and parks space before secondary institutions and businesses', () => {
  const station = {type: 'train_station', rank: 1, sizeRank: 16, minZoom: 14};
  const park = {type: 'park', rank: 2, sizeRank: 0, minZoom: 14};
  const gallery = {type: 'art_gallery', rank: 2, sizeRank: 5, minZoom: 14};
  const transportBusiness = {type: 'public_transit_facility', rank: 2, sizeRank: 16, minZoom: 15};
  for (const zoom of [16.3, 17.49, 17.5]) {
    assert.equal(acceptsPoi('transport', zoom, station), true);
    assert.equal(acceptsPoi('park-nature', zoom, park), true);
    assert.equal(acceptsPoi('arts-entertainment', zoom, gallery), true);
  }
  assert.equal(acceptsPoi('transport', 17.49, transportBusiness), false);
  assert.equal(acceptsPoi('transport', 17.5, transportBusiness), true);
  assert.equal(acceptsPoi('transport', 17.5, {...transportBusiness, minZoom: 18}), false);
  assert.equal(acceptsPoi('transport', 18, {...transportBusiness, minZoom: 18}), true);

  for (const category of ['arts-entertainment', 'education', 'public-services', 'medical']) {
    const secondary = {rank: 2, sizeRank: 16, minZoom: 14};
    assert.equal(acceptsPoi(category, 16.3, secondary), false);
    assert.equal(acceptsPoi(category, 17.49, secondary), false);
    assert.equal(acceptsPoi(category, 17.5, secondary), true);
    assert.equal(acceptsPoi(category, 16.3, {...secondary, rank: 1}), true);
    assert.equal(acceptsPoi(category, 16.3, {...secondary, sizeRank: 5}), true);
    assert.equal(acceptsPoi(category, 17.5, {...secondary, minZoom: 18}), false);
  }
  for (const category of ['food-drink', 'retail', 'visitor-amenity', 'lodging']) {
    assert.equal(acceptsPoi(category, 17.49), false);
    assert.equal(acceptsPoi(category, 17.5), true);
  }
});

test('Cívica distinguishes park titles and station anchors from supporting captions', () => {
  const fields = tileflowWorldV1Schema().fields;
  const park = layerFor('poi.park-nature', 16.3);
  const station = layerFor('poi.transport', 16.3);
  const caption = layerFor('poi.education', 16.3);
  assert.deepEqual(park.layout?.['text-font'], ['DM Serif Text Italic', 'Noto Sans Regular']);
  assert.deepEqual(station.layout?.['text-font'], [
    'Barlow Semi Condensed SemiBold',
    'Noto Sans Regular',
  ]);
  assert.deepEqual(caption.layout?.['text-font'], [
    'Barlow Semi Condensed Regular',
    'Noto Sans Regular',
  ]);
  assert.equal(park.layout?.['text-transform'], 'none');
  assert.equal(station.layout?.['text-transform'], 'uppercase');
  const principalPark = {[fields.poiSizeRank]: 0};
  const smallPark = {[fields.poiSizeRank]: 16};
  assert.ok(
    Number(evaluate(park, 'text-size', 16.3, principalPark)) >
      Number(evaluate(station, 'text-size', 16.3)),
  );
  for (const zoom of [14, 16.3, 18, 21]) {
    assert.ok(
      Number(evaluate(park, 'text-size', zoom, principalPark)) >
        Number(evaluate(park, 'text-size', zoom, smallPark)),
      `Small parks compete with principal park titles at z${zoom}`,
    );
  }
  assert.ok(
    Number(evaluate(station, 'text-size', 16.3)) > Number(evaluate(caption, 'text-size', 16.3)),
  );
  assert.notDeepEqual(evaluate(station, 'text-color', 16.3), evaluate(caption, 'text-color', 16.3));
  for (const layer of [park, station, caption]) {
    assert.equal(layer.layout?.['icon-allow-overlap'], false);
    assert.equal(layer.layout?.['text-allow-overlap'], false);
    assert.equal(layer.layout?.['icon-optional'], false);
    assert.equal(layer.layout?.['text-optional'], false);
  }
});

test('Cívica reserves vermilion building ink for civic and major destinations rather than height', () => {
  const building = layerFor('buildings.flat.fill');
  const fields = tileflowWorldV1Schema().fields;
  const color = (tone: string, height = 10, importance: number | string = 0) =>
    evaluate(building, 'fill-color', 16, {
      [fields.buildingTone]: tone,
      [fields.renderHeight]: height,
      [fields.importanceTier]: importance,
    });
  assert.deepEqual(color('destination', 10, 3), color('civic'));
  assert.deepEqual(color('destination', 10, '3'), color('civic'));
  assert.notDeepEqual(color('destination', 10, 2), color('civic'));
  assert.notDeepEqual(color('destination', 10, 2), color('generic'));
  assert.deepEqual(color('destination', 10, 1), color('generic'));
  assert.deepEqual(color('destination'), color('commercial'));
  assert.notDeepEqual(color('civic'), color('generic'));
  assert.deepEqual(color('generic', 10), color('generic', 250));
  assert.deepEqual(color('generic', 10), color('generic', 250, 3));
  assert.deepEqual(
    evaluate(building, 'fill-color', 16, {[fields.buildingKind]: 'civic'}),
    color('civic'),
  );
});
