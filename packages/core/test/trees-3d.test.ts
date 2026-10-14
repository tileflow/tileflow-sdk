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
import {tileflowTreeMeshes, tileflowTreeVertexBytes} from '../src/trees-3d-mesh';
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

test('a row of trees stands a tree every few metres along its line, in its data’s form', () => {
  const rows: TileflowTileLayer = {
    extent: 4096,
    features: [
      {
        type: 'LineString',
        properties: {genus: 'Platanus', height: 18},
        // 100 m east, then 40 m south, then out of the tile.
        geometry: [[1000, 1000, 1100, 1000, 1100, 1040, 1100, 5000]],
      },
    ],
  };
  const placement = placeTileflowTrees({rows}, {...options, rowSpacing: 10});
  const trees = treesOf(placement);
  // Trees at 5, 15, … m along: 10 on the first leg, 4 on the second, then on to the tile's edge.
  assert.ok(trees.every((tree) => tree.form === 'tall' && tree.height === 18));
  assert.equal(trees.filter((tree) => tree.y === 1000).length, 10);
  assert.ok(
    trees.every((tree) => tree.y < 4096),
    'nothing stands outside the tile',
  );
  assert.equal(placement.mapped, trees.length);
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
  // Palms take the broadleaf colours when a style gives none of their own.
  assert.deepEqual(read.colors.palm, ['#335533', '#447744']);
  assert.equal(read.heightScale, 1.2);
  assert.equal(read.crownScale, 1);
  // An unknown form falls back to the default mix, and a region with south above north is dropped.
  assert.deepEqual(read.unknownForms, {round: 1, open: 1, tall: 1});
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
