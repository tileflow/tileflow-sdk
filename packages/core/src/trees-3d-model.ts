// A map's own 3D tree models. Tileflow's Node tooling prepares each glTF binary (.glb) a map
// declares into this compact form: an indexed unit tree, standing from z 0 to 1 with its crown one
// unit wide, whose vertices each carry their part (bark, leaves, fronds or stem), a shade and their
// occlusion. The compiler carries it in the style's tree description as text, so a model travels
// with the style and needs no file of its own, and the renderer expands it into the vertices of
// Core's own trees. It has no DOM dependency.
import {tileflowTreeParts} from './trees-3d-mesh';

/** What a map's tree models may hold. */
export const tileflowTreeModelLimits = Object.freeze({
  /** Triangles of a near model, the one drawn close to the camera. */
  nearTriangles: 1000,
  /** Triangles of a far model, drawn beyond the nearest tiles. */
  farTriangles: 120,
  /** Vertices of one model. */
  vertices: 4096,
  /** Models one map carries. */
  models: 16,
  /** Models one form draws from. */
  perForm: 4,
});

/** A model as indexed triangles of a unit tree, before it is encoded. */
export type TileflowTreeModelMesh = Readonly<{
  /** The model's crown width over its height, as its author drew it, from 0.1 to 3. */
  proportion: number;
  /** x, y and z of each vertex: x and y from about -0.5 to 0.5, z from 0 to 1. */
  positions: readonly number[];
  /** The vertex normals, x, y and z. */
  normals: readonly number[];
  /** Each vertex's part, a value of `tileflowTreeParts`. */
  parts: readonly number[];
  /** Each vertex's shade among its part's colours, from -1 (darkest) to 1. */
  shades: readonly number[];
  /** Each vertex's light, from 0 (fully occluded) to 1. */
  occlusion: readonly number[];
  /** Three vertex indices per triangle. */
  indices: readonly number[];
}>;

/** A prepared model, near and optionally far, as the style's tree description carries it. */
export type TileflowTreeModel = Readonly<{near: string; far?: string}>;

const magic = [0x54, 0x46, 0x54, 0x4d]; // "TFTM"
const version = 1;
const headerBytes = 16;
const vertexBytes = 12;
// Positions are stored as 16-bit integers over ±2 units, which holds a crown that overhangs its
// unit width and keeps a millimetre's precision on a 20 m tree.
const positionRange = 2;
const partCount = Object.keys(tileflowTreeParts).length;

/** Encodes a model as base64 text. Throws when it breaks `tileflowTreeModelLimits`. */
export function encodeTileflowTreeModel(
  mesh: TileflowTreeModelMesh,
  level: 'near' | 'far',
): string {
  const count = mesh.positions.length / 3;
  const triangles = mesh.indices.length / 3;
  const limit =
    level === 'near' ? tileflowTreeModelLimits.nearTriangles : tileflowTreeModelLimits.farTriangles;
  if (!Number.isInteger(count) || count < 3 || count > tileflowTreeModelLimits.vertices)
    throw new RangeError(`A tree model has 3 to ${tileflowTreeModelLimits.vertices} vertices.`);
  if (!Number.isInteger(triangles) || triangles < 1 || triangles > limit)
    throw new RangeError(`A ${level} tree model has 1 to ${limit} triangles.`);
  for (const list of [mesh.normals, mesh.positions])
    if (list.length !== count * 3)
      throw new RangeError('Every vertex needs a position and normal.');
  for (const list of [mesh.parts, mesh.shades, mesh.occlusion])
    if (list.length !== count) throw new RangeError('Every vertex needs a part, shade and light.');
  const bytes = new Uint8Array(headerBytes + count * vertexBytes + mesh.indices.length * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(magic, 0);
  view.setUint16(4, version, true);
  view.setUint16(6, count, true);
  view.setUint32(8, mesh.indices.length, true);
  view.setUint16(12, Math.round(clamp(mesh.proportion, 0.1, 3) * 1000), true);
  for (let index = 0; index < count; index += 1) {
    const at = headerBytes + index * vertexBytes;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = clamp(mesh.positions[index * 3 + axis]! / positionRange, -1, 1);
      view.setInt16(at + axis * 2, Math.round(value * 32767), true);
      view.setInt8(at + 6 + axis, Math.round(clamp(mesh.normals[index * 3 + axis]!, -1, 1) * 127));
    }
    const part = mesh.parts[index]!;
    if (!Number.isInteger(part) || part < 0 || part >= partCount)
      throw new RangeError(`Vertex ${index} has no tree part.`);
    bytes[at + 9] = part;
    bytes[at + 10] = Math.round(((clamp(mesh.shades[index]!, -1, 1) + 1) / 2) * 255);
    bytes[at + 11] = Math.round(clamp(mesh.occlusion[index]!, 0, 1) * 255);
  }
  const indexAt = headerBytes + count * vertexBytes;
  mesh.indices.forEach((vertex, index) => {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count)
      throw new RangeError(`Index ${index} names no vertex.`);
    view.setUint16(indexAt + index * 2, vertex, true);
  });
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/**
 * Decodes a model's base64 text, or undefined when it is not a tree model of this version or
 * breaks `tileflowTreeModelLimits`.
 */
export function decodeTileflowTreeModel(
  text: unknown,
  level: 'near' | 'far',
): TileflowTreeModelMesh | undefined {
  if (typeof text !== 'string' || text.length > 200_000) return undefined;
  let bytes: Uint8Array;
  try {
    const binary = atob(text);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    return undefined;
  }
  if (bytes.length < headerBytes || magic.some((byte, index) => bytes[index] !== byte))
    return undefined;
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(6, true);
  const indexCount = view.getUint32(8, true);
  const proportion = view.getUint16(12, true) / 1000;
  const limit =
    level === 'near' ? tileflowTreeModelLimits.nearTriangles : tileflowTreeModelLimits.farTriangles;
  if (
    view.getUint16(4, true) !== version ||
    count < 3 ||
    count > tileflowTreeModelLimits.vertices ||
    indexCount < 3 ||
    indexCount % 3 !== 0 ||
    indexCount / 3 > limit ||
    !(proportion >= 0.1 && proportion <= 3) ||
    bytes.length !== headerBytes + count * vertexBytes + indexCount * 2
  )
    return undefined;
  const positions: number[] = [];
  const normals: number[] = [];
  const parts: number[] = [];
  const shades: number[] = [];
  const occlusion: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = headerBytes + index * vertexBytes;
    for (let axis = 0; axis < 3; axis += 1) {
      positions.push((view.getInt16(at + axis * 2, true) / 32767) * positionRange);
      normals.push(view.getInt8(at + 6 + axis) / 127);
    }
    if (bytes[at + 9]! >= partCount) return undefined;
    parts.push(bytes[at + 9]!);
    shades.push((bytes[at + 10]! / 255) * 2 - 1);
    occlusion.push(bytes[at + 11]! / 255);
  }
  const indices: number[] = [];
  const indexAt = headerBytes + count * vertexBytes;
  for (let index = 0; index < indexCount; index += 1) {
    const vertex = view.getUint16(indexAt + index * 2, true);
    if (vertex >= count) return undefined;
    indices.push(vertex);
  }
  return {proportion, positions, normals, parts, shades, occlusion, indices};
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
}
