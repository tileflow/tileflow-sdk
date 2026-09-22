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
import {superTileWorld, superTileWorldFonts, superTileWorldIcons} from '../src';

const iconIds = [
  'stw-airship',
  'stw-book',
  'stw-brick',
  'stw-castle',
  'stw-coin',
  'stw-farmland',
  'stw-flag',
  'stw-flower',
  'stw-forest',
  'stw-ghost-house',
  'stw-grass',
  'stw-heart',
  'stw-hill',
  'stw-level-node',
  'stw-meadow',
  'stw-mushroom',
  'stw-mushroom-house',
  'stw-question-block',
  'stw-sand',
  'stw-star',
  'stw-tree',
  'stw-warp-pipe',
  'stw-water',
] as const;
const compiled = createStyleWithInspection(superTileWorld, {
  preparedAssets: {icons: {ids: iconIds, sprite: '/tileflow/icons/super-tile-world/sprite'}},
});
type Layer = (typeof compiled.style.layers)[number];

function visibleAt(layer: Layer, zoom: number): boolean {
  return (
    layer.layout?.visibility !== 'none' &&
    (layer.minzoom ?? 0) <= zoom &&
    zoom < (layer.maxzoom ?? 24)
  );
}

function layerFor(target: string, zoom?: number): Layer {
  const inspected = compiled.inspection.layers.find(
    ({contributions, index}) =>
      contributions.some((contribution) => contribution.target === target) &&
      (zoom === undefined || visibleAt(compiled.style.layers[index]!, zoom)),
  );
  assert.ok(inspected, `Missing Super Tile World target ${target} at z${zoom}`);
  return compiled.style.layers[inspected.index]!;
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
): boolean {
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

test('Super Tile World compiles as a standalone game board with local sprites and lettering', async () => {
  const resolved = resolveMap(superTileWorld);
  assert.equal(resolved.id, 'super-tile-world');
  assert.equal(resolved.name, 'Super Tile World');
  assert.equal('extends' in superTileWorld, false);
  assert.equal(Object.isFrozen(superTileWorld), true);
  assert.deepEqual(resolved.icons, [superTileWorldIcons]);
  assert.deepEqual(resolved.fonts, [superTileWorldFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.deepEqual(validateStyleMin(compiled.style as never), []);
  assert.equal(compiled.style.metadata?.['tileflow:extends'], undefined);
  assert.equal(compiled.style.metadata?.['tileflow:compiler'], 'tileflow-semantic');

  const packagedIds = (await readdir(new URL('../assets/super-tile-world/icons/', import.meta.url)))
    .map((file) => file.replace(/(?:\.pattern)?\.svg$/u, ''))
    .sort();
  assert.deepEqual(packagedIds, [...iconIds]);
  const serialized = JSON.stringify(compiled.style);
  for (const id of serialized.matchAll(/"(stw-[a-z-]+)"/gu)) {
    assert.ok(packagedIds.includes(id[1]!), `Missing local sprite ${id[1]}`);
  }
  assert.doesNotMatch(serialized, /"(?:civica|cyber|streets|baedeker)-/u);
});

function assertBefore(underlay: string, overlay: string): void {
  assert.ok(
    compiled.style.layers.indexOf(layerFor(underlay)) <
      compiled.style.layers.indexOf(layerFor(overlay)),
    `${underlay} must render before ${overlay}`,
  );
}

test('Super Tile World gives terrain and buildings flat platform depth in semantic order', () => {
  assert.equal(compiled.style.terrain, undefined);
  assert.equal(
    compiled.style.layers.some(({type}) => type === 'fill-extrusion'),
    false,
  );
  assertBefore('land.render.parkCliffEdge', 'land.render.parkCliff');
  assertBefore('land.render.parkCliff', 'land.landcover.urbanPark.fill');
  assertBefore('land.landcover.urbanPark.fill', 'land.render.parkGarden');
  assertBefore('water.render.coastInk', 'water.render.coastSand');
  assertBefore('water.render.coastSand', 'water.bodies.fill');
  assertBefore('water.bodies.fill', 'water.render.waves');
  assertBefore('buildings.render.platformSides', 'buildings.flat.fill');
  assertBefore('buildings.flat.fill', 'buildings.render.brickRoofs');

  for (const target of ['land.render.parkCliff', 'buildings.render.platformSides']) {
    const layer = layerFor(target);
    assert.equal(layer.type, 'fill');
    assert.equal(evaluate(layer, 'fill-translate-anchor', 17), 'viewport');
    const offset = layer.paint?.['fill-translate'] as number[];
    assert.ok(offset[1]! > 0, `${target} lost its downward platform side`);
  }
});

test('Super Tile World hands the overview to district blocks before close texture and trees', () => {
  const district = layerFor('buildings.render.districtBlocks');
  const detail = layerFor('buildings.flat.fill');
  assert.equal(district.maxzoom, detail.minzoom);
  const handoff = detail.minzoom!;
  assert.equal(
    evaluate(district, 'fill-opacity', handoff),
    evaluate(detail, 'fill-opacity', handoff),
  );
  assert.ok(
    Number(evaluate(detail, 'fill-opacity', handoff + 1)) >=
      Number(evaluate(detail, 'fill-opacity', handoff)),
  );

  const levelDots = layerFor('roads.render.levelDots');
  const coins = layerFor('roads.render.coinTrail');
  const bricks = layerFor('buildings.render.brickRoofs');
  const trees = layerFor('vegetation.render.pixelTrees');
  assert.ok(levelDots.maxzoom! <= coins.minzoom!);
  assert.equal(visibleAt(coins, 14), false);
  assert.equal(visibleAt(coins, 18), true);
  assert.equal(visibleAt(bricks, 14), false);
  assert.equal(visibleAt(trees, 14), false);
  assert.equal(visibleAt(trees, 18), true);
  assert.equal(coins.layout?.['symbol-placement'], 'line');
  assert.equal(coins.layout?.['icon-image'], 'stw-coin');
  assert.equal(trees.layout?.['icon-image'], 'stw-tree');
  assert.equal(trees.layout?.['symbol-z-order'], 'viewport-y');
});

test('Super Tile World keeps sprites and names coupled and selects them by real POI category', () => {
  const symbols = {
    landmark: 'stw-castle',
    'arts-entertainment': 'stw-star',
    'park-nature': 'stw-hill',
    transport: 'stw-warp-pipe',
    religion: 'stw-ghost-house',
    education: 'stw-book',
    'public-services': 'stw-flag',
    medical: 'stw-heart',
    lodging: 'stw-mushroom-house',
    'sport-leisure': 'stw-flower',
    'food-drink': 'stw-mushroom',
    retail: 'stw-question-block',
    'visitor-amenity': 'stw-level-node',
  };
  for (const [category, image] of Object.entries(symbols)) {
    const layer = layerFor(`poi.${category}`);
    assert.equal(layer.layout?.['icon-image'], image);
    assert.equal(layer.layout?.['icon-optional'], false);
    assert.equal(layer.layout?.['text-optional'], false);
    assert.equal(layer.layout?.['icon-allow-overlap'], false);
    assert.equal(layer.layout?.['icon-ignore-placement'], false);
    assert.ok(layer.layout?.['text-field']);
    assert.equal(acceptsPoi(category, 21), true);
    assert.equal(acceptsPoi(category, 21, {category: 'unsupported'}), false);
    assert.equal(acceptsPoi(category, 21, {rank: -1}), false);
    assert.equal(acceptsPoi(category, 21, {rank: 'invalid'}), false);
    assert.equal(acceptsPoi(category, 21, {sizeRank: -1}), false);
    assert.equal(acceptsPoi(category, 21, {sizeRank: 17}), false);
    assert.equal(acceptsPoi(category, 21, {sizeRank: 'invalid'}), false);
    assert.equal(acceptsPoi(category, 21, {sizeRank: 16}), true);
  }
  assert.equal(acceptsPoi('transport', 16), true);
  assert.equal(acceptsPoi('food-drink', 16), false);
  assert.equal(acceptsPoi('retail', 16), false);
  assert.equal(acceptsPoi('retail', 20), true);
});

test('Super Tile World respects producer eligibility before admitting secondary destinations', () => {
  for (const category of ['landmark', 'arts-entertainment', 'park-nature', 'transport']) {
    assert.equal(acceptsPoi(category, 16, {minZoom: 17}), false);
    assert.equal(acceptsPoi(category, 17, {minZoom: 17}), true);
    assert.equal(acceptsPoi(category, 20, {rank: undefined}), false);
    assert.equal(acceptsPoi(category, 20, {sizeRank: undefined}), false);
    assert.equal(acceptsPoi(category, 20, {rank: 6}), false);
  }
  assert.equal(acceptsPoi('transport', 16, {type: 'train_station', sizeRank: 16}), true);
  assert.equal(acceptsPoi('transport', 17, {type: 'public_transit_facility'}), false);
  assert.equal(acceptsPoi('transport', 18, {type: 'public_transit_facility'}), true);
  assert.equal(acceptsPoi('transport', 21, {type: 'airport'}), false);
  assert.equal(acceptsPoi('arts-entertainment', 16, {rank: 2, sizeRank: 16}), false);
  assert.equal(acceptsPoi('arts-entertainment', 17, {rank: 2, sizeRank: 16}), true);
  assert.equal(acceptsPoi('retail', 16, {rank: 2}), false);
  assert.equal(acceptsPoi('retail', 17, {rank: 2}), true);
  for (const category of ['food-drink', 'retail']) {
    for (const rank of [4, 5]) {
      assert.equal(acceptsPoi(category, 17, {rank}), false);
      assert.equal(acceptsPoi(category, 18, {rank}), true);
      assert.equal(acceptsPoi(category, 18, {rank, minZoom: 19}), false);
      assert.equal(acceptsPoi(category, 19, {rank, minZoom: 19}), true);
    }
    assert.equal(acceptsPoi(category, 21, {rank: 6}), false);
    assert.equal(acceptsPoi(category, 21, {rank: 5, sizeRank: 17}), false);
  }
});
