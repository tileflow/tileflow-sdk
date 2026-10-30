import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import type {Side} from './types';

export type IconSource = Pick<MapLibreMap, 'listImages' | 'getImage'>;
type Entry = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio?: number;
  sdf?: boolean;
};
/** Asset-only atlas reads. Never changes the map theme or fabricates variant names. */
export class SpriteCatalog {
  private cache = new Map<string, Promise<{style: StyleSpecification; icons: IconSource}>>();
  private generation = '';
  load(side: Side, theme: string, signal: AbortSignal) {
    const generation = `${side.loadEpoch}:${side.artifactGeneration}`;
    if (this.generation !== generation) {
      this.cache.clear();
      this.generation = generation;
    }
    let pending = this.cache.get(theme);
    if (!pending) {
      pending = this.read(side, theme, AbortSignal.timeout(15000));
      this.cache.set(theme, pending);
      pending.catch(() => this.cache.delete(theme));
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    }
    return pending.then((result) => {
      signal.throwIfAborted();
      return result;
    });
  }
  private async read(side: Side, theme: string, signal: AbortSignal) {
    const bridge = window.__tileflowScene;
    if (!bridge) throw new Error('Theme assets are unavailable.');
    const style = await bridge.style(theme, signal),
      images = new Map<string, ReturnType<MapLibreMap['getImage']>>();
    const sprites =
      typeof style.sprite === 'string'
        ? [{id: 'default', url: style.sprite}]
        : (style.sprite ?? []);
    const frame = side.frame.contentWindow as (Window & typeof globalThis) | null;
    if (!frame) throw new Error('Map frame is unavailable.');
    for (const sprite of sprites) {
      const base = new URL(sprite.url, frame.location.href);
      const jsonURL = new URL(base),
        pngURL = new URL(base);
      jsonURL.pathname += '.json';
      pngURL.pathname += '.png';
      const [json, png] = await Promise.all([
        frame.fetch(jsonURL.href, {signal}),
        frame.fetch(pngURL.href, {signal}),
      ]);
      if (!json.ok || !png.ok) throw new Error(`Sprite unavailable for ${theme}`);
      const index = (await json.json()) as Record<string, Entry>,
        bitmap = await createImageBitmap(await png.blob());
      if (bitmap.width * bitmap.height > 16_777_216) {
        bitmap.close();
        throw new Error('Atlas is too large to preview.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      for (const [name, entry] of Object.entries(index).slice(0, 10000)) {
        if (
          ![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) ||
          entry.width <= 0 ||
          entry.height <= 0 ||
          entry.x < 0 ||
          entry.y < 0 ||
          entry.x + entry.width > canvas.width ||
          entry.y + entry.height > canvas.height
        )
          continue;
        const id = sprite.id === 'default' ? name : `${sprite.id}:${name}`;
        const data = ctx.getImageData(entry.x, entry.y, entry.width, entry.height);
        images.set(id, {
          data: {width: data.width, height: data.height, data: new Uint8Array(data.data)},
          pixelRatio: entry.pixelRatio ?? 1,
          sdf: entry.sdf ?? false,
        } as ReturnType<MapLibreMap['getImage']>);
      }
      canvas.width = canvas.height = 0;
    }
    return {
      style,
      icons: {
        listImages: () => [...images.keys()],
        getImage: (id: string) => images.get(id),
      } as IconSource,
    };
  }
  dispose() {
    this.cache.clear();
  }
}
