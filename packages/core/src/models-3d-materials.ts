import {
  isTileflowModelPartName,
  type TileflowModelLightingRole,
  tileflowModelLightingRoles,
} from './models-3d-model';

/** An embedded glTF image and its sampler. Colour space belongs to its material channel. */
export type TileflowModelTexture = Readonly<{
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
  wrapS?: 33071 | 33648 | 10497;
  wrapT?: 33071 | 33648 | 10497;
  minFilter?: 9728 | 9729 | 9984 | 9985 | 9986 | 9987;
  magFilter?: 9728 | 9729;
}>;

/** A texture channel, including KHR_texture_transform and channel-specific strength. */
export type TileflowModelTextureReference = Readonly<{
  texture: number;
  texCoord?: 0 | 1;
  offset?: readonly [number, number];
  scale?: readonly [number, number];
  rotation?: number;
  strength?: number;
}>;

/** Metallic/roughness material values use glTF's linear factors and channel conventions. */
export type TileflowModelMaterial = Readonly<{
  baseColorFactor?: readonly [number, number, number, number];
  metallicFactor?: number;
  roughnessFactor?: number;
  emissiveFactor?: readonly [number, number, number];
  emissiveStrength?: number;
  baseColorTexture?: TileflowModelTextureReference;
  metallicRoughnessTexture?: TileflowModelTextureReference;
  normalTexture?: TileflowModelTextureReference;
  occlusionTexture?: TileflowModelTextureReference;
  emissiveTexture?: TileflowModelTextureReference;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  unlit?: boolean;
}>;

/** An explicitly authored area emitter. Endpoints are its lower edge, in model metres, Z up. */
export type TileflowModelEmitter = Readonly<{
  start: readonly [number, number, number];
  end: readonly [number, number, number];
  height: number;
  depth?: number;
  role: TileflowModelLightingRole;
  /** The part whose colour it takes, by name. */
  part: string;
}>;

export type TileflowModelMaterialRange = Readonly<{
  /** First index, and number of indices. */
  from: number;
  count: number;
  material: number;
  /** The source mesh's vertical extent in model metres, for its role emission gradient. */
  emissiveBounds?: readonly [number, number];
}>;

/** Optional physical surface data, independent of the vertex's part, role and occlusion. */
export type TileflowModelSurface = Readonly<{
  /** Eight floats per vertex: UV0, UV1, linear vertex RGBA. */
  attributes: readonly number[] | Float32Array;
  materials: readonly TileflowModelMaterial[];
  textures: readonly TileflowModelTexture[];
  ranges: readonly TileflowModelMaterialRange[];
  emitters?: readonly TileflowModelEmitter[];
}>;

export const tileflowModelSurfaceLimits = Object.freeze({
  materials: 256,
  textures: 32,
  textureDimension: 4096,
  texturePixels: 16_777_216,
  emitters: 128,
});

export const tileflowModelTextureChannels = [
  'baseColorTexture',
  'metallicRoughnessTexture',
  'normalTexture',
  'occlusionTexture',
  'emissiveTexture',
] as const;

/** Validate before preparation, encoding, or browser allocation. */
export function checkTileflowModelSurface(
  surface: TileflowModelSurface,
  vertices: number,
  indices: number,
): void {
  const fail = (reason: string): never => {
    throw new RangeError(`Invalid model surface: ${reason}.`);
  };
  if (!surface || typeof surface !== 'object') fail('missing data');
  const {attributes, materials, textures, ranges, emitters} = surface;
  if (
    !(Array.isArray(attributes) || attributes instanceof Float32Array) ||
    attributes.length !== vertices * 8
  )
    fail('each vertex needs UV0, UV1 and RGBA');
  for (let i = 0; i < attributes.length; i++) {
    const value = attributes[i]!;
    if (!Number.isFinite(value) || Math.abs(value) > 65_536) fail('unbounded vertex attributes');
    if (i % 8 >= 4 && (value < 0 || value > 1)) fail('vertex RGBA must be zero to one');
  }
  if (
    !Array.isArray(materials) ||
    materials.length < 1 ||
    materials.length > tileflowModelSurfaceLimits.materials
  )
    fail('material count exceeds the limit');
  if (!Array.isArray(textures) || textures.length > tileflowModelSurfaceLimits.textures)
    fail('texture count exceeds the limit');
  let pixels = 0;
  for (const texture of textures) {
    if (!texture || !(texture.bytes instanceof Uint8Array) || !texture.bytes.length)
      fail('an embedded image is missing');
    if (!['image/png', 'image/jpeg'].includes(texture.mimeType)) fail('use embedded PNG or JPEG');
    const dimensions = tileflowModelImageSize(texture.bytes, texture.mimeType);
    if (!dimensions || dimensions[0] !== texture.width || dimensions[1] !== texture.height)
      fail('image dimensions disagree with the image');
    if (Math.max(texture.width, texture.height) > tileflowModelSurfaceLimits.textureDimension)
      fail('image dimensions exceed the limit');
    pixels += texture.width * texture.height;
    if (pixels > tileflowModelSurfaceLimits.texturePixels)
      fail('decoded image pixels exceed the limit');
    if (texture.wrapS !== undefined && ![33071, 33648, 10497].includes(texture.wrapS))
      fail('unknown horizontal texture wrapping');
    if (texture.wrapT !== undefined && ![33071, 33648, 10497].includes(texture.wrapT))
      fail('unknown vertical texture wrapping');
    if (
      texture.minFilter !== undefined &&
      ![9728, 9729, 9984, 9985, 9986, 9987].includes(texture.minFilter)
    )
      fail('unknown texture minification');
    if (texture.magFilter !== undefined && ![9728, 9729].includes(texture.magFilter))
      fail('unknown texture magnification');
  }
  const tuple = (value: unknown, count: number, min: number, max: number) =>
    Array.isArray(value) &&
    value.length === count &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
  const number = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  for (const material of materials) {
    if (!material || typeof material !== 'object') fail('missing material');
    if (material.baseColorFactor !== undefined && !tuple(material.baseColorFactor, 4, 0, 1))
      fail('base colour must have four zero-to-one components');
    if (material.emissiveFactor !== undefined && !tuple(material.emissiveFactor, 3, 0, 1))
      fail('emission must have three zero-to-one components');
    for (const key of ['metallicFactor', 'roughnessFactor', 'alphaCutoff'] as const)
      if (material[key] !== undefined && !number(material[key], 0, 1))
        fail(`${key} must be zero to one`);
    if (material.emissiveStrength !== undefined && !number(material.emissiveStrength, 0, 1000))
      fail('emissive strength must be zero to 1000');
    if (
      material.alphaMode !== undefined &&
      !['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode)
    )
      fail('unknown alpha mode');
    for (const key of ['doubleSided', 'unlit'] as const)
      if (material[key] !== undefined && typeof material[key] !== 'boolean')
        fail(`${key} must be boolean`);
    for (const channel of tileflowModelTextureChannels) {
      const ref = material[channel];
      if (ref === undefined) continue;
      if (!ref || typeof ref !== 'object') fail('invalid texture reference');
      if (!Number.isInteger(ref.texture) || ref.texture < 0 || ref.texture >= textures.length)
        fail('material names a missing texture');
      if (ref.texCoord !== undefined && ref.texCoord !== 0 && ref.texCoord !== 1)
        fail('texture coordinates must name UV0 or UV1');
      if (ref.offset !== undefined && !tuple(ref.offset, 2, -65_536, 65_536))
        fail('invalid texture offset');
      if (ref.scale !== undefined && !tuple(ref.scale, 2, -65_536, 65_536))
        fail('invalid texture scale');
      if (ref.rotation !== undefined && !number(ref.rotation, -1000, 1000))
        fail('invalid texture rotation');
      if (
        ref.strength !== undefined &&
        !number(ref.strength, 0, channel === 'normalTexture' ? 100 : 1)
      )
        fail('invalid texture channel strength');
    }
  }
  let covered = 0;
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > indices / 3)
    fail('missing material ranges');
  for (const range of ranges) {
    if (!range || typeof range !== 'object') fail('invalid material range');
    if (
      range.emissiveBounds !== undefined &&
      (!tuple(range.emissiveBounds, 2, -2000, 2000) ||
        range.emissiveBounds[0] > range.emissiveBounds[1])
    )
      fail('invalid material emission bounds');
    if (
      !Number.isInteger(range.from) ||
      range.from !== covered ||
      !Number.isInteger(range.count) ||
      range.count <= 0 ||
      range.count % 3 !== 0 ||
      !Number.isInteger(range.material) ||
      range.material < 0 ||
      range.material >= materials.length
    )
      fail('material ranges must cover whole triangles in order');
    covered += range.count;
    if (covered > indices) fail('material range exceeds the mesh');
  }
  if (covered !== indices) fail('material ranges must cover the mesh');
  if (emitters !== undefined) {
    if (!Array.isArray(emitters) || emitters.length > tileflowModelSurfaceLimits.emitters)
      fail('emitter count exceeds the limit');
    for (const emitter of emitters) {
      if (!emitter || typeof emitter !== 'object') fail('invalid area emitter');
      if (
        !tuple(emitter.start, 3, -2000, 2000) ||
        !tuple(emitter.end, 3, -2000, 2000) ||
        !number(emitter.height, 0.01, 1000) ||
        (emitter.depth !== undefined && !number(emitter.depth, 0, 100)) ||
        !Object.hasOwn(tileflowModelLightingRoles, emitter.role) ||
        !isTileflowModelPartName(emitter.part)
      )
        fail('invalid area emitter');
      if (
        Math.hypot(emitter.end[0] - emitter.start[0], emitter.end[1] - emitter.start[1]) < 0.001 ||
        Math.abs(emitter.end[2] - emitter.start[2]) > 0.01
      )
        fail('an area emitter needs a horizontal lower edge');
    }
  }
}

/** Read bounded image dimensions without a DOM or image decoder. */
export function tileflowModelImageSize(
  bytes: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg',
): readonly [number, number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === 'image/png') {
    if (
      bytes.length < 33 ||
      view.getUint32(0) !== 0x89504e47 ||
      view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(12) !== 0x49484452
    )
      return undefined;
    const width = view.getUint32(16),
      height = view.getUint32(20);
    return width && height ? [width, height] : undefined;
  }
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return undefined;
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at++] !== 0xff) return undefined;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++]!;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) return undefined;
    const length = view.getUint16(at);
    if (length < 2 || at + length > bytes.length) return undefined;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      if (length < 8) return undefined;
      const height = view.getUint16(at + 3),
        width = view.getUint16(at + 5);
      return width && height ? [width, height] : undefined;
    }
    at += length;
  }
  return undefined;
}
