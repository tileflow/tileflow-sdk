import {
  checkTileflowModelSurface,
  type TileflowModelMaterial,
  type TileflowModelMaterialRange,
  type TileflowModelSurface,
  type TileflowModelTexture,
  tileflowModelTextureChannels,
} from '@tileflow/core';
import type {TileflowGltfPrimitive} from './gltf-reader';

/** Join primitive surfaces without changing triangle order or the palette and lighting roles. */
export function buildingModelSurface(
  primitives: readonly TileflowGltfPrimitive[],
): TileflowModelSurface | undefined {
  if (!primitives.some((primitive) => primitive.surface)) return undefined;

  const attributes: number[] = [];
  const materials: TileflowModelMaterial[] = [];
  const materialIds = new Map<string, number>();
  const textures: TileflowModelTexture[] = [];
  const textureIds = new Map<TileflowModelTexture, number>();
  const ranges: TileflowModelMaterialRange[] = [];
  const emitters: NonNullable<TileflowModelSurface['emitters']>[number][] = [];
  let indexCount = 0;

  for (const primitive of primitives) {
    const count = primitive.positions.length / 3;
    const surface = primitive.surface;
    if (surface) {
      checkTileflowModelSurface(surface, count, primitive.indices.length);
      for (const value of surface.attributes) attributes.push(value);
      emitters.push(...(surface.emitters ?? []));
    } else {
      for (let vertex = 0; vertex < count; vertex++) attributes.push(0, 0, 0, 0, 1, 1, 1, 1);
    }

    const remap = (surface?.materials ?? [{}]).map((material) => {
      const copy = {...material};
      for (const channel of tileflowModelTextureChannels) {
        const ref = copy[channel];
        if (!ref) continue;
        const texture = surface!.textures[ref.texture]!;
        let id = textureIds.get(texture);
        if (id === undefined) {
          id = textures.length;
          textures.push(texture);
          textureIds.set(texture, id);
        }
        copy[channel] = {...ref, texture: id};
      }
      const key = JSON.stringify(copy);
      let id = materialIds.get(key);
      if (id === undefined) {
        id = materials.length;
        materials.push(copy);
        materialIds.set(key, id);
      }
      return id;
    });
    const sourceRanges: readonly TileflowModelMaterialRange[] = surface?.ranges ?? [
      {from: 0, count: primitive.indices.length, material: 0},
    ];
    for (const range of sourceRanges) {
      const material = remap[range.material]!;
      const previous = ranges.at(-1);
      if (
        previous?.material === material &&
        JSON.stringify(previous.emissiveBounds) === JSON.stringify(range.emissiveBounds)
      )
        ranges[ranges.length - 1] = {...previous, count: previous.count + range.count};
      else ranges.push({...range, from: indexCount + range.from, material});
    }
    indexCount += primitive.indices.length;
  }

  const result = {attributes, materials, textures, ranges, ...(emitters.length ? {emitters} : {})};
  checkTileflowModelSurface(result, attributes.length / 8, indexCount);
  return result;
}
