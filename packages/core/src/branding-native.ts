import {
  readTileflowBrandingSources as readSources,
  rememberTileflowBrandingSources as rememberSources,
} from './branding';
import {parseNativeUrl} from './native-url-provider';

/** Use the same bundled URL parser as the other Native source contracts. */
export function readTileflowBrandingSources(
  style: Parameters<typeof readSources>[0],
  options: Parameters<typeof readSources>[1] = {},
) {
  return readSources(style, options, parseNativeUrl);
}

export function rememberTileflowBrandingSources(
  style: Parameters<typeof rememberSources>[0],
  options: Parameters<typeof rememberSources>[1] = {},
) {
  return rememberSources(style, options, parseNativeUrl);
}
