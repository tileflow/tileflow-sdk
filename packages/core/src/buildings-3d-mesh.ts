// Meshes a vector tile's buildings for Tileflow's 3D buildings renderer: roofs triangulated, walls
// as quads facing out of each building, each vertex packed in 28 bytes. A mesh lists its roofs'
// triangles first and its walls' after `wallsFrom`, so the renderer can draw the walls again, laid on
// the ground, as the band of contact shadow at their foot. It has no DOM dependency.
import earcut from 'earcut';
import type {TileflowTileLayer} from './vector-tile-decode';

/** The renderer's tile units: MapLibre projects custom layers' tiles over 8192. */
export const tileflowBuildingExtent = 8192;
/** Bytes per vertex; see `meshTileflowBuildings` for the layout. */
export const tileflowBuildingVertexBytes = 28;

/** World's `building_tone`, which the renderer uses to choose the buildings it flood-lights. */
const tones: Readonly<Record<string, number>> = {commercial: 1, active: 2, destination: 3};
/** World's `night_use`: the strongest night use of the places a building holds. */
const nightUses: Readonly<Record<string, number>> = {dining: 1, entertainment: 2, nightlife: 3};
/**
 * The night use of a place from its type, as World's `night_use` ranks it, for tiles whose buildings
 * do not carry it: bars and clubs, then theatres and cinemas, then places to eat.
 */
const placeNightUses: Readonly<Record<string, number>> = {
  ...Object.fromEntries(
    [
      'alcoholic_beverage_venue',
      'bar',
      'beer',
      'biergarten',
      'brewery',
      'casino',
      'cocktail_bar',
      'dance_club',
      'karaoke',
      'lounge',
      'music_venue',
      'night_club',
      'nightclub',
      'pub',
      'wine_bar',
    ].map((type) => [type, 3]),
  ),
  ...Object.fromEntries(
    [
      'arts_centre',
      'bowling_alley',
      'cinema',
      'comedy_club',
      'concert_hall',
      'movie_theater',
      'opera',
      'performing_arts_venue',
      'theater',
      'theatre',
      'theatre_venue',
    ].map((type) => [type, 2]),
  ),
  ...Object.fromEntries(
    ['casual_eatery', 'fast_food', 'fast_food_restaurant', 'food_court', 'restaurant'].map(
      (type) => [type, 1],
    ),
  ),
};
// A place this close to a building it is not inside, in metres, stands on its facade.
const facadeReach = 6;
// Where two walls meet at less than 150° in the open air, the corner is tight: the sine of the turn.
const cornerTurn = 0.5;

export type TileflowBuildingMeshOptions = Readonly<{
  /** The tile's width in metres, for the length of each wall. */
  tileMetres: number;
  /** Height used where a building has none, in metres; defaults to 5, World's own fallback. */
  defaultHeight?: number;
  /**
   * The tile's places (World's `poi` layer), for the night use of buildings when the tile's
   * buildings do not carry World's `night_use`: a place inside a building, or on its facade, gives
   * the building its use.
   */
  places?: TileflowTileLayer;
}>;

/** One tile's buildings, ready to upload. */
export type TileflowBuildingMesh = Readonly<{
  vertices: Uint8Array;
  indices: Uint32Array;
  /** The first wall index: roofs come before it, walls from it. */
  wallsFrom: number;
  /** The tallest building, in metres. */
  top: number;
  /** Each vertex's building is an index into these feature properties. */
  features: readonly Readonly<Record<string, string | number | boolean>>[];
}>;

/**
 * Meshes the buildings of one decoded tile layer, or returns undefined when it has none. It reads
 * World's `render_height`, `render_min_height`, `hide_3d`, `building_tone` and `night_use`. Vertex layout:
 * 0 position in the tile, 0 to 8192 (uint16 ×2); 4 base and top in decimetres (uint16 ×2); 8 the
 * wall's outward normal (int8 ×2, normalised); 10 raised to the top, part of a wall (uint8 ×2);
 * 12 decimetres along the wall (uint16); 14 a per-building jitter and seed (uint8 ×2, normalised);
 * 16 the building's centre in the tile (uint16 ×2); 20 tone and night use (uint8 ×2: none, dining,
 * entertainment, nightlife); 22 the wall's
 * tight corners, bit 0 at its start and bit 1 at its end, and bit 2 when it faces a courtyard, and
 * its length in metres up to 255
 * (uint8 ×2); 24 the building's feature index (uint16) and 26 reserved (uint16).
 */
export function meshTileflowBuildings(
  layer: TileflowTileLayer,
  options: TileflowBuildingMeshOptions,
): TileflowBuildingMesh | undefined {
  const scale = tileflowBuildingExtent / layer.extent;
  const fallback = options.defaultHeight ?? 5;
  const vertices = new VertexWriter();
  const roofs = new IndexWriter();
  const walls = new IndexWriter();
  const features: Readonly<Record<string, string | number | boolean>>[] = [];
  let tallest = 0;
  const uses = nightUsesOf(layer, options);

  for (const [featureIndex, feature] of layer.features.entries()) {
    if (feature.type !== 'Polygon' || features.length >= 65535) continue;
    const properties = feature.properties;
    const hidden = properties.hide_3d;
    if (hidden === true || hidden === 1 || hidden === '1' || hidden === 'true') continue;
    const height = Math.min(6000, positive(properties.render_height) ?? fallback);
    const base = Math.min(height, positive(properties.render_min_height) ?? 0);
    const tone = tones[String(properties.building_tone ?? '')] ?? 0;
    const use = uses.get(featureIndex) ?? 0;
    const index = features.length;
    let used = false;
    // A little of each building's own timing, the same for every piece of it a tile edge cuts.
    const jitter = hash(height * 7.31 + base * 3.17 + tone);
    for (const polygon of polygonsOf(feature.geometry, scale)) {
      const rings = polygon.map(clip).filter((ring) => ring.length >= 6);
      if (rings.length === 0 || area(rings[0]!) === 0) continue;
      used = true;
      tallest = Math.max(tallest, height);
      const [cx, cy] = centroid(rings[0]!);
      const seed = hash(cx * 0.0731 + cy * 0.19137 + index * 1.618);
      const building: Building = {base, top: height, jitter, seed, tone, use, cx, cy, index};

      // The roof.
      const flat: number[] = [];
      const holes: number[] = [];
      for (const ring of rings) {
        if (flat.length) holes.push(flat.length / 2);
        flat.push(...ring);
      }
      const first = vertices.count;
      for (let at = 0; at < flat.length; at += 2)
        vertices.write(building, flat[at]!, flat[at + 1]!, 1, 0, 0, 0, 0, 0, 0);
      for (const corner of earcut(flat, holes, 2)) roofs.push(first + corner);

      // The walls, facing out of the building: away from the outer ring, into each courtyard.
      // Edges along the tile's border are inside the building; the next tile carries it on.
      for (const [ringIndex, ring] of rings.entries()) {
        const left = area(ring) > 0;
        const outward = ringIndex === 0 ? (left ? -1 : 1) : left ? 1 : -1;
        const points = ring.length / 2;
        const point = (at: number): [number, number] => {
          const wrapped = ((at % points) + points) % points;
          return [ring[wrapped * 2]!, ring[wrapped * 2 + 1]!];
        };
        // Tight: the next wall turns towards this one's outward side, as at an L's inner corner.
        const tight = (at: number) => {
          const [px, py] = point(at - 1);
          const [qx, qy] = point(at);
          const [nx, ny] = point(at + 1);
          if (onBorder(px, py, qx, qy) || onBorder(qx, qy, nx, ny)) return false;
          const before = Math.hypot(qx - px, qy - py);
          const after = Math.hypot(nx - qx, ny - qy);
          if (!before || !after) return false;
          const outX = (-(qy - py) / before) * outward;
          const outY = ((qx - px) / before) * outward;
          return (outX * (nx - qx) + outY * (ny - qy)) / after > cornerTurn;
        };
        let along = 0;
        for (let at = 0; at < points; at += 1) {
          const [ax, ay] = point(at);
          const [bx, by] = point(at + 1);
          const length = Math.hypot(bx - ax, by - ay);
          if (length === 0 || onBorder(ax, ay, bx, by)) continue;
          const normalX = (-(by - ay) / length) * outward;
          const normalY = ((bx - ax) / length) * outward;
          const metres = (length / tileflowBuildingExtent) * options.tileMetres;
          const corners = (tight(at) ? 1 : 0) | (tight(at + 1) ? 2 : 0) | (ringIndex > 0 ? 4 : 0);
          const v = vertices.write(
            building,
            ax,
            ay,
            0,
            normalX,
            normalY,
            1,
            along,
            corners,
            metres,
          );
          vertices.write(building, bx, by, 0, normalX, normalY, 1, along + metres, corners, metres);
          vertices.write(building, ax, ay, 1, normalX, normalY, 1, along, corners, metres);
          vertices.write(building, bx, by, 1, normalX, normalY, 1, along + metres, corners, metres);
          walls.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
          along += metres;
        }
      }
    }
    if (used) features.push(properties);
  }
  if (vertices.count === 0) return undefined;
  const indices = new Uint32Array(roofs.length + walls.length);
  indices.set(roofs.values());
  indices.set(walls.values(), roofs.length);
  return {
    vertices: vertices.bytes(),
    indices,
    wallsFrom: roofs.length,
    top: tallest,
    features,
  };
}

type Building = {
  base: number;
  top: number;
  jitter: number;
  seed: number;
  tone: number;
  use: number;
  cx: number;
  cy: number;
  index: number;
};

class VertexWriter {
  #buffer = new ArrayBuffer(4096 * tileflowBuildingVertexBytes);
  #view = new DataView(this.#buffer);
  count = 0;

  write(
    building: Building,
    x: number,
    y: number,
    raised: number,
    normalX: number,
    normalY: number,
    wall: number,
    along: number,
    corners: number,
    length: number,
  ): number {
    const stride = tileflowBuildingVertexBytes;
    if ((this.count + 1) * stride > this.#buffer.byteLength) {
      const larger = new ArrayBuffer(this.#buffer.byteLength * 2);
      new Uint8Array(larger).set(new Uint8Array(this.#buffer));
      this.#buffer = larger;
      this.#view = new DataView(larger);
    }
    const view = this.#view;
    const at = this.count * stride;
    view.setUint16(at, clampUnit(x), true);
    view.setUint16(at + 2, clampUnit(y), true);
    view.setUint16(at + 4, Math.min(65535, Math.round(building.base * 10)), true);
    view.setUint16(at + 6, Math.min(65535, Math.round(building.top * 10)), true);
    view.setInt8(at + 8, Math.round(normalX * 127));
    view.setInt8(at + 9, Math.round(normalY * 127));
    view.setUint8(at + 10, raised);
    view.setUint8(at + 11, wall);
    view.setUint16(at + 12, Math.round(along * 10) % 65536, true);
    view.setUint8(at + 14, Math.round(building.jitter * 255));
    view.setUint8(at + 15, Math.round(building.seed * 255));
    view.setUint16(at + 16, clampUnit(building.cx), true);
    view.setUint16(at + 18, clampUnit(building.cy), true);
    view.setUint8(at + 20, building.tone);
    view.setUint8(at + 21, building.use);
    view.setUint8(at + 22, corners);
    view.setUint8(at + 23, Math.min(255, Math.round(length)));
    view.setUint16(at + 24, building.index, true);
    view.setUint16(at + 26, 0, true);
    this.count += 1;
    return this.count - 1;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.#buffer.slice(0, this.count * tileflowBuildingVertexBytes));
  }
}

class IndexWriter {
  #array = new Uint32Array(8192);
  length = 0;

  push(...values: number[]): void {
    if (this.length + values.length > this.#array.length) {
      const larger = new Uint32Array(Math.max(this.length + values.length, this.#array.length * 2));
      larger.set(this.#array);
      this.#array = larger;
    }
    for (const value of values) this.#array[this.length++] = value;
  }

  values(): Uint32Array {
    return this.#array.subarray(0, this.length);
  }
}

/**
 * Each building's night use by its index in the layer: World's `night_use` when the tile's buildings
 * carry it, or else the strongest use of the places inside each building or on its facade.
 */
function nightUsesOf(
  layer: TileflowTileLayer,
  options: TileflowBuildingMeshOptions,
): Map<number, number> {
  const uses = new Map<number, number>();
  if (layer.features.some((feature) => feature.properties.night_use !== undefined)) {
    for (const [index, feature] of layer.features.entries()) {
      const use = nightUses[String(feature.properties.night_use ?? '')];
      if (use) uses.set(index, use);
    }
    return uses;
  }
  const places = options.places;
  if (!places || places.features.length === 0) return uses;
  const reach = (facadeReach / options.tileMetres) * layer.extent;
  const shapes: {index: number; rings: readonly (readonly number[])[]; box: number[]}[] = [];
  for (const [index, feature] of layer.features.entries()) {
    if (feature.type !== 'Polygon') continue;
    const hidden = feature.properties.hide_3d;
    if (hidden === true || hidden === 1 || hidden === '1' || hidden === 'true') continue;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of feature.geometry)
      for (let at = 0; at + 1 < ring.length; at += 2) {
        box[0] = Math.min(box[0]!, ring[at]!);
        box[1] = Math.min(box[1]!, ring[at + 1]!);
        box[2] = Math.max(box[2]!, ring[at]!);
        box[3] = Math.max(box[3]!, ring[at + 1]!);
      }
    shapes.push({index, rings: feature.geometry, box});
  }
  const scale = layer.extent / places.extent;
  for (const place of places.features) {
    if (place.type !== 'Point') continue;
    const properties = place.properties;
    const use =
      placeNightUses[String(properties.type ?? '')] ??
      placeNightUses[String(properties.subclass ?? '')] ??
      placeNightUses[String(properties.class ?? '')];
    if (!use) continue;
    for (const points of place.geometry)
      for (let at = 0; at + 1 < points.length; at += 2) {
        const x = points[at]! * scale;
        const y = points[at + 1]! * scale;
        let holder: number | undefined;
        let nearest: number | undefined;
        let nearestDistance = reach;
        for (const shape of shapes) {
          const [left, top, right, bottom] = shape.box;
          if (x < left! - reach || x > right! + reach || y < top! - reach || y > bottom! + reach)
            continue;
          let inside = false;
          for (const ring of shape.rings) {
            for (let at = 0, before = ring.length - 2; at + 1 < ring.length; before = at, at += 2) {
              const ax = ring[before]!;
              const ay = ring[before + 1]!;
              const bx = ring[at]!;
              const by = ring[at + 1]!;
              if (by > y !== ay > y && x < ((ax - bx) * (y - by)) / (ay - by) + bx)
                inside = !inside;
              const dx = bx - ax;
              const dy = by - ay;
              const length = dx * dx + dy * dy;
              const t = length
                ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length))
                : 0;
              const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy);
              if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = shape.index;
              }
            }
          }
          if (inside) {
            holder = shape.index;
            break;
          }
        }
        const building = holder ?? nearest;
        if (building !== undefined) uses.set(building, Math.max(uses.get(building) ?? 0, use));
      }
  }
  return uses;
}

function clampUnit(value: number): number {
  return Math.min(tileflowBuildingExtent, Math.max(0, Math.round(value)));
}

function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** A feature's rings grouped into polygons: a ring wound like the first starts a new polygon. */
function polygonsOf(parts: readonly (readonly number[])[], scale: number): number[][][] {
  const polygons: number[][][] = [];
  let winding: number | undefined;
  for (const part of parts) {
    const ring: number[] = [];
    for (let at = 0; at + 1 < part.length; at += 2) {
      const x = part[at]! * scale;
      const y = part[at + 1]! * scale;
      if (ring.length && x === ring.at(-2) && y === ring.at(-1)) continue;
      ring.push(x, y);
    }
    if (ring.length >= 6 && ring[0] === ring.at(-2) && ring[1] === ring.at(-1)) ring.length -= 2;
    if (ring.length < 6) continue;
    const sign = Math.sign(area(ring));
    if (!sign) continue;
    winding ??= sign;
    if (sign === winding || polygons.length === 0) polygons.push([ring]);
    else polygons.at(-1)!.push(ring);
  }
  return polygons;
}

/** Twice the signed area of a flat ring. */
function area(ring: readonly number[]): number {
  let sum = 0;
  const points = ring.length / 2;
  for (let at = 0; at < points; at += 1) {
    const next = (at + 1) % points;
    sum += ring[at * 2]! * ring[next * 2 + 1]! - ring[next * 2]! * ring[at * 2 + 1]!;
  }
  return sum;
}

function centroid(ring: readonly number[]): [number, number] {
  let x = 0;
  let y = 0;
  const points = ring.length / 2;
  for (let at = 0; at < points; at += 1) {
    x += ring[at * 2]!;
    y += ring[at * 2 + 1]!;
  }
  return [x / points, y / points];
}

function onBorder(ax: number, ay: number, bx: number, by: number): boolean {
  const extent = tileflowBuildingExtent;
  return (
    (ax <= 0 && bx <= 0) ||
    (ax >= extent && bx >= extent) ||
    (ay <= 0 && by <= 0) ||
    (ay >= extent && by >= extent)
  );
}

/** A ring cut to the tile's square, one side at a time. */
function clip(ring: readonly number[]): number[] {
  const extent = tileflowBuildingExtent;
  let points: number[] = [...ring];
  const sides: [number, number, (value: number) => boolean][] = [
    [0, 0, (value) => value >= 0],
    [0, extent, (value) => value <= extent],
    [1, 0, (value) => value >= 0],
    [1, extent, (value) => value <= extent],
  ];
  for (const [axis, bound, keep] of sides) {
    const next: number[] = [];
    const count = points.length / 2;
    for (let at = 0; at < count; at += 1) {
      const a = [points[at * 2]!, points[at * 2 + 1]!];
      const b = [points[((at + 1) % count) * 2]!, points[((at + 1) % count) * 2 + 1]!];
      const inA = keep(a[axis]!);
      const inB = keep(b[axis]!);
      if (inA) next.push(a[0]!, a[1]!);
      if (inA !== inB) {
        const t = (bound - a[axis]!) / (b[axis]! - a[axis]!);
        next.push(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t);
      }
    }
    points = next;
    if (points.length < 6) return [];
  }
  return points;
}

/** A number from 0 to 1 that changes unpredictably with its input. */
function hash(value: number): number {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
