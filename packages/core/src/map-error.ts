/**
 * What failed. The codes are stable; an application can branch on them.
 *
 * - `manifest`: the map manifest could not be loaded, or does not contain the requested map.
 * - `theme`: the requested theme, or its time of day, is not in the map, or the change failed.
 * - `blend`: a theme blend named a theme the map does not have, or the blend failed.
 * - `colors`: the `colors` overrides were rejected, for example an unknown token or an invalid value.
 * - `emphasis`: the `emphasis` setting was rejected.
 * - `runtime`: the map could not be created, loaded or taken down.
 * - `scene`: the 3D scene could not be loaded.
 * - `camera`: `bounds` or `fitAnnotations` could not be turned into a view.
 */
export type TileflowMapErrorCode =
  'blend' | 'camera' | 'colors' | 'emphasis' | 'manifest' | 'runtime' | 'scene' | 'theme';

/** A failure the map recovered from or could not avoid, passed to `onError`. */
export type TileflowMapError = Readonly<{
  code: TileflowMapErrorCode;
  /** The underlying failure, always an `Error`. */
  error: Error;
}>;

/** Receives a map failure. When a map has none, the failure goes to `console.error`. */
export type TileflowMapErrorHandler = (event: TileflowMapError) => void;

const consoleMessages: Readonly<Record<TileflowMapErrorCode, string>> = {
  blend: 'Failed to blend the Tileflow map themes',
  camera: 'Invalid Tileflow map camera',
  colors: 'Failed to apply the Tileflow map colors',
  emphasis: 'Failed to apply the Tileflow map emphasis',
  manifest: 'Failed to load Tileflow manifest',
  runtime: 'Failed to load the Tileflow map runtime',
  scene: 'Failed to load the Tileflow 3D scene',
  theme: 'Failed to change the Tileflow map theme',
};

/**
 * Reports a failure to `handler`, or to `console.error` when the application gave none. A handler
 * that throws is itself logged, so a failing handler never breaks the map.
 */
export function reportTileflowMapError(
  handler: TileflowMapErrorHandler | undefined,
  code: TileflowMapErrorCode,
  cause: unknown,
): void {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!handler) {
    console.error(consoleMessages[code], error);
    return;
  }
  try {
    handler({code, error});
  } catch (handlerError) {
    console.error('A Tileflow onError handler threw', handlerError);
  }
}
