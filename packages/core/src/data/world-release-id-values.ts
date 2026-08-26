/** Exact immutable release identity contract for the current World V1 product. */
export const tileflowWorldReleaseIdMinimumLength = 12 as const;
export const tileflowWorldReleaseIdMaximumLength = 128 as const;
export const tileflowWorldReleaseIdPatternSource =
  '^world-v1-[a-z0-9][a-z0-9._-]*[a-z0-9]$' as const;
export const tileflowWorldReleaseIdPattern = new RegExp(tileflowWorldReleaseIdPatternSource, 'u');

/** Validate without trimming, lowercasing, or otherwise normalizing an immutable release ID. */
export function isTileflowWorldReleaseId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= tileflowWorldReleaseIdMinimumLength &&
    value.length <= tileflowWorldReleaseIdMaximumLength &&
    tileflowWorldReleaseIdPattern.test(value)
  );
}
