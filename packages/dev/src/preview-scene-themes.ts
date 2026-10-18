/** Serialized into the preview page; keep dependencies in the arguments. */
export function createPreviewSceneThemes<Sun>(
  map: {
    getStyle(): {metadata?: Record<string, unknown>} | undefined;
    on(event: string, listener: () => void): unknown;
    off(event: string, listener: () => void): unknown;
  },
  readSun: (metadata: Record<string, unknown> | undefined) => Sun,
) {
  const cache = {
    value: undefined as {metadata: Record<string, unknown> | undefined; sun: Sun} | undefined,
    snapshot() {
      if (!cache.value) {
        // getStyle serializes every layer. All scene layers share one snapshot until
        // the style changes, including when it has no 3D metadata yet.
        const metadata = map.getStyle()?.metadata;
        cache.value = {metadata, sun: readSun(metadata)};
      }
      return cache.value;
    },
    invalidate() {
      cache.value = undefined;
    },
    release() {
      map.off('styledata', cache.invalidate);
      map.off('style.load', cache.invalidate);
      map.off('remove', cache.release);
      cache.invalidate();
    },
  };
  map.on('styledata', cache.invalidate);
  map.on('style.load', cache.invalidate);
  map.on('remove', cache.release);
  return {
    getSun() {
      return cache.snapshot().sun;
    },
    getThemeMetadata(key: string) {
      return {values: [cache.snapshot().metadata?.[key]], position: 0};
    },
  };
}
