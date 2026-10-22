// A building model a map places in its 3D city, such as a landmark or an application's own
// building: one to three levels of detail, each an indexed mesh in metres round the model's origin
// (where it stands on the ground; x east, y north and z up before its heading), whose vertices carry
// their part, a shade and their occlusion, and the footprint the model replaces on the ground.
// Tileflow's Node tooling prepares the glTF binaries a map declares, and its landmarks, into
// prepared model files (models-3d-file.ts) that travel beside the compiled style or in the landmarks
// tileset and are downloaded only near the camera. It has no DOM dependency.
import type {TileflowModelSurface} from './models-3d-materials';

/** The parts of a model, each coloured by the theme: the model's materials name them. */
export const tileflowModelParts = Object.freeze({
  surface: 0,
  secondary: 1,
  glass: 2,
  accent: 3,
  roof: 4,
  water: 5,
  vegetation: 6,
  wood: 7,
});

export type TileflowModelPart = keyof typeof tileflowModelParts;

export const tileflowModelPartCount = Object.keys(tileflowModelParts).length;

/** Architectural roles control lighting independently of the model's palette slots. */
export const tileflowModelLightingRoles = Object.freeze({
  unclassified: 0,
  wall: 1,
  door: 2,
  roof: 3,
  window: 4,
  lamp: 5,
  logo: 6,
});

export type TileflowModelLightingRole = keyof typeof tileflowModelLightingRoles;

/** Natural surfaces are unclassified; architectural parts retain their original role mapping. */
export const tileflowModelDefaultLightingRoles = Object.freeze([1, 1, 4, 1, 3, 0, 0, 0] as const);

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
  /** Models in one prepared file, as a landmark tile holds them. */
  models: 512,
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
  /** Optional architectural role per vertex; absent roles use the palette slot's legacy mapping. */
  lightingRoles?: readonly number[];
  /** Each vertex's shade within its part's colour, from -1 (darkest) to 1 (lightest). */
  shades: readonly number[];
  /** Each vertex's light, from 0 (fully occluded) to 1. */
  occlusion: readonly number[];
  /** Three vertex indices per triangle. */
  indices: readonly number[];
  /** Optional physical materials and their independent texture coordinates. */
  surface?: TileflowModelSurface;
}>;

/** A prepared model: its levels, nearest first, and the footprint it replaces on the ground. */
export type TileflowModel = Readonly<{
  levels: readonly TileflowModelMesh[];
  /**
   * Closed rings on the ground, in metres round the origin as `[x, y, x, y, …]`: the outline of
   * what the model stands in for. The map's own buildings that reach into it are not raised while
   * the model stands.
   */
  footprint: readonly (readonly number[])[];
}>;

/** A decoded level, ready for the GPU: its vertex bytes as the file holds them. */
export type TileflowModelLevelBytes = Readonly<{
  /**
   * 16 bytes a vertex, in glTF's axes (x east, y up, z south): its position as whole steps from
   * `centre` (int16 ×3, then two bytes of padding), its normal (int8 ×3, then one), and its part,
   * shade and light (uint8 ×3, then one).
   */
  vertices: Uint8Array;
  indices: Uint16Array | Uint32Array;
  /** The point the positions count from, in glTF's axes, in metres. */
  centre: readonly [number, number, number];
  /** Metres in one step of a position. */
  step: number;
  /** Optional physical data; absent data retains the legacy palette lighting. */
  surface?: TileflowModelSurface & {attributes: Float32Array};
}>;

/** A decoded model, as the renderer draws it. */
export type TileflowModelBytes = Readonly<{
  /** The model's id. */
  id: string;
  /** Its bounds in metres round its origin, `[minX, minY, minZ, maxX, maxY, maxZ]` (x east, y north, z up). */
  bounds: readonly [number, number, number, number, number, number];
  levels: readonly TileflowModelLevelBytes[];
  footprint: readonly (readonly number[])[];
  /** Where it stands, longitude and latitude, when the file says so, as a landmark tile does. */
  at?: readonly [number, number];
  /** Degrees clockwise from north its own north is turned to, when the file says so. */
  heading?: number;
}>;

/** Bytes per vertex in a model file and on the GPU. */
export const tileflowModelVertexBytes = 16;

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

/**
 * Whether the rings `outline` (a building's) reach more than `margin` into any of the rings
 * `footprints` (the models'), all as `[x, y, x, y, …]` in the same units: a corner of one deep
 * inside the other, or an edge passing through it. A building that only touches a footprint, as a
 * neighbour sharing a wall does, does not.
 */
export function tileflowRingsOverlap(
  outline: readonly (readonly number[])[],
  footprints: readonly (readonly number[])[],
  margin: number,
): boolean {
  for (const footprint of footprints) {
    const [fl, ft, fr, fb] = boxOf(footprint);
    for (const ring of outline) {
      const [left, top, right, bottom] = boxOf(ring);
      if (left > fr - margin || right < fl + margin || top > fb - margin || bottom < ft + margin)
        continue;
      if (reachesInto(ring, footprint, margin) || reachesInto(footprint, ring, margin)) return true;
    }
  }
  return false;
}

/** Whether a corner, or a stretch of an edge, of `ring` lies deeper than `margin` inside `into`. */
function reachesInto(ring: readonly number[], into: readonly number[], margin: number): boolean {
  const deep = (x: number, y: number) =>
    tileflowInsideRings([into], x, y) && distanceToRing(into, x, y) > margin;
  for (let a = 0; a + 1 < ring.length; a += 2) if (deep(ring[a]!, ring[a + 1]!)) return true;
  // An edge that passes through without a corner inside: the middle of each stretch between its
  // crossings of the other ring's edges.
  for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
    const [ax, ay, bx, by] = [ring[b]!, ring[b + 1]!, ring[a]!, ring[a + 1]!];
    const cuts = [0, 1];
    for (let c = 0, d = into.length - 2; c < into.length; d = c, c += 2) {
      const t = crossingOf(ax, ay, bx, by, into[d]!, into[d + 1]!, into[c]!, into[c + 1]!);
      if (t !== undefined) cuts.push(t);
    }
    if (cuts.length === 2) continue;
    cuts.sort((p, q) => p - q);
    for (let at = 1; at < cuts.length; at += 1) {
      const t = (cuts[at - 1]! + cuts[at]!) / 2;
      if (deep(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
    }
  }
  return false;
}

/** Where along a→b the segment c→d crosses it, from 0 to 1, or undefined when it does not. */
function crossingOf(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number | undefined {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denominator;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

function distanceToRing(ring: readonly number[], px: number, py: number): number {
  let nearest = Infinity;
  for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
    const [ax, ay, bx, by] = [ring[b]!, ring[b + 1]!, ring[a]!, ring[a + 1]!];
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t =
      length > 0
        ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length))
        : 0;
    nearest = Math.min(nearest, Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t)));
  }
  return nearest;
}

function boxOf(ring: readonly number[]): [number, number, number, number] {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 1 < ring.length; at += 2) {
    left = Math.min(left, ring[at]!);
    right = Math.max(right, ring[at]!);
    top = Math.min(top, ring[at + 1]!);
    bottom = Math.max(bottom, ring[at + 1]!);
  }
  return [left, top, right, bottom];
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
