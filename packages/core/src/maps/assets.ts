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

/**
 * An explicit MapLibre glyph provider. `fontStacks` lists the exact comma-joined request keys
 * produced by each compiled `text-font` array. The map owns the URL; World never supplies fonts.
 */
export type TileflowGlyphs = Readonly<{
  fontStacks: readonly string[];
  kind: 'url';
  url: string;
}>;
