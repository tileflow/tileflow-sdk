// The ground that placed models and landmarks stand in for, for the compiled building extrusion
// drawn while Core's building scene is not ready. The scene's mesh leaves out every building that
// reaches more than half a metre into a model's footprint; the extrusion must leave out the same
// buildings, or the parts a landmark replaces stand round it until the scene can draw.

const earth = 40_075_016.686;

/** How deep, in metres, a building must reach into a footprint to be left to its model. */
export const tileflowStandInMargin = 0.5;

/** A footprint a model stands in for: rings of `[east, north, …]` metres round its placement. */
export type TileflowStandIn = Readonly<{
  placement: Readonly<{at: readonly [number, number]; heading: number}>;
  footprint: readonly (readonly number[])[];
}>;

/** The ground models stand in for, as a GeoJSON MultiPolygon of `[longitude, latitude]`. */
export type TileflowStandInArea = Readonly<{
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}>;

/**
 * The footprints, each ring drawn in by `margin` metres, as one area. A building that only
 * touches a footprint, as a neighbour sharing a wall does, stays clear of it. Undefined when no
 * footprint has an inside deeper than the margin.
 */
export function tileflowStandInArea(
  standIns: readonly TileflowStandIn[],
  margin = tileflowStandInMargin,
): TileflowStandInArea | undefined {
  const coordinates: [number, number][][][] = [];
  // In a fixed order, so the same footprints make the same area whichever arrived first.
  const ordered = [...standIns].sort(
    (a, b) => a.placement.at[0] - b.placement.at[0] || a.placement.at[1] - b.placement.at[1],
  );
  for (const {placement, footprint} of ordered) {
    const [lng, lat] = placement.at;
    const turn = (placement.heading * Math.PI) / 180;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const perLng = (earth * Math.cos((lat * Math.PI) / 180)) / 360;
    const perLat = earth / 360;
    for (const ring of footprint) {
      const inner = insetRing(ring, margin);
      if (!inner) continue;
      const out: [number, number][] = [];
      for (let at = 0; at + 1 < inner.length; at += 2) {
        // Turned clockwise seen from above, as the model is: north swings towards east.
        const east = inner[at]! * cos + inner[at + 1]! * sin;
        const north = -inner[at]! * sin + inner[at + 1]! * cos;
        out.push([lng + east / perLng, lat + north / perLat]);
      }
      out.push([...out[0]!]);
      coordinates.push([out]);
    }
  }
  return coordinates.length > 0 ? {type: 'MultiPolygon', coordinates} : undefined;
}

/**
 * Whether two areas cover the same ground to within `tolerance` degrees, about 10 cm by default: a
 * landmark's footprint as its region's index names it, rounded to decimetres, and as its model
 * names it are the same.
 */
export function tileflowSameStandInArea(
  a: TileflowStandInArea | undefined,
  b: TileflowStandInArea | undefined,
  tolerance = 1e-6,
): boolean {
  if (!a || !b) return a === b;
  if (a.coordinates.length !== b.coordinates.length) return false;
  return a.coordinates.every((polygon, p) => {
    const other = b.coordinates[p]!;
    return (
      polygon.length === other.length &&
      polygon.every((ring, r) => {
        const otherRing = other[r]!;
        return (
          ring.length === otherRing.length &&
          ring.every(
            ([lng, lat], at) =>
              Math.abs(lng - otherRing[at]![0]) <= tolerance &&
              Math.abs(lat - otherRing[at]![1]) <= tolerance,
          )
        );
      })
    );
  });
}

/**
 * The compiled extrusion's filter with the buildings under `area` left out. Without an area it is
 * the authored filter unchanged.
 */
export function tileflowNativeBuildingsFilter(
  authored: unknown,
  area: TileflowStandInArea | undefined,
): unknown {
  if (!area) return authored;
  const clear = ['>', ['distance', area], 0];
  return authored === undefined || authored === null ? clear : ['all', authored, clear];
}

/**
 * A ring of `[x, y, …]` metres drawn in by `margin` towards its inside, or undefined when it has
 * no inside that deep. A closing point that repeats the first is ignored.
 */
function insetRing(ring: readonly number[], margin: number): number[] | undefined {
  const points: [number, number][] = [];
  for (let at = 0; at + 1 < ring.length; at += 2) {
    const point: [number, number] = [ring[at]!, ring[at + 1]!];
    const last = points.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  const first = points[0];
  const last = points.at(-1);
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1])
    points.pop();
  if (points.length < 3) return undefined;
  const area = signedArea(points);
  if (area === 0) return undefined;
  // The inside lies to the left of each edge of an anticlockwise ring, to the right otherwise.
  const side = area > 0 ? 1 : -1;
  const out: number[] = [];
  for (let at = 0; at < points.length; at += 1) {
    const [px, py] = points[(at + points.length - 1) % points.length]!;
    const [x, y] = points[at]!;
    const [nx, ny] = points[(at + 1) % points.length]!;
    const [ax, ay] = inwardNormal(x - px, y - py, side);
    const [bx, by] = inwardNormal(nx - x, ny - y, side);
    // The corner moves along the bisector so that both edges move in by the margin; a sharp
    // corner moves at most four margins.
    const bend = Math.max(1 + ax * bx + ay * by, 0.125);
    out.push(x + ((ax + bx) / bend) * margin, y + ((ay + by) / bend) * margin);
  }
  const inner: [number, number][] = [];
  for (let at = 0; at + 1 < out.length; at += 2) inner.push([out[at]!, out[at + 1]!]);
  const innerArea = signedArea(inner);
  // A ring narrower than twice the margin turns inside out.
  if (Math.sign(innerArea) !== Math.sign(area) || Math.abs(innerArea) >= Math.abs(area))
    return undefined;
  return out;
}

function inwardNormal(dx: number, dy: number, side: number): [number, number] {
  const length = Math.hypot(dx, dy);
  return [(-dy / length) * side, (dx / length) * side];
}

function signedArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let at = 0, before = points.length - 1; at < points.length; before = at, at += 1)
    sum += points[before]![0] * points[at]![1] - points[at]![0] * points[before]![1];
  return sum / 2;
}
