import {parse} from 'zod/mini';
import {createTileflowRuntimeManifestSchema} from './manifest-schema';
import {miniManifestSchemaOperations} from './manifest-schema-mini';
import type {TileflowRuntimeManifest} from './manifest-types';
import {nativeManifestUtf8ByteLength} from './native-manifest-utf8';
import {parseNativeUrl} from './native-url-provider';

const schema = createTileflowRuntimeManifestSchema(
  {
    parseUrl: parseNativeUrl,
    utf8ByteLength: nativeManifestUtf8ByteLength,
  },
  miniManifestSchemaOperations,
);

/** Same grammar; Mini's private errors are sanitized by the manifest loader. */
export function parseTileflowRuntimeManifest(input: unknown): TileflowRuntimeManifest {
  return parse(schema, input);
}
