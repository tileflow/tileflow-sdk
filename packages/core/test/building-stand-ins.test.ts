import {featureFilter, type FilterSpecification} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tileflowNativeBuildingsFilter,
  tileflowSameStandInArea,
  type TileflowStandIn,
  tileflowStandInArea,
  tileflowStandInMargin,
} from '../src/building-stand-ins';
import {
  tileflowInsideRings,
  tileflowModelFootprintInTile,
  tileflowRingsOverlap,
} from '../src/models-3d-model';

// The compiled extrusion, drawn while the building scene is not ready, must leave out exactly the
// buildings the scene's mesh leaves to a model; MapLibre evaluates its filter, so this asks it.

const earth = 40_075_016.686;
const extent = 8192;
const zoom = 14;
const at = [2.2944962, 48.8582621] as const;
const tile = {
  x: Math.floor(((at[0] + 180) / 360) * 2 ** zoom),
  y: Math.floor(((1 - Math.asinh(Math.tan((at[1] * Math.PI) / 180)) / Math.PI) / 2) * 2 ** zoom),
};

// A tower on four legs, as a landmark index names it: its octagon of ±88 m in triangles.
const octagon = Array.from({length: 8}, (_, side) => {
  const angle = (side * Math.PI) / 4 + Math.PI / 8;
  return [
    (Math.cos(angle) * 88) / Math.cos(Math.PI / 8),
    (Math.sin(angle) * 88) / Math.cos(Math.PI / 8),
  ];
});
const tower: TileflowStandIn = {
  placement: {at, heading: 30},
  footprint: octagon
    .slice(1, -1)
    .map((point, side) => [...octagon[0]!, ...point, ...octagon[side + 2]!]),
};

/** A building's ring, `[east, north]` metres round the tower, in the tile's units. */
function inTile(ring: readonly (readonly [number, number])[]): number[] {
  return tileflowModelFootprintInTile([ring.flat()], {at, heading: 0}, {...tile, zoom}, extent)[0]!;
}

/** Whether MapLibre draws a building, as a feature of the tile, through the filter. */
function drawn(filter: unknown, ring: readonly (readonly [number, number])[], extrude = true) {
  const points = inTile(ring);
  const geometry = [[] as {x: number; y: number}[]];
  for (let index = 0; index < points.length; index += 2)
    geometry[0]!.push({x: points[index]!, y: points[index + 1]!});
  geometry[0]!.push({...geometry[0]![0]!});
  const feature = {type: 3 as const, properties: {extrude}, geometry};
  return featureFilter(filter as FilterSpecification).filter(
    {zoom: 16},
    feature as never,
    {z: zoom, ...tile} as never,
  );
}

/** Whether the scene's mesh leaves a building to the tower, at a margin in metres. */
function meshLeaves(ring: readonly (readonly [number, number])[], margin: number): boolean {
  const masks = tileflowModelFootprintInTile(
    tower.footprint,
    tower.placement,
    {...tile, zoom},
    extent,
  );
  const metresPerUnit = (earth * Math.cos((at[1] * Math.PI) / 180)) / 2 ** zoom / extent;
  const outline = inTile(ring);
  let [cx, cy] = [0, 0];
  for (let index = 0; index < outline.length; index += 2) {
    cx += outline[index]! / (outline.length / 2);
    cy += outline[index + 1]! / (outline.length / 2);
  }
  return (
    tileflowInsideRings(masks, cx, cy) ||
    tileflowRingsOverlap([outline], masks, margin / metresPerUnit)
  );
}

const square = (east: number, north: number, side: number): [number, number][] => [
  [east, north],
  [east + side, north],
  [east + side, north + side],
  [east, north + side],
];

const authored = ['!=', ['get', 'extrude'], false];

test('the native extrusion leaves out the buildings a landmark stands in for, as the mesh does', () => {
  const filter = tileflowNativeBuildingsFilter(authored, tileflowStandInArea([tower]));
  let left = 0;
  let kept = 0;
  for (let east = -121; east <= 112; east += 7.3)
    for (let north = -118; north <= 112; north += 6.1) {
      const building = square(east, north, 9);
      const leaves = meshLeaves(building, tileflowStandInMargin);
      // Buildings within a few centimetres of the margin may fall either way.
      if (leaves !== meshLeaves(building, tileflowStandInMargin + 0.05)) continue;
      if (leaves !== meshLeaves(building, tileflowStandInMargin - 0.05)) continue;
      assert.equal(drawn(filter, building), !leaves, `building at ${east}, ${north}`);
      if (leaves) left += 1;
      else kept += 1;
    }
  assert.ok(left > 300 && kept > 300, `${left} left to the tower, ${kept} kept`);
});

test("a landmark's floating parts are left to it, and a neighbour that only touches it stays", () => {
  // Upright, the octagon's southern edge runs along 88 m south.
  const upright = {...tower, placement: {at, heading: 0}};
  const filter = tileflowNativeBuildingsFilter(authored, tileflowStandInArea([upright]));
  // Parts the map draws of the tower itself, high above its centre and over a leg.
  assert.equal(drawn(filter, square(-10, -10, 20)), false);
  assert.equal(drawn(filter, square(50, 40, 6)), false);
  // A part reaching ten metres in across the edge of its footprint.
  assert.equal(drawn(filter, square(-100, -5, 22)), false);
  // A neighbour sharing the footprint's southern edge, and one reaching in less than the margin.
  const south = -88;
  assert.equal(drawn(filter, square(-10, south - 20, 20)), true);
  assert.equal(drawn(filter, square(-10, south - 19.7, 20)), true);
  // The authored filter still applies.
  assert.equal(drawn(filter, square(150, 150, 10), false), false);
  assert.equal(drawn(filter, square(150, 150, 10)), true);
});

test('without a model standing, the native extrusion keeps its authored filter', () => {
  assert.equal(tileflowStandInArea([]), undefined);
  assert.equal(tileflowNativeBuildingsFilter(authored, undefined), authored);
  // A footprint too narrow to reach into by the margin stands in for nothing.
  assert.equal(
    tileflowStandInArea([{placement: {at, heading: 0}, footprint: [[0, 0, 0.8, 0, 0.8, 0.8]]}]),
    undefined,
  );
  const area = tileflowStandInArea([tower]);
  assert.deepEqual(tileflowNativeBuildingsFilter(undefined, area), ['>', ['distance', area], 0]);
});

test('a landmark whose model replaces its index entry covers the same ground', () => {
  const other: TileflowStandIn = {
    placement: {at: [2.2885, 48.862], heading: 0},
    footprint: [[0, 0, 40, 0, 0, 40]],
  };
  // The index names footprints in whole decimetres; the model, exactly.
  const rounded: TileflowStandIn = {
    ...tower,
    footprint: tower.footprint.map((ring) => ring.map((value) => Math.round(value * 10) / 10)),
  };
  const held = tileflowStandInArea([rounded, other]);
  const standing = tileflowStandInArea([other, tower]);
  assert.ok(tileflowSameStandInArea(held, standing));
  assert.equal(tileflowSameStandInArea(held, tileflowStandInArea([tower])), false);
  assert.equal(
    tileflowSameStandInArea(
      held,
      tileflowStandInArea([{...tower, placement: {at, heading: 31}}, other]),
    ),
    false,
  );
});
