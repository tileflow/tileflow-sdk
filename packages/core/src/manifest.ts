import {createTileflowRuntimeManifestParser} from './manifest-schema';
import type {TileflowRuntimeManifest} from './manifest-types';

export {tileflowRuntimeManifestLimits, tileflowRuntimeManifestVersion} from './manifest-types';
export type {
  TileflowRuntimeColorScheme,
  TileflowRuntimeManifest,
  TileflowRuntimeManifestMapEntry,
  TileflowRuntimeManifestTheme,
  TileflowRuntimeSystemThemes,
} from './manifest-types';

const parser = createTileflowRuntimeManifestParser({
  parseUrl: (value, base) => (base === undefined ? new URL(value) : new URL(value, base)),
  utf8ByteLength: (value) => new TextEncoder().encode(value).byteLength,
});
export const tileflowRuntimeManifestSchema = parser.tileflowRuntimeManifestSchema;

export function parseTileflowRuntimeManifest(input: unknown): TileflowRuntimeManifest {
  return parser.parseTileflowRuntimeManifest(input);
}

export function safeParseTileflowRuntimeManifest(input: unknown) {
  return parser.safeParseTileflowRuntimeManifest(input);
}
