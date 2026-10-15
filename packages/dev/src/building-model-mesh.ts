// Turns a glTF binary into a level of Core's building model: each material names its part of the
// building (surface, secondary, glass, accent or roof), the model keeps its size in metres round its
// origin (where it stands on the ground, x east and y north), and its colours become shades within
// its parts' theme colours. The footprint, the outline on the ground the model stands in for, is a
// mesh whose material is named `footprint`, which is never drawn, or else the nearest level's own
// outline on the ground. It has no filesystem access.
import {tileflowModelLimits, type TileflowModelMesh, tileflowModelParts} from '@tileflow/core';
import {
  readTileflowGltfTriangles,
  TileflowGltfError,
  type TileflowGltfPrimitive,
} from './gltf-reader';

export const tileflowBuildingModelPartNames = Object.keys(tileflowModelParts) as readonly (
  'surface' | 'secondary' | 'glass' | 'accent' | 'roof'
)[];

/** Whether every material of a glTF binary names a part of a building, so it is a building model. */
export function isTileflowBuildingModel(primitives: readonly TileflowGltfPrimitive[]): boolean {
  const drawn = primitives.filter((primitive) => !isFootprint(primitive));
  return drawn.length > 0 && drawn.every((primitive) => partOf(primitive.material) !== undefined);
}

/**
 * The triangles a model says it stands in for: its meshes whose material is named `footprint`, or
 * undefined when it has none.
 */
export function tileflowBuildingModelDeclaredFootprint(
  primitives: readonly TileflowGltfPrimitive[],
): Pick<TileflowModelMesh, 'indices' | 'positions'> | undefined {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const primitive of primitives) {
    if (!isFootprint(primitive)) continue;
    const offset = positions.length / 3;
    positions.push(...primitive.positions);
    for (const index of primitive.indices) indices.push(offset + index);
  }
  return indices.length > 0 ? {positions, indices} : undefined;
}

/** A level of a building model, as Core encodes it. Throws `TileflowGltfError`. */
export function prepareTileflowBuildingModelMesh(
  bytes: Uint8Array | readonly TileflowGltfPrimitive[],
): TileflowModelMesh {
  const primitives = bytes instanceof Uint8Array ? readTileflowGltfTriangles(bytes) : bytes;
  const positions: number[] = [];
  const normals: (number[] | undefined)[] = [];
  const parts: number[] = [];
  const luminance: number[] = [];
  const indices: number[] = [];
  for (const primitive of primitives) {
    if (isFootprint(primitive)) continue;
    const part = partOf(primitive.material);
    if (part === undefined)
      throw new TileflowGltfError(
        primitive.material === undefined
          ? 'has a mesh without a material; name each material surface, secondary, glass, accent or roof'
          : `has a material "${primitive.material}" that names no part of a building; name each material surface, secondary, glass, accent or roof`,
      );
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
  const triangles = indices.length / 3;
  if (triangles > tileflowModelLimits.triangles)
    throw new TileflowGltfError(
      `has ${triangles.toLocaleString('en')} triangles; a building model takes at most ${tileflowModelLimits.triangles.toLocaleString('en')} a level. Simplify it and export it again`,
    );
  if (count > tileflowModelLimits.vertices)
    throw new TileflowGltfError(
      `has ${count.toLocaleString('en')} vertices; a building model takes at most ${tileflowModelLimits.vertices.toLocaleString('en')} a level. Merge vertices by distance and export it again`,
    );
  let low = Infinity;
  let high = -Infinity;
  for (let vertex = 0; vertex < count; vertex += 1) {
    low = Math.min(low, positions[vertex * 3 + 2]!);
    high = Math.max(high, positions[vertex * 3 + 2]!);
  }
  if (low < -0.5)
    throw new TileflowGltfError(
      `reaches ${(-low).toFixed(1)} m below its origin; put the origin on the ground where the building stands, with the building above it`,
    );
  if (!(high > 0)) throw new TileflowGltfError('has no height above its origin');

  // A file without normals takes each vertex's faces' mean.
  const sums = new Array<number>(count * 3).fill(0);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at]!, indices[at + 1]!, indices[at + 2]!];
    const n = cross(
      sub(point(positions, b), point(positions, a)),
      sub(point(positions, c), point(positions, a)),
    );
    for (const vertex of [a, b, c])
      for (let axis = 0; axis < 3; axis += 1) sums[vertex * 3 + axis]! += n[axis]!;
  }
  const outNormals: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const n = normals[vertex] ?? sums.slice(vertex * 3, vertex * 3 + 3);
    const size = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    outNormals.push(n[0]! / size, n[1]! / size, n[2]! / size);
  }
  // A vertex's shade is how much lighter or darker it is than its part's mean: the theme colours
  // each part, and the model's own colours only vary it.
  const shades = new Array<number>(count).fill(0);
  for (const part of new Set(parts)) {
    const members = parts.flatMap((value, vertex) => (value === part ? [vertex] : []));
    const mean = members.reduce((sum, vertex) => sum + luminance[vertex]!, 0) / members.length;
    const spread = Math.max(0.06, mean * 0.6);
    for (const vertex of members)
      shades[vertex] = clamp((luminance[vertex]! - mean) / spread, -1, 1);
  }
  return {
    positions,
    normals: outNormals,
    parts,
    shades,
    occlusion: new Array<number>(count).fill(1),
    indices,
  };
}

/**
 * The outline on the ground a model covers, as closed rings in metres: every triangle laid flat on
 * a grid of cells about a metre wide (coarser for very wide models), and the outer edges of the
 * covered cells simplified to within a cell. Courtyards inside it are covered too.
 */
export function tileflowBuildingModelFootprint(
  mesh: Pick<TileflowModelMesh, 'indices' | 'positions'>,
): number[][] {
  const {positions, indices} = mesh;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at += 3) {
    minX = Math.min(minX, positions[at]!);
    maxX = Math.max(maxX, positions[at]!);
    minY = Math.min(minY, positions[at + 1]!);
    maxY = Math.max(maxY, positions[at + 1]!);
  }
  const cell = Math.max(1, Math.max(maxX - minX, maxY - minY) / 1024);
  const columns = Math.ceil((maxX - minX) / cell) + 5;
  const rows = Math.ceil((maxY - minY) / cell) + 5;
  const x0 = minX - 2 * cell;
  const y0 = minY - 2 * cell;
  const filled = new Uint8Array(columns * rows);
  // A cell is covered when its centre lies inside a triangle, or a triangle's corner lies in it,
  // so thin members still mark the ground they stand on.
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const corners = [indices[at]!, indices[at + 1]!, indices[at + 2]!].map((vertex) => [
      (positions[vertex * 3]! - x0) / cell,
      (positions[vertex * 3 + 1]! - y0) / cell,
    ]) as [number, number][];
    for (const [cx, cy] of corners) filled[Math.floor(cy) * columns + Math.floor(cx)] = 1;
    const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
    const right = Math.min(columns - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
    const bottom = Math.min(rows - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    const [a, b, c] = corners;
    const area = edge(a, b, c);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = top; y <= bottom; y += 1)
      for (let x = left; x <= right; x += 1) {
        const p: [number, number] = [x + 0.5, y + 0.5];
        const w0 = edge(b, c, p) / area;
        const w1 = edge(c, a, p) / area;
        const w2 = edge(a, b, p) / area;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) filled[y * columns + x] = 1;
      }
  }
  // Members thinner than a cell can leave gaps between the cells they cover: a cell beside a
  // covered one counts, so a lattice encloses what it surrounds.
  const grown = new Uint8Array(filled);
  for (let y = 1; y < rows - 1; y += 1)
    for (let x = 1; x < columns - 1; x += 1) {
      if (filled[y * columns + x]) continue;
      for (let dy = -1; dy <= 1 && !grown[y * columns + x]; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1)
          if (filled[(y + dy) * columns + x + dx]) {
            grown[y * columns + x] = 1;
            break;
          }
    }
  // Courtyards are part of what the model stands in for: fill every gap the outside cannot reach.
  const outside = new Uint8Array(columns * rows);
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % columns;
    const y = (at - x) / columns;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const next = ny * columns + nx;
      if (outside[next] || grown[next]) continue;
      outside[next] = 1;
      stack.push(next);
    }
  }
  const covered = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < columns && y < rows && !outside[y * columns + x];
  // Directed boundary edges, covered cells on their left, linked into rings.
  const next = new Map<string, [number, number][]>();
  const add = (from: [number, number], to: [number, number]) => {
    const key = `${from[0]},${from[1]}`;
    const list = next.get(key) ?? [];
    list.push(to);
    next.set(key, list);
  };
  for (let y = 0; y < rows; y += 1)
    for (let x = 0; x < columns; x += 1) {
      if (!covered(x, y)) continue;
      if (!covered(x, y - 1)) add([x, y], [x + 1, y]);
      if (!covered(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!covered(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!covered(x - 1, y)) add([x, y + 1], [x, y]);
    }
  const rings: number[][] = [];
  for (const [startKey, targets] of next) {
    while (targets.length) {
      const start = startKey.split(',').map(Number) as [number, number];
      const ring: [number, number][] = [start];
      let current = targets.pop()!;
      while (`${current[0]},${current[1]}` !== startKey) {
        ring.push(current);
        const outs = next.get(`${current[0]},${current[1]}`);
        if (!outs?.length) break;
        current = outs.pop()!;
      }
      const simplified = simplify(ring, 0.75);
      if (simplified.length >= 3)
        rings.push(simplified.flatMap(([x, y]) => [x0 + x * cell, y0 + y * cell]));
    }
  }
  // Rings with the most ground first; the count of points stays within the format's limit.
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const kept: number[][] = [];
  let points = 0;
  for (const ring of rings) {
    if (points + ring.length / 2 > tileflowModelLimits.footprintPoints) break;
    kept.push(ring);
    points += ring.length / 2;
  }
  return kept;
}

function isFootprint(primitive: TileflowGltfPrimitive): boolean {
  return (
    primitive.material
      ?.trim()
      .toLowerCase()
      .replace(/\.\d+$/u, '') === 'footprint'
  );
}

function partOf(material: string | undefined): number | undefined {
  const name = material
    ?.trim()
    .toLowerCase()
    .replace(/\.\d+$/u, '');
  const part = tileflowBuildingModelPartNames.find((candidate) => candidate === name);
  return part === undefined ? undefined : tileflowModelParts[part];
}

/** Douglas–Peucker on a closed ring, to within `tolerance` cells. */
function simplify(ring: readonly [number, number][], tolerance: number): [number, number][] {
  if (ring.length <= 4) return [...ring];
  // Split the ring at its farthest point from its first, and simplify both halves.
  let far = 0;
  let distance = -1;
  for (const [index, [x, y]] of ring.entries()) {
    const d = Math.hypot(x - ring[0]![0], y - ring[0]![1]);
    if (d > distance) {
      distance = d;
      far = index;
    }
  }
  const half = (points: readonly [number, number][]): [number, number][] => {
    if (points.length <= 2) return [...points];
    const [a, b] = [points[0]!, points[points.length - 1]!];
    let index = 0;
    let most = -1;
    for (let at = 1; at < points.length - 1; at += 1) {
      const d = segmentDistance(points[at]!, a, b);
      if (d > most) {
        most = d;
        index = at;
      }
    }
    if (most <= tolerance) return [a, b];
    const left = half(points.slice(0, index + 1));
    return [...left.slice(0, -1), ...half(points.slice(index))];
  };
  const first = half(ring.slice(0, far + 1));
  const second = half([...ring.slice(far), ring[0]!]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function segmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? clamp(((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / length, 0, 1) : 0;
  return Math.hypot(p[0]! - (a[0]! + t * dx), p[1]! - (a[1]! + t * dy));
}

function ringArea(ring: readonly number[]): number {
  let area = 0;
  for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2)
    area += ring[b]! * ring[a + 1]! - ring[a]! * ring[b + 1]!;
  return area / 2;
}

function edge(a: readonly number[], b: readonly number[], p: readonly number[]): number {
  return (b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!);
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
