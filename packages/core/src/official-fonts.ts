import type {TileflowFontFallback} from './maps/assets';
import source from './official-fonts.generated.json';

/** Immutable files shared by maps; binaries are delivered separately from the SDK. */
export const tileflowOfficialFontAssetSet = source;
export const officialFontFallback: TileflowFontFallback = Object.freeze({
  kind: 'official-fonts',
  assetSetSha256: source.assetSetSha256,
  fontStack: Object.freeze(['Noto Sans Regular']),
});

export function officialFontFiles(
  fallback: TileflowFontFallback,
  apiBaseUrl = 'https://api.tileflow.dev',
) {
  if (fallback.assetSetSha256 !== source.assetSetSha256 || fallback.kind !== 'official-fonts')
    throw new TypeError('Unknown official font set.');
  return fallback.fontStack.flatMap((name) => {
    const face = source.manifest.fontFaces.find((candidate) => candidate.name === name);
    if (!face) throw new TypeError(`Unknown official font face: ${name}`);
    return face.files.map((file) => ({
      url: `${new URL(apiBaseUrl).origin}/base/${source.assetSetSha256}/${file.path}`,
      'unicode-range': [...file['unicode-range']],
    }));
  });
}

const officialRangesByPath = new Map<string, string>(
  source.manifest.fontFaces.flatMap((face) =>
    face.files.map(
      (file) =>
        [
          `/base/${source.assetSetSha256}/${file.path}`,
          JSON.stringify(file['unicode-range']),
        ] as const,
    ),
  ),
);

/** Identity, cmap and the explicitly configured delivery origin must all match. */
export function isOfficialFontFile(
  value: unknown,
  apiBaseUrl = 'https://api.tileflow.dev',
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as {url?: unknown; 'unicode-range'?: unknown};
  if (typeof file.url !== 'string') return false;
  try {
    const url = new URL(file.url),
      origin = new URL(apiBaseUrl).origin;
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const ranges = officialRangesByPath.get(url.pathname);
    return ranges !== undefined && JSON.stringify(file['unicode-range']) === ranges;
  } catch {
    return false;
  }
}
