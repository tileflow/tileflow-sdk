import {
  createNativeUrlPolicy,
  type TileflowNativeNetworkOptions,
  type TileflowNativeResourceUrlOptions,
} from './native-url-policy';
import {parseNativeUrl} from './native-url-provider';

export {TileflowNativeUrlError, tileflowNativeUrlLimits} from './native-url-policy';
export type {
  TileflowNativeNetworkOptions,
  TileflowNativeResourceUrlOptions,
  TileflowNativeUrlErrorCode,
  TileflowNativeUrlField,
} from './native-url-policy';

const policy = createNativeUrlPolicy(parseNativeUrl);

/** Resolve an explicit manifest URL with the private WHATWG parser, not the ambient URL. */
export function resolveTileflowNativeManifestUrl(
  value: unknown,
  options: TileflowNativeNetworkOptions = {},
): string {
  return policy.resolveTileflowNativeManifestUrl(value, options);
}

/** Resolve a resource against its owner without fetching it or authorizing requests. */
export function resolveTileflowNativeResourceUrl(
  value: unknown,
  options: TileflowNativeResourceUrlOptions,
): string {
  return policy.resolveTileflowNativeResourceUrl(value, options);
}
