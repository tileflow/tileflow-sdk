import type {TileflowModelMesh} from '@tileflow/core';

type Geometry = Pick<TileflowModelMesh, 'positions' | 'normals' | 'indices'>;
type Node = {bounds: number[]; from: number; to: number; left: number; right: number; axis: number};

/** Local sky visibility, baked independently of colour and sun direction. Distances are metres. */
export function buildingModelAmbientVisibility(
  mesh: Geometry,
  options: {radius?: number; samples?: number} = {},
): number[] {
  const sampler = buildingModelAmbientSampler(mesh, options);
  const {positions, normals} = mesh;
  const values = new Array<number>(positions.length / 3);
  const cache = new Map<string, number>();
  for (let vertex = 0; vertex < values.length; vertex += 1) {
    const at = vertex * 3;
    const point = [positions[at]!, positions[at + 1]!, positions[at + 2]!];
    const normal = [normals[at]!, normals[at + 1]!, normals[at + 2]!];
    // Repeated corners with the same normal share samples across material and UV seams.
    const key = [...point, ...normal].map((v) => Math.round(v * 100_000)).join(',');
    let value = cache.get(key);
    if (value === undefined) {
      value = sampler.sky(point, normal);
      cache.set(key, value);
    }
    values[vertex] = value;
  }
  return values;
}

export type BuildingModelAmbientSampler = {
  readonly radius: number;
  /** Sky visibility seen by a surface facing `normal` at `point`; `turn` rotates the ray pattern. */
  sky(point: readonly number[], normal: readonly number[], rays?: number, turn?: number): number;
  /** Distance to the nearest surface along a direction, up to the reach. */
  along(point: readonly number[], direction: readonly number[]): number;
};

/** Ray queries against a level's own triangles. */
export function buildingModelAmbientSampler(
  mesh: Geometry,
  {radius = 2, samples = 48}: {radius?: number; samples?: number} = {},
): BuildingModelAmbientSampler {
  if (
    !(radius > 0 && Number.isFinite(radius)) ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > 256
  )
    throw new RangeError('Model ambient visibility needs a positive radius and 1 to 256 samples.');

  const {positions, indices} = mesh;
  const count = indices.length / 3;
  const triangles = new Float64Array(count * 9);
  const bounds = new Float64Array(count * 6);
  const centres = new Float64Array(count * 3);
  const order = Uint32Array.from({length: count}, (_, i) => i);
  for (let i = 0; i < count; i += 1) {
    const a = indices[i * 3]! * 3;
    const b = indices[i * 3 + 1]! * 3;
    const c = indices[i * 3 + 2]! * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const x = positions[a + axis]!,
        y = positions[b + axis]!,
        z = positions[c + axis]!;
      triangles[i * 9 + axis] = x;
      triangles[i * 9 + 3 + axis] = y - x;
      triangles[i * 9 + 6 + axis] = z - x;
      bounds[i * 6 + axis] = Math.min(x, y, z);
      bounds[i * 6 + 3 + axis] = Math.max(x, y, z);
      centres[i * 3 + axis] = (x + y + z) / 3;
    }
  }

  const nodes: Node[] = [];
  const build = (from: number, to: number): number => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let at = from; at < to; at += 1) {
      const i = order[at]! * 6;
      for (let axis = 0; axis < 3; axis += 1) {
        box[axis] = Math.min(box[axis]!, bounds[i + axis]!);
        box[axis + 3] = Math.max(box[axis + 3]!, bounds[i + axis + 3]!);
      }
    }
    let axis = 0;
    for (let next = 1; next < 3; next += 1)
      if (box[next + 3]! - box[next]! > box[axis + 3]! - box[axis]!) axis = next;
    const index = nodes.length;
    const node: Node = {bounds: box, from, to, left: -1, right: -1, axis};
    nodes.push(node);
    if (to - from > 8) {
      order
        .subarray(from, to)
        .sort((a, b) => centres[a * 3 + axis]! - centres[b * 3 + axis]! || a - b);
      const middle = (from + to) >>> 1;
      node.left = build(from, middle);
      node.right = build(middle, to);
    }
    return index;
  };
  if (count > 0) build(0, count);

  // Cosine-weighted hemispheres: each sample contributes the same ambient irradiance.
  const hemispheres = new Map<number, number[][]>();
  const hemisphere = (count: number) => {
    let pattern = hemispheres.get(count);
    if (!pattern) {
      pattern = Array.from({length: count}, (_, i) => {
        const r = Math.sqrt((i + 0.5) / count),
          angle = i * Math.PI * (3 - Math.sqrt(5));
        return [r * Math.cos(angle), r * Math.sin(angle), Math.sqrt(1 - r * r)];
      });
      hemispheres.set(count, pattern);
    }
    return pattern;
  };
  const bias = Math.min(0.002, radius * 0.001);
  const stack = new Int32Array(64);
  const origin = [0, 0, 0];
  const direction = [0, 0, 0];
  const nearest = (): number => {
    let best = radius,
      pending = 1;
    if (nodes.length === 0) return best;
    stack[0] = 0;
    while (pending > 0) {
      const node = nodes[stack[--pending]!]!;
      if (!hitsBox(node.bounds, origin, direction, best)) continue;
      if (node.left >= 0) {
        const forward = direction[node.axis]! >= 0;
        stack[pending++] = forward ? node.right : node.left;
        stack[pending++] = forward ? node.left : node.right;
        continue;
      }
      for (let at = node.from; at < node.to; at += 1) {
        const i = order[at]! * 9;
        const e1x = triangles[i + 3]!,
          e1y = triangles[i + 4]!,
          e1z = triangles[i + 5]!;
        const e2x = triangles[i + 6]!,
          e2y = triangles[i + 7]!,
          e2z = triangles[i + 8]!;
        const px = direction[1]! * e2z - direction[2]! * e2y;
        const py = direction[2]! * e2x - direction[0]! * e2z;
        const pz = direction[0]! * e2y - direction[1]! * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(determinant) < 1e-12) continue;
        const tx = origin[0]! - triangles[i]!,
          ty = origin[1]! - triangles[i + 1]!,
          tz = origin[2]! - triangles[i + 2]!;
        const inverse = 1 / determinant;
        const u = (tx * px + ty * py + tz * pz) * inverse;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y,
          qy = tz * e1x - tx * e1z,
          qz = tx * e1y - ty * e1x;
        const v = (direction[0]! * qx + direction[1]! * qy + direction[2]! * qz) * inverse;
        if (v < 0 || u + v > 1) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
        if (distance > bias && distance < best) best = distance;
      }
    }
    return best;
  };

  return {
    radius,
    sky(point, normal, rays = samples, turn = 0) {
      const [nx, ny, nz] = normal as [number, number, number];
      const flat = Math.abs(nz) < 0.9 ? [-ny, nx, 0] : [nz, 0, -nx];
      const length = Math.hypot(...flat);
      if (length === 0) return 1;
      const [c, s] = [Math.cos(turn), Math.sin(turn)];
      const base = flat.map((value) => value / length);
      const cross = [
        ny * base[2]! - nz * base[1]!,
        nz * base[0]! - nx * base[2]!,
        nx * base[1]! - ny * base[0]!,
      ];
      const tangent = base.map((value, axis) => value * c + cross[axis]! * s);
      const bitangent = cross.map((value, axis) => value * c - base[axis]! * s);
      for (let axis = 0; axis < 3; axis += 1) origin[axis] = point[axis]! + normal[axis]! * bias;
      let visibility = 0;
      const pattern = hemisphere(rays);
      for (const sample of pattern) {
        for (let axis = 0; axis < 3; axis += 1)
          direction[axis] =
            sample[0]! * tangent[axis]! +
            sample[1]! * bitangent[axis]! +
            sample[2]! * normal[axis]!;
        visibility += nearest() / radius;
      }
      return visibility / pattern.length;
    },
    along(point, towards) {
      for (let axis = 0; axis < 3; axis += 1) {
        origin[axis] = point[axis]! + towards[axis]! * bias;
        direction[axis] = towards[axis]!;
      }
      return nearest();
    },
  };
}

function hitsBox(box: number[], origin: number[], direction: number[], limit: number): boolean {
  let low = 0,
    high = limit;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis]!,
      d = direction[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < box[axis]! || o > box[axis + 3]!) return false;
      continue;
    }
    const a = (box[axis]! - o) / d,
      b = (box[axis + 3]! - o) / d;
    low = Math.max(low, Math.min(a, b));
    high = Math.min(high, Math.max(a, b));
    if (low > high) return false;
  }
  return true;
}
