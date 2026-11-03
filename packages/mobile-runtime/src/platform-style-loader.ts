import {ProtocolError} from './errors';

// The embedded build substitutes Core's web-only loader with this guard. Mobile always passes
// styles.load to the theme controller so the native host owns resource authorization and fetching.
// An omitted override must fail instead of falling back to the WebView's unrestricted fetch.
export const loadTileflowRuntimeStyle: typeof import('@tileflow/core/browser').loadTileflowRuntimeStyle =
  async () => {
    throw new ProtocolError('resourceFailed', 'Theme resources require the native transport.');
  };
