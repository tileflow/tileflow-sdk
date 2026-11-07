/** A build failure with a stable code that agents and scripts can branch on. */
export class TilesetBuildError extends Error {
  constructor(
    readonly code: `TF_TILESET_BUILD_${string}`,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'TilesetBuildError';
  }
}

/** Readers call this between chunks so that Ctrl-C can run its cleanup during a long read. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
