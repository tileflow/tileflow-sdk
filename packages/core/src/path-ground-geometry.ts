import {decodeTileflowVectorTile, type TileflowTileFeature} from './vector-tile-decode';

export type PathGroundBindings = {
  road: string;
  landcover: string;
  landuse: string;
  class: string;
  subclass: string;
  brunnel: string;
};
type Point = readonly [number, number];
type Polygon = {rings: readonly (readonly number[])[]; bounds: readonly number[]};
const coverClasses = new Set(['grass', 'wood', 'forest', 'wetland']);
const useClasses = new Set(['cemetery', 'pitch', 'track', 'playground', 'zoo']);
const pathClasses = new Set([
  'footway',
  'path',
  'bridleway',
  'corridor',
  'pedestrian',
  'steps',
  'cycleway',
]);

/** Derive only the portions of surface paths lying on mapped green ground. */
export function deriveTileflowGreenPaths(
  bytes: Uint8Array,
  bindings: PathGroundBindings,
): Uint8Array {
  const tile = decodeTileflowVectorTile(bytes, {
    layers: [bindings.road, bindings.landcover, bindings.landuse],
  });
  const road = tile[bindings.road];
  if (!road) return encodeLines(bindings.road, 4096, []);
  const polygons: Polygon[] = [];
  for (const name of [bindings.landcover, bindings.landuse]) {
    const layer = tile[name];
    if (!layer) continue;
    for (const feature of layer.features) {
      const kind = String(feature.properties[bindings.class]);
      const subclass = String(feature.properties[bindings.subclass]);
      const green =
        name === bindings.landcover
          ? coverClasses.has(kind) ||
            (kind === 'farmland' && ['orchard', 'plant_nursery'].includes(subclass))
          : useClasses.has(kind);
      if (feature.type !== 'Polygon' || !green) continue;
      let current: number[][] | undefined;
      for (const raw of feature.geometry) {
        const ring = raw.map((n) => (n * road.extent) / layer.extent);
        // MVT exteriors are clockwise in screen coordinates; each starts a polygon.
        // Keeping separate polygons makes overlapping garden areas a union, not holes.
        if (signedArea(ring) > 0 || !current) {
          current = [ring];
          polygons.push({rings: current, bounds: boundsOf(ring)});
        } else current.push(ring);
      }
    }
  }
  const features: TileflowTileFeature[] = [];
  for (const feature of road.features) {
    const p = feature.properties;
    if (
      feature.type !== 'LineString' ||
      !['path', 'path_construction'].includes(String(p[bindings.class])) ||
      !pathClasses.has(String(p[bindings.subclass])) ||
      ['bridge', 'tunnel'].includes(String(p[bindings.brunnel]))
    )
      continue;
    const geometry = feature.geometry.flatMap((line) => clipLineToGreen(line, polygons));
    if (geometry.length) features.push({...feature, geometry});
  }
  return encodeLines(bindings.road, road.extent, features);
}

function signedArea(ring: readonly number[]) {
  let area = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
    area += ring[j]! * ring[i + 1]! - ring[i]! * ring[j + 1]!;
  return area / 2;
}
function boundsOf(line: readonly number[]) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < line.length; i += 2) {
    box[0] = Math.min(box[0]!, line[i]!);
    box[1] = Math.min(box[1]!, line[i + 1]!);
    box[2] = Math.max(box[2]!, line[i]!);
    box[3] = Math.max(box[3]!, line[i + 1]!);
  }
  return box;
}
function overlaps(a: readonly number[], b: readonly number[]) {
  return a[0]! <= b[2]! && a[2]! >= b[0]! && a[1]! <= b[3]! && a[3]! >= b[1]!;
}
function insideRing(point: Point, ring: readonly number[]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j]!,
      ay = ring[j + 1]!,
      bx = ring[i]!,
      by = ring[i + 1]!;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(cross) < 1e-7 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function clipLineToGreen(line: readonly number[], all: readonly Polygon[]): number[][] {
  const polygons = all.filter((polygon) => overlaps(boundsOf(line), polygon.bounds));
  if (!polygons.length) return [];
  const output: number[][] = [];
  let active: number[] | undefined;
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2]!,
      ay = line[i - 1]!,
      dx = line[i]! - ax,
      dy = line[i + 1]! - ay;
    if (dx === 0 && dy === 0) continue;
    const cuts = [0, 1];
    for (const polygon of polygons)
      for (const ring of polygon.rings)
        for (let k = 0, j = ring.length - 2; k < ring.length; j = k, k += 2) {
          const bx = ring[j]!,
            by = ring[j + 1]!,
            ex = ring[k]! - bx,
            ey = ring[k + 1]! - by;
          const denominator = dx * ey - dy * ex;
          if (Math.abs(denominator) < 1e-10) continue;
          const t = ((bx - ax) * ey - (by - ay) * ex) / denominator;
          const u = ((bx - ax) * dy - (by - ay) * dx) / denominator;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
        }
    cuts.sort((a, b) => a - b);
    for (let k = 1; k < cuts.length; k++) {
      const lo = cuts[k - 1]!,
        hi = cuts[k]!;
      if (hi - lo < 1e-9) continue;
      const mid = (lo + hi) / 2;
      const point: Point = [ax + dx * mid, ay + dy * mid];
      const inside = polygons.some(
        (p) =>
          insideRing(point, p.rings[0]!) &&
          !p.rings.slice(1).some((hole) => insideRing(point, hole)),
      );
      if (!inside) {
        active = undefined;
        continue;
      }
      const start = [Math.round(ax + dx * lo), Math.round(ay + dy * lo)];
      const end = [Math.round(ax + dx * hi), Math.round(ay + dy * hi)];
      if (start[0] === end[0] && start[1] === end[1]) continue;
      if (!active || active.at(-2) !== start[0] || active.at(-1) !== start[1]) {
        active = [...start];
        output.push(active);
      }
      active.push(...end);
    }
  }
  return output;
}

// Small MVT writer: this derived layer contains lines and scalar properties only.
class Writer {
  bytes: number[] = [];
  uint(n: number) {
    while (n > 127) {
      this.bytes.push((n % 128) | 128);
      n = Math.floor(n / 128);
    }
    this.bytes.push(n);
  }
  field(tag: number, value: number) {
    this.uint(tag * 8);
    this.uint(value);
  }
  message(tag: number, value: Uint8Array | number[]) {
    this.uint(tag * 8 + 2);
    this.uint(value.length);
    for (const n of value) this.bytes.push(n);
  }
  text(tag: number, value: string) {
    this.message(tag, new TextEncoder().encode(value));
  }
}
function zigzag(n: number) {
  return n < 0 ? -n * 2 - 1 : n * 2;
}
/** Internal encoder also used to exercise clipping with complete synthetic tiles. */
export function encodeTileflowPathLayer(
  name: string,
  extent: number,
  features: readonly TileflowTileFeature[],
): Uint8Array {
  return encodeLines(name, extent, features);
}
function encodeLines(
  name: string,
  extent: number,
  features: readonly TileflowTileFeature[],
): Uint8Array {
  const layer = new Writer();
  layer.text(1, name);
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const keyMap = new Map<string, number>(),
    valueMap = new Map<string, number>();
  for (const feature of features) {
    const message = new Writer(),
      tags = new Writer(),
      geometry = new Writer();
    if (feature.id !== undefined) message.field(1, feature.id);
    for (const [key, value] of Object.entries(feature.properties)) {
      if (!keyMap.has(key)) {
        keyMap.set(key, keys.length);
        keys.push(key);
      }
      const identity = typeof value + ':' + value;
      if (!valueMap.has(identity)) {
        valueMap.set(identity, values.length);
        values.push(value);
      }
      tags.uint(keyMap.get(key)!);
      tags.uint(valueMap.get(identity)!);
    }
    message.message(2, tags.bytes);
    message.field(3, feature.type === 'Polygon' ? 3 : 2);
    let x = 0,
      y = 0;
    for (const raw of feature.geometry) {
      const points =
        feature.type === 'Polygon' && raw[0] === raw.at(-2) && raw[1] === raw.at(-1)
          ? raw.slice(0, -2)
          : raw;
      if (points.length < 4) continue;
      geometry.uint(9);
      geometry.uint(zigzag(Math.round(points[0]!) - x));
      geometry.uint(zigzag(Math.round(points[1]!) - y));
      x = Math.round(points[0]!);
      y = Math.round(points[1]!);
      geometry.uint((points.length / 2 - 1) * 8 + 2);
      for (let i = 2; i < points.length; i += 2) {
        const nx = Math.round(points[i]!),
          ny = Math.round(points[i + 1]!);
        geometry.uint(zigzag(nx - x));
        geometry.uint(zigzag(ny - y));
        x = nx;
        y = ny;
      }
      if (feature.type === 'Polygon') geometry.uint(15);
    }
    message.message(4, geometry.bytes);
    layer.message(2, message.bytes);
  }
  for (const key of keys) layer.text(3, key);
  for (const value of values) {
    const message = new Writer();
    if (typeof value === 'string') message.text(1, value);
    else if (typeof value === 'boolean') message.field(7, value ? 1 : 0);
    else if (Number.isSafeInteger(value)) {
      message.field(value < 0 ? 6 : 4, value < 0 ? zigzag(value) : value);
    } else {
      message.uint(25);
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, value, true);
      message.bytes.push(...b);
    }
    layer.message(4, message.bytes);
  }
  layer.field(5, extent);
  layer.field(15, 2);
  const tile = new Writer();
  tile.message(3, layer.bytes);
  return new Uint8Array(tile.bytes);
}
