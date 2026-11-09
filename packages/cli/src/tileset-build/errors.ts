/** A build failure with a stable code that agents and scripts can branch on. */
export class TilesetBuildError extends Error {
  constructor(
    readonly code: `TF_TILESET_BUILD_${string}`,
    readonly path: string,
    message: string,
    /** What the caller can pick from, when the input holds several layers or entries. */
    readonly choices?: readonly string[],
  ) {
    super(message);
    this.name = 'TilesetBuildError';
  }
}

/** Ends a read early once a sample is complete. */
export class SampleComplete extends TilesetBuildError {
  constructor() {
    super('TF_TILESET_BUILD_SAMPLE_COMPLETE', 'input', 'The sample is complete.');
  }
}

/** Readers call this between chunks so that Ctrl-C can run its cleanup during a long read. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The names a "choose one" error offers, capped so that a hostile file cannot flood the message. */
export function listChoices(names: readonly string[]): string {
  const shown = names.slice(0, 20).join(', ');
  return names.length > 20 ? `${shown}, and ${names.length - 20} more` : shown;
}

/**
 * Vertices one feature may hold while it is assembled in memory. Readers enforce it before
 * allocating, so that a small file claiming a huge geometry stops with an error instead of a crash.
 */
export const maximumFeaturePositions = 5_000_000;

/** Bytes one feature may span before it is parsed, far more than those positions need. */
export const maximumFeatureBytes = 256 * 1024 * 1024;

export function featureTooManyBytes(location: string): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_LIMIT',
    'input',
    `${location}: the feature takes more than ${maximumFeatureBytes / 1024 ** 2} MiB. Split or simplify it first.`,
  );
}

export function featureTooLarge(location: string): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_LIMIT',
    'input',
    `${location}: the feature has more than ${maximumFeaturePositions} positions. Split or simplify it first.`,
  );
}
