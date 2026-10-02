import {renderTileflowIconAtlasPixels, type TileflowIconSpriteIndex} from '@tileflow/core';
import {loadSharp} from './icon-sprite';

/** Render a report image without changing the immutable generated sprite. */
export async function renderTileflowIconAtlasPreview(
  source: Uint8Array,
  index: TileflowIconSpriteIndex,
): Promise<Uint8Array> {
  if (!Object.values(index).some((entry) => entry.sdf)) return source;
  const sharp = await loadSharp();
  const {data, info} = await sharp(source, {limitInputPixels: 2048 * 2048})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const rendered = renderTileflowIconAtlasPixels(data, info.width, info.height, index);
  return sharp(rendered, {raw: {width: info.width, height: info.height, channels: 4}})
    .png()
    .toBuffer();
}
