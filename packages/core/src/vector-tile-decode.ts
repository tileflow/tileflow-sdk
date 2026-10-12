// A Mapbox Vector Tile (MVT 2.1) decoder for applications that read tiles themselves: the features
// of chosen layers, with their properties and geometry in tile units. It allocates one flat array
// per point set, line or ring, so a worker can read a city's streets quickly.

export type TileflowTileGeometryType = 'Point' | 'LineString' | 'Polygon';

export type TileflowTileFeature = Readonly<{
  /** The feature's id in the tile, when it has one. */
  id?: number;
  type: TileflowTileGeometryType;
  properties: Readonly<Record<string, string | number | boolean>>;
  /**
   * One flat `[x0, y0, x1, y1, …]` array per point set, line or ring, in tile units from 0 to the
   * layer's extent (coordinates in a tile's buffer fall outside that range). Polygon rings follow
   * the MVT winding: an exterior ring is clockwise in tile units, a hole anticlockwise.
   */
  geometry: readonly (readonly number[])[];
}>;

export type TileflowTileLayer = Readonly<{
  /** Tile units across the tile, usually 4096. */
  extent: number;
  features: readonly TileflowTileFeature[];
}>;

export type TileflowVectorTileDecodeOptions = Readonly<{
  /** The layers to decode; others are skipped without decoding. Defaults to every layer. */
  layers?: readonly string[];
}>;

const geometryTypes = [undefined, 'Point', 'LineString', 'Polygon'] as const;

/** Decodes a Mapbox Vector Tile's layers. Throws on bytes that are not a vector tile. */
export function decodeTileflowVectorTile(
  bytes: Uint8Array,
  options: TileflowVectorTileDecodeOptions = {},
): Readonly<Record<string, TileflowTileLayer>> {
  const wanted = options.layers ? new Set(options.layers) : undefined;
  const layers: Record<string, TileflowTileLayer> = {};
  const tile = new Reader(bytes, 0, bytes.length);
  while (tile.more()) {
    const [field, wire] = tile.tag();
    if (field !== 3) {
      tile.skip(wire);
      continue;
    }
    const layer = tile.message();
    const decoded = readLayer(layer, wanted);
    if (decoded && !(decoded.name in layers)) layers[decoded.name] = decoded.layer;
  }
  return layers;
}

function readLayer(
  layer: Reader,
  wanted: Set<string> | undefined,
): {name: string; layer: TileflowTileLayer} | undefined {
  let name: string | undefined;
  let extent = 4096;
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const features: Reader[] = [];
  while (layer.more()) {
    const [field, wire] = layer.tag();
    if (field === 1) name = layer.string();
    else if (field === 2) features.push(layer.message());
    else if (field === 3) keys.push(layer.string());
    else if (field === 4) values.push(readValue(layer.message()));
    else if (field === 5) extent = layer.varint();
    else layer.skip(wire);
    // Name comes first in practice; an unwanted layer is left at once.
    if (name !== undefined && wanted && !wanted.has(name)) return undefined;
  }
  if (name === undefined || (wanted && !wanted.has(name))) return undefined;
  return {
    name,
    layer: Object.freeze({
      extent,
      features: Object.freeze(
        features.flatMap((feature) => {
          const decoded = readFeature(feature, keys, values);
          return decoded ? [decoded] : [];
        }),
      ),
    }),
  };
}

function readFeature(
  feature: Reader,
  keys: readonly string[],
  values: readonly (string | number | boolean)[],
): TileflowTileFeature | undefined {
  let id: number | undefined;
  let type: TileflowTileGeometryType | undefined;
  const properties: Record<string, string | number | boolean> = {};
  let commands: number[] = [];
  while (feature.more()) {
    const [field, wire] = feature.tag();
    if (field === 1) id = feature.varint();
    else if (field === 2) {
      const tags = feature.packed();
      for (let index = 0; index + 1 < tags.length; index += 2) {
        const key = keys[tags[index]!];
        const value = values[tags[index + 1]!];
        if (key !== undefined && value !== undefined) properties[key] = value;
      }
    } else if (field === 3) type = geometryTypes[feature.varint()];
    else if (field === 4) commands = feature.packed();
    else feature.skip(wire);
  }
  if (!type) return undefined;
  return Object.freeze({
    ...(id === undefined ? {} : {id}),
    type,
    properties: Object.freeze(properties),
    geometry: Object.freeze(readGeometry(commands, type)),
  });
}

/**
 * Geometry commands as parts: each MoveTo starts a line or ring, LineTo extends it and ClosePath
 * repeats its first point; the points of one MoveTo of a point feature share a part.
 */
function readGeometry(commands: readonly number[], type: TileflowTileGeometryType): number[][] {
  const parts: number[][] = [];
  let part: number[] | undefined;
  let x = 0;
  let y = 0;
  let index = 0;
  while (index < commands.length) {
    const header = commands[index++]!;
    const command = header & 7;
    const count = header >>> 3;
    if (command === 7) {
      if (part && part.length >= 2) part.push(part[0]!, part[1]!);
      continue;
    }
    if (command !== 1 && command !== 2)
      throw new Error(`Unknown geometry command ${command} in vector tile.`);
    if (index + count * 2 > commands.length) throw new Error('Truncated vector tile geometry.');
    for (let repeat = 0; repeat < count; repeat += 1) {
      x += zigzag(commands[index++]!);
      y += zigzag(commands[index++]!);
      if (command === 1 && (type !== 'Point' || repeat === 0)) parts.push((part = []));
      if (!part) throw new Error('Vector tile geometry draws a line before moving to its start.');
      part.push(x, y);
    }
  }
  return parts;
}

const zigzag = (value: number) => (value % 2 === 1 ? -(value + 1) / 2 : value / 2);

function readValue(message: Reader): string | number | boolean {
  let value: string | number | boolean = '';
  while (message.more()) {
    const [field, wire] = message.tag();
    if (field === 1) value = message.string();
    else if (field === 2) value = message.float();
    else if (field === 3) value = message.double();
    else if (field === 4) value = message.varint(true);
    else if (field === 5) value = message.varint();
    else if (field === 6) value = zigzag(message.varint());
    else if (field === 7) value = message.varint() !== 0;
    else message.skip(wire);
  }
  return value;
}

const text = new TextDecoder();

/** A protocol buffer reader over a slice of bytes. */
class Reader {
  private position: number;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.position = start;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  more(): boolean {
    return this.position < this.end;
  }

  tag(): [field: number, wire: number] {
    const value = this.varint();
    return [Math.floor(value / 8), value & 7];
  }

  /**
   * A varint as MapLibre's protocol buffer reader reads it: the low and high 32 bits apart, so ids
   * beyond 2^53 round to the same number. `signed` reads an int64's two's complement.
   */
  varint(signed = false): number {
    let low = 0;
    let high = 0;
    for (let index = 0; index < 10; index += 1) {
      if (this.position >= this.end) throw new Error('Truncated vector tile.');
      const byte = this.bytes[this.position++]!;
      if (index < 4) low |= (byte & 0x7f) << (index * 7);
      else if (index === 4) {
        low |= (byte & 0x0f) << 28;
        high = (byte & 0x70) >> 4;
      } else if (index < 9) high |= (byte & 0x7f) << ((index - 5) * 7 + 3);
      else high |= (byte & 0x01) << 31;
      if (byte < 0x80)
        return signed ? high * 0x100000000 + (low >>> 0) : (high >>> 0) * 0x100000000 + (low >>> 0);
    }
    throw new Error('Invalid varint in vector tile.');
  }

  private span(): [number, number] {
    const length = this.varint();
    const start = this.position;
    if (start + length > this.end) throw new Error('Truncated vector tile.');
    this.position = start + length;
    return [start, start + length];
  }

  message(): Reader {
    const [start, end] = this.span();
    return new Reader(this.bytes, start, end);
  }

  string(): string {
    const [start, end] = this.span();
    return text.decode(this.bytes.subarray(start, end));
  }

  packed(): number[] {
    const [start, end] = this.span();
    const inner = new Reader(this.bytes, start, end);
    const values: number[] = [];
    while (inner.more()) values.push(inner.varint());
    return values;
  }

  float(): number {
    if (this.position + 4 > this.end) throw new Error('Truncated vector tile.');
    const value = this.view.getFloat32(this.position, true);
    this.position += 4;
    return value;
  }

  double(): number {
    if (this.position + 8 > this.end) throw new Error('Truncated vector tile.');
    const value = this.view.getFloat64(this.position, true);
    this.position += 8;
    return value;
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.position += 8;
    else if (wire === 2) this.span();
    else if (wire === 5) this.position += 4;
    else throw new Error(`Unsupported protocol buffer wire type ${wire} in vector tile.`);
    if (this.position > this.end) throw new Error('Truncated vector tile.');
  }
}
