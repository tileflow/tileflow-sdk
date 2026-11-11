import type {TileflowTileLayer} from './vector-tile-decode';

// The ordinary tree vertex (24 bytes) followed by its placement (16 bytes). Placement is
// per vertex here: connected hedges rise vertically without pulling their joints apart.
export const tileflowHedgeVertexBytes = 40;
const extent = 8192;
const halfWidth = 0.25;
const profile = [
  [-halfWidth, 0],
  [-halfWidth, 0.9],
  [-halfWidth + 0.05, 1],
  [halfWidth - 0.05, 1],
  [halfWidth, 0.9],
  [halfWidth, 0],
] as const;
type Point = readonly [number, number];
type Vertex = readonly [number, number, number];
type Face = {points: Vertex[]; normal: Vertex; height: number};

/** A clipped ribbon with shared mitered corners, a flat crown and gently bevelled shoulders. */
export function placeTileflowHedges(
  layer: TileflowTileLayer | undefined,
  tileMetres: number,
  fields: {subclass: string; hedge: string; height: string},
): {instances: Uint8Array; geometry: Uint8Array; tallest: number} {
  const faces: Face[] = [];
  const segments: {a: Point; b: Point; height: number}[] = [];
  let tallest = 0;

  const face = (points: Vertex[], normal: Vertex, height: number) => {
    // Clip the surface, not just the segment's centre. Neighbouring buffered tiles must not
    // draw the same coplanar roof or wall: that flickers as the camera tilts.
    let clipped = points;
    for (const [axis, edge, direction] of [
      [0, 0, 1],
      [0, tileMetres, -1],
      [1, -tileMetres, 1],
      [1, 0, -1],
    ] as const)
      clipped = clip(clipped, axis, edge, direction);
    for (let index = 1; index + 1 < clipped.length; index += 1) {
      const triangle = [clipped[0]!, clipped[index]!, clipped[index + 1]!];
      const cross = normalOf(triangle);
      if (Math.hypot(...cross) < 1e-9) continue;
      if (cross.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) < 0)
        triangle.reverse();
      faces.push({points: triangle, normal, height});
    }
  };

  for (const feature of layer?.features ?? []) {
    if (feature.type === 'Point' || feature.properties[fields.subclass] !== 'hedge') continue;
    const measured = Number.parseFloat(String(feature.properties[fields.height]));
    const height =
      (Number.isFinite(measured) && measured > 0 ? Math.min(10, Math.max(0.3, measured)) : 1.3) +
      (feature.properties[fields.hedge] === 'hedge_bank' ? 1 : 0);
    const metres = tileMetres / layer!.extent;
    for (const coordinates of feature.geometry) {
      const points: Point[] = [];
      for (let index = 0; index + 1 < coordinates.length; index += 2) {
        const point: Point = [coordinates[index]! * metres, -coordinates[index + 1]! * metres];
        const previous = points.at(-1);
        if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6)
          points.push(point);
      }
      if (points.length < 2) continue;
      const first = points[0]!;
      const last = points.at(-1)!;
      const closed = first[0] === last[0] && first[1] === last[1];
      if (closed) points.pop();
      if (points.length < 2) continue;
      const count = closed ? points.length : points.length - 1;
      const directions = Array.from({length: count}, (_, index) => {
        const a = points[index]!;
        const b = points[(index + 1) % points.length]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
      });
      const joins = points.map((_, index): Point => {
        const before = directions[(index - 1 + count) % count]!;
        const after = directions[index % count]!;
        if (!closed && index === 0) return [-after[1], after[0]];
        if (!closed && index === points.length - 1) return [-before[1], before[0]];
        const denominator = 1 + before[0] * after[0] + before[1] * after[1];
        if (denominator < 1e-6) return [-after[1], after[0]];
        const x = (-before[1] - after[1]) / denominator;
        const y = (before[0] + after[0]) / denominator;
        const limit = Math.min(1, 2 / Math.hypot(x, y));
        return [x * limit, y * limit];
      });
      const section = (index: number) =>
        profile.map(([width, z]): Vertex => [
          points[index]![0] + joins[index]![0] * width,
          points[index]![1] + joins[index]![1] * width,
          z,
        ]);
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % points.length;
        const a = section(index);
        const b = section(next);
        const start = faces.length;
        const direction = directions[index]!;
        for (let side = 0; side + 1 < profile.length; side += 1) {
          const [w0, z0] = profile[side]!;
          const [w1, z1] = profile[side + 1]!;
          const normal = unit([direction[1] * (z1 - z0), -direction[0] * (z1 - z0), w1 - w0]);
          face([a[side]!, b[side]!, b[side + 1]!, a[side + 1]!], normal, height);
        }
        if (!closed) {
          for (const end of [0, 1] as const) {
            if ((end === 0 && index !== 0) || (end === 1 && index !== count - 1)) continue;
            const ring = end === 0 ? a : b;
            const point = points[end === 0 ? index : next]!;
            const centre: Vertex = [point[0], point[1], 0.5];
            const sign = end === 0 ? -1 : 1;
            const normal: Vertex = [sign * direction[0], sign * direction[1], 0];
            for (let side = 0; side < ring.length; side += 1)
              face([centre, ring[side]!, ring[(side + 1) % ring.length]!], normal, height);
          }
        }
        if (faces.length > start) {
          segments.push({a: points[index]!, b: points[next]!, height});
          tallest = Math.max(tallest, height);
        }
      }
    }
  }

  const instances = new Uint8Array(segments.length * 16);
  const instanceView = new DataView(instances.buffer);
  const tileUnit = tileMetres / extent;
  segments.forEach(({a, b, height}, index) => {
    const at = index * 16;
    instanceView.setUint16(
      at,
      Math.max(0, Math.min(extent - 1, Math.round((a[0] + b[0]) / 2 / tileUnit))),
      true,
    );
    instanceView.setUint16(
      at + 2,
      Math.max(0, Math.min(extent - 1, Math.round(-(a[1] + b[1]) / 2 / tileUnit))),
      true,
    );
    instanceView.setUint16(at + 4, Math.round(height * 10), true);
    instanceView.setUint16(
      at + 6,
      Math.min(65535, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 10)),
      true,
    );
    instances[at + 8] =
      Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI * 2) + 1) * 256) & 255;
    instances[at + 9] = 128;
  });
  const geometry = new Uint8Array(faces.length * 3 * tileflowHedgeVertexBytes);
  const view = new DataView(geometry.buffer);
  let at = 0;
  for (const {points, normal, height} of faces) {
    for (const [x, y, z] of points) {
      const px = Math.round(x / tileUnit);
      const py = Math.round(-y / tileUnit);
      view.setFloat32(at, x - px * tileUnit, true);
      view.setFloat32(at + 4, y + py * tileUnit, true);
      view.setFloat32(at + 8, z, true);
      for (let axis = 0; axis < 3; axis += 1) {
        const value = Math.round(normal[axis]! * 127);
        view.setInt8(at + 12 + axis, value);
        // Flat roofs and walls retain their normals even when trees use a smooth finish.
        view.setInt8(at + 18 + axis, value);
      }
      geometry[at + 15] = 1;
      geometry[at + 16] = 128;
      geometry[at + 17] = Math.round((0.55 + z * 0.45) * 255);
      view.setUint16(at + 24, px, true);
      view.setUint16(at + 26, py, true);
      view.setUint16(at + 28, Math.round(height * 10), true);
      view.setUint16(at + 30, 10, true);
      // One continuous shade, without alternating blocks or per-segment growth delays.
      geometry[at + 33] = 128;
      at += tileflowHedgeVertexBytes;
    }
  }
  return {instances, geometry, tallest};
}

function unit(vector: Vertex): Vertex {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length) as unknown as Vertex;
}

function normalOf([a, b, c]: Vertex[]): Vertex {
  const u = b!.map((value, axis) => value - a![axis]!);
  const v = c!.map((value, axis) => value - a![axis]!);
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
}

function clip(points: Vertex[], axis: 0 | 1, edge: number, direction: number): Vertex[] {
  const result: Vertex[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const da = (a[axis] - edge) * direction;
    const db = (b[axis] - edge) * direction;
    if (da >= 0) result.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      result.push(
        a.map((value, component) =>
          component === axis ? edge : value + (b[component]! - value) * t,
        ) as unknown as Vertex,
      );
    }
  }
  return result;
}
