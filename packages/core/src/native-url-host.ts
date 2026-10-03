import {createNativeUrlPolicy} from './native-url-policy';

export {TileflowNativeUrlError} from './native-url-policy';

// Build-only validation already runs in a WHATWG host. Keep the mobile parser out of its bundle.
// The constructor is read only when resolving a URL, never while importing this module.
export const {resolveTileflowNativeResourceUrl} = createNativeUrlPolicy((value, base) =>
  base === undefined ? new URL(value) : new URL(value, base),
);
