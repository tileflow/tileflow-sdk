// Roofs of Tileflow's 3D buildings renderer (buildings-3d-mesh.ts), from the roof World publishes
// on a building: `roof_shape`, `roof_direction`, `roof_orientation` and `roof_height`. Every roof is
// the lowest of a few planes over the building's smallest enclosing rectangle, so a gabled roof is
// two planes meeting at the ridge, a hipped one four, a mansard eight, and a dome or a barrel the
// planes tangent to it, drawn faceted. Each plane owns the part of the footprint where it is lowest,
// and the walls rise to the roof, so gable ends come out of the same rule. It has no DOM dependency.
import earcut from 'earcut';

/** A plane as a share of the roof's height over the rectangle's axes, in metres: a·u + b·v + c. */
type Plane = readonly [number, number, number];

/** One planar face of a roof, ready to mesh. */
export type TileflowRoofFace = Readonly<{
  /** Its outline in tile units, x then y, inside the building's footprint. */
  ring: readonly number[];
  /** Triangles over `ring`'s points, as earcut gives them. */
  triangles: readonly number[];
  /** Its normal's horizontal part in the tile (x east, y south), normalised with its upward part. */
  normal: readonly [number, number];
}>;

export type TileflowRoof = Readonly<{
  /** Metres above the ground. */
  eaves: number;
  ridge: number;
  faces: readonly TileflowRoofFace[];
  /** The roof's height at a point of the tile, in metres. */
  heightAt(x: number, y: number): number;
  /** Where the roof's slope changes along a wall from a to b, as shares of its length. */
  breaks(ax: number, ay: number, bx: number, by: number): number[];
}>;

/** Footprints this far from their smallest rectangle (area share) keep a flat roof. */
const minimumFill = 0.7;
const tan30 = Math.tan(Math.PI / 6);
const tan35 = Math.tan((35 * Math.PI) / 180);
const tan10 = Math.tan(Math.PI / 18);
// A gambrel's or a mansard's break: the steep lower slope rises to this share of the roof's height
// over this share of the half width.
const breakHeight = 0.65;
const breakWidth = 0.4;

/**
 * The roof of one building, or undefined to keep it flat: a building without a roof shape, a flat
 * roof, a footprint with courtyards or far from a rectangle, or one the tile cut short.
 *
 * `frame` is the building's outer ring as the tile holds it, before it is cut to the tile, so the
 * roof is the same in every tile that draws a piece of it; `footprint` is that ring cut to the tile.
 * `base` and `top` are the building's base and its published height in metres.
 */
export function tileflowRoofOf(
  frame: readonly number[],
  footprint: readonly number[],
  properties: Readonly<Record<string, unknown>>,
  base: number,
  top: number,
  metresPerUnit: number,
  extent: number,
): TileflowRoof | undefined {
  const shape = String(properties.roof_shape ?? '');
  if (!shape || shape === 'flat' || shape === 'sawtooth') return undefined;
  if (truncated(frame, extent)) return undefined;
  const box = smallestRectangle(frame);
  if (!box || Math.abs(ringArea(frame)) < minimumFill * 4 * box.halfU * box.halfV) return undefined;

  // Axes in metres: u along the ridge, v across it.
  let u: [number, number] = box.u;
  let v: [number, number] = box.v;
  let halfU = box.halfU * metresPerUnit;
  let halfV = box.halfV * metresPerUnit;
  if (halfU < halfV) [u, v, halfU, halfV] = [v, u, halfV, halfU];
  const direction = finite(properties.roof_direction);
  // The compass direction the slope faces, in the tile (x east, y south).
  const downhill: [number, number] | undefined =
    direction === undefined
      ? undefined
      : [Math.sin((direction * Math.PI) / 180), -Math.cos((direction * Math.PI) / 180)];
  const ridgeAcross =
    downhill !== undefined
      ? Math.abs(downhill[0] * u[0] + downhill[1] * u[1]) >
        Math.abs(downhill[0] * v[0] + downhill[1] * v[1])
      : properties.roof_orientation === 'across';
  if (ridgeAcross && shape !== 'skillion') [u, v, halfU, halfV] = [v, u, halfV, halfU];

  const planes = planesOf(shape, halfU, halfV, downhill && [dot(downhill, u), dot(downhill, v)]);
  if (!planes) return undefined;
  const span = Math.max(0, top - base);
  const own = finite(properties.roof_height);
  let eaves: number;
  let ridge: number;
  if (own !== undefined && own > 0) {
    // World's height includes the roof it states.
    ridge = top;
    eaves = Math.max(base + Math.min(2, span / 2), top - own);
  } else {
    const rise = Math.min(defaultRise(shape, halfV), span * 0.6, 30);
    // A measured or tagged height reaches the roof; one from levels or a fallback stops at the eaves.
    if (properties.height_source === 'height') {
      ridge = top;
      eaves = top - rise;
    } else {
      eaves = top;
      ridge = top + rise;
    }
  }
  const rise = ridge - eaves;
  if (!(rise >= 0.3)) return undefined;

  const [cx, cy] = box.centre;
  const local = (x: number, y: number): [number, number] => {
    const dx = (x - cx) * metresPerUnit;
    const dy = (y - cy) * metresPerUnit;
    return [dx * u[0] + dy * u[1], dx * v[0] + dy * v[1]];
  };
  const tile = (pu: number, pv: number): [number, number] => [
    cx + (pu * u[0] + pv * v[0]) / metresPerUnit,
    cy + (pu * u[1] + pv * v[1]) / metresPerUnit,
  ];
  const envelope = (pu: number, pv: number) => {
    let lowest = Infinity;
    for (const [a, b, c] of planes) lowest = Math.min(lowest, a * pu + b * pv + c);
    return Math.max(0, lowest);
  };
  const heightAt = (x: number, y: number) => eaves + rise * envelope(...local(x, y));

  const outline: number[] = [];
  for (let at = 0; at + 1 < footprint.length; at += 2)
    outline.push(...local(footprint[at]!, footprint[at + 1]!));
  if (ringArea(outline) < 0) reverse(outline);
  const margin = 1.01;
  const rectangle = [
    -halfU * margin,
    -halfV * margin,
    halfU * margin,
    -halfV * margin,
    halfU * margin,
    halfV * margin,
    -halfU * margin,
    halfV * margin,
  ];
  const faces: TileflowRoofFace[] = [];
  for (const [index, plane] of planes.entries()) {
    // Where this plane is the lowest: the rectangle cut by each other plane.
    let region: number[] = rectangle;
    for (const [other, next] of planes.entries()) {
      if (other === index) continue;
      const a = plane[0] - next[0];
      const b = plane[1] - next[1];
      const c = plane[2] - next[2];
      // The same plane twice: the first one keeps it.
      if (Math.abs(a) + Math.abs(b) + Math.abs(c) < 1e-9) {
        if (other < index) region = [];
        continue;
      }
      region = clipHalf(region, a, b, c);
      if (region.length < 6) break;
    }
    if (region.length < 6) continue;
    let piece = outline;
    const corners = region.length / 2;
    for (let at = 0; at < corners && piece.length >= 6; at += 1) {
      const [ax, ay] = [region[at * 2]!, region[at * 2 + 1]!];
      const [bx, by] = [region[((at + 1) % corners) * 2]!, region[((at + 1) % corners) * 2 + 1]!];
      // Keep the side the region lies on: left of each of its edges, counter-clockwise.
      piece = clipHalf(piece, by - ay, ax - bx, -(by - ay) * ax - (ax - bx) * ay);
    }
    if (piece.length < 6 || Math.abs(ringArea(piece)) < 1e-6) continue;
    const ring: number[] = [];
    for (let at = 0; at < piece.length; at += 2) ring.push(...tile(piece[at]!, piece[at + 1]!));
    const triangles = earcut(ring);
    if (triangles.length === 0) continue;
    // The plane's slope in the tile, per metre; its normal tilts against it.
    const gu = rise * plane[0];
    const gv = rise * plane[1];
    const gx = gu * u[0] + gv * v[0];
    const gy = gu * u[1] + gv * v[1];
    const length = Math.hypot(gx, gy, 1);
    faces.push({ring, triangles, normal: [-gx / length, -gy / length]});
  }
  if (faces.length === 0) return undefined;

  return {
    eaves,
    ridge,
    faces,
    heightAt,
    breaks(ax, ay, bx, by) {
      const [au, av] = local(ax, ay);
      const [bu, bv] = local(bx, by);
      const shares: number[] = [];
      for (let i = 0; i < planes.length; i += 1)
        for (let j = i + 1; j < planes.length; j += 1) {
          const f = (pu: number, pv: number) =>
            (planes[i]![0] - planes[j]![0]) * pu +
            (planes[i]![1] - planes[j]![1]) * pv +
            (planes[i]![2] - planes[j]![2]);
          const fa = f(au, av);
          const fb = f(bu, bv);
          if (fa === fb || fa * fb > 0) continue;
          const share = fa / (fa - fb);
          if (share <= 1e-4 || share >= 1 - 1e-4) continue;
          const pu = au + (bu - au) * share;
          const pv = av + (bv - av) * share;
          const value = planes[i]![0] * pu + planes[i]![1] * pv + planes[i]![2];
          // A crossing that matters lies on the roof itself, where both planes are lowest.
          if (value <= envelope(pu, pv) + 1e-6) shares.push(share);
        }
      return [...new Set(shares.map((share) => Math.round(share * 1e6) / 1e6))].sort(
        (a, b) => a - b,
      );
    },
  };
}

/** The roof's rise where its height is not stated: about the pitch roofs of its shape have. */
function defaultRise(shape: string, halfV: number): number {
  switch (shape) {
    case 'skillion':
      return 2 * halfV * tan10;
    case 'pyramidal':
      return halfV * tan35;
    case 'gambrel':
    case 'mansard':
      return halfV * 0.8;
    case 'dome':
    case 'onion':
    case 'round':
      return halfV;
    default:
      return halfV * tan30;
  }
}

/** The planes whose lowest is the roof, each a share of its height; undefined for no shape. */
function planesOf(
  shape: string,
  halfU: number,
  halfV: number,
  downhill: readonly [number, number] | undefined,
): Plane[] | undefined {
  const L = halfU;
  const W = halfV;
  const gable: Plane[] = [
    [0, -1 / W, 1],
    [0, 1 / W, 1],
  ];
  const broken = (sides: readonly ('u' | 'v')[]): Plane[] =>
    sides.flatMap((side) =>
      [1, -1].flatMap((sign): Plane[] => {
        // Distance to the side: half its extent less the coordinate across it.
        const half = side === 'v' ? W : L;
        const steep = (breakHeight / (breakWidth * W)) * sign;
        const gentle = ((1 - breakHeight) / ((1 - breakWidth) * W)) * sign;
        const along = (k: number): [number, number] => (side === 'v' ? [0, -k] : [-k, 0]);
        return [
          [...along(steep), (breakHeight / (breakWidth * W)) * half],
          [
            ...along(gentle),
            breakHeight + ((1 - breakHeight) / ((1 - breakWidth) * W)) * (half - breakWidth * W),
          ],
        ];
      }),
    );
  // Tangent planes of a curved roof, at these shares of its radius.
  const curve = [0.99, 0.8, 0.5, 0.2];
  switch (shape) {
    case 'gabled':
      return gable;
    case 'saltbox': {
      const ridge = W / 3;
      return [
        [0, -1 / (W - ridge), 1 + ridge / (W - ridge)],
        [0, 1 / (W + ridge), 1 - ridge / (W + ridge)],
      ];
    }
    case 'hipped':
      return [...gable, [-1 / W, 0, L / W], [1 / W, 0, L / W]];
    case 'half_hipped':
      return [...gable, [-1 / W, 0, 0.5 + L / W], [1 / W, 0, 0.5 + L / W]];
    case 'pyramidal':
      return [...gable, [-1 / L, 0, 1], [1 / L, 0, 1]];
    case 'gambrel':
      return broken(['v']);
    case 'mansard':
      return broken(['v', 'u']);
    case 'skillion': {
      // Down the stated direction, else across the building.
      const [du, dv] = downhill ?? [0, 1];
      const reach = Math.abs(du) * L + Math.abs(dv) * W;
      if (!(reach > 0)) return undefined;
      return [[-du / (2 * reach), -dv / (2 * reach), 0.5]];
    }
    case 'round':
      return [
        [0, 0, 1],
        ...curve.flatMap((r) => {
          const z = Math.sqrt(1 - r * r);
          return [1, -1].map((sign): Plane => [0, (-sign * r) / (W * z), 1 / z]);
        }),
      ];
    case 'dome':
    case 'onion':
      // Capped at the top, which the tangent planes overshoot between them.
      return [
        [0, 0, 1],
        ...curve.flatMap((r) => {
          const z = Math.sqrt(1 - r * r);
          return Array.from({length: 12}, (_, k): Plane => {
            const angle = (k * Math.PI) / 6;
            return [(-r * Math.cos(angle)) / (L * z), (-r * Math.sin(angle)) / (W * z), 1 / z];
          });
        }),
      ];
    default:
      return undefined;
  }
}

/** The ring's points where a·x + b·y + c ≤ 0, as a ring. */
function clipHalf(ring: readonly number[], a: number, b: number, c: number): number[] {
  const points = ring.length / 2;
  const out: number[] = [];
  for (let at = 0; at < points; at += 1) {
    const ax = ring[at * 2]!;
    const ay = ring[at * 2 + 1]!;
    const bx = ring[((at + 1) % points) * 2]!;
    const by = ring[((at + 1) % points) * 2 + 1]!;
    const fa = a * ax + b * ay + c;
    const fb = a * bx + b * by + c;
    if (fa <= 0) out.push(ax, ay);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const share = fa / (fa - fb);
      out.push(ax + (bx - ax) * share, ay + (by - ay) * share);
    }
  }
  return out;
}

type Rectangle = {
  centre: [number, number];
  u: [number, number];
  v: [number, number];
  halfU: number;
  halfV: number;
};

/** The smallest rectangle around a ring, by rotating its convex hull's edges. */
function smallestRectangle(ring: readonly number[]): Rectangle | undefined {
  const hull = convexHull(ring);
  if (hull.length < 3) return undefined;
  let best: Rectangle | undefined;
  let bestArea = Infinity;
  for (let at = 0; at < hull.length; at += 1) {
    const [ax, ay] = hull[at]!;
    const [bx, by] = hull[(at + 1) % hull.length]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const u: [number, number] = [(bx - ax) / length, (by - ay) / length];
    const v: [number, number] = [-u[1], u[0]];
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of hull) {
      const pu = x * u[0] + y * u[1];
      const pv = x * v[0] + y * v[1];
      minU = Math.min(minU, pu);
      maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv);
      maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const mu = (minU + maxU) / 2;
      const mv = (minV + maxV) / 2;
      best = {
        centre: [mu * u[0] + mv * v[0], mu * u[1] + mv * v[1]],
        u,
        v,
        halfU: (maxU - minU) / 2,
        halfV: (maxV - minV) / 2,
      };
    }
  }
  return best && best.halfU > 0 && best.halfV > 0 ? best : undefined;
}

function convexHull(ring: readonly number[]): [number, number][] {
  const points: [number, number][] = [];
  for (let at = 0; at + 1 < ring.length; at += 2) points.push([ring[at]!, ring[at + 1]!]);
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (const point of points.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Whether the tile cut the building short: it reaches past the tile and one of its sides lies on
 * the farthest line it reaches there, as the tile's buffer cuts it.
 */
function truncated(ring: readonly number[], extent: number): boolean {
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let at = 0; at + 1 < ring.length; at += 2) {
    minX = Math.min(minX, ring[at]!);
    maxX = Math.max(maxX, ring[at]!);
    minY = Math.min(minY, ring[at + 1]!);
    maxY = Math.max(maxY, ring[at + 1]!);
  }
  const points = ring.length / 2;
  for (let at = 0; at < points; at += 1) {
    const ax = ring[at * 2]!;
    const ay = ring[at * 2 + 1]!;
    const bx = ring[((at + 1) % points) * 2]!;
    const by = ring[((at + 1) % points) * 2 + 1]!;
    if (minX < 0 && ax === minX && bx === minX) return true;
    if (maxX > extent && ax === maxX && bx === maxX) return true;
    if (minY < 0 && ay === minY && by === minY) return true;
    if (maxY > extent && ay === maxY && by === maxY) return true;
  }
  return false;
}

function ringArea(ring: readonly number[]): number {
  let sum = 0;
  const points = ring.length / 2;
  for (let at = 0; at < points; at += 1) {
    const next = (at + 1) % points;
    sum += ring[at * 2]! * ring[next * 2 + 1]! - ring[next * 2]! * ring[at * 2 + 1]!;
  }
  return sum / 2;
}

function reverse(ring: number[]): void {
  const pairs: number[][] = [];
  for (let at = 0; at < ring.length; at += 2) pairs.push([ring[at]!, ring[at + 1]!]);
  pairs.reverse();
  ring.splice(0, ring.length, ...pairs.flat());
}

function dot(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}

function finite(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}
