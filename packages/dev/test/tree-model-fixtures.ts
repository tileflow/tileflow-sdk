// Writes small glTF binaries for tests: one node per part, Y up as glTF has it.

export type GlbPart = {
  material?: string;
  lightingRole?: string;
  materialData?: Record<string, unknown>;
  texcoords?: number[];
  texcoords1?: number[];
  vertexColors?: number[];
  nodeExtras?: Record<string, unknown>;
  /** x, y, z per vertex, Y up. */
  positions: number[];
  indices: number[];
  colour?: [number, number, number];
  translation?: [number, number, number];
};

export function writeGlb(
  parts: GlbPart[],
  extra: Record<string, unknown> = {},
  images: readonly {bytes: Uint8Array; mimeType: string}[] = [],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const materials: unknown[] = [];
  const nodes: unknown[] = [];
  const push = (bytes: Uint8Array, target?: number) => {
    const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
    padded.set(bytes);
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.byteLength,
      ...(target ? {target} : {}),
    });
    chunks.push(padded);
    offset += padded.byteLength;
    return bufferViews.length - 1;
  };
  for (const part of parts) {
    const positions = new Float32Array(part.positions);
    const min = [0, 1, 2].map((axis) =>
      Math.min(...part.positions.filter((_, i) => i % 3 === axis)),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...part.positions.filter((_, i) => i % 3 === axis)),
    );
    accessors.push({
      bufferView: push(new Uint8Array(positions.buffer), 34962),
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    const position = accessors.length - 1;
    accessors.push({
      bufferView: push(new Uint8Array(new Uint16Array(part.indices).buffer), 34963),
      componentType: 5123,
      count: part.indices.length,
      type: 'SCALAR',
    });
    const indices = accessors.length - 1;
    const attributes: Record<string, number> = {POSITION: position};
    for (const [name, values, size] of [
      ['TEXCOORD_0', part.texcoords, 2],
      ['TEXCOORD_1', part.texcoords1, 2],
      ['COLOR_0', part.vertexColors, 4],
    ] as const) {
      if (!values) continue;
      const data = new Float32Array(values);
      attributes[name] = accessors.length;
      accessors.push({
        bufferView: push(new Uint8Array(data.buffer), 34962),
        componentType: 5126,
        count: data.length / size,
        type: size === 2 ? 'VEC2' : 'VEC4',
      });
    }
    let material: number | undefined;
    if (part.material !== undefined) {
      materials.push({
        name: part.material,
        ...(part.lightingRole === undefined
          ? {}
          : {extras: {tileflow: {lightingRole: part.lightingRole}}}),
        pbrMetallicRoughness: {baseColorFactor: [...(part.colour ?? [1, 1, 1]), 1]},
        ...part.materialData,
      });
      material = materials.length - 1;
    }
    meshes.push({
      primitives: [{attributes, indices, ...(material === undefined ? {} : {material})}],
    });
    nodes.push({
      mesh: meshes.length - 1,
      ...(part.translation ? {translation: part.translation} : {}),
      ...(part.nodeExtras ? {extras: part.nodeExtras} : {}),
    });
  }
  const json = {
    asset: {version: '2.0'},
    scene: 0,
    scenes: [{nodes: nodes.map((_, index) => index)}],
    nodes,
    meshes,
    materials,
    ...(images.length
      ? {
          images: images.map((image) => ({
            bufferView: push(image.bytes),
            mimeType: image.mimeType,
          })),
        }
      : {}),
    accessors,
    bufferViews,
    buffers: [{byteLength: offset}],
    ...extra,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.byteLength / 4) * 4).fill(0x20);
  jsonPadded.set(jsonBytes);
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    bin.set(chunk, at);
    at += chunk.byteLength;
  }
  const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.byteLength;
  view.setUint32(binAt, bin.byteLength, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(bin, binAt + 8);
  return out;
}

/** A small tree: a box trunk (bark) and an octahedron crown (leaves), Y up, 10 m tall. */
export function smallTree(options: {crown?: string; trunk?: string} = {}): Uint8Array {
  const trunk: GlbPart = {
    material: options.trunk ?? 'bark',
    colour: [0.3, 0.2, 0.1],
    positions: [
      -0.2, 0, -0.2, 0.2, 0, -0.2, 0.2, 0, 0.2, -0.2, 0, 0.2, -0.2, 5, -0.2, 0.2, 5, -0.2, 0.2, 5,
      0.2, -0.2, 5, 0.2,
    ],
    indices: [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
  };
  const crown: GlbPart = {
    material: options.crown ?? 'leaves',
    colour: [0.2, 0.5, 0.2],
    // An octahedron 6 m across from 4 m to 10 m.
    positions: [0, 10, 0, 0, 4, 0, 3, 7, 0, -3, 7, 0, 0, 7, 3, 0, 7, -3],
    indices: [0, 4, 2, 0, 3, 4, 0, 5, 3, 0, 2, 5, 1, 2, 4, 1, 4, 3, 1, 3, 5, 1, 5, 2],
  };
  return writeGlb([trunk, crown]);
}
