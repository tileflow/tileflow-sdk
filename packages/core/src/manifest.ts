import type {z} from 'zod';
import {createTileflowRuntimeManifestSchema} from './manifest-schema';
import {classicManifestSchemaOperations} from './manifest-schema-classic';
import type {TileflowRuntimeManifest} from './manifest-types';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';

export {tileflowRuntimeManifestLimits, tileflowRuntimeManifestVersion} from './manifest-types';
export type {
  TileflowRuntimeColorScheme,
  TileflowRuntimeManifest,
  TileflowRuntimeManifestMapEntry,
  TileflowRuntimeManifestTheme,
  TileflowRuntimeSystemThemes,
} from './manifest-types';

export const tileflowRuntimeManifestSchema: z.ZodType<TileflowRuntimeManifest> =
  createTileflowRuntimeManifestSchema(
    {
      parseUrl: (value, base) => (base === undefined ? new URL(value) : new URL(value, base)),
      utf8ByteLength: (value) => new TextEncoder().encode(value).byteLength,
    },
    classicManifestSchemaOperations,
    {tileflowPortableIdSchema, tileflowThemeNameSchema},
  ) as z.ZodType<TileflowRuntimeManifest>;

export function parseTileflowRuntimeManifest(input: unknown): TileflowRuntimeManifest {
  return tileflowRuntimeManifestSchema.parse(input);
}

export function safeParseTileflowRuntimeManifest(input: unknown) {
  return tileflowRuntimeManifestSchema.safeParse(input);
}
