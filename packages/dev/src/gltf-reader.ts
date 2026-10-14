// Reads the triangles of a glTF 2.0 binary (.glb) for Tileflow's tree models: the default scene's
// meshes with their node transforms, each vertex's position, normal and colour, and each
// primitive's material. Tileflow reads glTF itself, with no dependency: a tree model needs only
// this much of the format. It turns glTF's Y-up into Tileflow's Z-up. Textures, animations, skins
// and morph targets are ignored; compressed geometry and external buffers are refused.

export type TileflowGltfPrimitive = {
  /** The material's name, or undefined when the primitive has none. */
  material: string | undefined;
  /** x, y and z of each vertex, in metres, Z up. */
  positions: number[];
  /** The vertex normals, Z up; undefined when the file gives none. */
  normals: number[] | undefined;
  /** Each vertex's colour (the material's base colour times its vertex colour), linear RGB. */
  colours: number[];
  /** Three vertex indices per triangle. */
  indices: number[];
};

/** Why a file cannot be read, in words an author can act on. */
export class TileflowGltfError extends Error {
  override name = 'TileflowGltfError';
}

type Json = Record<string, unknown>;
type Matrix = number[]; // 4 × 4, column-major, as glTF writes them

const glbMagic = 0x46546c67; // "glTF"
const jsonChunk = 0x4e4f534a; // "JSON"
const binChunk = 0x004e4942; // "BIN\0"
const triangles = 4;
const compressions = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'KHR_mesh_quantization',
]);
const componentBytes: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const typeSizes: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};

/** The triangles of a glTF binary's default scene. Throws `TileflowGltfError`. */
export function readTileflowGltfTriangles(bytes: Uint8Array): TileflowGltfPrimitive[] {
  const {json, bin} = chunks(bytes);
  const required = array(json.extensionsRequired).filter((name) => typeof name === 'string');
  const compressed = required.find((name) => compressions.has(name as string));
  if (compressed)
    throw new TileflowGltfError(
      `uses compressed geometry (${String(compressed)}); export it without compression`,
    );
  for (const buffer of array(json.buffers))
    if (record(buffer).uri !== undefined)
      throw new TileflowGltfError('keeps its geometry in another file; export a single .glb');

  const nodes = array(json.nodes).map(record);
  const scenes = array(json.scenes).map(record);
  const scene = scenes[typeof json.scene === 'number' ? json.scene : 0];
  const roots = scene
    ? array(scene.nodes)
    : nodes
        .map((_, index) => index)
        .filter((index) => !nodes.some((node) => array(node.children).includes(index)));
  const out: TileflowGltfPrimitive[] = [];
  const visit = (index: unknown, parent: Matrix, depth: number) => {
    if (typeof index !== 'number' || !nodes[index])
      throw new TileflowGltfError('names a node it does not hold');
    if (depth > 64) throw new TileflowGltfError('nests its nodes more than 64 deep');
    const node = nodes[index]!;
    const world = multiply(parent, local(node));
    if (typeof node.mesh === 'number') out.push(...meshOf(json, bin, node.mesh, world));
    for (const child of array(node.children)) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, identity(), 0);
  if (out.length === 0) throw new TileflowGltfError('holds no triangles in its scene');
  return out;
}

function chunks(bytes: Uint8Array): {json: Json; bin: Uint8Array | undefined} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== glbMagic)
    throw new TileflowGltfError('is not a glTF binary; export the model as .glb');
  if (view.getUint32(4, true) !== 2) throw new TileflowGltfError('is not glTF 2.0');
  if (view.getUint32(8, true) !== bytes.byteLength)
    throw new TileflowGltfError('is cut short or has trailing bytes');
  let at = 12;
  let json: Json | undefined;
  let bin: Uint8Array | undefined;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + length > bytes.byteLength) throw new TileflowGltfError('has a chunk past its end');
    const body = bytes.subarray(start, start + length);
    if (type === jsonChunk && json === undefined) {
      try {
        json = record(JSON.parse(new TextDecoder().decode(body)));
      } catch {
        throw new TileflowGltfError('has an unreadable JSON chunk');
      }
    } else if (type === binChunk && bin === undefined) bin = body;
    at = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new TileflowGltfError('has no JSON chunk');
  return {json, bin};
}

function meshOf(
  json: Json,
  bin: Uint8Array | undefined,
  index: number,
  world: Matrix,
): TileflowGltfPrimitive[] {
  const mesh = record(array(json.meshes)[index]);
  const normalMatrix = inverseTranspose(world);
  return array(mesh.primitives).map((value) => {
    const primitive = record(value);
    if ((primitive.mode ?? triangles) !== triangles)
      throw new TileflowGltfError('draws points or lines; a tree model draws triangles');
    const attributes = record(primitive.attributes);
    if (typeof attributes.POSITION !== 'number')
      throw new TileflowGltfError('has a primitive without positions');
    const raw = accessor(json, bin, attributes.POSITION, 3);
    const count = raw.length / 3;
    const positions: number[] = [];
    for (let vertex = 0; vertex < count; vertex += 1) {
      const [x, y, z] = transform(
        world,
        raw[vertex * 3]!,
        raw[vertex * 3 + 1]!,
        raw[vertex * 3 + 2]!,
        1,
      );
      positions.push(x, -z, y); // Y up → Z up
    }
    let normals: number[] | undefined;
    if (typeof attributes.NORMAL === 'number') {
      const rawNormals = accessor(json, bin, attributes.NORMAL, 3);
      normals = [];
      for (let vertex = 0; vertex < count; vertex += 1) {
        const [x, y, z] = transform(
          normalMatrix,
          rawNormals[vertex * 3]!,
          rawNormals[vertex * 3 + 1]!,
          rawNormals[vertex * 3 + 2]!,
          0,
        );
        const size = Math.hypot(x, y, z) || 1;
        normals.push(x / size, -z / size, y / size);
      }
    }
    const material =
      typeof primitive.material === 'number'
        ? record(array(json.materials)[primitive.material])
        : undefined;
    const base = array(record(material?.pbrMetallicRoughness).baseColorFactor).map(Number);
    const factor = base.length >= 3 && base.every(Number.isFinite) ? base : [1, 1, 1];
    const colours: number[] = [];
    const vertexColours =
      typeof attributes.COLOR_0 === 'number'
        ? accessorWithSize(json, bin, attributes.COLOR_0)
        : undefined;
    for (let vertex = 0; vertex < count; vertex += 1)
      for (let channel = 0; channel < 3; channel += 1)
        colours.push(
          factor[channel]! *
            (vertexColours ? vertexColours.values[vertex * vertexColours.size + channel]! : 1),
        );
    const indices =
      typeof primitive.indices === 'number'
        ? accessor(json, bin, primitive.indices, 1).map((value) => Math.round(value))
        : Array.from({length: count}, (_, vertex) => vertex);
    if (indices.length % 3 !== 0 || indices.some((vertex) => vertex < 0 || vertex >= count))
      throw new TileflowGltfError('has triangles that name missing vertices');
    // A mirroring transform turns a triangle's winding; turn it back.
    if (determinant(world) < 0)
      for (let at = 0; at + 2 < indices.length; at += 3)
        [indices[at + 1], indices[at + 2]] = [indices[at + 2]!, indices[at + 1]!];
    return {
      material: typeof material?.name === 'string' ? material.name : undefined,
      positions,
      normals,
      colours,
      indices,
    };
  });
}

function accessor(json: Json, bin: Uint8Array | undefined, index: number, size: number): number[] {
  const read = accessorWithSize(json, bin, index);
  if (read.size !== size)
    throw new TileflowGltfError(`has an accessor of ${read.size} components where ${size} belong`);
  return read.values;
}

function accessorWithSize(
  json: Json,
  bin: Uint8Array | undefined,
  index: number,
): {values: number[]; size: number} {
  const accessor = record(array(json.accessors)[index]);
  if (accessor.sparse !== undefined)
    throw new TileflowGltfError('uses sparse accessors; export without them');
  const size = typeSizes[String(accessor.type)];
  const component = Number(accessor.componentType);
  const bytesEach = componentBytes[component];
  const count = Number(accessor.count);
  if (!size || !bytesEach || !Number.isInteger(count) || count < 0 || count > 1_000_000)
    throw new TileflowGltfError('has an accessor Tileflow cannot read');
  if (typeof accessor.bufferView !== 'number')
    return {values: new Array<number>(count * size).fill(0), size};
  const view = record(array(json.bufferViews)[accessor.bufferView]);
  if (!bin || Number(view.buffer ?? 0) !== 0)
    throw new TileflowGltfError('has geometry outside its binary chunk');
  const stride = Number(view.byteStride ?? 0) || size * bytesEach;
  const start = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
  const end = start + (count - 1) * stride + size * bytesEach;
  if (
    count > 0 &&
    (start < 0 ||
      end > Number(view.byteOffset ?? 0) + Number(view.byteLength) ||
      end > bin.byteLength)
  )
    throw new TileflowGltfError('has an accessor past the end of its buffer');
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const normalized = accessor.normalized === true;
  const values: number[] = [];
  for (let item = 0; item < count; item += 1)
    for (let part = 0; part < size; part += 1) {
      const at = start + item * stride + part * bytesEach;
      let value: number;
      switch (component) {
        case 5126:
          value = data.getFloat32(at, true);
          break;
        case 5125:
          value = data.getUint32(at, true);
          break;
        case 5123:
          value = data.getUint16(at, true);
          if (normalized) value /= 65535;
          break;
        case 5122:
          value = data.getInt16(at, true);
          if (normalized) value = Math.max(value / 32767, -1);
          break;
        case 5121:
          value = data.getUint8(at);
          if (normalized) value /= 255;
          break;
        default:
          value = data.getInt8(at);
          if (normalized) value = Math.max(value / 127, -1);
      }
      if (!Number.isFinite(value)) throw new TileflowGltfError('has a value that is not a number');
      values.push(value);
    }
  return {values, size};
}

// --- Transforms ---

function identity(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function local(node: Json): Matrix {
  const matrix = array(node.matrix).map(Number);
  if (matrix.length === 16 && matrix.every(Number.isFinite)) return matrix;
  const [tx, ty, tz] = vector(node.translation, [0, 0, 0]);
  const [qx, qy, qz, qw] = vector(node.rotation, [0, 0, 0, 1]);
  const [sx, sy, sz] = vector(node.scale, [1, 1, 1]);
  const [xx, yy, zz] = [qx * qx, qy * qy, qz * qz];
  const [xy, xz, yz, wx, wy, wz] = [qx * qy, qx * qz, qy * qz, qw * qx, qw * qy, qw * qz];
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1)
      for (let k = 0; k < 4; k += 1) out[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!;
  return out;
}

function transform(
  m: Matrix,
  x: number,
  y: number,
  z: number,
  w: number,
): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
  ];
}

function determinant(m: Matrix): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
    m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
    m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
  );
}

/** The 3 × 3 inverse transpose of a transform, in a 4 × 4 with no translation, for normals. */
function inverseTranspose(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = [
    m[0]!,
    m[1]!,
    m[2]!,
    m[4]!,
    m[5]!,
    m[6]!,
    m[8]!,
    m[9]!,
    m[10]!,
  ];
  const det = determinant(m) || 1;
  // Cofactors of the column-major 3 × 3 [a d g; b e h; c f i], divided by the determinant, are
  // its inverse transpose.
  return [
    (e * i - h * f) / det,
    (g * f - d * i) / det,
    (d * h - g * e) / det,
    0,
    (h * c - b * i) / det,
    (a * i - g * c) / det,
    (g * b - a * h) / det,
    0,
    (b * f - e * c) / det,
    (d * c - a * f) / det,
    (a * e - d * b) / det,
    0,
    0,
    0,
    0,
    1,
  ];
}

// --- JSON helpers ---

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function vector(value: unknown, fallback: number[]): number[] {
  const list = array(value).map(Number);
  return list.length === fallback.length && list.every(Number.isFinite) ? list : fallback;
}
