function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f || '\\?#'.includes(character)) return true;
  }
  return false;
}

/** Normalize a development route base. This is a URL pathname, never a filesystem path. */
export function normalizeTileflowBasePath(value = ''): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  if (hasUnsafeUrlCharacter(trimmed)) throw invalidBasePath(value);

  const withoutEdges = trimmed.replace(/^\/+|\/+$/gu, '');
  if (!withoutEdges) return '';
  const segments = withoutEdges.split('/');
  if (segments.some((segment) => !isSafeRouteSegment(segment))) throw invalidBasePath(value);
  return `/${segments.join('/')}`;
}

/**
 * Join a bundler public URL prefix to the Tileflow route without changing URL-reference kind.
 * In particular, `./` and `../` remain path-relative rather than becoming root-relative.
 */
export function joinTileflowPublicUrl(publicBase: string, basePath: string): string {
  const normalizedBase = normalizePublicBase(publicBase);
  const trimmedPath = normalizeTileflowBasePath(basePath).replace(/^\//u, '');

  if (!trimmedPath) return publicBaseWithoutResource(normalizedBase);
  if (!normalizedBase || normalizedBase === '/') return `/${trimmedPath}`;
  if (normalizedBase === '.') return `./${trimmedPath}`;
  if (normalizedBase === '..') return `../${trimmedPath}`;
  return `${normalizedBase}/${trimmedPath}`;
}

/**
 * Resolve the public URL at which a manifest is exposed and the URLs embedded inside its artifacts.
 * Path-relative deployments use owner-relative references because the manifest already lives below
 * the public prefix.
 */
export function resolveTileflowArtifactPublicUrls(
  publicBase: string,
  basePath: string,
): {assetBaseUrl?: string; publicBaseUrl: string; styleBaseUrl: string} {
  const publicBaseUrl = joinTileflowPublicUrl(publicBase, basePath);
  if (publicBaseUrl.startsWith('./') || publicBaseUrl.startsWith('../')) {
    return {publicBaseUrl, styleBaseUrl: '.'};
  }
  return {assetBaseUrl: publicBaseUrl, publicBaseUrl, styleBaseUrl: publicBaseUrl};
}

/** Convert a validated route base to a bundler-relative asset prefix. */
export function getTileflowAssetBasePath(basePath: string): string {
  return normalizeTileflowBasePath(basePath).replace(/^\//u, '');
}

export function getTileflowAssetFileName(basePath: string, fileName: string): string {
  const assetBasePath = getTileflowAssetBasePath(basePath);
  assertSafeAssetFileName(fileName);
  return assetBasePath ? `${assetBasePath}/${fileName}` : fileName;
}

function normalizePublicBase(value: string): string {
  if (value !== value.trim() || hasUnsafeUrlCharacter(value)) throw invalidPublicBase(value);
  if (!value) return '';
  if (value.startsWith('//')) throw invalidPublicBase(value);

  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw invalidPublicBase(value);
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw invalidPublicBase(value);
    }
    return value.replace(/\/+$/gu, '');
  }

  if (value === '/') return '/';
  const withoutTrailingSlash = value.replace(/\/+$/gu, '');
  if (!withoutTrailingSlash) return '/';
  if (
    withoutTrailingSlash.startsWith('/') ||
    withoutTrailingSlash === '.' ||
    withoutTrailingSlash === '..' ||
    withoutTrailingSlash.startsWith('./') ||
    withoutTrailingSlash.startsWith('../')
  ) {
    return withoutTrailingSlash;
  }
  return `./${withoutTrailingSlash}`;
}

function publicBaseWithoutResource(value: string): string {
  if (value === '.') return './';
  if (value === '..') return '../';
  return value;
}

function isSafeRouteSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !decoded.includes('/') &&
    !decoded.includes('\\') &&
    !hasUnsafeUrlCharacter(decoded)
  );
}

function assertSafeAssetFileName(fileName: string): void {
  if (
    !fileName ||
    fileName.startsWith('/') ||
    fileName.endsWith('/') ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    fileName.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe Tileflow asset file name: ${fileName}`);
  }
}

function invalidBasePath(value: string): TypeError {
  return new TypeError(`Invalid Tileflow base path: ${JSON.stringify(value)}`);
}

function invalidPublicBase(value: string): TypeError {
  return new TypeError(`Invalid Tileflow public base: ${JSON.stringify(value)}`);
}
