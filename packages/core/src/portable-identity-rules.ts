export const tileflowPortableIdMaximumLength = 64 as const;
export const tileflowPortableIdPattern = /^[a-z][a-z0-9-]{0,63}$/u;

export function isTileflowPortableId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= tileflowPortableIdMaximumLength &&
    tileflowPortableIdPattern.test(value) &&
    !['constructor', 'prototype'].includes(value) &&
    !/^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/i.test(value)
  );
}

export function isTileflowThemeName(value: unknown): value is string {
  return isTileflowPortableId(value) && value !== 'system';
}
