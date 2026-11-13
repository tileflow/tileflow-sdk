import type {TileflowFontFallback} from './maps/assets';
import source from './official-fonts.generated.json';

/** Immutable files shared by maps; binaries are delivered separately from the SDK. */
export const tileflowOfficialFontAssetSet = source;
export const officialFontFallback: TileflowFontFallback = Object.freeze({
  kind: 'official-fonts',
  assetSetSha256: source.assetSetSha256,
  fontStack: Object.freeze(['Noto Sans Regular']),
});

export function officialFontFiles(fallback: TileflowFontFallback) {
  if (fallback.assetSetSha256 !== source.assetSetSha256 || fallback.kind !== 'official-fonts')
    throw new TypeError('Unknown official font set.');
  return fallback.fontStack.flatMap((name) => {
    const face = source.manifest.fontFaces.find((candidate) => candidate.name === name);
    if (!face) throw new TypeError(`Unknown official font face: ${name}`);
    return face.files.map((file) => ({
      url: `https://api.tileflow.dev/base/${source.assetSetSha256}/${file.path}`,
      'unicode-range': [...file['unicode-range']],
    }));
  });
}

const officialRangesByUrl = new Map<string, string>(
  source.manifest.fontFaces.flatMap((face) =>
    face.files.map(
      (file) =>
        [
          `https://api.tileflow.dev/base/${source.assetSetSha256}/${file.path}`,
          JSON.stringify(file['unicode-range']),
        ] as const,
    ),
  ),
);

/** Full identity and cmap must match the reviewed shared resource. */
export function isOfficialFontFile(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as {url?: unknown; 'unicode-range'?: unknown};
  if (typeof file.url !== 'string') return false;
  const ranges = officialRangesByUrl.get(file.url);
  return ranges !== undefined && JSON.stringify(file['unicode-range']) === ranges;
}
