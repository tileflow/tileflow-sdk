import {randomBytes} from 'node:crypto';
import {renderTileflowComparisonHtml} from './comparison-html';
import {normalizeTileflowBasePath} from './public-paths';

export const tileflowComparisonSchemaVersion = 1 as const;

export type TileflowComparisonRequestHandler = (request: Request) => Promise<Response> | Response;

export type TileflowComparisonSide = {
  /** Route base owned by this side's existing Tileflow dev handler. */
  basePath: string;
  /** Optional safe cwd-relative config argument used by Copy command. */
  captureConfig?: string;
  handler: TileflowComparisonRequestHandler;
  /** Human-readable local label. It is never interpreted as HTML. */
  label: string;
  /** Optional compiler-inspection sidecar exposed by the owning handler. */
  sidecarUrl?: string;
  /** Same-origin preview URL below basePath, including its map/theme query. */
  previewUrl: string;
};

export type TileflowComparisonMode = 'blink' | 'overlay' | 'side-by-side' | 'split';

export type TileflowComparisonOptions = {
  basePath?: string;
  initialMode?: TileflowComparisonMode;
  left: TileflowComparisonSide;
  right: TileflowComparisonSide;
  title?: string;
};

type NormalizedSide = Omit<TileflowComparisonSide, 'basePath'> & {
  basePath: string;
  eventsUrl: string;
  statusUrl: string;
};

/**
 * Compose two existing Tileflow dev handlers behind one same-origin comparison shell.
 *
 * The side handlers retain ownership of styles, sprites, fonts, generations, live
 * events, and last-known-good behavior. This router owns only the shell document and
 * deterministic dispatch by route prefix.
 */
export function createTileflowComparisonRequestHandler(options: TileflowComparisonOptions) {
  const comparisonBasePath = normalizeTileflowBasePath(options.basePath);
  const left = normalizeSide(options.left, 'left', comparisonBasePath);
  const right = normalizeSide(options.right, 'right', comparisonBasePath);
  assertDisjointSideRoutes(left.basePath, right.basePath);
  const title = normalizeLabel(options.title ?? 'Tileflow comparison', 'title');
  const initialMode = options.initialMode ?? 'side-by-side';

  return async function handleTileflowComparisonRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (matchesBasePath(pathname, left.basePath)) return await left.handler(request);
    if (matchesBasePath(pathname, right.basePath)) return await right.handler(request);

    if (isComparisonRoot(pathname, comparisonBasePath)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonResponse({error: 'Method not allowed'}, 405);
      }
      const cspNonce = randomBytes(18).toString('base64');
      const html = renderTileflowComparisonHtml({
        basePath: comparisonBasePath,
        cspNonce,
        initialMode,
        left: publicSide(left),
        right: publicSide(right),
        schemaVersion: tileflowComparisonSchemaVersion,
        title,
      });
      return new Response(request.method === 'HEAD' ? null : html, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': comparisonContentSecurityPolicy(cspNonce),
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return jsonResponse({error: 'Not found'}, 404);
  };
}

function comparisonContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'self'",
    "img-src 'self' blob: data:",
    "object-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src-elem 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
  ].join('; ');
}

function normalizeSide(
  side: TileflowComparisonSide,
  name: 'left' | 'right',
  comparisonBasePath: string,
): NormalizedSide {
  const basePath = normalizeTileflowBasePath(side.basePath);
  if (!basePath) {
    throw new TypeError(`Tileflow comparison ${name} basePath must not own the server root.`);
  }
  if (comparisonBasePath && !matchesBasePath(basePath, comparisonBasePath)) {
    throw new TypeError(
      `Tileflow comparison ${name} basePath must be inside ${comparisonBasePath}.`,
    );
  }
  if (typeof side.handler !== 'function') {
    throw new TypeError(`Tileflow comparison ${name} handler must be a function.`);
  }

  return {
    ...side,
    basePath,
    ...(side.captureConfig === undefined
      ? {}
      : {captureConfig: normalizeCaptureConfig(side.captureConfig, `${name} captureConfig`)}),
    eventsUrl: `${basePath}/__events`,
    label: normalizeLabel(side.label, `${name} label`),
    previewUrl: normalizeOwnedUrl(side.previewUrl, basePath, `${name} previewUrl`),
    ...(side.sidecarUrl
      ? {sidecarUrl: normalizeOwnedUrl(side.sidecarUrl, basePath, `${name} sidecarUrl`)}
      : {}),
    statusUrl: `${basePath}/__status`,
  };
}

function publicSide(side: NormalizedSide) {
  return {
    basePath: side.basePath,
    ...(side.captureConfig ? {captureConfig: side.captureConfig} : {}),
    eventsUrl: side.eventsUrl,
    label: side.label,
    previewUrl: side.previewUrl,
    ...(side.sidecarUrl ? {sidecarUrl: side.sidecarUrl} : {}),
    statusUrl: side.statusUrl,
  };
}

function normalizeCaptureConfig(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    /[\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`Invalid Tileflow comparison ${label}.`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(
      `Tileflow comparison ${label} must be a normalized path inside the current working directory.`,
    );
  }
  return value;
}

function normalizeOwnedUrl(value: string, basePath: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    !value.startsWith('/') ||
    value.includes('\\') ||
    /[\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`Invalid Tileflow comparison ${label}.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value, 'http://tileflow.local');
  } catch {
    throw new TypeError(`Invalid Tileflow comparison ${label}.`);
  }
  if (
    parsed.origin !== 'http://tileflow.local' ||
    parsed.hash ||
    !matchesBasePath(parsed.pathname, basePath)
  ) {
    throw new TypeError(`Tileflow comparison ${label} must remain below ${basePath}.`);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function normalizeLabel(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 160 ||
    value !== value.trim() ||
    /[\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`Invalid Tileflow comparison ${label}.`);
  }
  return value
    .split(' · ')
    .map((part, index) => (index > 0 && /[\\/]/u.test(part) ? part.split(/[\\/]/u).at(-1)! : part))
    .join(' · ');
}

function assertDisjointSideRoutes(left: string, right: string): void {
  if (matchesBasePath(left, right) || matchesBasePath(right, left)) {
    throw new TypeError('Tileflow comparison side base paths must be disjoint.');
  }
}

function isComparisonRoot(pathname: string, basePath: string): boolean {
  return basePath ? pathname === basePath || pathname === `${basePath}/` : pathname === '/';
}

function matchesBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
