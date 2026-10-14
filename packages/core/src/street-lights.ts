// Places a vector tile's street lights for Tileflow's street lights layer: the lamps the map's data
// holds (World's `street_furniture` lamps, with their height, type and colour where mapped), and a
// soft light along the streets and pavements the data maps as lit but whose lamps it does not hold.
// Only on request is the same soft light estimated along streets the data says nothing about. It
// has no DOM dependency.
import {tileflowColourChannels} from './theme-blend';
import type {TileflowTileLayer} from './vector-tile-decode';

/** The layer's tile units, as for the 3D buildings: MapLibre projects custom layers over 8192. */
const extent = 8192;
/** Bytes per lamp; see `placeTileflowStreetLights` for the layout. */
export const tileflowStreetLightBytes = 12;

/**
 * Where light is estimated where the data maps no lamps: `lit` (the default) along the streets and
 * pavements the data maps as lit; `streets` also along the streets the data says nothing about,
 * wherever it maps few lamps, which invents light as night windows do; `none` nowhere, so only
 * mapped lamps shine.
 */
export type TileflowStreetLightEstimate = 'streets' | 'lit' | 'none';

export type TileflowStreetLightPlacementOptions = Readonly<{
  /** The tile's width in metres. */
  tileMetres: number;
  /** Defaults to `lit`. */
  estimate?: TileflowStreetLightEstimate;
}>;

/** A tile's layers the lamps come from, as World names them. */
export type TileflowStreetLightLayers = Readonly<{
  /** Points with `subclass` `street_lamp` (World's `street_furniture`). */
  streetFurniture?: TileflowTileLayer;
  /** Streets by `class`, with `lit` where mapped (World's `transportation`). */
  transportation?: TileflowTileLayer;
  /** Pavements, as lines or areas, with `lit` where mapped (World's `sidewalk`). */
  sidewalks?: TileflowTileLayer;
}>;

/** One tile's lamps, ready to upload. */
export type TileflowStreetLightPlacement = Readonly<{
  lamps: Uint8Array;
  /** Lamps from the data. */
  mapped: number;
  /** Points of soft light estimated along streets. */
  estimated: number;
}>;

// Streets that have lamps unless the data says otherwise: how far apart, staggered from one kerb
// to the other, and how far from the street's centre, in metres.
const streets: Readonly<Record<string, {spacing: number; kerb: number}>> = {
  primary: {spacing: 30, kerb: 10},
  secondary: {spacing: 32, kerb: 8.5},
  tertiary: {spacing: 34, kerb: 7},
  minor: {spacing: 36, kerb: 5.5},
  pedestrian: {spacing: 26, kerb: 3},
};
// Streets lit only where the data says so.
const litOnly: Readonly<Record<string, {spacing: number; kerb: number}>> = {
  motorway: {spacing: 45, kerb: 14},
  trunk: {spacing: 40, kerb: 12},
  service: {spacing: 38, kerb: 4},
  path: {spacing: 28, kerb: 1.5},
  track: {spacing: 40, kerb: 2.5},
};
const pavement = {spacing: 30, kerb: 0};
// A tile whose mapped lamps reach this many a kilometre of street is mapped: light is estimated
// there only along the streets mapped as lit, whatever the layer asks.
const mappedDensity = 12;
// No lamp is estimated this close to a mapped lamp or to another estimated lamp, in metres.
const mappedClearance = 18;
const estimatedClearance = 9;

const lampColours: Readonly<Record<string, string>> = {
  sodium: '#ffa64d',
  high_pressure_sodium: '#ffa64d',
  low_pressure_sodium: '#ff9326',
  led: '#fff1db',
  mercury: '#e3ecff',
  metal_halide: '#f4f4ff',
  fluorescent: '#eef9ff',
  electric: '#ffd59a',
  incandescent: '#ffd59a',
  halogen: '#ffe3b0',
  gas: '#ffd28a',
  gaslight: '#ffd28a',
};
const namedColours: Readonly<Record<string, string>> = {
  orange: '#ffa64d',
  yellow: '#ffd27a',
  warm_white: '#ffe2b8',
  white: '#fff4e6',
  cool_white: '#eef4ff',
  neutral_white: '#fff8f0',
  blue: '#b8d0ff',
  green: '#c4ffd0',
  red: '#ff9a8a',
};
const wallMounts = new Set(['wall', 'wall_mounted', 'wall_bracket']);
const hangingMounts = new Set(['suspended', 'cable', 'catenary', 'wire']);

/**
 * Places one tile's lamps and estimated light, or returns undefined when it has none. Each is a
 * point of light, flagged as mapped or estimated. Layout: 0 position in the
 * tile, 0 to 8192 (uint16 ×2); 4 height in decimetres (uint16); 6 the reach of its light on the
 * ground in metres (uint8); 7 flags (uint8: bit 0 mapped, bit 1 its own colour); 8 its colour
 * (uint8 ×3, sRGB); 11 a seed (uint8, normalised).
 */
export function placeTileflowStreetLights(
  layers: TileflowStreetLightLayers,
  options: TileflowStreetLightPlacementOptions,
): TileflowStreetLightPlacement | undefined {
  const estimate = options.estimate ?? 'lit';
  const writer = new LampWriter();
  const placed = new Grid(mappedClearance);
  const nearby = new Grid(estimatedClearance);

  // The mapped lamps.
  const furniture = layers.streetFurniture;
  if (furniture) {
    const scale = extent / furniture.extent;
    for (const feature of furniture.features) {
      const properties = feature.properties;
      if (feature.type !== 'Point' || properties.subclass !== 'street_lamp') continue;
      const height = lampHeight(properties);
      const colour = lampColour(properties);
      const count = Math.max(1, Math.min(4, Number(properties.light_count) || 1));
      const reach = Math.min(24, Math.max(5, height * 1.7 * (count > 1 ? 1.15 : 1)));
      for (const points of feature.geometry)
        for (let at = 0; at + 1 < points.length; at += 2) {
          const x = points[at]! * scale;
          const y = points[at + 1]! * scale;
          if (!inside(x, y)) continue;
          writer.write(x, y, height, reach, true, colour);
          const metres = toMetres(x, y, options.tileMetres);
          placed.add(...metres);
          nearby.add(...metres);
        }
    }
  }
  const mapped = writer.count;
  if (estimate === 'none') return writer.done(mapped);

  // How well the tile maps its lamps: mapped lamps a kilometre of street.
  const roads = layers.transportation;
  let streetMetres = 0;
  if (roads) {
    const unit = options.tileMetres / roads.extent;
    for (const feature of roads.features) {
      if (feature.type !== 'LineString' || !streetRule(feature.properties, 'streets')) continue;
      for (const line of feature.geometry) streetMetres += clippedLength(line, roads.extent) * unit;
    }
  }
  const mappedZone = streetMetres > 0 && mapped / (streetMetres / 1000) >= mappedDensity;
  const mode = estimate === 'streets' && !mappedZone ? 'streets' : 'lit';

  const along = (
    layer: TileflowTileLayer,
    line: readonly number[],
    rule: {spacing: number; kerb: number},
    salt: number,
  ) => {
    const scale = extent / layer.extent;
    const points: number[] = [];
    for (let at = 0; at + 1 < line.length; at += 2)
      points.push(line[at]! * scale, line[at + 1]! * scale);
    const unit = options.tileMetres / extent;
    // Estimated light keeps near the street's middle: it says the street is lit, not where a lamp
    // stands.
    const kerb = (rule.kerb * 0.45) / unit;
    // Each street starts its lamps at its own point, so neighbouring streets do not line up.
    const phase = hash(points[0]! * 0.013 + points[1]! * 0.029 + salt) * rule.spacing;
    let travelled = 0;
    let next = phase;
    let side = hash(points[0]! + points[1]! * 3.1) < 0.5 ? 1 : -1;
    for (let at = 2; at < points.length; at += 2) {
      const ax = points[at - 2]!;
      const ay = points[at - 1]!;
      const bx = points[at]!;
      const by = points[at + 1]!;
      const length = Math.hypot(bx - ax, by - ay) * unit;
      if (length === 0) continue;
      while (next <= travelled + length) {
        const t = (next - travelled) / length;
        const nx = (-(by - ay) / (length / unit)) * side;
        const ny = ((bx - ax) / (length / unit)) * side;
        const x = ax + (bx - ax) * t + nx * kerb;
        const y = ay + (by - ay) * t + ny * kerb;
        next += rule.kerb > 0 ? rule.spacing / 2 : rule.spacing;
        if (rule.kerb > 0) side = -side;
        if (!inside(x, y)) continue;
        const metres = toMetres(x, y, options.tileMetres);
        if (placed.near(...metres) || nearby.near(...metres)) continue;
        nearby.add(...metres);
        writer.write(x, y, 7, 15, false);
      }
      travelled += length;
    }
  };

  if (roads)
    for (const feature of roads.features) {
      if (feature.type !== 'LineString') continue;
      const rule = streetRule(feature.properties, mode);
      if (!rule) continue;
      for (const line of feature.geometry) along(roads, line, rule, 1);
    }
  const sidewalks = layers.sidewalks;
  if (sidewalks)
    for (const feature of sidewalks.features) {
      // Pavements are lines or, as World draws them, narrow areas whose outline runs along them.
      if (feature.type === 'Point' || !isLit(feature.properties.lit)) continue;
      for (const line of feature.geometry) along(sidewalks, line, pavement, 2);
    }
  return writer.done(mapped);
}

/** How a street takes estimated lamps, or undefined when it takes none. */
function streetRule(
  properties: Readonly<Record<string, string | number | boolean>>,
  mode: 'streets' | 'lit',
): {spacing: number; kerb: number} | undefined {
  if (properties.brunnel === 'tunnel' || properties.covered === true) return undefined;
  const lit = properties.lit;
  if (lit === false || lit === 'no') return undefined;
  const featureClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const kind =
    featureClass === 'path' && (subclass === 'pedestrian' || subclass === 'living_street')
      ? 'pedestrian'
      : featureClass;
  const rule = streets[kind];
  if (rule && (mode === 'streets' || isLit(lit))) return rule;
  const litRule = litOnly[kind];
  if (litRule && isLit(lit)) return litRule;
  return undefined;
}

function isLit(value: unknown): boolean {
  return value === true || value === 'yes' || value === 1 || value === '1' || value === 'true';
}

function lampHeight(properties: Readonly<Record<string, string | number | boolean>>): number {
  const height = Number(properties.height);
  if (Number.isFinite(height) && height >= 0.5 && height <= 40) return height;
  const mount = String(properties.lamp_mount ?? '').toLowerCase();
  if (wallMounts.has(mount)) return 4.5;
  if (hangingMounts.has(mount)) return 7.5;
  return 7;
}

function lampColour(
  properties: Readonly<Record<string, string | number | boolean>>,
): readonly [number, number, number] | undefined {
  const given = properties.light_colour ?? properties['light:colour'];
  if (typeof given === 'string' && given) {
    const name = given.toLowerCase().replaceAll(' ', '_');
    const channels = tileflowColourChannels(namedColours[name] ?? given);
    if (channels) return [channels[0], channels[1], channels[2]];
  }
  const type = String(properties.lamp_type ?? '')
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
  const known = lampColours[type];
  if (!known) return undefined;
  const channels = tileflowColourChannels(known)!;
  return [channels[0], channels[1], channels[2]];
}

function inside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < extent && y < extent;
}

function toMetres(x: number, y: number, tileMetres: number): [number, number] {
  return [(x / extent) * tileMetres, (y / extent) * tileMetres];
}

/** A line's length inside the tile's square, in its layer's units. */
function clippedLength(line: readonly number[], size: number): number {
  let length = 0;
  for (let at = 2; at + 1 < line.length; at += 2) {
    const mx = (line[at - 2]! + line[at]!) / 2;
    const my = (line[at - 1]! + line[at + 1]!) / 2;
    if (mx < 0 || my < 0 || mx >= size || my >= size) continue;
    length += Math.hypot(line[at]! - line[at - 2]!, line[at + 1]! - line[at - 1]!);
  }
  return length;
}

/** Points in square cells of a size, to find any within that distance. */
class Grid {
  readonly #cells = new Map<string, [number, number][]>();
  constructor(readonly size: number) {}

  add(x: number, y: number): void {
    const key = `${Math.floor(x / this.size)}/${Math.floor(y / this.size)}`;
    const cell = this.#cells.get(key);
    if (cell) cell.push([x, y]);
    else this.#cells.set(key, [[x, y]]);
  }

  near(x: number, y: number): boolean {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (const [px, py] of this.#cells.get(`${cx + dx}/${cy + dy}`) ?? [])
          if (Math.hypot(px - x, py - y) < this.size) return true;
    return false;
  }
}

class LampWriter {
  #buffer = new ArrayBuffer(256 * tileflowStreetLightBytes);
  #view = new DataView(this.#buffer);
  count = 0;

  write(
    x: number,
    y: number,
    height: number,
    reach: number,
    mapped: boolean,
    colour?: readonly [number, number, number],
  ): void {
    const stride = tileflowStreetLightBytes;
    if ((this.count + 1) * stride > this.#buffer.byteLength) {
      const larger = new ArrayBuffer(this.#buffer.byteLength * 2);
      new Uint8Array(larger).set(new Uint8Array(this.#buffer));
      this.#buffer = larger;
      this.#view = new DataView(larger);
    }
    const view = this.#view;
    const at = this.count * stride;
    view.setUint16(at, Math.min(extent, Math.max(0, Math.round(x))), true);
    view.setUint16(at + 2, Math.min(extent, Math.max(0, Math.round(y))), true);
    view.setUint16(at + 4, Math.min(65535, Math.round(height * 10)), true);
    view.setUint8(at + 6, Math.min(255, Math.round(reach)));
    view.setUint8(at + 7, (mapped ? 1 : 0) | (colour ? 2 : 0));
    view.setUint8(at + 8, Math.round((colour?.[0] ?? 0) * 255));
    view.setUint8(at + 9, Math.round((colour?.[1] ?? 0) * 255));
    view.setUint8(at + 10, Math.round((colour?.[2] ?? 0) * 255));
    view.setUint8(at + 11, Math.round(hash(x * 0.0731 + y * 0.19137) * 255));
    this.count += 1;
  }

  done(mapped: number): TileflowStreetLightPlacement | undefined {
    if (this.count === 0) return undefined;
    return {
      lamps: new Uint8Array(this.#buffer.slice(0, this.count * tileflowStreetLightBytes)),
      mapped,
      estimated: this.count - mapped,
    };
  }
}

/** A number from 0 to 1 that changes unpredictably with its input. */
function hash(value: number): number {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** The style metadata key under which a compiled map describes its street lights. */
export const tileflowStreetLightsMetadataKey = 'tileflow:street-lights';

/** A compiled map's street lights, as the roads module describes them, resolved for one theme. */
export type TileflowStreetLightsDesign = Readonly<{
  /** The vector source and its layers with the lamps, the streets and the pavements. */
  source: string;
  layers: Readonly<{streetFurniture: string; transportation: string; sidewalk?: string}>;
  estimate: TileflowStreetLightEstimate;
  /** The light of lamps whose data gives no colour, as a CSS colour. */
  color: string;
  /** How bright the lights shine, from 0 to 2. */
  intensity: number;
}>;

/** The street lights of a style compiled without this description. */
export const tileflowDefaultStreetLightsDesign: TileflowStreetLightsDesign = Object.freeze({
  source: 'tileflow',
  layers: Object.freeze({
    streetFurniture: 'street_furniture',
    transportation: 'transportation',
    sidewalk: 'sidewalk',
  }),
  estimate: 'lit',
  color: '#ffcf8f',
  intensity: 1,
});

/** The metadata a compiled style publishes for its street lights. */
export function tileflowStreetLightsMetadata(
  design: TileflowStreetLightsDesign,
): Readonly<{version: 1} & TileflowStreetLightsDesign> {
  return {version: 1, ...design};
}

/**
 * Reads the street lights a compiled style describes, or undefined when its metadata has none or a
 * version or shape this Core does not know.
 */
export function readTileflowStreetLights(
  metadata: unknown,
): TileflowStreetLightsDesign | undefined {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    return undefined;
  const value = (metadata as Record<string, unknown>)[tileflowStreetLightsMetadataKey] as
    Record<string, unknown> | undefined;
  if (typeof value !== 'object' || value === null || value.version !== 1) return undefined;
  const layers = value.layers as Record<string, unknown> | undefined;
  if (
    typeof value.source !== 'string' ||
    typeof layers?.streetFurniture !== 'string' ||
    typeof layers.transportation !== 'string'
  )
    return undefined;
  const estimate = (['lit', 'streets', 'none'] as const).find((name) => name === value.estimate);
  const intensity =
    typeof value.intensity === 'number' && value.intensity >= 0 && value.intensity <= 2
      ? value.intensity
      : 1;
  return {
    source: value.source,
    layers: {
      streetFurniture: layers.streetFurniture,
      transportation: layers.transportation,
      ...(typeof layers.sidewalk === 'string' ? {sidewalk: layers.sidewalk} : {}),
    },
    estimate: estimate ?? 'lit',
    color:
      typeof value.color === 'string' && tileflowColourChannels(value.color)
        ? value.color
        : tileflowDefaultStreetLightsDesign.color,
    intensity,
  };
}
