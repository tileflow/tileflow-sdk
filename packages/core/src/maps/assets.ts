/** A directory resolved relative to the selected executable tileflow.config.ts. */
export type TileflowLocalDirectory = `./${string}` | `../${string}`;

export const tileflowLocalDirectoryMaximumLength = 512;
export const tileflowLocalDirectoryMessage =
  'Expected a canonical relative directory beginning with ./ or ../; only leading .. segments are allowed and segments must be non-empty, without backslashes or controls';

/** Exact portable syntax shared by config validation and Node filesystem resolution. */
export function isTileflowLocalDirectory(value: unknown): value is TileflowLocalDirectory {
  if (typeof value !== 'string' || value.length < 3) return false;
  if (value.length > tileflowLocalDirectoryMaximumLength) return false;
  if (value.includes('\\') || /[\p{Cc}]/u.test(value)) return false;

  let remainder: string;
  if (value.startsWith('./')) {
    remainder = value.slice(2);
  } else if (value.startsWith('../')) {
    remainder = value;
    while (remainder.startsWith('../')) remainder = remainder.slice(3);
  } else {
    return false;
  }

  return (
    remainder.length > 0 &&
    remainder
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

/**
 * A package-owned asset directory. Applications normally import one of these
 * descriptors from the package that owns the assets instead of constructing it.
 */
export type TileflowPackageDirectory = Readonly<{
  kind: 'package-directory';
  package: string;
  path: string;
}>;

/** One icon directory in the ordered map icon search path. */
export type TileflowIconDirectory = TileflowLocalDirectory | TileflowPackageDirectory;

/** One font directory in the ordered map font search path. */
export type TileflowFontDirectory = TileflowLocalDirectory | TileflowPackageDirectory;

/** One directory of 3D models in the ordered map model search path. */
export type TileflowModelDirectory = TileflowLocalDirectory | TileflowPackageDirectory;

/**
 * Tree models published as files, such as Tileflow's official tree models. `url` names each
 * model's file with `{model}` for its id and `{level}` for `near` or `far`; every model listed has
 * both. The style carries only these URLs, and the renderer downloads each file the first time
 * trees that draw it come into view, so a view without trees downloads none.
 */
export type TileflowModelSet = Readonly<{
  kind: 'url';
  url: string;
  models: readonly string[];
}>;

/** One entry of a map's models: a directory of its own models, or a set published as files. */
export type TileflowModelSource = TileflowModelDirectory | TileflowModelSet;

/** The most models one model set lists. */
export const tileflowModelSetLimit = 16;

/** A model set's file URL for one model and level. */
export function tileflowModelSetUrl(set: TileflowModelSet, model: string, level: 'near' | 'far') {
  return set.url.replaceAll('{model}', model).replaceAll('{level}', level);
}

/** Whether an entry of a map's models is a published model set rather than a directory. */
export function isTileflowModelSet(value: unknown): value is TileflowModelSet {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as {kind?: unknown}).kind === 'url',
  );
}

/**
 * An explicit MapLibre glyph provider. `fontStacks` lists the exact comma-joined request keys
 * produced by each compiled `text-font` array. A Tileflow glyph set URL also combines any list of at
 * most 10 declared fonts, so there each font is enough. The map owns the URL; World never supplies
 * fonts.
 */
export type TileflowGlyphs = Readonly<{
  fontStacks: readonly string[];
  kind: 'url';
  url: string;
}>;

/** Complete official font files used after the map's own fonts, in explicit order. */
export type TileflowFontFallback = Readonly<{
  kind: 'official-fonts';
  assetSetSha256: string;
  fontStack: readonly string[];
}>;
