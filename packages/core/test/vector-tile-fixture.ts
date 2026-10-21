// A small Mapbox Vector Tile encoder for test fixtures.

export type Value = string | number | boolean;
export type FixtureFeature = {
  id?: number;
  type: 1 | 2 | 3;
  properties: Record<string, Value>;
  /** Parts as [[x, y], …] in tile units; rings are closed by ClosePath, not by repeating. */
  parts: [number, number][][];
};

function varint(out: number[], value: number) {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}
const zigzag = (value: number) => (value < 0 ? -2 * value - 1 : 2 * value);
function field(out: number[], number: number, wire: number) {
  varint(out, number * 8 + wire);
}
function bytesField(out: number[], number: number, bytes: number[] | Uint8Array) {
  field(out, number, 2);
  varint(out, bytes.length);
  out.push(...bytes);
}
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

function encodeValue(value: Value): number[] {
  const out: number[] = [];
  if (typeof value === 'string') bytesField(out, 1, utf8(value));
  else if (typeof value === 'boolean') {
    field(out, 7, 0);
    varint(out, value ? 1 : 0);
  } else if (Number.isInteger(value) && value >= 0) {
    field(out, 5, 0);
    varint(out, value);
  } else if (Number.isInteger(value)) {
    field(out, 6, 0);
    varint(out, zigzag(value));
  } else {
    field(out, 3, 1);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    out.push(...new Uint8Array(view.buffer));
  }
  return out;
}

function encodeGeometry(type: 1 | 2 | 3, parts: [number, number][][]): number[] {
  const commands: number[] = [];
  let x = 0;
  let y = 0;
  const move = (points: [number, number][], command: number) => {
    commands.push(command | (points.length << 3));
    for (const [px, py] of points) {
      commands.push(zigzag(px - x), zigzag(py - y));
      x = px;
      y = py;
    }
  };
  if (type === 1) move(parts.flat(), 1);
  else
    for (const part of parts) {
      move([part[0]!], 1);
      move(part.slice(1), 2);
      if (type === 3) commands.push(7 | (1 << 3));
    }
  return commands;
}

export function encodeTile(layers: Record<string, {extent?: number; features: FixtureFeature[]}>) {
  const tile: number[] = [];
  for (const [name, {extent = 4096, features}] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: Value[] = [];
    const layer: number[] = [];
    field(layer, 15, 0);
    varint(layer, 2);
    bytesField(layer, 1, utf8(name));
    for (const feature of features) {
      const encoded: number[] = [];
      if (feature.id !== undefined) {
        field(encoded, 1, 0);
        varint(encoded, feature.id);
      }
      const tags: number[] = [];
      for (const [key, value] of Object.entries(feature.properties)) {
        let k = keys.indexOf(key);
        if (k < 0) k = keys.push(key) - 1;
        let v = values.indexOf(value);
        if (v < 0) v = values.push(value) - 1;
        tags.push(k, v);
      }
      const packedTags: number[] = [];
      for (const tag of tags) varint(packedTags, tag);
      bytesField(encoded, 2, packedTags);
      field(encoded, 3, 0);
      varint(encoded, feature.type);
      const geometry: number[] = [];
      for (const command of encodeGeometry(feature.type, feature.parts)) varint(geometry, command);
      bytesField(encoded, 4, geometry);
      bytesField(layer, 2, encoded);
    }
    for (const key of keys) bytesField(layer, 3, utf8(key));
    for (const value of values) bytesField(layer, 4, encodeValue(value));
    field(layer, 5, 0);
    varint(layer, extent);
    bytesField(tile, 3, layer);
  }
  return new Uint8Array(tile);
}
