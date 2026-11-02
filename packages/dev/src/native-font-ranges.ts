import {createRequire} from 'node:module';

type CharacterTable = {
  characterSet: readonly number[];
  hasGlyphForCodePoint(codePoint: number): boolean;
};

const localRequire = createRequire(import.meta.url);
// The same OpenType parser the font pipeline uses to read names, weights and styles.
const fontkit = localRequire('fontkit') as {create(source: Uint8Array): CharacterTable};

/** Ranges beyond this many per font are rejected rather than written into a style. */
export const tileflowNativeFontRangeLimit = 4096;

/**
 * The `unicode-range` of a font file: every code point its character map (cmap) gives a glyph,
 * as ascending `U+XXXX-YYYY` runs. MapLibre Native picks a font for each character only among faces
 * whose ranges cover it, so a face must claim no character it cannot draw for the next font in a
 * `text-font` list to be used. Code points mapped to the missing glyph are not claimed.
 */
export function tileflowNativeFontUnicodeRanges(source: Uint8Array): string[] {
  const font = fontkit.create(source);
  const points = [...new Set(font.characterSet)]
    .filter(
      (point) =>
        Number.isInteger(point) &&
        point >= 0 &&
        point <= 0x10ffff &&
        font.hasGlyphForCodePoint(point),
    )
    .sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const point of points) {
    const last = runs.at(-1);
    if (last && point === last[1] + 1) last[1] = point;
    else runs.push([point, point]);
  }
  if (!runs.length || runs.length > tileflowNativeFontRangeLimit)
    throw new RangeError('A native font must map between 1 and 4096 runs of characters.');
  // Native engines read only the `U+start-end` form, so single characters repeat their code point.
  const hex = (point: number) => point.toString(16).toUpperCase().padStart(4, '0');
  return runs.map(([start, end]) => `U+${hex(start)}-${hex(end)}`);
}
