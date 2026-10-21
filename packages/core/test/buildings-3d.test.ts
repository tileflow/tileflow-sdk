import {createExpression} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowBuildings3D,
  tileflowBuildings3DLayerId,
  tileflowSunLightMatrix,
} from '../src/buildings-3d-browser';
import {
  readTileflowBuildings3D,
  tileflowBuildingsMetadata,
  tileflowBuildingsMetadataKey,
  tileflowDefaultBuildings3DDesign,
} from '../src/buildings-3d-design';
import {tileflowBuildingStyleLight} from '../src/buildings-3d-light';
import {
  meshTileflowBuildings,
  tileflowBuildingExtent,
  tileflowBuildingVertexBytes,
} from '../src/buildings-3d-mesh';
import {tileflowFeatureColour} from '../src/feature-colour-browser';
import {tileflowColourChannels} from '../src/theme-blend';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

// MVT exterior rings are clockwise in tile units (y down); this is a 1000 × 1000 square.
const square = [0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0];

function layerOf(
  features: {geometry: number[][]; properties?: Record<string, string | number | boolean>}[],
): TileflowTileLayer {
  return {
    extent: 4096,
    features: features.map(({geometry, properties}) => ({
      type: 'Polygon' as const,
      properties: {render_height: 30, ...properties},
      geometry: geometry.map((ring) => ring.map((value) => value + 1000)),
    })),
  };
}

function vertex(mesh: NonNullable<ReturnType<typeof meshTileflowBuildings>>, index: number) {
  const view = new DataView(
    mesh.vertices.buffer,
    mesh.vertices.byteOffset + index * tileflowBuildingVertexBytes,
  );
  return {
    x: view.getUint16(0, true),
    y: view.getUint16(2, true),
    base: view.getUint16(4, true) / 10,
    top: view.getUint16(6, true) / 10,
    normal: [view.getInt8(8) / 127, view.getInt8(9) / 127],
    raised: view.getUint8(10),
    wall: view.getUint8(11),
    tone: view.getUint8(20),
    corners: view.getUint8(22),
    length: view.getUint8(23),
    feature: view.getUint16(24, true),
    corner: view.getUint8(26),
    sides: view.getUint8(27),
  };
}

test("a building's use class is packed above its tone for the windows", () => {
  const packed = (properties: Record<string, unknown>) =>
    vertex(
      meshTileflowBuildings(layerOf([{geometry: [square], properties}]), {tileMetres: 1000})!,
      0,
    ).tone;
  assert.equal(packed({}), 0);
  assert.equal(packed({class: 'residential'}), 4);
  assert.equal(packed({class: 'education'}), 8);
  assert.equal(packed({class: 'outbuilding'}), 12);
  assert.equal(packed({class: 'industrial', building_tone: 'destination'}), 15);
  assert.equal(packed({class: 'unknown', building_tone: 'commercial'}), 1);
});

test('a building becomes a roof and four walls facing out of it', () => {
  const mesh = meshTileflowBuildings(
    layerOf([{geometry: [square], properties: {building_tone: 'commercial'}}]),
    {tileMetres: 1000},
  );
  assert.ok(mesh);
  // Two roof triangles with corners of their own, and four walls of four corners.
  assert.equal(mesh.vertices.length, 22 * tileflowBuildingVertexBytes);
  assert.equal(mesh.wallsFrom, 6);
  assert.equal(mesh.indices.length, 6 + 4 * 6);
  assert.equal(mesh.top, 30);
  assert.equal(mesh.features.length, 1);
  const roof = vertex(mesh, 0);
  assert.equal(roof.raised, 1);
  assert.equal(roof.wall, 0);
  assert.equal(roof.top, 30);
  assert.equal(roof.tone, 1);
  // Scaled from the 4096 extent to the renderer's 8192.
  assert.ok([2000, 4000].includes(roof.x));
  // Every wall's normal points away from the square's centre.
  const centre = [(2000 + 4000) / 2, (2000 + 4000) / 2];
  for (let index = 6; index < 22; index += 4) {
    const start = vertex(mesh, index);
    const end = vertex(mesh, index + 1);
    assert.equal(start.wall, 1);
    assert.equal(start.corner, 0);
    assert.equal(end.corner, 1);
    // No end of these walls lies on the tile's edge.
    assert.equal(start.sides, 0);
    const middle = [(start.x + end.x) / 2, (start.y + end.y) / 2];
    const outward =
      start.normal[0]! * (middle[0]! - centre[0]!) + start.normal[1]! * (middle[1]! - centre[1]!);
    assert.ok(outward > 0, `wall ${index} faces in`);
    // A convex square has no tight corner.
    assert.equal(start.corners, 0);
  }
  // 2000 units of 8192 at 1000 m per tile: about 244 m a side.
  assert.equal(vertex(mesh, 6).length, Math.round((2000 / tileflowBuildingExtent) * 1000));
});

test('rounded corners stay inside the footprint and keep roof and wall outlines joined', () => {
  const input = layerOf([{geometry: [square]}]);
  const sharp = meshTileflowBuildings(input, {tileMetres: 1000})!;
  const rounded = meshTileflowBuildings(input, {tileMetres: 1000, edgeRadius: 0.4})!;
  assert.ok(rounded.vertices.length > sharp.vertices.length);
  assert.equal(rounded.top, sharp.top);
  const roofPoints = new Set<string>();
  const wallPoints = new Set<string>();
  let curved = 0;
  for (let index = 0; index < rounded.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    const v = vertex(rounded, index);
    assert.ok(v.x >= 2000 && v.x <= 4000 && v.y >= 2000 && v.y <= 4000);
    assert.ok(
      !([2000, 4000].includes(v.x) && [2000, 4000].includes(v.y)),
      'a sharp exterior corner remains',
    );
    const key = `${v.x},${v.y}`;
    if (!v.wall) roofPoints.add(key);
    else {
      wallPoints.add(key);
      assert.ok(Math.abs(Math.hypot(...v.normal) - 1) < 0.015);
      if (Math.abs(v.normal[0]!) > 0.1 && Math.abs(v.normal[1]!) > 0.1) curved += 1;
    }
  }
  assert.ok(curved > 0, 'curved corners need smoothly changing normals');
  assert.deepEqual(roofPoints, wallPoints);
  // Rounding is opt-in and never consumes tiny walls or adds vertices below tile precision.
  assert.deepEqual(meshTileflowBuildings(input, {tileMetres: 1000, edgeRadius: 0}), sharp);
  assert.deepEqual(meshTileflowBuildings(input, {tileMetres: 1000, edgeRadius: 0.01}), sharp);
});

test('rounding preserves tile cuts, concave corners and courtyard boundaries', () => {
  const across = [-2000, 0, 0, 0, 0, 1000, -2000, 1000, -2000, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [across]}]), {
    tileMetres: 1000,
    edgeRadius: 0.4,
  })!;
  let cuts = 0;
  for (
    let index = mesh.wallsFrom;
    index < mesh.vertices.length / tileflowBuildingVertexBytes;
    index += 4
  ) {
    const a = vertex(mesh, index);
    const b = vertex(mesh, index + 1);
    assert.ok(!(a.x === 0 && b.x === 0), 'rounding introduced a wall on the tile cut');
    if (a.x === 0 || b.x === 0) cuts += 1;
  }
  assert.equal(cuts, 2);
  const courtyard = [250, 250, 250, 750, 750, 750, 750, 250, 250, 250];
  const withHole = meshTileflowBuildings(layerOf([{geometry: [square, courtyard]}]), {
    tileMetres: 1000,
    edgeRadius: 0.4,
  })!;
  const holePoints = new Set<string>();
  for (
    let index = withHole.wallsFrom;
    index < withHole.vertices.length / tileflowBuildingVertexBytes;
    index += 4
  ) {
    const v = vertex(withHole, index);
    if (v.corners & 4) holePoints.add(`${v.x},${v.y}`);
  }
  assert.deepEqual(holePoints, new Set(['2500,2500', '2500,3500', '3500,3500', '3500,2500']));
});

test("a roof's triangles mark the sides on its outline, not the diagonal between them", () => {
  const mesh = meshTileflowBuildings(layerOf([{geometry: [square]}]), {tileMetres: 1000});
  assert.ok(mesh);
  let outline = 0;
  for (let triangle = 0; triangle < 2; triangle += 1) {
    const corners = [0, 1, 2].map((corner) => vertex(mesh, triangle * 3 + corner));
    assert.deepEqual(
      corners.map(({corner}) => corner),
      [0, 1, 2],
    );
    // Every corner of a triangle carries the same sides.
    assert.equal(new Set(corners.map(({sides}) => sides)).size, 1);
    const sides = corners[0]!.sides;
    // Two sides of each triangle are the square's; the third is the diagonal.
    assert.equal([1, 2, 4].filter((bit) => sides & bit).length, 2);
    outline += 2;
  }
  assert.equal(outline, 4);
});

test("a roof the tile's edge cuts has no outline along the edge", () => {
  const across = [-2000, 0, 0, 0, 0, 1000, -2000, 1000, -2000, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [across]}]), {tileMetres: 1000});
  assert.ok(mesh);
  const roofCorners = mesh.wallsFrom;
  for (let index = 0; index < roofCorners; index += 3) {
    const corners = [0, 1, 2].map((corner) => vertex(mesh, index + corner));
    for (let corner = 0; corner < 3; corner += 1) {
      if (!(corners[0]!.sides & (1 << corner))) continue;
      const [a, b] = [corners[(corner + 1) % 3]!, corners[(corner + 2) % 3]!];
      assert.ok(!(a.x === 0 && b.x === 0), 'an outline along the tile edge');
    }
  }
  // The walls that end on the tile's edge say so.
  const cut = [];
  for (
    let index = roofCorners;
    index < mesh.vertices.length / tileflowBuildingVertexBytes;
    index += 4
  )
    cut.push(vertex(mesh, index).sides);
  assert.deepEqual(cut.sort(), [0, 1, 2]);
});

test("an L's inside corner is tight for the walls that meet there", () => {
  // An L in tile units, clockwise: the inside corner is at (500, 500).
  const shape = [0, 0, 1000, 0, 1000, 500, 500, 500, 500, 1000, 0, 1000, 0, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [shape]}]), {tileMetres: 1000});
  assert.ok(mesh);
  const tight: number[] = [];
  for (
    let index = mesh.wallsFrom;
    index < mesh.vertices.length / tileflowBuildingVertexBytes;
    index += 4
  ) {
    const start = vertex(mesh, index);
    if (start.corners) tight.push(start.corners);
  }
  // The wall arriving at the inside corner has it at its end; the one leaving, at its start.
  assert.deepEqual(tight.sort(), [1, 2]);
});

test('hidden buildings, other geometry and empty layers raise nothing', () => {
  assert.equal(
    meshTileflowBuildings(layerOf([{geometry: [square], properties: {hide_3d: true}}]), {
      tileMetres: 1000,
    }),
    undefined,
  );
  assert.equal(
    meshTileflowBuildings(
      {extent: 4096, features: [{type: 'LineString', properties: {}, geometry: [[0, 0, 10, 10]]}]},
      {tileMetres: 1000},
    ),
    undefined,
  );
  assert.equal(meshTileflowBuildings({extent: 4096, features: []}, {tileMetres: 1000}), undefined);
});

test('a building the tile edge cuts has no wall along the edge', () => {
  // From x = -1000 to 1000 in the layer's units before the shift: half of it lies past the edge.
  const across = [-2000, 0, 0, 0, 0, 1000, -2000, 1000, -2000, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [across]}]), {tileMetres: 1000});
  assert.ok(mesh);
  for (let index = 0; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    assert.ok(vertex(mesh, index).x >= 0);
  }
  // Three walls: the one on the tile's left edge belongs to the next tile.
  assert.equal(mesh.indices.length - mesh.wallsFrom, 3 * 6);
});

test('heights fall back to five metres and bases stay under the top', () => {
  const mesh = meshTileflowBuildings(
    {
      extent: 4096,
      features: [
        {type: 'Polygon', properties: {}, geometry: [square]},
        {
          type: 'Polygon',
          properties: {render_height: 20, render_min_height: 50},
          geometry: [square],
        },
      ],
    },
    {tileMetres: 1000},
  );
  assert.ok(mesh);
  assert.equal(vertex(mesh, 0).top, 5);
  const second = vertex(mesh, 22);
  assert.equal(second.feature, 1);
  assert.equal(second.base, 20);
  assert.equal(second.top, 20);
});

/** Each building's night use, as the mesh stores it: none, dining, entertainment, nightlife. */
function usesOf(mesh: NonNullable<ReturnType<typeof meshTileflowBuildings>>) {
  const uses = new Map<number, number>();
  for (let index = 0; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    const view = new DataView(
      mesh.vertices.buffer,
      mesh.vertices.byteOffset + index * tileflowBuildingVertexBytes,
    );
    uses.set(view.getUint16(24, true), view.getUint8(21));
  }
  return [...uses.entries()].sort((a, b) => a[0] - b[0]).map(([, use]) => use);
}

// Four 1000-unit squares, 500 units apart, in a tile of 4096 units and 4096 metres.
const row = [
  [0, 0],
  [1500, 0],
  [0, 1500],
  [1500, 1500],
].map(([left, top]) => [
  left!,
  top!,
  left! + 1000,
  top!,
  left! + 1000,
  top! + 1000,
  left!,
  top! + 1000,
  left!,
  top!,
]);
const place = (x: number, y: number, type: string) => ({
  type: 'Point' as const,
  properties: {type},
  geometry: [[x + 1000, y + 1000]],
});

test("buildings take World's night use, or the strongest use of the places inside or on their facade", () => {
  const places = {
    extent: 4096,
    features: [
      // Inside the first building: a restaurant and a bar, so nightlife.
      place(500, 500, 'restaurant'),
      place(400, 600, 'bar'),
      // Three metres outside the second building's facade: a theatre.
      place(2000, 1003, 'theatre_venue'),
      // Twenty metres from the third building: nothing.
      place(500, 2520, 'restaurant'),
      // A shop gives no night use to the fourth.
      place(2000, 2000, 'clothing_store'),
    ],
  };
  const derived = meshTileflowBuildings(layerOf(row.map((ring) => ({geometry: [ring]}))), {
    tileMetres: 4096,
    places,
  });
  assert.ok(derived);
  assert.deepEqual(usesOf(derived), [3, 2, 0, 0]);

  // Once the tile's buildings carry `night_use`, the places are not read.
  const carried = meshTileflowBuildings(
    layerOf([
      {geometry: [row[0]!], properties: {night_use: 'dining'}},
      {geometry: [row[1]!]},
      {geometry: [row[2]!], properties: {night_use: 'entertainment'}},
      {geometry: [row[3]!], properties: {night_use: 'nightlife'}},
    ]),
    {tileMetres: 4096, places},
  );
  assert.ok(carried);
  assert.deepEqual(usesOf(carried), [1, 0, 2, 3]);
});

test('walls round a courtyard are marked as facing it', () => {
  // A 1000-unit square with a 200-unit courtyard, wound anticlockwise.
  const courtyard = [400, 400, 400, 600, 600, 600, 600, 400, 400, 400];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [square, courtyard]}]), {
    tileMetres: 1000,
  });
  assert.ok(mesh);
  const flags: number[] = [];
  for (let index = 0; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    const wall = vertex(mesh, index);
    if (wall.wall) flags.push(wall.corners & 4);
  }
  // Four outer walls and four courtyard walls, four vertices each.
  assert.deepEqual(flags.sort(), [...Array(16).fill(0), ...Array(16).fill(4)]);
});

test('the sun sees nearer points at a smaller depth and holds the whole box', () => {
  const box = {min: [-500, -500, 0], max: [500, 500, 100]};
  const light = tileflowSunLightMatrix([0, -0.5, 0.866], box);
  const apply = ([x, y, z]: number[]) => {
    const m = light.matrix;
    return [0, 1, 2].map(
      (row) => m[row]! * x! + m[4 + row]! * y! + m[8 + row]! * z! + m[12 + row]!,
    );
  };
  for (const x of [-500, 500])
    for (const y of [-500, 500])
      for (const z of [0, 100])
        for (const value of apply([x, y, z])) assert.ok(Math.abs(value) <= 1, `${x} ${y} ${z}`);
  // A roof is nearer the sun than the ground under it.
  assert.ok(apply([0, 0, 100])[2]! < apply([0, 0, 0])[2]!);
  assert.ok(light.depth > 0);
  assert.ok(light.extent > 1000);
});

function fakeMap() {
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Set<string>();
  return {
    layers,
    listeners,
    addLayer(layer: {id: string}) {
      layers.add(layer.id);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 25.76, lng: -80.19}),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getPaintProperty: () => undefined,
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle: () => ({layers: [{id: 'labels', type: 'symbol'}]}),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    triggerRepaint() {},
  };
}

test('the renderer puts its layer on the map, grows without a renderer and leaves cleanly', async () => {
  const map = fakeMap();
  const buildings = createTileflowBuildings3D({map});
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  assert.equal(buildings.scale, 1, 'mounted buildings are enabled automatically');
  await buildings.grow(0.5, {transition: {duration: 0}});
  assert.equal(buildings.scale, 0.5);
  await buildings.show({transition: {duration: 0}});
  assert.equal(buildings.scale, 1);
  await assert.rejects(buildings.grow(Number.NaN), RangeError);
  await assert.rejects(buildings.grow(1, {transition: {duration: -1}}), RangeError);
  assert.deepEqual(buildings.stats, {
    declared: false,
    tiles: 0,
    buildings: 0,
    vertices: 0,
    models: 0,
  });
  buildings.dispose();
  assert.equal(map.layers.has(tileflowBuildings3DLayerId), false);
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('standalone buildings reuse metadata until the style changes', () => {
  const map = fakeMap();
  let reads = 0;
  let metadata: Record<string, unknown> = {};
  map.getStyle = () => {
    reads += 1;
    return {metadata, layers: [{id: 'labels', type: 'symbol'}]};
  };
  const buildings = createTileflowBuildings3D({map});
  assert.equal(buildings.stats.declared, false);
  const initialReads = reads;
  for (let frame = 0; frame < 120; frame += 1) assert.equal(buildings.stats.declared, false);
  assert.equal(reads, initialReads);
  metadata = {
    [tileflowBuildingsMetadataKey]: tileflowBuildingsMetadata(tileflowDefaultBuildings3DDesign),
  };
  map.listeners.get('styledata')?.forEach((listener) => listener());
  assert.equal(buildings.stats.declared, true);
  const updatedReads = reads;
  for (let frame = 0; frame < 120; frame += 1) assert.equal(buildings.stats.declared, true);
  assert.equal(reads, updatedReads);
  buildings.dispose();
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('controller-driven style changes do not serialize the style for fallback lighting', () => {
  const map = {...fakeMap(), getLight: () => ({})};
  let reads = 0;
  const getStyle = map.getStyle;
  map.getStyle = () => {
    reads += 1;
    return getStyle();
  };
  const metadata = tileflowBuildingsMetadata(tileflowDefaultBuildings3DDesign);
  const buildings = createTileflowBuildings3D({
    map,
    controller: {getThemeMetadata: () => ({values: [metadata], position: 0})},
  });
  const initialReads = reads;
  for (let frame = 0; frame < 120; frame += 1) {
    map.listeners.get('styledata')?.forEach((listener) => listener());
    assert.equal(buildings.stats.declared, true);
  }
  assert.equal(reads, initialReads);
  buildings.dispose();
});

test('renderer options are validated', () => {
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), minzoom: 30}), RangeError);
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), maxTiles: 0}), RangeError);
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), maxTiles: 100}), RangeError);
});

test('the 3D buildings design is read only in a known version and shape', () => {
  const described = {
    version: 1,
    source: 'tileflow',
    layers: {building: 'building', places: 'poi'},
    color: ['case', ['==', ['get', 'building_tone'], 'destination'], '#ff0000', '#00ff00'],
    edges: 3,
    edgeColor: '#7fd8ff',
    nightLight: 0.5,
    windows: true,
    shadows: false,
  };
  const read = readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: described})!;
  assert.deepEqual(read.color, described.color);
  // A value out of range keeps its default; an unset switch keeps its default.
  assert.equal(read.edges, 0);
  assert.equal(read.edgeColor, '#7fd8ff');
  assert.equal(read.nightLight, 0.5);
  assert.equal(read.windows, true);
  assert.equal(read.shadows, false);
  assert.equal(read.occlusion, true);
  assert.equal(
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: {...described, version: 2}}),
    undefined,
  );
  assert.equal(readTileflowBuildings3D({}), undefined);
});

test('a building colour expression evaluates as MapLibre evaluates it', () => {
  const floors = ['/', ['to-number', ['get', 'render_height'], 0], 3.2];
  const expressions: unknown[] = [
    [
      'case',
      ['==', ['coalesce', ['get', 'building_tone'], ''], 'destination'],
      '#d4a017',
      ['step', ['%', floors, 5], '#f1d4cd', 1, '#d3e8da', 2, '#f6e0b5', 3, '#e2d5f0', 4, '#cfe3f2'],
    ],
    ['match', ['get', 'building_tone'], ['active', 'commercial'], '#ff8800', '#336699'],
    [
      'interpolate',
      ['linear'],
      ['to-number', ['get', 'render_height'], 0],
      0,
      '#000000',
      100,
      '#ffffff',
    ],
    [
      'let',
      'tall',
      ['>=', floors, 10],
      ['case', ['var', 'tall'], 'rgb(10, 20, 30)', 'hsl(0, 100%, 50%)'],
    ],
  ];
  const buildings = [
    {render_height: 3},
    {render_height: 12.8},
    {render_height: 40, building_tone: 'destination'},
    {render_height: '25', building_tone: 'commercial'},
    {},
  ];
  for (const expression of expressions)
    for (const properties of buildings) {
      const parsed = createExpression(
        expression as never,
        {
          type: 'color',
          'property-type': 'data-driven',
          expression: {interpolated: true, parameters: ['zoom', 'feature']},
          transition: false,
        } as never,
      );
      assert.equal(parsed.result, 'success');
      const reference = (
        parsed.value as {
          evaluate(globals: object, feature: object): {r: number; g: number; b: number};
        }
      ).evaluate({zoom: 16}, {type: 'Polygon', properties});
      const ours = tileflowFeatureColour(
        expression as unknown[],
        properties,
        tileflowColourChannels,
      )!;
      assert.ok(ours, JSON.stringify([expression, properties]));
      for (const [index, channel] of (['r', 'g', 'b'] as const).entries())
        assert.ok(
          Math.abs(ours[index]! - reference[channel]) < 0.01,
          JSON.stringify([expression, properties]),
        );
    }
  // An expression Core does not compile gives no colour.
  assert.equal(tileflowFeatureColour(['image', 'x'], {}, tileflowColourChannels), undefined);
});

test('buildings have a sunlit finish by default and preserve explicit design choices', () => {
  const metadata = {
    version: 1,
    source: 'tileflow',
    layers: {building: 'building', places: 'poi'},
    color: '#d8d0c0',
  };
  assert.deepEqual(
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: metadata}),
    tileflowDefaultBuildings3DDesign,
  );
  assert.equal(tileflowDefaultBuildings3DDesign.lighting, 'sun');
  assert.equal(tileflowDefaultBuildings3DDesign.edgeRadius, 0.8);
  assert.equal(tileflowDefaultBuildings3DDesign.windows, false);
  for (const flag of ['shadows', 'occlusion'] as const)
    assert.equal(tileflowDefaultBuildings3DDesign[flag], true);
  for (const amount of ['edges', 'nightLight', 'colorVariation'] as const)
    assert.equal(tileflowDefaultBuildings3DDesign[amount], 0);
  const enhanced = {
    ...tileflowDefaultBuildings3DDesign,
    lighting: 'sun' as const,
    edges: 1,
    edgeRadius: 0.4,
    nightLight: 1,
    colorVariation: 0.06,
    shadows: true,
    occlusion: true,
    windows: true,
  };
  assert.deepEqual(
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: tileflowBuildingsMetadata(enhanced)}),
    enhanced,
  );
  // Existing compiled styles with explicit false/zero values retain their chosen finish.
  const flat = {
    ...tileflowDefaultBuildings3DDesign,
    lighting: 'style' as const,
    edgeRadius: 0,
    shadows: false,
    occlusion: false,
  };
  assert.deepEqual(
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: tileflowBuildingsMetadata(flat)}),
    flat,
  );
  assert.equal(
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: {...metadata, edgeRadius: 2}})
      ?.edgeRadius,
    0.8,
  );
});

test('a design gives the zoom bands the city comes in over, or leaves them to the renderer', () => {
  const metadata = {
    version: 1,
    source: 'tileflow',
    layers: {building: 'building'},
    color: '#d8d0c0',
  };
  const read = (entrance: unknown) =>
    readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: {...metadata, entrance}})?.entrance;
  assert.deepEqual(read({buildings: [15.5, 16], models: [14, 14.5]}), {
    buildings: [15.5, 16],
    models: [14, 14.5],
  });
  // A band must rise across zooms the map has.
  assert.deepEqual(read({buildings: [16, 15], models: [14, 14.5]}), {models: [14, 14.5]});
  assert.equal(read({buildings: [15, 30]}), undefined);
  assert.equal(read([15, 16]), undefined);
});

test('show, hide and grow are immediate unless animation is requested', async () => {
  const buildings = createTileflowBuildings3D({map: fakeMap()});
  try {
    const shown = buildings.show();
    assert.equal(buildings.scale, 1);
    await shown;
    const hidden = buildings.hide();
    assert.equal(buildings.scale, 0);
    await hidden;
    await buildings.grow(0.4);
    assert.equal(buildings.scale, 0.4);
    const animated = buildings.show({transition: {duration: 40}});
    assert.equal(buildings.scale, 0.4);
    await animated;
    assert.equal(buildings.scale, 1);
    await buildings.hide();
    const faded = buildings.show({transition: {duration: 40, mode: 'fade'}});
    assert.equal(buildings.scale, 1, 'Fade reveals full-height geometry instead of growing it');
    await faded;
    await buildings.hide();
    assert.equal(buildings.scale, 0);
  } finally {
    buildings.dispose();
  }
});

test('building style light preserves authored intensity, colour and anchoring', () => {
  const light = {anchor: 'map', position: [1, 0, 90], color: '#804020', intensity: 0.08};
  const fixed = tileflowBuildingStyleLight(light, 90);
  assert.equal(fixed.intensity, 0.08);
  assert.deepEqual(fixed.colour, [128 / 255, 64 / 255, 32 / 255]);
  assert.ok(Math.abs(fixed.position[0]!) < 1e-10);
  assert.ok(Math.abs(fixed.position[1]! - 1) < 1e-10);
  const rotating = tileflowBuildingStyleLight({...light, anchor: 'viewport'}, 90);
  assert.ok(Math.abs(rotating.position[0]! + 1) < 1e-10);
  assert.ok(Math.abs(rotating.position[1]!) < 1e-10);
  const fallback = tileflowBuildingStyleLight(undefined, 0);
  assert.equal(fallback.intensity, 0.5);
  assert.deepEqual(fallback.colour, [1, 1, 1]);
});
