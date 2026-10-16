import {Color} from '@maplibre/maplibre-gl-style-spec';
import type {StyleSpecification} from 'maplibre-gl';
import {PbfReader} from 'pbf';
import {readBoundedTileflowResponse} from '../landmarks';
import type {Side} from './types';

export const fontPreviewLines = ['Aa Bb Cc 0123456789', 'Streets, parks and cafés.'];
type Glyph = {
  id: number;
  bitmap: Uint8Array;
  width: number;
  height: number;
  left: number;
  top: number;
  advance: number;
};

/** The glyphs.proto metrics describe a 24px em with a three-pixel SDF border. */
export function readPreviewGlyphs(bytes: Uint8Array): Map<number, Glyph> {
  const glyphs = new Map<number, Glyph>();
  new PbfReader(bytes).readFields((tag, _, reader) => {
    if (tag !== 1) return;
    reader.readMessage((field, _, stack) => {
      if (field !== 3) return;
      const glyph = stack.readMessage(
        (key, value, item) => {
          if (key === 1) value.id = item.readVarint();
          else if (key === 2) value.bitmap = item.readBytes();
          else if (key === 3) value.width = item.readVarint();
          else if (key === 4) value.height = item.readVarint();
          else if (key === 5) value.left = item.readSVarint();
          else if (key === 6) value.top = item.readSVarint();
          else if (key === 7) value.advance = item.readVarint();
        },
        {
          id: 0,
          bitmap: new Uint8Array(),
          width: 0,
          height: 0,
          left: 0,
          top: 0,
          advance: 0,
        } as Glyph,
      );
      if (
        glyph.id > 0x10ffff ||
        glyph.width > 256 ||
        glyph.height > 256 ||
        glyph.advance > 256 ||
        Math.abs(glyph.left) > 512 ||
        Math.abs(glyph.top) > 512 ||
        (glyph.bitmap.length && glyph.bitmap.length !== (glyph.width + 6) * (glyph.height + 6))
      ) {
        throw new Error('Invalid preview glyph metrics');
      }
      glyphs.set(glyph.id, glyph);
    }, undefined);
  }, undefined);
  return glyphs;
}

export function previewGlyphBaseline(glyphs: Map<number, Glyph>) {
  const tops = [...fontPreviewLines.join('')].flatMap((char) => {
    const glyph = glyphs.get(char.codePointAt(0)!);
    return glyph?.bitmap.length ? [glyph.top] : [];
  });
  return 14 + (tops.length ? Math.max(...tops) : 0);
}

let faceId = 0;
export class FontPreviews {
  private cache = new Map<string, Uint8Array>();

  async render(
    font: string,
    style: StyleSpecification,
    side: Side,
    signal: AbortSignal,
    sample = fontPreviewLines[1],
  ) {
    const lines = [fontPreviewLines[0], sample.slice(0, 160)];
    const frame = side.frame.contentWindow as (Window & typeof globalThis) | null;
    if (!frame) throw new Error('Map is unavailable');
    const doc = frame.document;
    const canvas = doc.createElement('canvas');
    const ratio = Math.min(2, devicePixelRatio);
    canvas.width = 320 * ratio;
    canvas.height = 92 * ratio;
    canvas.style.width = '320px';
    canvas.style.height = '92px';
    canvas.className = 'dt-font-preview';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${font}: ${lines.join(' / ')}`);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    const ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#30251F';
    const color = Color.parse(ink)!;
    const rgb = [color.r, color.g, color.b].map((n) => Math.round(n * 255));
    ctx.fillStyle = ink;

    const bytes = async (url: string) => {
      const resolved = new URL(url, doc.baseURI).href;
      const key = `${side.loadEpoch}:${side.artifactGeneration}:${resolved}`;
      const cached = this.cache.get(key);
      if (cached) return cached;
      // Use the preview's resource context, just as the map does; retain the shell CSP.
      const response = await frame.fetch(resolved, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        cache: 'force-cache',
      });
      if (!response.ok) throw new Error(`Font preview request failed (${response.status})`);
      const data = await readBoundedTileflowResponse(response, 2 * 1024 * 1024);
      signal.throwIfAborted();
      this.cache.set(key, data);
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
      return data;
    };

    const face = style['font-faces']?.[font];
    let loaded: FontFace | undefined;
    const temporary: FontFace[] = [];
    doc.fonts.forEach((entry) => {
      if (entry.family.replace(/^['"]|['"]$/gu, '') === font && entry.status === 'loaded')
        loaded = entry;
    });
    try {
      if (face) {
        const family = `tileflow-preview-${++faceId}`;
        const definitions = typeof face === 'string' ? [{url: face}] : [...face].reverse();
        for (const definition of definitions) {
          const data = await bytes(definition.url);
          const item = new frame.FontFace(family, data.slice().buffer, {
            unicodeRange: definition['unicode-range']?.join(', ') || 'U+0-10FFFF',
          });
          await item.load();
          signal.throwIfAborted();
          doc.fonts.add(item);
          temporary.push(item);
          loaded = item;
        }
      }
      if (loaded) {
        lines.forEach((line, i) => {
          ctx.font = `${loaded!.style} ${loaded!.weight} 24px ${JSON.stringify(loaded!.family.replace(/^['"]|['"]$/gu, ''))}`;
          ctx.fillText(line, 10, 34 + i * 38);
        });
      } else if (style.glyphs) {
        const glyphs = new Map<number, Glyph>();
        const ranges = [
          ...new Set(
            [...lines.join('')].map((char) => Math.floor(char.codePointAt(0)! / 256) * 256),
          ),
        ].slice(0, 8);
        for (const start of ranges) {
          const url = style.glyphs
            .replace('{fontstack}', encodeURIComponent(font))
            .replace('{range}', `${start}-${start + 255}`);
          for (const [id, glyph] of readPreviewGlyphs(await bytes(url))) glyphs.set(id, glyph);
        }
        const baseline = previewGlyphBaseline(glyphs);
        const cell = doc.createElement('canvas');
        const cellContext = cell.getContext('2d')!;
        for (const [index, line] of lines.entries()) {
          let x = 10;
          for (const char of line) {
            const glyph = glyphs.get(char.codePointAt(0)!);
            if (!glyph) throw new Error('The font does not provide the sample characters');
            if (glyph.bitmap.length) {
              cell.width = glyph.width + 6;
              cell.height = glyph.height + 6;
              const pixels = cellContext.createImageData(cell.width, cell.height);
              for (let i = 0; i < glyph.bitmap.length; i++) {
                const t = Math.max(0, Math.min(1, (glyph.bitmap[i] / 255 - 0.645) / 0.21));
                pixels.data.set([...rgb, Math.round(t * t * (3 - 2 * t) * 255)], i * 4);
              }
              cellContext.putImageData(pixels, 0, 0);
              ctx.drawImage(cell, x + glyph.left - 3, baseline + index * 38 - glyph.top - 3);
            }
            x += glyph.advance;
          }
        }
        cell.width = cell.height = 0;
      } else {
        throw new Error('No font file or glyph source is available');
      }
      signal.throwIfAborted();
      return canvas;
    } finally {
      for (const item of temporary) doc.fonts.delete(item);
    }
  }
}
