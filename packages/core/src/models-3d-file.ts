// Tileflow's prepared model files: glTF binaries (.glb) that hold one or more building models, each
// with one to three levels of detail, its footprint and, in a landmark tile, where it stands. Their
// meshes are quantised (KHR_mesh_quantization) and compressed by meshoptimizer
// (EXT_meshopt_compression), as other web maps' landmark models are, and any glTF viewer opens them.
// Each model is a root node whose `extras.tileflow` names it and carries its footprint; its children
// are its levels, `near`, `mid` and `far`, each one mesh of one indexed triangle primitive whose node
// translation and uniform scale turn its whole-step positions into metres. A vertex is 16 bytes in
// glTF's axes (x east, y up, z south): position, normal, and part, shade and light (`_PAINT`). Node
// tooling encodes files with meshoptimizer's encoder; Core decodes them for its 3D buildings
// renderer. It has no DOM dependency, and loads meshoptimizer's decoder only to read a compressed
// file.
import {
  type TileflowModel,
  type TileflowModelBytes,
  type TileflowModelLevelBytes,
  tileflowModelLimits,
  tileflowModelParts,
  tileflowModelVertexBytes,
} from './models-3d-model';

/** A model as a file holds it: its id and, in a landmark tile, where it stands. */
export type TileflowModelEntry = TileflowModel &
  Readonly<{
    id: string;
    /** Longitude and latitude of its origin. */
    at?: readonly [number, number];
    /** Degrees clockwise from north its own north is turned to. */
    heading?: number;
  }>;

/** What compresses a file's buffers: meshoptimizer's encoder, once ready. */
export type TileflowModelCompressor = Readonly<{
  reorderMesh(indices: Uint32Array, triangles: boolean, optsize: boolean): [Uint32Array, number];
  encodeGltfBuffer(source: Uint8Array, count: number, size: number, mode: string): Uint8Array;
}>;

/** What decompresses them: meshoptimizer's decoder, once ready. */
export type TileflowModelDecompressor = Readonly<{
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): void;
}>;

/** The media type of a prepared model file. */
export const tileflowModelContentType = 'model/gltf-binary';

const levelNames = ['near', 'mid', 'far'] as const;
const meshopt = 'EXT_meshopt_compression';
const quantisation = 'KHR_mesh_quantization';
const steps = 32767;
const partCount = Object.keys(tileflowModelParts).length;
const modelId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const [glbMagic, jsonChunk, binChunk] = [0x46546c67, 0x4e4f534a, 0x004e4942];
const [short, byte, unsignedByte, unsignedShort, unsignedInt] = [5122, 5120, 5121, 5123, 5125];

/**
 * Encodes models as a prepared model file: compressed when given meshoptimizer's encoder, else with
 * plain buffers of the same layout. Throws a `RangeError` when a model breaks `tileflowModelLimits`.
 */
export function encodeTileflowModels(
  models: readonly TileflowModelEntry[],
  compressor?: TileflowModelCompressor,
): Uint8Array {
  if (models.length < 1 || models.length > tileflowModelLimits.models)
    throw new RangeError(`A model file holds 1 to ${tileflowModelLimits.models} models.`);
  if (new Set(models.map((model) => model.id)).size !== models.length)
    throw new RangeError('The models of a file have different ids.');
  const extensions = compressor ? [meshopt, quantisation] : [quantisation];
  const nodes: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const roots: number[] = [];
  const blobs: Uint8Array[] = [];
  let binLength = 0;
  let fallbackLength = 0;
  const addBlob = (bytes: Uint8Array) => {
    const padding = (4 - (binLength % 4)) % 4;
    if (padding) blobs.push(new Uint8Array(padding));
    const offset = binLength + padding;
    blobs.push(bytes);
    binLength = offset + bytes.byteLength;
    return offset;
  };
  const addView = (bytes: Uint8Array, count: number, stride: number, vertices: boolean) => {
    const target = vertices ? 34962 : 34963;
    if (!compressor) {
      const byteOffset = addBlob(bytes);
      bufferViews.push({
        buffer: 0,
        byteOffset,
        byteLength: bytes.byteLength,
        ...(vertices ? {byteStride: stride} : {}),
        target,
      });
      return bufferViews.length - 1;
    }
    const mode = vertices ? 'ATTRIBUTES' : 'TRIANGLES';
    const packed = compressor.encodeGltfBuffer(bytes, count, stride, mode);
    const byteOffset = addBlob(packed);
    const fallbackOffset = fallbackLength;
    fallbackLength += bytes.byteLength + ((4 - (bytes.byteLength % 4)) % 4);
    bufferViews.push({
      buffer: 1,
      byteOffset: fallbackOffset,
      byteLength: bytes.byteLength,
      ...(vertices ? {byteStride: stride} : {}),
      target,
      extensions: {
        [meshopt]: {
          buffer: 0,
          byteOffset,
          byteLength: packed.byteLength,
          byteStride: stride,
          count,
          mode,
        },
      },
    });
    return bufferViews.length - 1;
  };

  for (const model of models) {
    checkModel(model);
    const children: number[] = [];
    for (const [index, mesh] of model.levels.entries()) {
      const level = quantise(mesh, compressor);
      const vertexView = addView(level.vertices, level.count, tileflowModelVertexBytes, true);
      const width = level.indices instanceof Uint32Array ? 4 : 2;
      const indexView = addView(
        new Uint8Array(level.indices.buffer, level.indices.byteOffset, level.indices.byteLength),
        level.indices.length,
        width,
        false,
      );
      const first = accessors.length;
      accessors.push(
        {
          bufferView: vertexView,
          byteOffset: 0,
          componentType: short,
          count: level.count,
          type: 'VEC3',
          min: level.min,
          max: level.max,
        },
        {
          bufferView: vertexView,
          byteOffset: 8,
          componentType: byte,
          normalized: true,
          count: level.count,
          type: 'VEC3',
        },
        {
          bufferView: vertexView,
          byteOffset: 12,
          componentType: unsignedByte,
          count: level.count,
          type: 'VEC3',
        },
        {
          bufferView: indexView,
          componentType: width === 4 ? unsignedInt : unsignedShort,
          count: level.indices.length,
          type: 'SCALAR',
        },
      );
      meshes.push({
        primitives: [
          {
            attributes: {POSITION: first, NORMAL: first + 1, _PAINT: first + 2},
            indices: first + 3,
            mode: 4,
          },
        ],
      });
      children.push(nodes.length);
      nodes.push({
        name: levelNames[index],
        mesh: meshes.length - 1,
        translation: [...level.centre],
        scale: [level.step, level.step, level.step],
      });
    }
    roots.push(nodes.length);
    nodes.push({
      name: model.id,
      children,
      extras: {
        tileflow: {
          model: model.id,
          footprint: model.footprint.map((ring) => ring.map((value) => round(value, 100))),
          ...(model.at ? {at: [model.at[0], model.at[1]]} : {}),
          ...(model.heading !== undefined ? {heading: model.heading} : {}),
        },
      },
    });
  }

  const json = {
    asset: {version: '2.0', generator: 'Tileflow'},
    extensionsUsed: extensions,
    extensionsRequired: extensions,
    scene: 0,
    scenes: [{nodes: roots}],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [
      {byteLength: binLength},
      ...(compressor
        ? [{byteLength: fallbackLength, extensions: {[meshopt]: {fallback: true}}}]
        : []),
    ],
  };
  const file = glb(new TextEncoder().encode(JSON.stringify(json)), blobs, binLength);
  if (file.byteLength > tileflowModelLimits.bytes)
    throw new RangeError(`A prepared model file is at most ${tileflowModelLimits.bytes} bytes.`);
  return file;
}

/**
 * Decodes a prepared model file for drawing, or undefined when it is not one or breaks
 * `tileflowModelLimits`. A compressed file loads meshoptimizer's decoder unless one is given.
 */
export async function decodeTileflowModels(
  buffer: ArrayBuffer | Uint8Array,
  decompressor?: TileflowModelDecompressor,
): Promise<readonly TileflowModelBytes[] | undefined> {
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const {json, bin} = readGlb(bytes);
    const required: unknown[] = Array.isArray(json.extensionsRequired)
      ? json.extensionsRequired
      : [];
    if (
      json.asset?.version !== '2.0' ||
      required.some((name) => name !== meshopt && name !== quantisation)
    )
      return undefined;
    const views: any[] = json.bufferViews ?? [];
    const compressed = views.some((view) => view?.extensions?.[meshopt]);
    const decoder = compressed ? (decompressor ?? (await meshoptDecoder())) : undefined;
    const decoded = new Map<number, Uint8Array>();
    const viewBytes = (index: unknown, stride: number, length: number): Uint8Array => {
      const view = views[index as number];
      if (!Number.isInteger(index) || !view || view.byteLength !== length) throw new Error();
      if ((view.byteStride ?? stride) !== stride) throw new Error();
      const cached = decoded.get(index as number);
      if (cached) return cached;
      const packed = view.extensions?.[meshopt];
      let out: Uint8Array;
      if (packed) {
        const {
          buffer: source,
          byteOffset = 0,
          byteLength,
          byteStride,
          count,
          mode,
          filter,
        } = packed;
        if (source !== 0 || byteStride !== stride || count * byteStride !== length)
          throw new Error();
        if (filter !== undefined && filter !== 'NONE') throw new Error();
        if (mode !== (stride === tileflowModelVertexBytes ? 'ATTRIBUTES' : 'TRIANGLES'))
          throw new Error();
        out = new Uint8Array(length);
        decoder!.decodeGltfBuffer(out, count, byteStride, slice(bin, byteOffset, byteLength), mode);
      } else {
        if (view.buffer !== 0) throw new Error();
        out = slice(bin, view.byteOffset ?? 0, length).slice();
      }
      decoded.set(index as number, out);
      return out;
    };
    const roots: unknown[] = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    if (roots.length < 1 || roots.length > tileflowModelLimits.models) return undefined;
    const models: TileflowModelBytes[] = [];
    for (const root of roots) {
      const node = json.nodes?.[root as number];
      const model = readModelNode(node);
      const children: unknown[] = Array.isArray(node.children) ? node.children : [];
      if (children.length < 1 || children.length > tileflowModelLimits.levels) return undefined;
      const levels: TileflowModelLevelBytes[] = [];
      const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const [at, child] of children.entries()) {
        const level = readLevelNode(
          json,
          json.nodes?.[child as number],
          levelNames[at]!,
          viewBytes,
        );
        // Bounds in glTF's axes (x east, y up, z south), then east, north and up.
        const low = level.min.map((value, axis) => level.centre[axis]! + value * level.step);
        const high = level.max.map((value, axis) => level.centre[axis]! + value * level.step);
        const box = [low[0]!, -high[2]!, low[1]!, high[0]!, -low[2]!, high[1]!];
        for (let axis = 0; axis < 3; axis += 1) {
          bounds[axis] = Math.min(bounds[axis]!, box[axis]!);
          bounds[axis + 3] = Math.max(bounds[axis + 3]!, box[axis + 3]!);
        }
        levels.push({
          vertices: level.vertices,
          indices: level.indices,
          centre: level.centre,
          step: level.step,
        });
      }
      models.push({
        ...model,
        bounds: bounds as unknown as TileflowModelBytes['bounds'],
        levels,
      });
    }
    return models;
  } catch {
    return undefined;
  }
}

/**
 * The ids of the models a prepared model file holds, in the order of its scene, read from its glTF
 * header and JSON chunk without decoding a mesh; undefined when it is not a prepared model file. A
 * server checks an uploaded file with it without running meshoptimizer's decoder.
 */
export function readTileflowModelFileIds(
  buffer: ArrayBuffer | Uint8Array,
): readonly string[] | undefined {
  try {
    const {json} = readGlb(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const required: unknown[] = Array.isArray(json.extensionsRequired)
      ? json.extensionsRequired
      : [];
    if (
      json.asset?.version !== '2.0' ||
      !required.includes(quantisation) ||
      required.some((name) => name !== meshopt && name !== quantisation)
    )
      return undefined;
    const roots: unknown[] = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    if (roots.length < 1 || roots.length > tileflowModelLimits.models) return undefined;
    const ids: string[] = [];
    for (const root of roots) {
      const node = json.nodes?.[root as number];
      const children: unknown[] = Array.isArray(node?.children) ? node.children : [];
      if (children.length < 1 || children.length > tileflowModelLimits.levels) return undefined;
      ids.push(readModelNode(node).id);
    }
    return new Set(ids).size === ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}

/** A prepared model file's name: its id and the start of its SHA-256, so a change is a new name. */
export function tileflowModelFileName(id: string, sha256: string): string {
  return `${id}-${sha256.slice(0, 16)}.glb`;
}

/** What a file holding one model is, in metres, read without decompressing its meshes. */
export type TileflowModelFileSummary = Readonly<{
  /** The model's id, as maps name it. */
  model: string;
  /** Its levels of detail, nearest first. */
  levels: readonly Readonly<{
    level: (typeof levelNames)[number];
    vertices: number;
    triangles: number;
  }>[];
  /** The nearest level's extent along east, north and up, from the ground. */
  width: number;
  depth: number;
  height: number;
  /** The base the model stands in for: its rings, their points and their area in square metres. */
  footprint: Readonly<{rings: number; points: number; area: number}>;
}>;

/**
 * Summarises a prepared file of one model from its glTF JSON alone: its id, the vertices and
 * triangles of each level, its size and its footprint. It decompresses nothing, so it suits a
 * server that checks an upload; `undefined` means the file is not a Tileflow model file of exactly
 * one model.
 */
export function readTileflowModelFileSummary(
  buffer: ArrayBuffer | Uint8Array,
): TileflowModelFileSummary | undefined {
  try {
    const ids = readTileflowModelFileIds(buffer);
    if (ids?.length !== 1) return undefined;
    const {json} = readGlb(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const node = json.nodes[json.scenes[json.scene ?? 0].nodes[0]];
    const {id, footprint} = readModelNode(node);
    const levels = (node.children as unknown[]).map((child, at) => {
      const level = json.nodes?.[child as number];
      const name = levelNames[at]!;
      if (level?.name !== name) throw new Error();
      const primitive = json.meshes?.[level.mesh]?.primitives?.[0];
      const position = json.accessors?.[primitive?.attributes?.POSITION];
      const index = json.accessors?.[primitive?.indices];
      const vertices = position?.count;
      const indices = index?.count;
      const centre = level.translation;
      const step = level.scale?.[0];
      if (
        !Number.isInteger(vertices) ||
        vertices < 3 ||
        vertices > tileflowModelLimits.vertices ||
        !Number.isInteger(indices) ||
        indices < 3 ||
        indices % 3 !== 0 ||
        indices / 3 > tileflowModelLimits.triangles ||
        !Array.isArray(centre) ||
        centre.length !== 3 ||
        !centre.every(Number.isFinite) ||
        !(step > 0) ||
        ![position.min, position.max].every(
          (list) => Array.isArray(list) && list.length === 3 && list.every(Number.isFinite),
        )
      )
        throw new Error();
      // In glTF's axes: x east, y up, z south.
      const low = (axis: number) => centre[axis] + position.min[axis] * step;
      const high = (axis: number) => centre[axis] + position.max[axis] * step;
      return {
        level: name,
        vertices: vertices as number,
        triangles: (indices as number) / 3,
        extent: [high(0) - low(0), high(2) - low(2), high(1)] as const,
      };
    });
    const [width, depth, height] = levels[0]!.extent;
    let area = 0;
    for (const ring of footprint) {
      let twice = 0;
      for (let at = 0; at < ring.length; at += 2) {
        const next = (at + 2) % ring.length;
        twice += ring[at]! * ring[next + 1]! - ring[next]! * ring[at + 1]!;
      }
      area += twice / 2;
    }
    return {
      model: id,
      levels: levels.map(({level, vertices, triangles}) => ({level, vertices, triangles})),
      width: round(width, 100),
      depth: round(depth, 100),
      height: round(height, 100),
      footprint: {
        rings: footprint.length,
        points: footprint.reduce((sum, ring) => sum + ring.length / 2, 0),
        area: round(Math.abs(area), 10),
      },
    };
  } catch {
    return undefined;
  }
}

let decoderLoad: Promise<TileflowModelDecompressor> | undefined;

/** meshoptimizer's decoder, loaded once, the first time a compressed file is read. */
function meshoptDecoder(): Promise<TileflowModelDecompressor> {
  decoderLoad ??= import('meshoptimizer/decoder').then(
    async ({MeshoptDecoder}) => {
      await MeshoptDecoder.ready;
      return MeshoptDecoder;
    },
    (error: unknown) => {
      decoderLoad = undefined;
      throw error;
    },
  );
  return decoderLoad;
}

/** A level as whole steps in glTF's axes, welded, and reordered for the GPU when compressed. */
function quantise(mesh: TileflowModel['levels'][number], compressor?: TileflowModelCompressor) {
  const count = mesh.positions.length / 3;
  const axes = (index: number): [number, number, number] => [
    mesh.positions[index * 3]!,
    mesh.positions[index * 3 + 2]!,
    -mesh.positions[index * 3 + 1]!,
  ];
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const point = axes(vertex);
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis]!, point[axis]!);
      high[axis] = Math.max(high[axis]!, point[axis]!);
    }
  }
  const centre = low.map((value, axis) => round((value + high[axis]!) / 2, 1000)) as [
    number,
    number,
    number,
  ];
  // One step for every axis keeps the scale uniform, so normals need no correction.
  const reach = Math.max(
    ...low.map((value, axis) => Math.max(centre[axis]! - value, high[axis]! - centre[axis]!)),
  );
  const step = Math.max(reach, 1e-3) / steps;
  const raw = new Uint8Array(count * tileflowModelVertexBytes);
  const view = new DataView(raw.buffer);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const at = vertex * tileflowModelVertexBytes;
    const point = axes(vertex);
    for (let axis = 0; axis < 3; axis += 1)
      view.setInt16(
        at + axis * 2,
        clamp(Math.round((point[axis]! - centre[axis]!) / step), -steps, steps),
        true,
      );
    const [nx, ny, nz] = [
      mesh.normals[vertex * 3]!,
      mesh.normals[vertex * 3 + 1]!,
      mesh.normals[vertex * 3 + 2]!,
    ];
    const length = Math.hypot(nx, ny, nz) || 1;
    const normal = [nx / length, nz / length, -ny / length];
    for (let axis = 0; axis < 3; axis += 1)
      view.setInt8(at + 8 + axis, clamp(Math.round(normal[axis]! * 127), -127, 127));
    const part = mesh.parts[vertex]!;
    if (!Number.isInteger(part) || part < 0 || part >= partCount)
      throw new RangeError(`Vertex ${vertex} has no part.`);
    raw[at + 12] = part;
    raw[at + 13] = Math.round(((clamp(mesh.shades[vertex]!, -1, 1) + 1) / 2) * 255);
    raw[at + 14] = Math.round(clamp(mesh.occlusion[vertex]!, 0, 1) * 255);
  }

  // Vertices alike in every byte become one.
  const words = new Uint32Array(raw.buffer);
  const seen = new Map<string, number>();
  const weld = new Uint32Array(count);
  const kept: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const w = vertex * 4;
    const key = `${words[w]},${words[w + 1]},${words[w + 2]},${words[w + 3]}`;
    let index = seen.get(key);
    if (index === undefined) {
      index = kept.length;
      seen.set(key, index);
      kept.push(vertex);
    }
    weld[vertex] = index;
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (const [position, vertex] of mesh.indices.entries()) {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count)
      throw new RangeError(`Index ${position} names no vertex.`);
    indices[position] = weld[vertex]!;
  }
  let order = kept;
  if (compressor) {
    // In place: the triangles reordered for the vertex cache, and the vertices for fetching.
    const [remap, unique] = compressor.reorderMesh(indices, true, true);
    order = new Array<number>(unique);
    for (const [index, vertex] of kept.entries())
      if (remap[index] !== 0xffffffff) order[remap[index]!] = vertex;
  }
  const vertices = new Uint8Array(order.length * tileflowModelVertexBytes);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [index, vertex] of order.entries()) {
    vertices.set(
      raw.subarray(vertex * tileflowModelVertexBytes, (vertex + 1) * tileflowModelVertexBytes),
      index * tileflowModelVertexBytes,
    );
    for (let axis = 0; axis < 3; axis += 1) {
      const value = view.getInt16(vertex * tileflowModelVertexBytes + axis * 2, true);
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return {
    vertices,
    indices: order.length > 0xffff ? indices : Uint16Array.from(indices),
    count: order.length,
    centre,
    step,
    min,
    max,
  };
}

/** Checks a model against `tileflowModelLimits` before it is encoded. */
function checkModel(model: TileflowModelEntry): void {
  const {id, levels, footprint} = model;
  if (!modelId.test(id) || id.length > 64)
    throw new RangeError(`"${id}" is not a model id: lower-case words joined by hyphens.`);
  if (levels.length < 1 || levels.length > tileflowModelLimits.levels)
    throw new RangeError(`A model has 1 to ${tileflowModelLimits.levels} levels of detail.`);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [at, level] of levels.entries()) {
    const count = level.positions.length / 3;
    const triangles = level.indices.length / 3;
    if (!Number.isInteger(count) || count < 3 || count > tileflowModelLimits.vertices)
      throw new RangeError(`Level ${at} has 3 to ${tileflowModelLimits.vertices} vertices.`);
    if (!Number.isInteger(triangles) || triangles < 1 || triangles > tileflowModelLimits.triangles)
      throw new RangeError(`Level ${at} has 1 to ${tileflowModelLimits.triangles} triangles.`);
    if (level.normals.length !== count * 3)
      throw new RangeError(`Every vertex of level ${at} needs a position and a normal.`);
    for (const list of [level.parts, level.shades, level.occlusion])
      if (list.length !== count)
        throw new RangeError(`Every vertex of level ${at} needs a part, a shade and a light.`);
    for (let index = 0; index < count; index += 1)
      for (let axis = 0; axis < 3; axis += 1) {
        const value = level.positions[index * 3 + axis]!;
        if (!Number.isFinite(value)) throw new RangeError(`Level ${at} has a vertex at no place.`);
        bounds[axis] = Math.min(bounds[axis]!, value);
        bounds[axis + 3] = Math.max(bounds[axis + 3]!, value);
      }
  }
  const radius = Math.max(...[0, 1, 3, 4].map((axis) => Math.abs(bounds[axis]!)));
  if (radius > tileflowModelLimits.radius)
    throw new RangeError(
      `A model reaches at most ${tileflowModelLimits.radius} m from its origin.`,
    );
  if (bounds[2]! < -0.5)
    throw new RangeError('A model stands on the ground: no vertex lies more than 0.5 m below it.');
  if (bounds[5]! > tileflowModelLimits.height)
    throw new RangeError(`A model is at most ${tileflowModelLimits.height} m tall.`);
  if (footprint.some((ring) => ring.length < 6 || ring.length % 2 !== 0))
    throw new RangeError('A footprint ring has at least three points.');
  if (footprint.some((ring) => ring.some((value) => !Number.isFinite(value))))
    throw new RangeError('A footprint point has no place.');
  if (
    footprint.reduce((sum, ring) => sum + ring.length / 2, 0) > tileflowModelLimits.footprintPoints
  )
    throw new RangeError(
      `A footprint has at most ${tileflowModelLimits.footprintPoints} points in all.`,
    );
  if (model.at && !placed(model.at))
    throw new RangeError(`Model ${id} stands at no place on the map.`);
  if (model.heading !== undefined && !(model.heading >= 0 && model.heading < 360))
    throw new RangeError(`Model ${id} is turned 0 to 360 degrees.`);
}

/** A model's root node: its id, footprint and placement. */
function readModelNode(node: any): Omit<TileflowModelBytes, 'bounds' | 'levels'> {
  const own = node?.extras?.tileflow;
  if (!own || typeof own.model !== 'string' || !modelId.test(own.model)) throw new Error();
  const footprint: unknown[] = Array.isArray(own.footprint) ? own.footprint : [];
  let points = 0;
  for (const ring of footprint) {
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0) throw new Error();
    if (ring.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error();
    points += ring.length / 2;
  }
  if (points > tileflowModelLimits.footprintPoints) throw new Error();
  if (own.at !== undefined && !placed(own.at)) throw new Error();
  if (
    own.heading !== undefined &&
    !(typeof own.heading === 'number' && own.heading >= 0 && own.heading < 360)
  )
    throw new Error();
  return {
    id: own.model,
    footprint: footprint as number[][],
    ...(own.at ? {at: [own.at[0], own.at[1]] as const} : {}),
    ...(own.heading !== undefined ? {heading: own.heading} : {}),
  };
}

/** One level's node, mesh, accessors and buffers, checked against the file's layout. */
function readLevelNode(
  json: any,
  node: any,
  name: string,
  viewBytes: (index: unknown, stride: number, length: number) => Uint8Array,
) {
  if (node?.name !== name || node.matrix !== undefined || node.rotation !== undefined)
    throw new Error();
  const centre = node.translation;
  const scale = node.scale;
  if (!Array.isArray(centre) || centre.length !== 3 || !centre.every(Number.isFinite))
    throw new Error();
  if (
    !Array.isArray(scale) ||
    scale.length !== 3 ||
    !(scale[0] > 0) ||
    scale.some((value) => value !== scale[0])
  )
    throw new Error();
  const primitives = json.meshes?.[node.mesh]?.primitives;
  if (!Array.isArray(primitives) || primitives.length !== 1) throw new Error();
  const primitive = primitives[0];
  const names = Object.keys(primitive.attributes ?? {}).sort();
  if ((primitive.mode ?? 4) !== 4 || names.join() !== 'NORMAL,POSITION,_PAINT') throw new Error();
  const accessor = (index: unknown) => json.accessors?.[index as number];
  const position = accessor(primitive.attributes.POSITION);
  const normal = accessor(primitive.attributes.NORMAL);
  const paint = accessor(primitive.attributes._PAINT);
  const index = accessor(primitive.indices);
  const count = position?.count;
  if (!Number.isInteger(count) || count < 3 || count > tileflowModelLimits.vertices)
    throw new Error();
  const attribute = (value: any, offset: number, type: number, normalized: boolean) =>
    value?.bufferView === position.bufferView &&
    (value.byteOffset ?? 0) === offset &&
    value.componentType === type &&
    (value.normalized ?? false) === normalized &&
    value.type === 'VEC3' &&
    value.count === count;
  if (
    !attribute(position, 0, short, false) ||
    !attribute(normal, 8, byte, true) ||
    !attribute(paint, 12, unsignedByte, false)
  )
    throw new Error();
  const min = position.min;
  const max = position.max;
  if (
    ![min, max].every(
      (list) => Array.isArray(list) && list.length === 3 && list.every(Number.isFinite),
    )
  )
    throw new Error();
  const width =
    index?.componentType === unsignedInt ? 4 : index?.componentType === unsignedShort ? 2 : 0;
  const indexCount = index?.count;
  if (
    !width ||
    index.type !== 'SCALAR' ||
    (index.byteOffset ?? 0) !== 0 ||
    !Number.isInteger(indexCount) ||
    indexCount < 3 ||
    indexCount % 3 !== 0 ||
    indexCount / 3 > tileflowModelLimits.triangles
  )
    throw new Error();
  const vertices = viewBytes(
    position.bufferView,
    tileflowModelVertexBytes,
    count * tileflowModelVertexBytes,
  );
  for (let vertex = 0; vertex < count; vertex += 1)
    if (vertices[vertex * tileflowModelVertexBytes + 12]! >= partCount) throw new Error();
  const indexBytes = viewBytes(index.bufferView, width, indexCount * width);
  const indices =
    width === 4
      ? new Uint32Array(indexBytes.buffer, indexBytes.byteOffset, indexCount)
      : new Uint16Array(indexBytes.buffer, indexBytes.byteOffset, indexCount);
  for (const vertex of indices) if (vertex >= count) throw new Error();
  return {
    vertices,
    indices,
    centre: [centre[0], centre[1], centre[2]] as const,
    step: scale[0] as number,
    min: min as number[],
    max: max as number[],
  };
}

/** A glTF binary's JSON and binary chunks. */
function readGlb(bytes: Uint8Array): {json: any; bin: Uint8Array} {
  if (bytes.byteLength < 20 || bytes.byteLength > tileflowModelLimits.bytes) throw new Error();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== glbMagic || view.getUint32(4, true) !== 2) throw new Error();
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error();
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== jsonChunk || 20 + jsonLength > bytes.byteLength)
    throw new Error();
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  let bin: Uint8Array = new Uint8Array(0);
  const at = 20 + jsonLength;
  if (at + 8 <= bytes.byteLength) {
    const binLength = view.getUint32(at, true);
    if (view.getUint32(at + 4, true) !== binChunk || at + 8 + binLength > bytes.byteLength)
      throw new Error();
    bin = bytes.subarray(at + 8, at + 8 + binLength);
  }
  if (typeof json !== 'object' || json === null) throw new Error();
  return {json, bin};
}

/** A glTF binary of a JSON chunk and a binary chunk, each padded to four bytes. */
function glb(json: Uint8Array, blobs: readonly Uint8Array[], binLength: number): Uint8Array {
  const jsonLength = json.byteLength + ((4 - (json.byteLength % 4)) % 4);
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const total = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binPadded : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, glbMagic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, jsonChunk, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  if (binLength > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binPadded, true);
    view.setUint32(at + 4, binChunk, true);
    let offset = at + 8;
    for (const blob of blobs) {
      out.set(blob, offset);
      offset += blob.byteLength;
    }
  }
  return out;
}

function slice(bin: Uint8Array, offset: unknown, length: unknown): Uint8Array {
  if (!Number.isInteger(offset) || !Number.isInteger(length)) throw new Error();
  const start = offset as number;
  const end = start + (length as number);
  if (start < 0 || end > bin.byteLength) throw new Error();
  return bin.subarray(start, end);
}

function placed(at: unknown): boolean {
  if (!Array.isArray(at) || at.length !== 2) return false;
  const [longitude, latitude] = at as unknown[];
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -85 &&
    latitude <= 85
  );
}

function round(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
}
