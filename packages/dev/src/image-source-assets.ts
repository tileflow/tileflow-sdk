import {createHash} from 'node:crypto';
import type {TileflowBuildStyles} from '@tileflow/core/build';
import type {TileflowBuildAsset} from './icons';

/** Native URLs cannot contain data URIs. Retain embedded PNGs as ordinary artifact files. */
export function prepareEmbeddedImageSources(input: TileflowBuildStyles) {
  const styles = structuredClone(input);
  const assets = new Map<string, TileflowBuildAsset>();
  for (const [map, themes] of Object.entries(styles)) {
    for (const style of Object.values(themes)) {
      for (const source of Object.values(style.sources)) {
        if (source.type !== 'image' || typeof source.url !== 'string') continue;
        const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(source.url);
        if (!match || match[1]!.length > 14 * 1024 * 1024) continue;
        const bytes = Buffer.from(match[1]!, 'base64');
        if (
          bytes.length < 24 ||
          !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        )
          continue;
        const hash = createHash('sha256').update(bytes).digest('hex');
        const fileName = `images/${map}/${hash}.png`;
        assets.set(fileName, {contentType: 'image/png', fileName, source: bytes});
        // Styles and their immutable copies keep the same two-level owner layout.
        source.url = `../../${fileName}`;
      }
    }
  }
  return {styles, assets: [...assets.values()]};
}
