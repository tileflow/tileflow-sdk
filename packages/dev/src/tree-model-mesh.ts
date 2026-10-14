// Turns a glTF binary into Core's tree model: each material names its part of the tree, the model
// becomes a unit tree (its origin where the trunk meets the ground, its top at height 1, its widest
// crown point half a unit out), its colours become shades within its parts' theme colours, and
// occlusion is baked from where each vertex sits in the crown. It has no filesystem access.
import {
  tileflowTreeModelLimits,
  type TileflowTreeModelMesh,
  tileflowTreeParts,
} from '@tileflow/core';
import {readTileflowGltfTriangles, TileflowGltfError} from './gltf-reader';

export const tileflowTreeModelPartNames = ['bark', 'leaves', 'fronds', 'stem'] as const;

/**
 * The tree model a glTF binary holds, as Core encodes it. Throws `TileflowGltfError` with words an
 * author can act on.
 */
export function prepareTileflowTreeModelMesh(
  bytes: Uint8Array,
  level: 'near' | 'far',
): TileflowTreeModelMesh {
  const primitives = readTileflowGltfTriangles(bytes);
  const positions: number[] = [];
  const normals: (number[] | undefined)[] = [];
  const parts: number[] = [];
  const luminance: number[] = [];
  const indices: number[] = [];
  for (const primitive of primitives) {
    const part = partOf(primitive.material);
    const offset = positions.length / 3;
    const count = primitive.positions.length / 3;
    positions.push(...primitive.positions);
    for (let vertex = 0; vertex < count; vertex += 1) {
      parts.push(part);
      normals.push(primitive.normals?.slice(vertex * 3, vertex * 3 + 3));
      const [r, g, b] = primitive.colours.slice(vertex * 3, vertex * 3 + 3) as [
        number,
        number,
        number,
      ];
      luminance.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
    for (const index of primitive.indices) indices.push(offset + index);
  }
  const count = positions.length / 3;
  const triangleCount = indices.length / 3;
  const limit =
    level === 'near' ? tileflowTreeModelLimits.nearTriangles : tileflowTreeModelLimits.farTriangles;
  if (triangleCount > limit)
    throw new TileflowGltfError(
      `has ${triangleCount.toLocaleString('en')} triangles; a ${level} tree model takes at most ${limit.toLocaleString('en')}. Simplify it (for example with Blender's Decimate modifier) and export it again`,
    );
  if (count > tileflowTreeModelLimits.vertices)
    throw new TileflowGltfError(
      `has ${count.toLocaleString('en')} vertices; a tree model takes at most ${tileflowTreeModelLimits.vertices.toLocaleString('en')}. Merge vertices by distance and export it again`,
    );

  // A unit tree: its top at height 1 above its origin, its crown half a unit from its axis.
  let height = 0;
  let reach = 0;
  const crowned = parts.some((part) => isCrown(part));
  for (let vertex = 0; vertex < count; vertex += 1) {
    height = Math.max(height, positions[vertex * 3 + 2]!);
    if (!crowned || isCrown(parts[vertex]!))
      reach = Math.max(reach, Math.hypot(positions[vertex * 3]!, positions[vertex * 3 + 1]!));
  }
  if (!(height > 0))
    throw new TileflowGltfError(
      'stands below its origin; put the origin where the trunk meets the ground, with the tree above it',
    );
  if (!(reach > 0)) throw new TileflowGltfError('has no width round its origin');
  const across = 2 * reach;
  const unit: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1)
    unit.push(
      positions[vertex * 3]! / across,
      positions[vertex * 3 + 1]! / across,
      positions[vertex * 3 + 2]! / height,
    );

  // Normals follow the stretch; a file without them takes each vertex's faces' mean.
  const faceSums = new Array<number>(count * 3).fill(0);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at]!, indices[at + 1]!, indices[at + 2]!];
    const n = cross(sub(point(unit, b), point(unit, a)), sub(point(unit, c), point(unit, a)));
    for (const vertex of [a, b, c])
      for (let axis = 0; axis < 3; axis += 1) faceSums[vertex * 3 + axis]! += n[axis]!;
  }
  const outNormals: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const own = normals[vertex];
    const n = own
      ? [own[0]! * across, own[1]! * across, own[2]! * height]
      : faceSums.slice(vertex * 3, vertex * 3 + 3);
    const size = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    outNormals.push(n[0]! / size, n[1]! / size, n[2]! / size);
  }

  // A vertex's shade is how much lighter or darker it is than its part's mean.
  const shades = new Array<number>(count).fill(0);
  for (const part of new Set(parts)) {
    const members = parts.flatMap((value, vertex) => (value === part ? [vertex] : []));
    const mean = members.reduce((sum, vertex) => sum + luminance[vertex]!, 0) / members.length;
    const spread = Math.max(0.06, mean * 0.6);
    for (const vertex of members)
      shades[vertex] = clamp((luminance[vertex]! - mean) / spread, -1, 1);
  }

  // Inside and low in the crown is darker than its sunlit top and rim; the trunk is half shaded.
  let crownLow = 1;
  let crownHigh = 0;
  for (let vertex = 0; vertex < count; vertex += 1)
    if (isCrown(parts[vertex]!)) {
      crownLow = Math.min(crownLow, unit[vertex * 3 + 2]!);
      crownHigh = Math.max(crownHigh, unit[vertex * 3 + 2]!);
    }
  const occlusion: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const z = unit[vertex * 3 + 2]!;
    if (!isCrown(parts[vertex]!)) {
      occlusion.push(z > crownLow ? 0.55 : 0.8);
      continue;
    }
    const up = crownHigh > crownLow ? (z - crownLow) / (crownHigh - crownLow) : 1;
    const out = Math.min(1, Math.hypot(unit[vertex * 3]!, unit[vertex * 3 + 1]!) / 0.5);
    occlusion.push(clamp(0.4 + 0.35 * up + 0.3 * out, 0.35, 1));
  }
  return {
    // The author's proportions: the trees it stands keep them around the sizes the data gives.
    proportion: Math.min(3, Math.max(0.1, across / height)),
    positions: unit,
    normals: outNormals,
    parts,
    shades,
    occlusion,
    indices,
  };
}

function partOf(material: string | undefined): number {
  const name = material
    ?.trim()
    .toLowerCase()
    .replace(/\.\d+$/u, '');
  const part = tileflowTreeModelPartNames.find((candidate) => candidate === name);
  if (part) return tileflowTreeParts[part];
  throw new TileflowGltfError(
    material === undefined
      ? 'has a mesh without a material; name each material bark, leaves, fronds or stem'
      : `has a material "${material}" that names no part of a tree; name each material bark, leaves, fronds or stem`,
  );
}

function isCrown(part: number): boolean {
  return part === tileflowTreeParts.leaves || part === tileflowTreeParts.fronds;
}

function point(list: readonly number[], vertex: number): [number, number, number] {
  return [list[vertex * 3]!, list[vertex * 3 + 1]!, list[vertex * 3 + 2]!];
}

function sub(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
