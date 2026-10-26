import {MeshoptEncoder} from 'meshoptimizer/encoder';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTileflowModels,
  encodeTileflowModels,
  type TileflowModelEntry,
} from '../src/models-3d-file';
import type {TileflowModelMesh} from '../src/models-3d-model';

const pixel = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function mesh(): TileflowModelMesh {
  return {
    positions: [0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    normals: Array.from({length: 6}, () => [0, 0, 1]).flat(),
    parts: [0, 0, 0, 0, 0, 0],
    lightingRoles: [1, 1, 1, 1, 1, 1],
    shades: [0, 0, 0, 0, 0, 0],
    occlusion: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
    indices: [0, 1, 2, 3, 4, 5],
    surface: {
      // UV0, UV1, and linear vertex RGBA. Coincident triangles have different UV seams.
      attributes: [
        0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0.25, 0, 0, 0, 1, 1,
        1, 1, 0.75, 0, 1, 0, 1, 1, 1, 1, 0.25, 1, 0, 1, 1, 1, 1, 1,
      ],
      materials: [
        {
          baseColorFactor: [0.8, 0.7, 0.6, 0.9],
          metallicFactor: 0.6,
          roughnessFactor: 0.25,
          emissiveFactor: [0.2, 0.1, 0],
          emissiveStrength: 2,
          alphaMode: 'MASK',
          alphaCutoff: 0.4,
          doubleSided: true,
          baseColorTexture: {
            texture: 0,
            texCoord: 1,
            offset: [0.2, 0.3],
            scale: [2, 3],
            rotation: 0.4,
          },
          occlusionTexture: {texture: 0, strength: 0.7},
        },
      ],
      textures: [
        {
          mimeType: 'image/png',
          bytes: pixel,
          width: 1,
          height: 1,
          wrapS: 33071,
          wrapT: 10497,
          minFilter: 9987,
          magFilter: 9729,
        },
      ],
      ranges: [{from: 0, count: 6, material: 0}],
      emitters: [
        {start: [0, 0, 0], end: [2, 0, 0], height: 3, depth: 0.2, role: 'door', part: 'accent'},
      ],
    },
  };
}

const model = (level = mesh()): TileflowModelEntry => ({
  id: 'material-fixture',
  levels: [level],
  footprint: [[0, 0, 2, 0, 2, 2, 0, 2]],
});

test('physical material data survives prepared model compression independently of palette and AO', async () => {
  await MeshoptEncoder.ready;
  for (const compressor of [undefined, MeshoptEncoder]) {
    const bytes = encodeTileflowModels([model()], compressor);
    const decoded = (await decodeTileflowModels(bytes))![0]!.levels[0]!;
    assert.ok(decoded.surface, 'physical data must survive transport');
    assert.deepEqual(decoded.surface.materials, mesh().surface!.materials);
    assert.deepEqual(decoded.surface.textures, mesh().surface!.textures);
    assert.deepEqual(decoded.surface.emitters, mesh().surface!.emitters);
    assert.deepEqual(decoded.surface.ranges, [{from: 0, count: 6, material: 0}]);
    assert.equal(decoded.surface.uv.length, (decoded.vertices.length / 16) * 4);
    assert.deepEqual([...decoded.surface.rgba], [1, 1, 1, 1]);
    for (let at = 0; at < decoded.vertices.length; at += 16) {
      assert.equal(decoded.vertices[at + 12], 0);
      assert.equal(decoded.vertices[at + 14], 102);
      assert.equal(decoded.vertices[at + 15], 1);
    }
  }
});

test('physical UV seams survive welding and triangle reordering', async () => {
  await MeshoptEncoder.ready;
  const decoded = (await decodeTileflowModels(encodeTileflowModels([model()], MeshoptEncoder)))![0]!
    .levels[0]!;
  assert.equal(
    decoded.vertices.length / 16,
    6,
    'coincident vertices with different UVs must stay separate',
  );
  const uv = [...decoded.indices].map((index) => decoded.surface!.uv[index * 4]);
  assert.deepEqual([...uv].sort(), [0, 0, 0.25, 0.25, 0.75, 1].sort());
});

test('surface attributes every vertex shares decode to one value, the others to one a vertex', async () => {
  await MeshoptEncoder.ready;
  const base = mesh();
  const vertices = base.positions.length / 3;
  // As a library model's file holds them: no texture coordinates, and white or tinted vertices.
  const tinted = Array.from({length: vertices}, (_, vertex) => [0, 0, 0, 0, 1, 0.5, vertex / 8, 1]);
  const white = Array.from({length: vertices}, () => [0, 0, 0, 0, 1, 1, 1, 1]);
  for (const compressor of [undefined, MeshoptEncoder]) {
    for (const [attributes, rgbaShared] of [
      [white, true],
      [tinted, false],
    ] as const) {
      const surface = {...base.surface!, attributes: attributes.flat(), textures: []};
      const materials = surface.materials.map(
        ({baseColorTexture, occlusionTexture, ...rest}) => rest,
      );
      const bytes = encodeTileflowModels(
        [model({...base, surface: {...surface, materials}})],
        compressor,
      );
      const decoded = (await decodeTileflowModels(bytes))![0]!.levels[0]!;
      const count = decoded.vertices.length / 16;
      assert.deepEqual([...decoded.surface!.uv], [0, 0, 0, 0]);
      if (rgbaShared) assert.deepEqual([...decoded.surface!.rgba], [1, 1, 1, 1]);
      else {
        assert.equal(decoded.surface!.rgba.length, count * 4);
        const blue = [...decoded.indices].map((index) => decoded.surface!.rgba[index * 4 + 2]);
        assert.deepEqual(
          blue,
          [0, 1, 2, 3, 4, 5].map((vertex) => Math.fround(vertex / 8)),
        );
      }
    }
  }
});

test('material references, image budgets and draw ranges fail before encoding invalid models', () => {
  const base = mesh();
  const surface = base.surface!;
  for (const broken of [
    {...surface, attributes: [0, 0]},
    {...surface, ranges: [{from: 0, count: 3, material: 9}]},
    {...surface, ranges: [{from: 0, count: 3, material: 0}]},
    {...surface, materials: [{baseColorTexture: {texture: 9}}]},
    {...surface, textures: [{...surface.textures[0]!, width: 100_000}]},
    {...surface, emitters: [{...surface.emitters![0]!, height: -1}]},
  ]) {
    assert.throws(() => encodeTileflowModels([model({...base, surface: broken})]), RangeError);
  }
});

test('an occlusion-only texture uploads one channel; a texture shared with colour keeps four', async () => {
  const {uploadModelSurface} = await import('../src/models-3d-materials-browser');
  const uploads: {texture: unknown; internal: unknown; format: unknown}[] = [];
  let bound: unknown;
  let created = 0;
  // A WebGL context that records texture uploads; constants are their own names.
  const gl = new Proxy(
    {
      createBuffer: () => ({}),
      createTexture: () => ({id: created++}),
      bindTexture: (_: unknown, texture: unknown) => (bound = texture),
      getParameter: () => false,
      texImage2D: (...args: unknown[]) =>
        uploads.push({texture: bound, internal: args[2], format: args[3]}),
    } as Record<string, unknown>,
    {
      get: (target, name) =>
        name in target
          ? target[name as string]
          : typeof name === 'string' && /^[A-Z0-9_]+$/.test(name)
            ? name
            : () => {},
    },
  ) as unknown as WebGL2RenderingContext;
  const texture = {mimeType: 'image/png' as const, bytes: pixel, width: 1, height: 1};
  uploadModelSurface(
    gl,
    {
      vertices: new Uint8Array(48),
      indices: new Uint16Array([0, 1, 2]),
      centre: [0, 0, 0],
      step: 1,
      surface: {
        uv: new Float32Array(4),
        rgba: Float32Array.of(1, 1, 1, 1),
        materials: [
          {occlusionTexture: {texture: 0, texCoord: 1}},
          {baseColorTexture: {texture: 1}, occlusionTexture: {texture: 1}},
        ],
        textures: [texture, texture],
        ranges: [{from: 0, count: 3, material: 0}],
      },
    },
    [{} as ImageBitmap, {} as ImageBitmap],
  );
  assert.deepEqual(
    uploads.map(({internal, format}) => [internal, format]),
    [
      ['R8', 'RED'],
      ['RGBA8', 'RGBA'],
    ],
  );
});

test('UV1 travels as sixteen-bit coordinates inside the unit square', async () => {
  await MeshoptEncoder.ready;
  const base = mesh();
  const source = base.surface!.attributes.map((value, i) =>
    i % 8 === 2 ? (i / 8) * 0.137 : i % 8 === 3 ? 1 - (i / 8) * 0.071 : value,
  );
  const lightmapped: TileflowModelMesh = {...base, surface: {...base.surface!, attributes: source}};
  for (const compressor of [undefined, MeshoptEncoder]) {
    const decoded = (await decodeTileflowModels(
      encodeTileflowModels([model(lightmapped)], compressor),
    ))![0]!.levels[0]!;
    const {uv} = decoded.surface!;
    // Each decoded vertex matches a source vertex: UV0 exactly, UV1 within a sixteen-bit step.
    for (let vertex = 0; vertex < uv.length / 4; vertex++) {
      const got = uv.slice(vertex * 4, vertex * 4 + 4);
      assert.ok(
        Array.from({length: source.length / 8}, (_, s) => s).some((s) =>
          got.every((value, k) =>
            k >= 2
              ? Math.abs(value - source[s * 8 + k]!) <= 0.5 / 65_535 + 1e-7
              : value === Math.fround(source[s * 8 + k]!),
          ),
        ),
        `vertex ${vertex}`,
      );
    }
  }
  const outside = {
    ...base,
    surface: {...base.surface!, attributes: source.map((v, i) => (i === 2 ? 1.5 : v))},
  };
  assert.throws(() => encodeTileflowModels([model(outside)]), RangeError);
});

test('compression reorders triangles only within their material ranges', async () => {
  await MeshoptEncoder.ready;
  // A 6 × 6 grid of quads, split between two materials; each vertex carries its own UV1.
  const side = 7;
  const positions: number[] = [];
  const attributes: number[] = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      positions.push(x, y, 0);
      attributes.push(0, 0, x / side, y / side, 1, 1, 1, 1);
    }
  const indices: number[] = [];
  for (let y = 0; y < side - 1; y++)
    for (let x = 0; x < side - 1; x++) {
      const at = y * side + x;
      indices.push(at, at + 1, at + side, at + 1, at + side + 1, at + side);
    }
  const half = (indices.length / 6) * 3;
  const base = mesh();
  const count = positions.length / 3;
  const grid: TileflowModelMesh = {
    positions,
    normals: Array.from({length: count}, () => [0, 0, 1]).flat(),
    parts: new Array(count).fill(0),
    lightingRoles: new Array(count).fill(1),
    shades: new Array(count).fill(0),
    occlusion: new Array(count).fill(1),
    indices,
    surface: {
      ...base.surface!,
      attributes,
      materials: [{}, {}],
      ranges: [
        {from: 0, count: half, material: 0},
        {from: half, count: indices.length - half, material: 1},
      ],
      emitters: undefined,
    },
  };
  // A triangle as its corners' UV1, in a canonical order.
  const key = (uv: ArrayLike<number>, corners: number[]) =>
    corners
      .map(
        (vertex) =>
          `${Math.round(uv[vertex * 4 + 2]! * 1000)},${Math.round(uv[vertex * 4 + 3]! * 1000)}`,
      )
      .sort()
      .join(';');
  const source = new Float32Array(count * 4);
  for (let vertex = 0; vertex < count; vertex++)
    source.set(attributes.slice(vertex * 8, vertex * 8 + 4), vertex * 4);
  const triangles = (
    uv: ArrayLike<number>,
    list: ArrayLike<number>,
    from: number,
    length: number,
  ) =>
    Array.from({length: length / 3}, (_, t) =>
      key(uv, [list[from + t * 3]!, list[from + t * 3 + 1]!, list[from + t * 3 + 2]!]),
    ).sort();
  const decoded = (await decodeTileflowModels(
    encodeTileflowModels([model(grid)], MeshoptEncoder),
  ))![0]!.levels[0]!;
  assert.deepEqual(
    decoded.surface!.ranges.map(({from, count}) => [from, count]),
    [
      [0, half],
      [half, indices.length - half],
    ],
  );
  for (const {from, count: length} of grid.surface!.ranges)
    assert.deepEqual(
      triangles(decoded.surface!.uv, decoded.indices, from, length),
      triangles(source, indices, from, length),
    );
});
