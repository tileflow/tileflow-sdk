export const tileflowFontFallbackMetadataKey = 'tileflow:fontFallback' as const;
export const tileflowFontFallbackWebMinimum = '6.16.0' as const;

/** New mixed styles require font-faces; older styles retain their existing renderer support. */
export function assertTileflowFontFallbackWebSupport(
  style: {metadata?: Record<string, unknown>},
  version: string,
): void {
  if (style.metadata?.[tileflowFontFallbackMetadataKey] !== 1) return;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (!match || Number(match[1]) < 6 || (Number(match[1]) === 6 && Number(match[2]) < 16))
    throw new Error(
      `Font fallback requires MapLibre GL JS ${tileflowFontFallbackWebMinimum} or newer.`,
    );
}
