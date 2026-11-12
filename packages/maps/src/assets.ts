import type {TileflowGlyphs, TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/**
 * Tileflow's official glyph set: DINish Medium and Bold, and Noto Sans Regular, Bold and Italic, as
 * MapLibre glyph ranges with each font's licence at `glyphs/<font>/LICENSE.md`. The set is
 * immutable; its address is the SHA-256 of its manifest.
 */
export const officialGlyphsUrl =
  'https://api.tileflow.dev/base/fe873949787f8f1e2ff72853d13c1e6e3c1de83474e4c1de60dae6ac33fe3081/glyphs/{fontstack}/{range}.pbf';

/**
 * The glyphs Streets and Outdoors letter with. Tileflow composites a comma-joined stack of the
 * set's fonts per code point, so `DINish Medium,Noto Sans Regular` draws Latin text in DINish and
 * every other script the set covers in Noto Sans. A map of its own may declare the same glyphs.
 */
export const streetsGlyphs: TileflowGlyphs = Object.freeze({
  fontStacks: Object.freeze([
    'DINish Medium,Noto Sans Regular',
    'DINish Bold,Noto Sans Regular',
    'Noto Sans Regular',
    'Noto Sans Bold',
    'Noto Sans Italic',
  ]),
  kind: 'url',
  url: officialGlyphsUrl,
});

/** Package-owned Streets tree geometry, including the lighter far models. */
export const streetsModels = packageDirectory('assets/streets/models');

/** Package-owned Soundings symbols and patterns. This root does not compose Streets assets. */
export const soundingsIcons = packageDirectory('assets/soundings/icons');

/** Summit symbols for the Outdoors map. */
export const outdoorsIcons = packageDirectory('assets/outdoors/icons');
