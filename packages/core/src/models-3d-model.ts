// A building model a map places in its 3D city, such as a landmark or an application's own
// building. Tileflow's Node tooling prepares each glTF binary (.glb) a map declares into this
// compact binary file: one to three levels of detail, each an indexed mesh in metres round the
// model's origin (where it stands on the ground; x east, y north and z up before its heading), whose
// vertices carry their part, a shade and their occlusion, and the footprint the model replaces on
// the ground. The file travels beside the compiled style and is downloaded only when the model is
// near the camera. It has no DOM dependency.

/** The parts of a model, each coloured by the theme: the model's materials name them. */
export const tileflowModelParts = Object.freeze({
  surface: 0,
  secondary: 1,
  glass: 2,
  accent: 3,
  roof: 4,
});

export type TileflowModelPart = keyof typeof tileflowModelParts;

/** What a model may hold. */
export const tileflowModelLimits = Object.freeze({
  /** Levels of detail, nearest first. */
  levels: 3,
  /** Vertices of one level. */
  vertices: 200_000,
  /** Triangles of one level. */
  triangles: 200_000,
  /** Points of the footprint's rings, together. */
  footprintPoints: 4096,
  /** Half the model's widest extent, in metres. */
  radius: 2000,
  /** The model's height, in metres. */
  height: 1000,
  /** Bytes of one prepared file. */
  bytes: 16 * 1024 * 1024,
});

/** One level of detail, as indexed triangles. */
export type TileflowModelMesh = Readonly<{
  /** x, y and z of each vertex in metres: x east and y north of the origin, z up from the ground. */
  positions: readonly number[];
  /** The vertex normals, x, y and z. */
  normals: readonly number[];
  /** Each vertex's part, a value of `tileflowModelParts`. */
  parts: readonly number[];
  /** Each vertex's shade within its part's colour, from -1 (darkest) to 1 (lightest). */
  shades: readonly number[];
  /** Each vertex's light, from 0 (fully occluded) to 1. */
  occlusion: readonly number[];
  /** Three vertex indices per triangle. */
  indices: readonly number[];
}>;

/** A prepared model: its levels, nearest first, and the footprint it replaces on the ground. */
export type TileflowModel = Readonly<{
  levels: readonly TileflowModelMesh[];
  /**
   * Closed rings on the ground, in metres round the origin as `[x, y, x, y, …]`: the outline of
   * what the model stands in for. The map's own buildings whose centre falls inside it are not
   * raised while the model stands.
   */
  footprint: readonly (readonly number[])[];
}>;

/** A decoded level, ready for the GPU: its vertex bytes as the file holds them. */
export type TileflowModelLevelBytes = Readonly<{
  /** 12 bytes a vertex: position (int16 ×3, over the model's bounds), normal (int8 ×3), part, shade and light (uint8 ×3). */
  vertices: Uint8Array;
  indices: Uint16Array | Uint32Array;
}>;

/** A decoded model, as the renderer draws it. */
export type TileflowModelBytes = Readonly<{
  /** The model's bounds in metres, `[minX, minY, minZ, maxX, maxY, maxZ]`. */
  bounds: readonly [number, number, number, number, number, number];
  levels: readonly TileflowModelLevelBytes[];
  footprint: readonly (readonly number[])[];
}>;

/** Bytes per vertex in a model file and on the GPU. */
export const tileflowModelVertexBytes = 12;

const magic = [0x54, 0x46, 0x4d, 0x44]; // "TFMD"
const version = 1;
const partCount = Object.keys(tileflowModelParts).length;

/** Encodes a model as a file. Throws a `RangeError` when it breaks `tileflowModelLimits`. */
export function encodeTileflowModel(model: TileflowModel): Uint8Array {
  const {levels, footprint} = model;
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
  const points = footprint.reduce((sum, ring) => sum + ring.length / 2, 0);
  if (footprint.some((ring) => ring.length < 6 || ring.length % 2 !== 0))
    throw new RangeError('A footprint ring has at least three points.');
  if (points > tileflowModelLimits.footprintPoints)
    throw new RangeError(
      `A footprint has at most ${tileflowModelLimits.footprintPoints} points in all.`,
    );

  const levelSizes = levels.map((level) => {
    const count = level.positions.length / 3;
    const wide = count > 0xffff;
    return {
      count,
      wide,
      bytes: 12 + count * tileflowModelVertexBytes + level.indices.length * (wide ? 4 : 2),
    };
  });
  const header = 4 + 2 + 2 + 24 + 4 + footprint.length * 4 + points * 8;
  const size = levelSizes.reduce((sum, level) => sum + level.bytes, header);
  if (size > tileflowModelLimits.bytes)
    throw new RangeError(`A prepared model is at most ${tileflowModelLimits.bytes} bytes.`);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(magic, 0);
  view.setUint16(4, version, true);
  view.setUint16(6, levels.length, true);
  for (let axis = 0; axis < 6; axis += 1) view.setFloat32(8 + axis * 4, bounds[axis]!, true);
  view.setUint32(32, footprint.length, true);
  let at = 36;
  for (const ring of footprint) {
    view.setUint32(at, ring.length / 2, true);
    at += 4;
  }
  for (const ring of footprint)
    for (const value of ring) {
      if (!Number.isFinite(value)) throw new RangeError('A footprint point has no place.');
      view.setFloat32(at, value, true);
      at += 4;
    }
  for (const [index, level] of levels.entries()) {
    const {count, wide} = levelSizes[index]!;
    view.setUint32(at, count, true);
    view.setUint32(at + 4, level.indices.length, true);
    view.setUint32(at + 8, wide ? 4 : 2, true);
    at += 12;
    for (let vertex = 0; vertex < count; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const low = bounds[axis]!;
        const span = bounds[axis + 3]! - low;
        const unit = span > 0 ? (level.positions[vertex * 3 + axis]! - low) / span : 0;
        view.setInt16(at + axis * 2, Math.round(unit * 65535) - 32768, true);
        view.setInt8(
          at + 6 + axis,
          Math.round(clamp(level.normals[vertex * 3 + axis]!, -1, 1) * 127),
        );
      }
      const part = level.parts[vertex]!;
      if (!Number.isInteger(part) || part < 0 || part >= partCount)
        throw new RangeError(`Vertex ${vertex} of level ${index} has no part.`);
      bytes[at + 9] = part;
      bytes[at + 10] = Math.round(((clamp(level.shades[vertex]!, -1, 1) + 1) / 2) * 255);
      bytes[at + 11] = Math.round(clamp(level.occlusion[vertex]!, 0, 1) * 255);
      at += tileflowModelVertexBytes;
    }
    for (const [position, vertex] of level.indices.entries()) {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count)
        throw new RangeError(`Index ${position} of level ${index} names no vertex.`);
      if (wide) view.setUint32(at, vertex, true);
      else view.setUint16(at, vertex, true);
      at += wide ? 4 : 2;
    }
  }
  return bytes;
}

/**
 * Decodes a model file for drawing, or undefined when it is not a model of this version or breaks
 * `tileflowModelLimits`.
 */
export function decodeTileflowModel(
  buffer: ArrayBuffer | Uint8Array,
): TileflowModelBytes | undefined {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 36 || bytes.length > tileflowModelLimits.bytes) return undefined;
  if (magic.some((byte, index) => bytes[index] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== version) return undefined;
  const levelCount = view.getUint16(6, true);
  if (levelCount < 1 || levelCount > tileflowModelLimits.levels) return undefined;
  const bounds = [0, 1, 2, 3, 4, 5].map((axis) => view.getFloat32(8 + axis * 4, true)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (bounds.some((value) => !Number.isFinite(value))) return undefined;
  const ringCount = view.getUint32(32, true);
  let at = 36;
  if (at + ringCount * 4 > bytes.length) return undefined;
  const sizes: number[] = [];
  for (let ring = 0; ring < ringCount; ring += 1) {
    sizes.push(view.getUint32(at, true));
    at += 4;
  }
  if (
    sizes.some((size) => size < 3) ||
    sizes.reduce((sum, size) => sum + size, 0) > tileflowModelLimits.footprintPoints
  )
    return undefined;
  const footprint: number[][] = [];
  for (const size of sizes) {
    if (at + size * 8 > bytes.length) return undefined;
    const ring: number[] = [];
    for (let point = 0; point < size * 2; point += 1) {
      ring.push(view.getFloat32(at, true));
      at += 4;
    }
    footprint.push(ring);
  }
  const levels: TileflowModelLevelBytes[] = [];
  for (let level = 0; level < levelCount; level += 1) {
    if (at + 12 > bytes.length) return undefined;
    const count = view.getUint32(at, true);
    const indexCount = view.getUint32(at + 4, true);
    const width = view.getUint32(at + 8, true);
    at += 12;
    if (
      count < 3 ||
      count > tileflowModelLimits.vertices ||
      indexCount < 3 ||
      indexCount % 3 !== 0 ||
      indexCount / 3 > tileflowModelLimits.triangles ||
      (width !== 2 && width !== 4) ||
      (width === 2) !== count <= 0xffff ||
      at + count * tileflowModelVertexBytes + indexCount * width > bytes.length
    )
      return undefined;
    const vertices = bytes.slice(at, at + count * tileflowModelVertexBytes);
    at += count * tileflowModelVertexBytes;
    for (let vertex = 0; vertex < count; vertex += 1)
      if (vertices[vertex * tileflowModelVertexBytes + 9]! >= partCount) return undefined;
    const indices = width === 4 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    for (let index = 0; index < indexCount; index += 1) {
      const vertex = width === 4 ? view.getUint32(at, true) : view.getUint16(at, true);
      if (vertex >= count) return undefined;
      indices[index] = vertex;
      at += width;
    }
    levels.push({vertices, indices});
  }
  if (at !== bytes.length) return undefined;
  return {bounds, levels, footprint};
}

/**
 * Turns a model's footprint into rings of tile units in the tile at `tile` (`x`, `y` at `zoom`,
 * of `extent` units across), for a model standing at `at` (longitude and latitude) turned
 * `heading` degrees clockwise from north.
 */
export function tileflowModelFootprintInTile(
  footprint: readonly (readonly number[])[],
  placement: Readonly<{at: readonly [number, number]; heading: number}>,
  tile: Readonly<{x: number; y: number; zoom: number}>,
  extent: number,
): number[][] {
  const [x, y] = mercatorTile(placement.at[0], placement.at[1], tile.zoom);
  const metres = tileMetresAt(placement.at[1], tile.zoom) / extent;
  const turn = (placement.heading * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return footprint.map((ring) => {
    const out: number[] = [];
    for (let at = 0; at + 1 < ring.length; at += 2) {
      // Turned clockwise seen from above: north swings towards east.
      const east = ring[at]! * cos + ring[at + 1]! * sin;
      const north = -ring[at]! * sin + ring[at + 1]! * cos;
      out.push((x - tile.x) * extent + east / metres, (y - tile.y) * extent - north / metres);
    }
    return out;
  });
}

/** Whether a point lies inside any of the rings (even-odd), as `[x, y, x, y, …]`. */
export function tileflowInsideRings(
  rings: readonly (readonly number[])[],
  px: number,
  py: number,
): boolean {
  for (const ring of rings) {
    let inside = false;
    for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
      const ax = ring[a]!;
      const ay = ring[a + 1]!;
      const bx = ring[b]!;
      const by = ring[b + 1]!;
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** A point as fractional tile coordinates at a zoom. */
function mercatorTile(longitude: number, latitude: number, zoom: number): [number, number] {
  const phi = (Math.min(85.05, Math.max(-85.05, latitude)) * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * 2 ** zoom,
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom,
  ];
}

/** Metres across a tile at a latitude and zoom. */
function tileMetresAt(latitude: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
}
