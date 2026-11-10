/**
 * Font fallback stacks on Tileflow glyph sets. MapLibre requests a layer's `text-font` list as one
 * comma-joined `{fontstack}`; a Tileflow glyph set URL (`/base/<assetSetSha256>/glyphs/...`)
 * composites any stack of at most ten fonts the set publishes, the first font holding a glyph
 * winning, so a map declares fonts and may combine them. Other providers serve only the exact keys
 * declared.
 */

/** The most fonts one requested stack may name on Tileflow's hosted glyph routes. */
export const tileflowGlyphStackMaxFonts = 10;

// The fonts each reviewed Tileflow glyph set publishes, by its manifest SHA-256.
const reviewedGlyphSetFonts: ReadonlyMap<string, readonly string[]> = new Map([
  [
    '33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3',
    ['Noto Sans Bold', 'Noto Sans Italic', 'Noto Sans Regular'],
  ],
]);

export type TileflowGlyphSet = Readonly<{
  assetSetSha256: string;
  /** The fonts the set publishes when the SDK knows the set; otherwise the map's declaration. */
  fonts?: readonly string[];
}>;

/** The Tileflow glyph set a glyph URL template names, or undefined for any other provider. */
export function tileflowGlyphSet(url: string): TileflowGlyphSet | undefined {
  let path: string;
  try {
    path = new URL(url, 'https://relative.invalid').pathname;
  } catch {
    return undefined;
  }
  const match =
    /\/base\/([0-9a-f]{64})\/glyphs\/(?:\{|%7B)fontstack(?:\}|%7D)\/(?:\{|%7B)range(?:\}|%7D)\.pbf$/iu.exec(
      path,
    );
  if (!match) return undefined;
  const assetSetSha256 = match[1]!.toLowerCase();
  const fonts = reviewedGlyphSetFonts.get(assetSetSha256);
  return fonts ? {assetSetSha256, fonts} : {assetSetSha256};
}

/** Why a declared stack cannot be served by a Tileflow glyph set, or undefined when it can. */
export function tileflowGlyphStackProblem(
  set: TileflowGlyphSet,
  fontStack: string,
): string | undefined {
  const fonts = fontStack.split(',');
  if (fonts.length > tileflowGlyphStackMaxFonts) {
    return `names ${fonts.length} fonts; a Tileflow glyph stack names at most ${tileflowGlyphStackMaxFonts}`;
  }
  if (fonts.some((font) => font.length === 0 || font !== font.trim())) {
    return 'has an empty or space-padded font name between its commas';
  }
  const missing = set.fonts ? fonts.filter((font) => !set.fonts!.includes(font)) : [];
  if (missing.length > 0) {
    return (
      `names ${missing.map((font) => `"${font}"`).join(', ')}, which glyph set ` +
      `${set.assetSetSha256.slice(0, 12)} does not publish (it publishes ${set.fonts!.join(', ')})`
    );
  }
  return undefined;
}

/**
 * Whether a provider serves the stack a layer requests: an exact declared key always; on a
 * Tileflow glyph set, also any stack of at most ten fonts each declared, alone or within a
 * declared stack.
 */
export function servesGlyphFontStack(
  url: string,
  declared: readonly string[],
  fontStack: string,
): boolean {
  if (declared.includes(fontStack)) return true;
  const set = tileflowGlyphSet(url);
  if (!set || tileflowGlyphStackProblem(set, fontStack)) return false;
  const fonts = new Set(declared.flatMap((stack) => stack.split(',')));
  return fontStack.split(',').every((font) => fonts.has(font));
}
