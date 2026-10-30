import assert from 'node:assert/strict';
import test from 'node:test';
import {
  placeTileflowTrees,
  readTileflowVegetation3D,
  tileflowTreeBytes,
  tileflowTreeFormMixProblem,
  tileflowTreeFormOf,
  tileflowTreeForms,
  tileflowVegetationMetadataKey,
} from '../src/trees-3d';
import {createTileflowTrees3D, tileflowTrees3DLayerId} from '../src/trees-3d-browser';
import {
  tileflowHedgeMesh,
  tileflowTreeMeshes,
  tileflowTreeModelMeshOf,
  tileflowTreeVertexBytes,
} from '../src/trees-3d-mesh';
import {
  decodeTileflowTreeModel,
  encodeTileflowTreeModel,
  type TileflowTreeModelMesh,
} from '../src/trees-3d-model';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

// A z15 tile over Miami Beach, 4096 metres wide so a unit of 4096 is a metre.
const tile = {x: 9101, y: 13952, z: 15};
const options = {tile, tileMetres: 4096};

function layer(
  features: {geometry: number[][]; properties?: Record<string, string | number | boolean>}[],
): TileflowTileLayer {
  return {
    extent: 4096,
    features: features.map((feature) => ({
      type: 'Point' as const,
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    })),
  };
}

function treesOf(placement: ReturnType<typeof placeTileflowTrees>) {
  const trees = [];
  for (let at = 0; at < placement.trees.length; at += tileflowTreeBytes) {
    const view = new DataView(placement.trees.buffer, placement.trees.byteOffset + at);
    trees.push({
      // In metres, from the renderer's 8192 units.
      x: view.getUint16(0, true) / 2,
      y: view.getUint16(2, true) / 2,
      height: view.getUint16(4, true) / 10,
      crown: view.getUint16(6, true) / 10,
      form: tileflowTreeForms[view.getUint8(10)],
      rank: view.getUint8(11),
      canopy: view.getUint8(13) === 1,
    });
  }
  return trees;
}

test('a tree takes its form from its leaf type, genus or species', () => {
  assert.equal(tileflowTreeFormOf({leaf_type: 'palm'}), 'palm');
  assert.equal(tileflowTreeFormOf({species: 'Washingtonia robusta'}), 'palm');
  assert.equal(tileflowTreeFormOf({genus: 'Roystonea'}), 'palm');
  assert.equal(tileflowTreeFormOf({genus: 'Cupressus'}), 'columnar');
  assert.equal(tileflowTreeFormOf({leaf_type: 'needleleaved'}), 'conifer');
  assert.equal(tileflowTreeFormOf({genus: 'Pinus', leaf_type: 'needleleaved'}), 'conifer');
  assert.equal(tileflowTreeFormOf({genus: 'Platanus'}), 'tall');
  assert.equal(tileflowTreeFormOf({species: 'Quercus virginiana'}), 'open');
  assert.equal(tileflowTreeFormOf({genus: 'Tilia'}), 'round');
  assert.equal(tileflowTreeFormOf({leaf_type: 'broadleaved'}), 'broadleaf');
  assert.equal(tileflowTreeFormOf({}), undefined);
  assert.equal(tileflowTreeFormOf({hoja: 'palm'}, {leafType: 'hoja'}), 'palm');
});

test('mapped trees keep their measured size, bounded, and the buffer belongs to the neighbour', () => {
  const placement = placeTileflowTrees(
    {
      trees: layer([
        {geometry: [[100, 100]], properties: {height: 22, diameter_crown: 14, genus: 'Platanus'}},
        {geometry: [[200, 100]], properties: {height: 90}},
        {geometry: [[300, 100]], properties: {diameter_crown: 6, leaf_type: 'needleleaved'}},
        {
          geometry: [
            [-10, 100],
            [4100, 100],
            [400, 100],
          ],
        },
      ]),
    },
    options,
  );
  const trees = treesOf(placement);
  assert.equal(placement.mapped, 4);
  assert.equal(trees.length, 4);
  const platanus = trees.find((tree) => tree.x === 100)!;
  assert.deepEqual([platanus.height, platanus.crown, platanus.form], [22, 14, 'tall']);
  assert.equal(trees.find((tree) => tree.x === 200)!.height, 45);
  const conifer = trees.find((tree) => tree.x === 300)!;
  assert.equal(conifer.form, 'conifer');
  assert.equal(conifer.crown, 6);
  assert.ok(conifer.height > 6, 'a conifer stands taller than it is wide');
  assert.equal(placement.tallest, 45);
});

test('trees are ordered by form, then rank, with counts by rank for thinning', () => {
  const placement = placeTileflowTrees(
    {
      trees: layer(
        Array.from({length: 200}, (_, index) => ({
          geometry: [[10 + index * 19, 50 + (index % 7) * 300]],
        })),
      ),
    },
    options,
  );
  const trees = treesOf(placement);
  for (let index = 1; index < trees.length; index += 1) {
    const [a, b] = [trees[index - 1]!, trees[index]!];
    const order = tileflowTreeForms.indexOf(a.form!) - tileflowTreeForms.indexOf(b.form!);
    assert.ok(order < 0 || (order === 0 && a.rank <= b.rank));
  }
  for (const form of tileflowTreeForms) {
    const range = placement.forms[form];
    assert.equal(range.upTo[15], range.count);
    for (let rank = 0; rank < 16; rank += 1)
      assert.equal(
        range.upTo[rank],
        trees.slice(range.start, range.start + range.count).filter((tree) => tree.rank <= rank)
          .length,
      );
  }
  // Without data, unknown trees take the three broadleaf forms.
  assert.deepEqual(
    tileflowTreeForms.filter((form) => placement.forms[form].count > 0),
    ['round', 'open', 'tall'],
  );
});

test('a tree keeps its look wherever it is read', () => {
  const trees = layer([
    {geometry: [[1000, 2000]]},
    {geometry: [[1500, 2500]], properties: {genus: 'Acer'}},
  ]);
  const a = placeTileflowTrees({trees}, options);
  const b = placeTileflowTrees({trees}, options);
  assert.deepEqual(a.trees, b.trees);
});

test('a region gives its own forms only to trees whose data gives none', () => {
  // The whole tile lies in South Florida.
  const regions = [{bounds: [-81, 24.4, -79.8, 26.9] as const, unknownForms: {palm: 1}}];
  const placement = placeTileflowTrees(
    {
      trees: layer([
        {geometry: [[100, 100]]},
        {geometry: [[200, 200]], properties: {leaf_type: 'broadleaved'}},
        {geometry: [[300, 300]], properties: {genus: 'Pinus'}},
      ]),
    },
    {...options, regions},
  );
  const byX = new Map(treesOf(placement).map((tree) => [tree.x, tree.form]));
  assert.equal(byX.get(100), 'palm', 'the tree without data takes the region’s palms');
  assert.ok(
    ['round', 'open', 'tall'].includes(byX.get(200)!),
    'a broadleaved tree stays broadleaf',
  );
  assert.equal(byX.get(300), 'conifer');
  // Outside the region, the same tree takes the map's mix.
  const elsewhere = placeTileflowTrees(
    {trees: layer([{geometry: [[100, 100]]}])},
    {...options, regions: [{bounds: [-3.9, 40.3, -3.5, 40.6], unknownForms: {palm: 1}}]},
  );
  assert.notEqual(treesOf(elsewhere)[0]!.form, 'palm');
});

test('a canopy point stands one to three trees by its cover, inside its room', () => {
  const placement = placeTileflowTrees(
    {
      canopy: layer([
        {geometry: [[1000, 1000]], properties: {rank: 3, clearance_px_z15: 12, cover_pct: 3}},
        {geometry: [[2000, 1000]], properties: {rank: 5, clearance_px_z15: 12, cover_pct: 30}},
        {geometry: [[3000, 1000]], properties: {rank: 9, clearance_px_z15: 12, cover_pct: 60}},
      ]),
    },
    options,
  );
  const trees = treesOf(placement);
  assert.equal(placement.canopy, 6);
  assert.ok(trees.every((tree) => tree.canopy));
  // 12 z15 pixels of a 4096 m tile are 96 m of room.
  for (const [x, count, rank] of [
    [1000, 1, 3],
    [2000, 2, 5],
    [3000, 3, 9],
  ] as const) {
    const near = trees.filter((tree) => Math.abs(tree.x - x) < 100);
    assert.equal(near.length, count);
    assert.ok(near.every((tree) => tree.rank === rank));
    assert.ok(near.every((tree) => Math.hypot(tree.x - x, tree.y - 1000) + tree.crown / 2 <= 96));
  }
});

test('a mix of forms names known forms with weights of zero or more', () => {
  assert.equal(tileflowTreeFormMixProblem({palm: 3, round: 1}), undefined);
  assert.match(tileflowTreeFormMixProblem({oak: 1})!, /"oak" is not a tree form/u);
  assert.match(tileflowTreeFormMixProblem({palm: -1})!, /0 or more/u);
  assert.match(tileflowTreeFormMixProblem({palm: 0})!, /above 0/u);
  assert.match(tileflowTreeFormMixProblem([])!, /object of weights/u);
});

test('tree meshes stay within their triangle budgets and their unit tree', () => {
  const meshes = tileflowTreeMeshes();
  for (const form of tileflowTreeForms) {
    // Palms carry two tiers of folded fronds: their presence is in their crown.
    for (const [level, budget] of [
      ['near', form === 'palm' ? 320 : 160],
      ['far', 40],
    ] as const) {
      const mesh = meshes[form][level];
      const triangles = mesh.count / 3;
      assert.ok(triangles > 0 && triangles <= budget, `${form} ${level}: ${triangles} triangles`);
      const view = new DataView(mesh.vertices.buffer);
      for (let index = 0; index < mesh.count; index += 1) {
        const at = index * tileflowTreeVertexBytes;
        const [x, y, z] = [0, 4, 8].map((offset) => view.getFloat32(at + offset, true));
        assert.ok(
          Math.abs(x!) <= 0.62 && Math.abs(y!) <= 0.62,
          `${form} ${level} stays in its crown`,
        );
        assert.ok(z! >= 0 && z! <= 1.08, `${form} ${level} stands from 0 to 1`);
        const normal = [12, 13, 14].map((offset) => view.getInt8(at + offset) / 127);
        assert.ok(Math.abs(Math.hypot(...normal) - 1) < 0.05, `${form} ${level} has unit normals`);
      }
    }
  }
  // Leaves face out: a lobe's normals point away from the trunk on average.
  const round = meshes.round.near;
  const view = new DataView(round.vertices.buffer);
  let up = 0;
  for (let index = 0; index < round.count; index += 1) {
    const at = index * tileflowTreeVertexBytes;
    if (round.vertices[at + 15] === 1 && view.getFloat32(at + 8, true) > 0.8)
      up += view.getInt8(at + 14);
  }
  assert.ok(up > 0, 'the top of a crown faces up');
});

test('a row of trees in the tree layer stands a tree every few metres along its line', () => {
  // World's `tree` holds trees as points and rows of trees as lines.
  const trees: TileflowTileLayer = {
    extent: 4096,
    features: [
      {
        type: 'LineString',
        properties: {genus: 'Platanus', height: 18, subclass: 'tree_row'},
        // 100 m east, then 40 m south, then out of the tile.
        geometry: [[1000, 1000, 1100, 1000, 1100, 1040, 1100, 5000]],
      },
      {
        type: 'Point',
        properties: {leaf_type: 'needleleaved', height: 9, subclass: 'tree'},
        geometry: [[3000, 3000]],
      },
    ],
  };
  const placement = placeTileflowTrees({trees}, {...options, rowSpacing: 10});
  const placed = treesOf(placement);
  const row = placed.filter((tree) => tree.form === 'tall');
  // Trees at 5, 15, … m along: 10 on the first leg, 4 on the second, then on to the tile's edge.
  assert.ok(row.every((tree) => tree.height === 18));
  assert.equal(row.filter((tree) => tree.y === 1000).length, 10);
  assert.ok(
    row.every((tree) => tree.y < 4096),
    'nothing stands outside the tile',
  );
  // The point stands once, not as a row.
  assert.deepEqual(
    placed.filter((tree) => tree.form === 'conifer').map(({x, y}) => [x, y]),
    [[3000, 3000]],
  );
  assert.equal(placement.mapped, placed.length);
});

function hedgesOf(placement: ReturnType<typeof placeTileflowTrees>) {
  const pieces = [];
  for (let at = 0; at < placement.hedges.length; at += tileflowTreeBytes) {
    const view = new DataView(placement.hedges.buffer, placement.hedges.byteOffset + at);
    pieces.push({
      x: view.getUint16(0, true) / 2,
      y: view.getUint16(2, true) / 2,
      height: view.getUint16(4, true) / 10,
      length: view.getUint16(6, true) / 10,
      // In degrees, anticlockwise from east.
      turn: Math.round((view.getUint8(8) / 256) * 360),
    });
  }
  return pieces;
}

test('hedges stand as pieces along their lines and round their areas, a metre higher on a bank', () => {
  const hedges: TileflowTileLayer = {
    extent: 4096,
    features: [
      {
        type: 'LineString',
        properties: {class: 'barrier', subclass: 'hedge'},
        // 12 m east, then on out of the tile.
        geometry: [
          [1000, 1000, 1012, 1000],
          [4090, 2000, 4200, 2000],
        ],
      },
      {
        type: 'LineString',
        properties: {class: 'barrier', subclass: 'hedge', height: 2, hedge: 'hedge_bank'},
        // 6 m north.
        geometry: [[2000, 2006, 2000, 2000]],
      },
      {
        type: 'Polygon',
        properties: {class: 'barrier', subclass: 'hedge', height: 0.8},
        // A closed square of 6 m sides.
        geometry: [[3000, 3000, 3006, 3000, 3006, 3006, 3000, 3006, 3000, 3000]],
      },
      {
        type: 'LineString',
        properties: {class: 'barrier', subclass: 'fence'},
        geometry: [[500, 500, 600, 500]],
      },
    ],
  };
  const placement = placeTileflowTrees({hedges}, options);
  const pieces = hedgesOf(placement);
  assert.equal(treesOf(placement).length, 0, 'a hedge is no tree');
  // A piece every 1.2 m from 0.6 m in, each 1.5 m long so they overlap; nothing in the buffer.
  // Positions keep to the renderer's grid, half a metre in this 4096 m tile.
  const plain = pieces.filter((piece) => piece.y === 1000);
  const expected = [0.6, 1.8, 3, 4.2, 5.4, 6.6, 7.8, 9, 10.2, 11.4];
  assert.equal(plain.length, expected.length);
  plain.forEach((piece, index) => assert.ok(Math.abs(piece.x - 1000 - expected[index]!) <= 0.25));
  assert.ok(
    plain.every((piece) => piece.height === 1.3 && piece.length === 1.5 && piece.turn === 0),
  );
  // The line leaving the tile stands pieces up to its edge and none beyond.
  const edge = pieces.filter((piece) => piece.y === 2000);
  assert.equal(edge.length, 5);
  assert.ok(
    pieces.every((piece) => piece.x < 4096),
    'nothing stands outside the tile',
  );
  // Northward, on a bank: its height and a metre more.
  const bank = pieces.filter((piece) => piece.x === 2000);
  assert.equal(bank.length, 5);
  assert.ok(bank.every((piece) => piece.height === 3 && piece.turn === 90));
  // Round the 24 m of the square's sides, turning at each corner; the fence stands nothing.
  const area = pieces.filter((piece) => piece.height === 0.8);
  assert.equal(area.length, 20);
  assert.deepEqual(
    [...new Set(area.map((piece) => piece.turn))].sort((a, b) => a - b),
    [0, 90, 180, 270],
  );
  assert.equal(pieces.length, plain.length + edge.length + bank.length + area.length);
  assert.equal(placement.tallest, 3);
});

test('a hedge piece is a clipped unit hedge with its top facing up', () => {
  const mesh = tileflowHedgeMesh();
  assert.ok(mesh.count / 3 > 0 && mesh.count / 3 <= 24, `${mesh.count / 3} triangles`);
  const view = new DataView(mesh.vertices.buffer);
  let up = 0;
  for (let index = 0; index < mesh.count; index += 1) {
    const at = index * tileflowTreeVertexBytes;
    const [x, y, z] = [0, 4, 8].map((offset) => view.getFloat32(at + offset, true));
    assert.ok(Math.abs(x!) <= 0.5 && Math.abs(y!) <= 0.28 && z! >= 0 && z! <= 1);
    assert.equal(mesh.vertices[at + 15], 1, 'a hedge is all leaves');
    const normal = [12, 13, 14].map((offset) => view.getInt8(at + offset) / 127);
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < 0.05, 'unit normals');
    if (z === 1) up += normal[2]!;
  }
  assert.ok(up > 0, 'the top of a hedge faces up');
});

test('a taxon gives a form, and a canopy point’s measured height sizes its trees', () => {
  assert.equal(tileflowTreeFormOf({taxon: 'Arecaceae'}), 'palm');
  assert.equal(tileflowTreeFormOf({taxon: 'Platanus × hispanica'}), 'tall');
  assert.equal(tileflowTreeFormOf({taxon: 'Pinaceae'}), 'conifer');
  const placement = placeTileflowTrees(
    {
      canopy: layer([
        {geometry: [[1000, 1000]], properties: {clearance_px_z15: 12, cover_pct: 60, height_m: 20}},
      ]),
    },
    options,
  );
  for (const tree of treesOf(placement)) assert.ok(tree.height >= 17 && tree.height <= 22);
});

test('the 3D tree description is read only in a known version and shape', () => {
  const described = {
    version: 1,
    source: 'tileflow',
    layers: {tree: 'tree', canopy: 'canopy'},
    fields: {leafType: 'hoja'},
    colors: {bark: '#554433', broadleaf: ['#335533', '#447744'], conifer: ['#224422']},
    heightScale: 1.2,
    crownScale: 0,
    unknownForms: {oak: 1},
    regions: [
      {bounds: [-81, 24.4, -79.8, 26.9], unknownForms: {palm: 1}},
      {bounds: [0, 50, 1, 40], unknownForms: {palm: 1}},
    ],
  };
  const read = readTileflowVegetation3D({[tileflowVegetationMetadataKey]: described})!;
  assert.equal(read.fields.leafType, 'hoja');
  assert.equal(read.fields.genus, 'genus');
  // Palms take the broadleaf colours when a style gives none of their own, and hedges the two
  // darkest; a description without a hedge layer stands no hedges.
  assert.deepEqual(read.colors.palm, ['#335533', '#447744']);
  assert.deepEqual(read.colors.hedge, ['#335533', '#447744']);
  assert.equal(read.layers.hedge, undefined);
  assert.equal(
    readTileflowVegetation3D({
      [tileflowVegetationMetadataKey]: {...described, layers: {tree: 'tree', hedge: 'barriers'}},
    })!.layers.hedge,
    'barriers',
  );
  assert.equal(read.heightScale, 1.2);
  assert.equal(read.crownScale, 1);
  assert.equal(read.minimumHeight, 0);
  assert.equal(read.materialVariation, 0);
  // An unknown form falls back to the default mix, and a region with south above north is dropped.
  assert.deepEqual(read.unknownForms, {round: 1, open: 1, tall: 1});
  // Without a finish, edges or form scales, trees are faceted, unoutlined and as the map scales them.
  assert.equal(read.finish, 'faceted');
  assert.equal(read.edges, 0);
  assert.deepEqual(read.forms, {});
  const styled = readTileflowVegetation3D({
    [tileflowVegetationMetadataKey]: {
      ...described,
      finish: 'toon',
      minimumHeight: 6,
      materialVariation: 0.7,
      edges: 0.8,
      edgeColor: '#102010',
      forms: {palm: {heightScale: 1.3}, oak: {heightScale: 2}},
    },
  })!;
  assert.equal(styled.finish, 'toon');
  assert.equal(styled.minimumHeight, 6);
  assert.equal(styled.materialVariation, 0.7);
  for (const [minimumHeight, materialVariation, expected] of [
    [-2, -1, [0, 0]],
    [100, 10, [20, 1]],
    [NaN, Infinity, [0, 0]],
  ] as const) {
    const bounded = readTileflowVegetation3D({
      [tileflowVegetationMetadataKey]: {...described, minimumHeight, materialVariation},
    })!;
    assert.deepEqual([bounded.minimumHeight, bounded.materialVariation], expected);
  }
  assert.equal(styled.edges, 0.8);
  assert.equal(styled.edgeColor, '#102010');
  assert.deepEqual(styled.forms, {palm: {heightScale: 1.3, crownScale: 1}});
  assert.equal(read.regions.length, 1);
  assert.equal(
    readTileflowVegetation3D({[tileflowVegetationMetadataKey]: {...described, version: 2}}),
    undefined,
  );
  assert.equal(readTileflowVegetation3D({}), undefined);
});

test('the trees put their layer on the map, report an undeclared style and leave cleanly', () => {
  const layers = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    addLayer(added: {id: string}) {
      layers.add(added.id);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle: () => ({layers: [{id: 'labels', type: 'symbol'}], metadata: {}}),
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
  const trees = createTileflowTrees3D({map});
  assert.ok(layers.has(tileflowTrees3DLayerId));
  assert.equal(trees.stats.declared, false);
  assert.equal(trees.stats.trees, 0);
  trees.dispose();
  assert.equal(layers.has(tileflowTrees3DLayerId), false);
  for (const set of listeners.values()) assert.equal(set.size, 0);
  assert.throws(() => createTileflowTrees3D({map, minzoom: 30}), RangeError);
  assert.throws(() => createTileflowTrees3D({map, maxTiles: 0}), RangeError);
});

test('the 3D trees stand in for the style flat trees while they are shown', async () => {
  const visibility = new Map<string, unknown>([
    ['tileflow-vegetation-trees', undefined],
    ['tileflow-vegetation-trees::shade', 'visible'],
    ['labels', 'visible'],
  ]);
  const map = {
    addLayer() {},
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getLayer: (id: string) => (visibility.has(id) ? {} : undefined),
    getLayoutProperty: (id: string) => visibility.get(id),
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle: () => ({
      layers: [...visibility.keys()].map((id) => ({id})),
      metadata: {
        [tileflowVegetationMetadataKey]: {
          version: 1,
          source: 'tileflow',
          layers: {tree: 'tree'},
          fields: {},
          colors: {bark: '#554433', broadleaf: ['#335533'], conifer: ['#224422']},
          flatLayers: ['tileflow-vegetation-trees'],
        },
      },
    }),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off() {},
    on() {},
    removeLayer() {},
    setLayoutProperty(id: string, _name: string, value: unknown) {
      visibility.set(id, value);
    },
    triggerRepaint() {},
  };
  const trees = createTileflowTrees3D({map});
  assert.equal(trees.stats.declared, true);
  // The flat trees and their render passes give way; other layers stay.
  await trees.show({transition: {duration: 0}});
  assert.equal(visibility.get('tileflow-vegetation-trees'), 'none');
  assert.equal(visibility.get('tileflow-vegetation-trees::shade'), 'none');
  assert.equal(visibility.get('labels'), 'visible');
  // They come back as they were once the trees sink, and again when the layer leaves.
  await trees.hide({transition: {duration: 0}});
  assert.equal(visibility.get('tileflow-vegetation-trees'), 'visible');
  assert.equal(visibility.get('tileflow-vegetation-trees::shade'), 'visible');
  await trees.show({transition: {duration: 0}});
  trees.dispose();
  assert.equal(visibility.get('tileflow-vegetation-trees'), 'visible');
});

// A unit tree of two triangles: a bark stem and a leaf facing the sky.
const model: TileflowTreeModelMesh = {
  proportion: 0.4,
  positions: [0, 0, 0, 0.02, 0, 0.5, -0.02, 0, 0.5, -0.5, -0.5, 0.8, 0.5, -0.5, 0.8, 0, 0.5, 1],
  normals: [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  parts: [0, 0, 0, 1, 1, 1],
  shades: [0, 0, 0, -1, 0.5, 1],
  occlusion: [0.8, 0.8, 0.8, 0.4, 0.7, 1],
  // The leaf is wound to face down; its normals say up.
  indices: [0, 1, 2, 3, 5, 4],
};

test('a tree model encodes compactly and decodes as it was, within its limits', () => {
  const text = encodeTileflowTreeModel(model, 'near');
  // 12 bytes a vertex and 2 an index, after a 16-byte header, in base64.
  assert.equal(text.length, Math.ceil((16 + 6 * 12 + 6 * 2) / 3) * 4);
  const decoded = decodeTileflowTreeModel(text, 'near')!;
  assert.equal(decoded.proportion, 0.4);
  assert.deepEqual(decoded.parts, model.parts);
  assert.deepEqual(decoded.indices, model.indices);
  decoded.positions.forEach((value, index) =>
    assert.ok(Math.abs(value - model.positions[index]!) < 1e-4),
  );
  decoded.shades.forEach((value, index) =>
    assert.ok(Math.abs(value - model.shades[index]!) < 0.01),
  );
  assert.equal(decodeTileflowTreeModel('not a model', 'near'), undefined);
  assert.equal(decodeTileflowTreeModel(text.slice(0, -4), 'near'), undefined);
  assert.equal(decodeTileflowTreeModel(42, 'near'), undefined);
  const many = {
    ...model,
    indices: Array.from({length: 121 * 3}, (_, index) => index % 6),
  };
  assert.throws(() => encodeTileflowTreeModel(many, 'far'), /1 to 120 triangles/);
  assert.equal(decodeTileflowTreeModel(encodeTileflowTreeModel(many, 'near'), 'far'), undefined);
  assert.throws(
    () => encodeTileflowTreeModel({...model, parts: [0, 0, 0, 1, 1, 9]}, 'near'),
    /no tree part/,
  );
});

test('a model draws as Core’s trees do, each triangle facing the way its normals point', () => {
  const mesh = tileflowTreeModelMeshOf(model);
  assert.equal(mesh.count, 6);
  const view = new DataView(mesh.vertices.buffer);
  const at = (vertex: number, offset: number) => vertex * tileflowTreeVertexBytes + offset;
  // The leaf's facet normal points up, as its normals do, so it was turned round.
  assert.ok(view.getInt8(at(3, 14)) > 100);
  assert.equal(mesh.vertices[at(3, 15)], 1);
  // The model's own normal is kept as the round shape.
  assert.ok(view.getInt8(at(3, 20)) > 100);
});

test('a form drawing several models gives each tree one, in ranges thinned by rank', () => {
  const trees = layer(
    Array.from({length: 300}, (_, index) => ({
      geometry: [[100 + (index % 20) * 150, 100 + Math.floor(index / 20) * 200]],
      properties: {leaf_type: 'palm'},
    })),
  );
  const single = placeTileflowTrees({trees}, options);
  assert.equal(single.forms.palm.variants.length, 1);
  assert.deepEqual(single.forms.palm.variants[0], {
    start: single.forms.palm.start,
    count: single.forms.palm.count,
    upTo: single.forms.palm.upTo,
  });
  const placement = placeTileflowTrees({trees}, {...options, variants: {palm: 3}});
  const palm = placement.forms.palm;
  assert.equal(palm.variants.length, 3);
  assert.equal(
    palm.variants.reduce((sum, range) => sum + range.count, 0),
    palm.count,
  );
  for (const [index, range] of palm.variants.entries()) {
    assert.ok(range.count > 50, 'each model draws a share of the palms');
    assert.equal(range.upTo[15], range.count);
    for (let tree = range.start; tree < range.start + range.count; tree += 1)
      assert.equal(placement.trees[tree * tileflowTreeBytes + 14], index);
    if (index > 0)
      assert.equal(range.start, palm.variants[index - 1]!.start + palm.variants[index - 1]!.count);
  }
  // A tree keeps its model wherever it is read.
  const again = placeTileflowTrees({trees}, {...options, variants: {palm: 3}});
  assert.deepEqual(again.trees, placement.trees);
});

test('the description reads the models a map draws and drops references to missing ones', () => {
  const near = encodeTileflowTreeModel(model, 'near');
  const read = readTileflowVegetation3D({
    [tileflowVegetationMetadataKey]: {
      version: 1,
      source: 'tileflow',
      layers: {tree: 'tree'},
      fields: {},
      colors: {bark: '#554433', broadleaf: ['#335533'], conifer: ['#224422']},
      forms: {palm: {models: ['royal-palm', 'missing', 'royal-palm']}, open: {models: ['missing']}},
      models: {'royal-palm': {near}, 'Bad Id': {near}, broken: {far: near}},
    },
  })!;
  assert.deepEqual(Object.keys(read.models), ['royal-palm']);
  assert.deepEqual(read.forms.palm?.models, ['royal-palm']);
  assert.equal(read.forms.open?.models, undefined);
});

test('trees skip hidden GPU work, reuse projection programs and release every cached program', async (t) => {
  const created = new Set<object>(),
    deleted = new Set<object>();
  let buffers = 0;
  let failProgram = Infinity;
  class TestWebGL2 {
    LINK_STATUS = 1;
    ACTIVE_UNIFORMS = 2;
    createProgram() {
      const value = {};
      created.add(value);
      return value;
    }
    deleteProgram(value: object) {
      assert.ok(!deleted.has(value));
      deleted.add(value);
    }
    getProgramParameter(_program: unknown, key: number) {
      return key === this.LINK_STATUS ? created.size !== failProgram : 0;
    }
    createBuffer() {
      buffers++;
      return {};
    }
    createShader() {
      return {};
    }
    createVertexArray() {
      return {};
    }
  }
  const old = Object.getOwnPropertyDescriptor(globalThis, 'WebGL2RenderingContext');
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', {
    configurable: true,
    value: TestWebGL2,
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'WebGL2RenderingContext', old);
    else Reflect.deleteProperty(globalThis, 'WebGL2RenderingContext');
  });
  const context = new Proxy(new TestWebGL2(), {
    get(target, key, receiver) {
      if (key in target) return Reflect.get(target, key, receiver);
      return typeof key === 'string' && key === key.toUpperCase() ? 3 : () => {};
    },
  });
  let layer: any;
  let zoom = 10;
  let styleReads = 0;
  const map = {
    addLayer(value: any) {
      layer = value;
      value.onAdd(map, context);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 40, lng: -3}),
    getPitch: () => 0,
    getLayer: () => layer,
    getSource: () => undefined,
    getStyle() {
      styleReads++;
      return {layers: [], metadata: {}};
    },
    getZoom: () => zoom,
    isStyleLoaded: () => true,
    on() {},
    off() {},
    triggerRepaint() {},
    removeLayer() {
      layer.onRemove(map, context);
      layer = undefined;
    },
  };
  const trees = createTileflowTrees3D({map});
  const render = (name: string) =>
    layer.render(context, {shaderData: {variantName: name, vertexShaderPrelude: name, define: ''}});
  render('globe');
  assert.equal(created.size, 0);
  assert.equal(buffers, 0);
  await trees.show({transition: {duration: 0}});
  render('globe');
  assert.equal(created.size, 0, 'shown trees below minzoom still do not compile');
  zoom = 16;
  render('mercator');
  assert.equal(created.size, 3, 'trees, ground and depth; unused outlines are not compiled');
  const firstReads = styleReads;
  for (let i = 0; i < 20; i++) render('mercator');
  assert.equal(styleReads, firstReads, 'standalone metadata is reused between style events');
  render('globe');
  assert.equal(created.size, 5, 'depth is shared across projections');
  render('mercator');
  assert.equal(created.size, 5, 'returning to a projection reuses its programs');
  for (let i = 0; i < 6; i++) render(`variant-${i}`);
  assert.ok(deleted.size > 0, 'unusual variants cannot grow the cache without bound');
  failProgram = created.size + 2;
  const resident = created.size - deleted.size;
  render('unsupported-projection');
  assert.equal(created.size - deleted.size, resident, 'partial link failure releases new programs');
  failProgram = Infinity;
  render('mercator');
  trees.dispose();
  assert.deepEqual(deleted, created);
});

test('idle only retries tree attachment and does not schedule another frame', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(0)));
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Set<string>();
  let repaints = 0;
  const map = {
    addLayer: (layer: {id: string}) => layers.add(layer.id),
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getPitch: () => 60,
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getSource: () => ({tiles: ['https://idle-trees.invalid/{z}/{x}/{y}.pbf'], maxzoom: 15}),
    getStyle: () => ({layers: [], metadata: {}}),
    getZoom: () => 18,
    isStyleLoaded: () => true,
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    removeLayer: (id: string) => layers.delete(id),
    triggerRepaint() {
      repaints++;
    },
  };
  const trees = createTileflowTrees3D({map});
  try {
    await trees.show();
    await new Promise((resolve) => setTimeout(resolve, 100));
    repaints = 0;
    for (let n = 0; n < 20; n++) for (const listener of listeners.get('idle') ?? []) listener();
    assert.equal(repaints, 0);
    layers.delete(tileflowTrees3DLayerId);
    for (const listener of listeners.get('idle') ?? []) listener();
    assert.ok(layers.has(tileflowTrees3DLayerId));
  } finally {
    trees.dispose();
  }
  for (const set of listeners.values()) assert.equal(set.size, 0);
});

test('trees mount below ground names and solid buildings regardless of camera ordering', () => {
  const ground = {
    id: 'roads',
    type: 'symbol',
    metadata: {'tileflow:road-label-placement': {version: 1, mode: 'ground'}},
  };
  const solid = {id: 'buildings', type: 'fill-extrusion'};
  for (const [scene, expected] of [
    [[ground, solid], 'roads'],
    [[solid, ground], 'buildings'],
    [[ground], 'roads'],
    [[{id: 'roads', type: 'symbol'}, solid], 'above-buildings'],
  ] as const) {
    let before: string | undefined;
    const layers = new Set<string>();
    const map = {
      addLayer(layer: {id: string}, beforeId?: string) {
        layers.add(layer.id);
        before = beforeId;
      },
      getBearing: () => 0,
      getCenter: () => ({lat: 0, lng: 0}),
      getLayer: (id: string) => (layers.has(id) || id === 'above-buildings' ? {} : undefined),
      getPitch: () => 55,
      getSource: () => undefined,
      getStyle: () => ({
        layers: [...scene],
        metadata: {
          'tileflow:overlay-placement-manifest': {anchors: {'above-buildings': 'above-buildings'}},
        },
      }),
      getZoom: () => 16,
      isStyleLoaded: () => true,
      off() {},
      on() {},
      triggerRepaint() {},
      removeLayer(id: string) {
        layers.delete(id);
      },
    };
    const trees = createTileflowTrees3D({map});
    assert.equal(before, expected);
    trees.dispose();
    layers.add('tileflow-street-lights');
    const litTrees = createTileflowTrees3D({map});
    assert.equal(
      before,
      expected === 'above-buildings' ? 'tileflow-street-lights' : expected,
      'street lights do not make foliage cover ground names',
    );
    litTrees.dispose();
    const explicit = createTileflowTrees3D({map, beforeId: 'above-buildings'});
    assert.equal(before, 'above-buildings', 'explicit application placement takes precedence');
    explicit.dispose();
  }
});
