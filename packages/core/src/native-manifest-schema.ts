import {createTileflowRuntimeManifestParser} from './manifest-schema';
import {nativeManifestUtf8ByteLength} from './native-manifest-utf8';
import {parseNativeUrl} from './native-url-provider';

/** Same canonical schema and parser; only platform primitives are private and portable. */
export const {parseTileflowRuntimeManifest} = createTileflowRuntimeManifestParser({
  parseUrl: parseNativeUrl,
  utf8ByteLength: nativeManifestUtf8ByteLength,
});
