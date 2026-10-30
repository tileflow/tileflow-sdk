import {
  checkTileflowModelSurface,
  tileflowModelImageSize,
  type TileflowModelMaterial,
  type TileflowModelSurface,
  tileflowModelSurfaceLimits,
  type TileflowModelTexture,
  type TileflowModelTextureReference,
} from '@tileflow/core';

type Json = Record<string, unknown>;

/** The building importer retains physical glTF data; tree preparation keeps its smaller path. */
export function createGltfMaterialReader(
  json: Json,
  bin: Uint8Array | undefined,
  accessor: (index: number) => {values: number[]; size: number},
) {
  const textures: TileflowModelTexture[] = [];
  const textureIds = new Map<number, number>();
  const imageCache = new Map<
    number,
    Pick<TileflowModelTexture, 'bytes' | 'width' | 'height' | 'mimeType'>
  >();

  function imageAt(index: unknown) {
    if (!Number.isInteger(index)) throw new RangeError('A material names a missing image.');
    const cached = imageCache.get(index as number);
    if (cached) return cached;
    const image = record(list(json.images)[index as number]);
    let bytes: Uint8Array;
    let mimeType = image.mimeType;
    if (typeof image.uri === 'string') {
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image.uri);
      if (!match || image.uri.length > 24 * 1024 * 1024)
        throw new RangeError('Embed PNG/JPEG images in the GLB; external images are not read.');
      if (mimeType !== undefined && mimeType !== match[1])
        throw new RangeError('An image has conflicting media types.');
      mimeType = match[1];
      bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'));
    } else {
      if (!Number.isInteger(image.bufferView)) throw new RangeError('Embed each image in the GLB.');
      const view = record(list(json.bufferViews)[image.bufferView as number]);
      const start = view.byteOffset ?? 0;
      const length = view.byteLength;
      if (
        !bin ||
        (view.buffer ?? 0) !== 0 ||
        !Number.isInteger(start) ||
        !Number.isInteger(length) ||
        (start as number) < 0 ||
        (length as number) <= 0 ||
        (start as number) + (length as number) > bin.length
      )
        throw new RangeError('An embedded image extends outside the GLB.');
      bytes = bin.subarray(start as number, (start as number) + (length as number));
    }
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg')
      throw new RangeError('Use an embedded PNG or JPEG image.');
    const size = tileflowModelImageSize(bytes, mimeType);
    if (
      !size ||
      Math.max(...size) > tileflowModelSurfaceLimits.textureDimension ||
      size[0] * size[1] > tileflowModelSurfaceLimits.texturePixels
    )
      throw new RangeError('The model image is invalid or exceeds its pixel budget.');
    const result: Pick<TileflowModelTexture, 'bytes' | 'width' | 'height' | 'mimeType'> = {
      bytes,
      width: size[0],
      height: size[1],
      mimeType,
    };
    imageCache.set(index as number, result);
    return result;
  }

  function textureAt(index: unknown): number {
    if (!Number.isInteger(index)) throw new RangeError('A material names a missing texture.');
    const cached = textureIds.get(index as number);
    if (cached !== undefined) return cached;
    const source = record(list(json.textures)[index as number]);
    const image = imageAt(source.source);
    const sampler =
      source.sampler === undefined ? {} : record(list(json.samplers)[source.sampler as number]);
    if (
      source.sampler !== undefined &&
      (!Number.isInteger(source.sampler) || !list(json.samplers)[source.sampler as number])
    )
      throw new RangeError('A texture names a missing sampler.');
    const id = textures.length;
    if (id >= tileflowModelSurfaceLimits.textures)
      throw new RangeError('The model has too many textures.');
    textures.push({
      ...image,
      ...pick(sampler, ['wrapS', 'wrapT', 'minFilter', 'magFilter']),
    } as TileflowModelTexture);
    textureIds.set(index as number, id);
    return id;
  }

  function textureRef(value: unknown, normal = false): TileflowModelTextureReference | undefined {
    if (value === undefined) return undefined;
    const ref = record(value);
    const transform = record(record(ref.extensions).KHR_texture_transform);
    const texCoord = transform.texCoord ?? ref.texCoord;
    return {
      texture: textureAt(ref.index),
      ...(texCoord === undefined ? {} : {texCoord}),
      ...pick(transform, ['offset', 'scale', 'rotation']),
      ...(normal && ref.scale !== undefined ? {strength: ref.scale} : {}),
      ...(!normal && ref.strength !== undefined ? {strength: ref.strength} : {}),
    } as TileflowModelTextureReference;
  }

  return (primitive: Json, count: number, indexCount: number): TileflowModelSurface => {
    const source =
      primitive.material === undefined
        ? {}
        : record(list(json.materials)[primitive.material as number]);
    if (
      primitive.material !== undefined &&
      (!Number.isInteger(primitive.material) || !list(json.materials)[primitive.material as number])
    )
      throw new RangeError('A primitive names a missing material.');
    const pbr = record(source.pbrMetallicRoughness);
    const extensions = record(source.extensions);
    const material: TileflowModelMaterial = {
      ...pick(pbr, ['baseColorFactor', 'metallicFactor', 'roughnessFactor']),
      ...pick(source, ['emissiveFactor', 'alphaMode', 'alphaCutoff', 'doubleSided']),
      ...(extensions.KHR_materials_unlit === undefined ? {} : {unlit: true}),
      ...pick(record(extensions.KHR_materials_emissive_strength), ['emissiveStrength']),
      ...optional('baseColorTexture', textureRef(pbr.baseColorTexture)),
      ...optional('metallicRoughnessTexture', textureRef(pbr.metallicRoughnessTexture)),
      ...optional('normalTexture', textureRef(source.normalTexture, true)),
      ...optional('occlusionTexture', textureRef(source.occlusionTexture)),
      ...optional('emissiveTexture', textureRef(source.emissiveTexture)),
    };
    const attributes = record(primitive.attributes);
    const read = (name: string, size: number[]) => {
      const index = attributes[name];
      if (index === undefined) return undefined;
      if (!Number.isInteger(index)) throw new RangeError(`Invalid ${name} accessor.`);
      const value = accessor(index as number);
      if (!size.includes(value.size) || value.values.length !== count * value.size)
        throw new RangeError(`${name} must have one value per vertex.`);
      return value;
    };
    const uv0 = read('TEXCOORD_0', [2]),
      uv1 = read('TEXCOORD_1', [2]);
    // Prepared files keep the second UV set with sixteen bits inside the unit square.
    if (uv1?.values.some((value) => !(value >= 0 && value <= 1)))
      throw new RangeError('TEXCOORD_1 must lie between zero and one.');
    const colour = read('COLOR_0', [3, 4]);
    for (const key of [
      'baseColorTexture',
      'metallicRoughnessTexture',
      'normalTexture',
      'occlusionTexture',
      'emissiveTexture',
    ] as const) {
      const ref = material[key];
      if (
        ref &&
        !(ref.texCoord === 1
          ? uv1
          : ref.texCoord === undefined || ref.texCoord === 0
            ? uv0
            : undefined)
      )
        throw new RangeError(`The ${key} needs its declared UV coordinates.`);
    }
    const data = new Float32Array(count * 8);
    for (let vertex = 0; vertex < count; vertex++) {
      for (let axis = 0; axis < 2; axis++) {
        data[vertex * 8 + axis] = uv0?.values[vertex * 2 + axis] ?? 0;
        data[vertex * 8 + 2 + axis] = uv1?.values[vertex * 2 + axis] ?? 0;
      }
      for (let channel = 0; channel < 4; channel++)
        data[vertex * 8 + 4 + channel] =
          colour && channel < colour.size ? colour.values[vertex * colour.size + channel]! : 1;
    }
    const surface = {
      attributes: data,
      materials: [material],
      textures,
      ranges: [{from: 0, count: indexCount, material: 0}],
    };
    checkTileflowModelSurface(surface, count, indexCount);
    return surface;
  };
}

function record(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pick(value: Json, keys: readonly string[]) {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  );
}

function optional<K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> {
  return value === undefined ? {} : ({[key]: value} as Record<K, T>);
}
