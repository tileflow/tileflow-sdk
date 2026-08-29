import type {
  TileflowRuntimeColorScheme,
  TileflowRuntimeManifest,
  TileflowRuntimeManifestMapEntry,
  TileflowRuntimeManifestTheme,
} from './manifest';
import {isTileflowPortableId, isTileflowThemeName} from './portable-identity-rules';
import {type MapLibreStyle, type TileflowViewConfig} from './types';

export type {
  TileflowRuntimeColorScheme,
  TileflowRuntimeManifest,
  TileflowRuntimeManifestMapEntry,
  TileflowRuntimeManifestTheme,
  TileflowRuntimeSystemThemes,
} from './manifest';

export const defaultTileflowManifestUrl = '/tileflow/manifest.json';
export const defaultTileflowRuntimeView = Object.freeze({
  bearing: 0,
  center: [0, 20] as readonly [number, number],
  pitch: 0,
  zoom: 2,
}) satisfies Required<TileflowViewConfig>;

export type TileflowAnalytics = {
  apiUrl?: string;
  endpoint?: string;
  enabled?: boolean;
  mapId?: string;
  metadata?: Record<string, unknown>;
  projectId?: string;
  sdkVersion?: string;
  source?: string;
  styleId?: string;
  surfaceId?: string;
};

const tileflowSurfaceIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;

export function normalizeTileflowSurfaceId(value: unknown): string {
  return typeof value === 'string' && tileflowSurfaceIdPattern.test(value) ? value : 'default';
}

export type TileflowSessionGrantResponse = {
  billingEnabled?: false;
  disposition?: 'ordinary' | 'unbilled_fail_open';
  expiresAt?: string;
  grant?: string;
  meterMode?: 'disabled' | 'shadow' | 'enforced';
  ok: boolean;
  resourceOrigins?: string[];
  sessionId: string;
  usageMode?: 'session';
  code?: string;
  retryWithNewSession?: boolean;
};

export type TileflowSessionController = {
  readonly sessionId: string;
  resolveRequestUrl(
    url: string,
    analytics: TileflowAnalytics | undefined,
  ): Promise<string | undefined>;
};

type TileflowSessionGrantState = {
  expiresAt: number;
  resourceOrigins: Set<string>;
  token: string | null;
};

type TileflowSessionState = {
  binding: string | null;
  grant: TileflowSessionGrantState | null;
  grantPromise: Promise<TileflowResolvedSessionGrant> | null;
  pendingGrantRequests: number;
  requestCount: number;
  sessionId: string;
  startedAt: number;
};

type TileflowResolvedSessionGrant = {
  grant: TileflowSessionGrantState;
  session: TileflowSessionState;
};

export type TileflowMapMode = 'interactive' | 'image';

export type TileflowMapModeOptions = {
  mode?: TileflowMapMode;
};

/** Runtime-ready logical map with all relative theme resources already resolved. */
export type TileflowRuntimeManifestMap = TileflowRuntimeManifestMapEntry & {
  apiUrl?: string;
  name: string;
};

/** `system` is a selector and therefore reserved as a published theme name. */
export type TileflowThemeSelection = string | 'system';

export type TileflowResolvedRuntimeTheme = TileflowRuntimeManifestTheme & {
  name: string;
};

export type TileflowRuntimeStyle = {
  analytics?: TileflowAnalytics;
  colorScheme?: TileflowRuntimeColorScheme;
  /** An explicit empty array means the manifest declares that no web fonts are required. */
  fontFaces?: TileflowStyleFontFace[];
  revision?: string;
  style: MapLibreStyle | string;
  theme?: string;
};

export const tileflowStyleFontFacesMetadataKey = 'tileflow:fontFaces' as const;
export const tileflowStyleFontFaceLimits = Object.freeze({
  maximumCount: 16,
  maximumSourceLength: 2_048,
});

export type TileflowStyleFontFace = {
  family: string;
  source: string;
  style?: 'italic' | 'normal' | 'oblique';
  weight?: '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
};

/** Browser input is either one published Tileflow map or one direct MapLibre style. */
export type TileflowRuntimeSource =
  | {
      kind: 'tileflow';
      manifestUrl?: string;
      map: string;
    }
  | {
      kind: 'maplibre';
      style: MapLibreStyle | string;
    };

export type TileflowRuntimeStyleOptions = {
  colorScheme?: TileflowRuntimeColorScheme;
  manifestMap?: TileflowRuntimeManifestMap | null;
  source: TileflowRuntimeSource;
  theme?: TileflowThemeSelection;
};

export type TileflowRuntimeSourceValidation =
  | {ok: true}
  | {
      code: 'invalid-source' | 'missing-source';
      error: string;
      ok: false;
    };

export type TileflowManifestLoadOptions = {
  source: TileflowRuntimeSource;
};

export type TileflowManifestFetchOptions = {
  /** Successful manifests are shared for this duration. Set to 0 to bypass the cache. */
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** Hard request timeout in milliseconds. Defaults to 10 seconds and is capped at 60 seconds. */
  timeoutMs?: number;
};

export type TileflowRuntimeViewOptions = TileflowViewConfig & {
  fallback?: TileflowViewConfig;
  manifestMap?: TileflowRuntimeManifestMap | null;
};

export type TileflowRuntimeCenterLike =
  | readonly [number, number]
  | {lat: number; lng: number}
  | {lat: number; lon: number};

const maxStaticImageDimension = 1280;
const maxStaticImagePixels = 1280 * 1280;
const defaultManifestCacheTtlMs = 30_000;
const maximumManifestBytes = 1024 * 1024;
const maximumSessionGrantBytes = 64 * 1024;
const manifestCache = new globalThis.Map<
  string,
  {expiresAt: number; promise: Promise<TileflowRuntimeManifest | null>}
>();
const missingStaticMapIdWarnings = new Set<string>();

export function shouldLoadTileflowManifest(options: TileflowManifestLoadOptions): boolean {
  return options.source.kind === 'tileflow';
}

export function validateTileflowRuntimeSource(source: unknown): TileflowRuntimeSourceValidation {
  if (source === undefined) {
    return {code: 'missing-source', error: 'source is required', ok: false};
  }
  if (!isPlainRuntimeRecord(source)) {
    return {code: 'invalid-source', error: 'source must be an object', ok: false};
  }

  if (source.kind === 'tileflow') {
    if (
      !isTileflowPortableId(source.map) ||
      (source.manifestUrl !== undefined &&
        (typeof source.manifestUrl !== 'string' || source.manifestUrl.length === 0))
    ) {
      return {
        code: 'invalid-source',
        error: 'a tileflow source requires a portable map id and an optional non-empty manifestUrl',
        ok: false,
      };
    }
    return {ok: true};
  }

  if (source.kind === 'maplibre') {
    const style = source.style;
    if (
      (typeof style !== 'string' || style.length === 0) &&
      (!style || typeof style !== 'object' || Array.isArray(style))
    ) {
      return {
        code: 'invalid-source',
        error: 'a maplibre source requires a style object or non-empty style URL',
        ok: false,
      };
    }
    return {ok: true};
  }

  return {
    code: 'invalid-source',
    error: "source.kind must be 'tileflow' or 'maplibre'",
    ok: false,
  };
}

/** Validate the only runtime selection grammar: one concrete portable name or `system`. */
export function validateTileflowThemeSelection(value: unknown): value is TileflowThemeSelection {
  return value === 'system' || isTileflowThemeName(value);
}

export function assertValidTileflowRuntimeSource(
  source: unknown,
): asserts source is TileflowRuntimeSource {
  const validation = validateTileflowRuntimeSource(source);
  if (!validation.ok) {
    throw new TypeError(`Invalid Tileflow runtime source: ${validation.error}`);
  }
}

export function resolveTileflowRuntimeStyle(
  options: TileflowRuntimeStyleOptions,
): TileflowRuntimeStyle | null {
  assertValidTileflowRuntimeSource(options.source);

  if (options.source.kind === 'maplibre') {
    if (options.theme !== undefined) {
      throw new TypeError('The theme option is only valid for a Tileflow map source.');
    }
    if (typeof options.source.style !== 'string') {
      return {
        fontFaces: getTileflowStyleFontFaces(options.source.style),
        style: options.source.style,
      };
    }
    return {
      analytics: inferTileflowAnalyticsFromStyleUrl(options.source.style),
      style: options.source.style,
    };
  }

  if (options.manifestMap) {
    const theme = resolveTileflowRuntimeTheme(
      options.manifestMap,
      options.theme,
      options.colorScheme,
    );
    return {
      analytics: {
        apiUrl: options.manifestMap.apiUrl,
        mapId: options.manifestMap.mapId,
        styleId: theme.styleId,
      },
      colorScheme: theme.colorScheme,
      ...(theme.fontFaces === undefined ? {} : {fontFaces: [...theme.fontFaces]}),
      revision: theme.revision,
      style: theme.styleUrl,
      theme: theme.name,
    };
  }

  return null;
}

/** Resolve one concrete published theme without consulting ambient browser state. */
export function resolveTileflowRuntimeTheme(
  map: TileflowRuntimeManifestMap,
  selection: TileflowThemeSelection | undefined,
  colorScheme?: TileflowRuntimeColorScheme,
): TileflowResolvedRuntimeTheme {
  let name: string;
  if (selection === undefined) {
    name = map.defaultTheme;
  } else if (selection === 'system') {
    if (!map.systemThemes) {
      throw new Error(
        `Tileflow map "${map.name}" does not declare systemThemes; select a concrete theme.`,
      );
    }
    if (!colorScheme) {
      throw new Error('Resolving theme="system" requires an explicit browser color scheme.');
    }
    name = map.systemThemes[colorScheme];
  } else {
    name = selection;
  }

  if (!isTileflowThemeName(name)) {
    throw new Error(
      `Tileflow resolved invalid theme ${JSON.stringify(name)} for map "${map.name}"; expected a concrete portable theme name.`,
    );
  }

  const theme = Object.hasOwn(map.themes, name) ? map.themes[name] : undefined;
  if (!theme) {
    const available = Object.keys(map.themes).sort().join(', ');
    throw new Error(
      `Unknown Tileflow theme "${name}" for map "${map.name}". Available themes: ${available}.`,
    );
  }
  return {...theme, name};
}

/** Strictly reads Tileflow-owned web-font metadata from a compiled MapLibre style. */
export function getTileflowStyleFontFaces(
  style: Pick<MapLibreStyle, 'metadata'>,
): TileflowStyleFontFace[] {
  const input = style.metadata?.[tileflowStyleFontFacesMetadataKey];
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > tileflowStyleFontFaceLimits.maximumCount) {
    throw new TypeError('Invalid Tileflow style fontFaces metadata.');
  }

  const seen = new Set<string>();
  return input.map((value) => {
    if (!isPlainRuntimeRecord(value)) {
      throw new TypeError('Invalid Tileflow style fontFaces metadata.');
    }
    const keys = Object.keys(value);
    if (keys.some((key) => !['family', 'source', 'style', 'weight'].includes(key))) {
      throw new TypeError('Invalid Tileflow style fontFaces metadata.');
    }
    const family = value.family;
    const source = value.source;
    const fontStyle = value.style;
    const weight = value.weight;
    if (
      typeof family !== 'string' ||
      family.length === 0 ||
      family.length > 100 ||
      family !== family.trim() ||
      /[\p{Cc}\\]/u.test(family) ||
      typeof source !== 'string' ||
      source.length === 0 ||
      source.length > tileflowStyleFontFaceLimits.maximumSourceLength ||
      source !== source.trim() ||
      /[\p{Cc}\\]/u.test(source) ||
      !isTileflowPublicFontUrl(source) ||
      (fontStyle !== undefined && !['italic', 'normal', 'oblique'].includes(String(fontStyle))) ||
      (weight !== undefined && !/^[1-9]00$/u.test(String(weight)))
    ) {
      throw new TypeError('Invalid Tileflow style fontFaces metadata.');
    }
    const face = {
      family,
      source,
      ...(fontStyle === undefined ? {} : {style: fontStyle as TileflowStyleFontFace['style']}),
      ...(weight === undefined ? {} : {weight: weight as TileflowStyleFontFace['weight']}),
    } satisfies TileflowStyleFontFace;
    const key = `${face.family}\0${face.style ?? 'normal'}\0${face.weight ?? '400'}`;
    if (seen.has(key)) throw new TypeError('Invalid duplicate Tileflow style fontFace metadata.');
    seen.add(key);
    return face;
  });
}

export function normalizeTileflowUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function createTileflowSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ses_${crypto.randomUUID()}`;
  }

  return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createTileflowSessionController(input: {
  fetch?: typeof fetch;
  grantTimeoutMs?: number;
  now?: () => Date;
  sessionIdFactory?: () => string;
  source: string;
}): TileflowSessionController {
  const fetchGrant = input.fetch ?? globalThis.fetch;
  const grantTimeoutMs = validateSessionGrantTimeout(input.grantTimeoutMs);
  const now = input.now ?? (() => new Date());
  const sessionIdFactory = input.sessionIdFactory ?? createTileflowSessionId;
  const createSession = (startedAt: number): TileflowSessionState => ({
    binding: null,
    grant: null,
    grantPromise: null,
    pendingGrantRequests: 0,
    requestCount: 0,
    sessionId: sessionIdFactory(),
    startedAt,
  });
  let activeSession = createSession(now().getTime());

  async function resolveGrant(
    session: TileflowSessionState,
    analytics: TileflowAnalytics,
    at: number,
  ): Promise<TileflowResolvedSessionGrant> {
    if (session.grant && session.grant.expiresAt - at > 30_000) {
      return {grant: session.grant, session};
    }

    session.pendingGrantRequests += 1;
    try {
      if (!session.grantPromise) {
        const pending = (async () => {
          try {
            const nextGrant = await requestSessionGrant({
              analytics,
              at,
              fetchGrant,
              timeoutMs: grantTimeoutMs,
              sessionId: session.sessionId,
              source: input.source,
            });
            session.grant = nextGrant;
            return {grant: nextGrant, session};
          } catch (error) {
            if (!(error instanceof TileflowSessionRestartError)) throw error;

            const replacement = createSession(at);
            replacement.binding = session.binding;
            replacement.requestCount = session.pendingGrantRequests;
            if (activeSession === session) activeSession = replacement;
            const replacementPending = requestSessionGrant({
              analytics,
              at,
              fetchGrant,
              timeoutMs: grantTimeoutMs,
              sessionId: replacement.sessionId,
              source: input.source,
            }).then((nextGrant) => {
              replacement.grant = nextGrant;
              return {grant: nextGrant, session: replacement};
            });
            replacement.grantPromise = replacementPending;
            try {
              return await replacementPending;
            } finally {
              if (replacement.grantPromise === replacementPending) {
                replacement.grantPromise = null;
              }
            }
          } finally {
            session.grantPromise = null;
          }
        })();
        session.grantPromise = pending;
      }

      return await session.grantPromise;
    } finally {
      session.pendingGrantRequests -= 1;
    }
  }

  return {
    get sessionId() {
      return activeSession.sessionId;
    },
    async resolveRequestUrl(url, analytics) {
      // `enabled` controls the optional analytics beacon only. Commercial authorization is a
      // server-owned delivery requirement and must not disappear when telemetry is disabled.
      if (!analytics || !analytics.mapId) return undefined;
      const at = now().getTime();
      if (
        at - activeSession.startedAt >= 6 * 60 * 60 * 1000 ||
        activeSession.requestCount >= 10_000
      ) {
        activeSession = createSession(at);
      }

      const apiOrigin = originOf(getTileflowAnalyticsApiUrl(analytics));
      const binding = JSON.stringify([getTileflowAnalyticsApiUrl(analytics), analytics.mapId]);
      let session = activeSession;
      const grantedOrigins =
        session.binding === binding ? session.grant?.resourceOrigins : undefined;
      if (!isEligibleResource(url, analytics.mapId, apiOrigin, grantedOrigins)) {
        return undefined;
      }

      if (session.binding !== null && session.binding !== binding) {
        session = createSession(at);
        activeSession = session;
      }
      session.binding = binding;

      // Reserve the request slot before awaiting preflight so concurrent resources cannot all
      // observe the same 9,999 count and overrun the documented session boundary.
      session.requestCount += 1;
      const resolved = await resolveGrant(session, analytics, at);
      const nextUrl = new URL(url);
      nextUrl.searchParams.set('session', resolved.session.sessionId);
      nextUrl.searchParams.set('map', analytics.mapId);
      if (analytics.styleId) nextUrl.searchParams.set('styleId', analytics.styleId);
      if (resolved.grant.token) nextUrl.searchParams.set('grant', resolved.grant.token);
      return nextUrl.toString();
    },
  };
}

async function requestSessionGrant(input: {
  analytics: TileflowAnalytics;
  at: number;
  fetchGrant: typeof fetch;
  sessionId: string;
  source: string;
  timeoutMs: number;
}) {
  return runWithinSessionGrantTimeout(input.timeoutMs, async (signal) => {
    const apiUrl = getTileflowAnalyticsApiUrl(input.analytics);
    const response = await input.fetchGrant(`${apiUrl}/v1/sessions/start`, {
      body: JSON.stringify({
        mapId: input.analytics.mapId,
        sdkVersion: input.analytics.sdkVersion,
        sessionId: input.sessionId,
        source: input.analytics.source ?? input.source,
        styleId: input.analytics.styleId,
        surfaceId: normalizeTileflowSurfaceId(input.analytics.surfaceId),
      }),
      credentials: 'omit',
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      signal,
    });
    throwIfSessionGrantAborted(signal);
    let body: unknown = null;
    try {
      const source = await readBoundedUtf8Response(response, maximumSessionGrantBytes, {
        invalidUtf8: 'Tileflow session grant response was not valid UTF-8.',
        tooLarge: 'Tileflow session grant response was too large.',
      });
      body = JSON.parse(source) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) body = null;
      else throw error;
    }
    throwIfSessionGrantAborted(signal);
    if (
      response.status === 409 &&
      isRecord(body) &&
      body.code === 'COMMERCIAL_SESSION_RESTART_REQUIRED' &&
      body.ok === false &&
      body.retryWithNewSession === true &&
      body.sessionId === input.sessionId
    ) {
      throw new TileflowSessionRestartError();
    }
    if (!response.ok) {
      throw new Error(`Tileflow session grant failed: ${response.status}`);
    }
    const parsed = parseSessionGrantResponse(body, input.sessionId);
    if (!parsed) {
      throw new Error('Tileflow session grant response was invalid.');
    }
    const expiresAt = parsed.grant ? Date.parse(parsed.expiresAt!) : input.at + 60_000;
    if (
      (response.status === 201 && (!parsed.grant || !parsed.expiresAt)) ||
      (parsed.grant && (!Number.isFinite(expiresAt) || expiresAt <= input.at))
    ) {
      throw new Error('Tileflow session grant response was invalid.');
    }
    return {
      expiresAt,
      resourceOrigins: new Set(
        [originOf(apiUrl), ...(parsed.resourceOrigins ?? []).map(originOf)].filter(
          (value): value is string => Boolean(value),
        ),
      ),
      token: parsed.grant ?? null,
    };
  });
}

function validateSessionGrantTimeout(value: number | undefined): number {
  const resolved = value ?? 10_000;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 120_000) {
    throw new Error('Tileflow session grantTimeoutMs must be an integer from 1 to 120000');
  }
  return resolved;
}

async function runWithinSessionGrantTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Tileflow session grant timed out after ${timeoutMs}ms`);
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    return await raceSessionGrantWithAbort(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function raceSessionGrantWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(sessionGrantAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(sessionGrantAbortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, {once: true});
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function throwIfSessionGrantAborted(signal: AbortSignal): void {
  if (signal.aborted) throw sessionGrantAbortReason(signal);
}

function sessionGrantAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Tileflow session grant was aborted');
  error.name = 'AbortError';
  return error;
}

function parseSessionGrantResponse(
  value: unknown,
  expectedSessionId: string,
): TileflowSessionGrantResponse | null {
  if (!isRecord(value) || value.ok !== true || value.sessionId !== expectedSessionId) return null;
  if (value.usageMode !== undefined && value.usageMode !== 'session') return null;
  if (value.billingEnabled !== undefined && value.billingEnabled !== false) return null;
  if (
    value.disposition !== undefined &&
    value.disposition !== 'ordinary' &&
    value.disposition !== 'unbilled_fail_open'
  ) {
    return null;
  }
  if (
    value.meterMode !== undefined &&
    value.meterMode !== 'disabled' &&
    value.meterMode !== 'shadow' &&
    value.meterMode !== 'enforced'
  ) {
    return null;
  }
  if (
    value.grant !== undefined &&
    (typeof value.grant !== 'string' || value.grant.length === 0 || value.grant.length > 8192)
  ) {
    return null;
  }
  if (value.expiresAt !== undefined && typeof value.expiresAt !== 'string') return null;
  if (value.grant !== undefined && value.expiresAt === undefined) return null;
  if (
    value.resourceOrigins !== undefined &&
    (!Array.isArray(value.resourceOrigins) ||
      value.resourceOrigins.length > 32 ||
      value.resourceOrigins.some((origin) => !originOf(origin)))
  ) {
    return null;
  }
  return value as TileflowSessionGrantResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPlainRuntimeRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTileflowPublicFontUrl(value: string): boolean {
  if (value.startsWith('//')) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

class TileflowSessionRestartError extends Error {
  constructor() {
    super('Tileflow session must restart');
    this.name = 'TileflowSessionRestartError';
  }
}

function isEligibleResource(
  value: string,
  mapId: string,
  apiOrigin: string | null,
  grantedOrigins: Set<string> | undefined,
) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const originAllowed =
      url.origin === apiOrigin ||
      grantedOrigins?.has(url.origin) ||
      (apiOrigin === 'https://api.tileflow.dev' && url.origin === 'https://cdn.tileflow.dev');
    if (!originAllowed) return false;
    return (
      isHostedStylePath(url.pathname, mapId) ||
      url.pathname.startsWith('/tiles/') ||
      url.pathname.startsWith('/v1/tiles/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname.startsWith('/sprites/')
    );
  } catch {
    return false;
  }
}

function isHostedStylePath(pathname: string, mapId: string): boolean {
  const prefix = `/maps/${encodeURIComponent(mapId)}/`;
  if (!pathname.startsWith(prefix)) return false;
  const file = pathname.slice(prefix.length);
  if (file === 'style.json') return true;
  if (!file.endsWith('.json')) return false;
  return isTileflowThemeName(file.slice(0, -'.json'.length));
}

function originOf(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveTileflowAnalyticsRequestUrl(
  url: string,
  analytics: TileflowAnalytics | undefined,
  sessionId: string,
): string | undefined {
  if (!analytics || analytics.enabled === false) {
    return undefined;
  }

  const apiUrl = getTileflowAnalyticsApiUrl(analytics);

  if (!apiUrl || !isTileflowTileUrl(url, apiUrl)) {
    return undefined;
  }

  const nextUrl = new URL(url);
  nextUrl.searchParams.set('session', sessionId);

  if (analytics.mapId) {
    nextUrl.searchParams.set('map', analytics.mapId);
  }

  if (analytics.styleId) {
    nextUrl.searchParams.set('styleId', analytics.styleId);
  }

  return nextUrl.toString();
}

export function startTileflowSession(
  analytics: TileflowAnalytics | undefined,
  input: {
    mapId?: string;
    sessionId: string;
    source: string;
    styleId?: string;
  },
): void {
  if (
    !analytics ||
    analytics.enabled === false ||
    !input.mapId ||
    typeof navigator === 'undefined'
  ) {
    return;
  }

  const endpoint =
    analytics.endpoint ?? `${getTileflowAnalyticsApiUrl(analytics)}/v1/sessions/analytics`;
  const payload = JSON.stringify({
    mapId: input.mapId,
    metadata: analytics.metadata,
    referrer: typeof document === 'undefined' ? undefined : document.referrer || '',
    sdkVersion: analytics.sdkVersion,
    sessionId: input.sessionId,
    source: analytics.source ?? input.source,
    styleId: input.styleId,
    surfaceId: normalizeTileflowSurfaceId(analytics.surfaceId),
    timestamp: new Date().toISOString(),
  });
  const blob = new Blob([payload], {type: 'application/json'});

  if (navigator.sendBeacon?.(endpoint, blob)) {
    return;
  }

  void fetch(endpoint, {
    body: payload,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
    },
    keepalive: true,
    method: 'POST',
  }).catch(() => undefined);
}

export function getTileflowAnalyticsApiUrl(analytics: TileflowAnalytics): string {
  if (analytics.apiUrl) {
    return normalizeTileflowUrl(analytics.apiUrl);
  }

  if (analytics.endpoint) {
    try {
      const url = new URL(analytics.endpoint, getTileflowLocationOrigin());
      return url.origin;
    } catch {
      return 'https://api.tileflow.dev';
    }
  }

  return 'https://api.tileflow.dev';
}

export function mergeTileflowAnalytics(
  userAnalytics: TileflowAnalytics | undefined,
  runtimeAnalytics: TileflowAnalytics | undefined,
): TileflowAnalytics | undefined {
  if (!userAnalytics && !runtimeAnalytics?.mapId) {
    return undefined;
  }

  return {
    ...runtimeAnalytics,
    ...userAnalytics,
    apiUrl: userAnalytics?.apiUrl ?? runtimeAnalytics?.apiUrl,
    mapId: userAnalytics?.mapId ?? runtimeAnalytics?.mapId,
    styleId: userAnalytics?.styleId ?? runtimeAnalytics?.styleId,
    surfaceId: normalizeTileflowSurfaceId(userAnalytics?.surfaceId ?? runtimeAnalytics?.surfaceId),
  };
}

export function resolveTileflowMapMode(options: TileflowMapModeOptions): TileflowMapMode {
  return options.mode ?? 'interactive';
}

export function resolveTileflowRuntimeView(
  options: TileflowRuntimeViewOptions,
): TileflowViewConfig {
  const manifestView = options.manifestMap?.view;
  return {
    ...(options.fallback ?? defaultTileflowRuntimeView),
    ...(manifestView ?? {}),
    ...(options.bearing !== undefined ? {bearing: options.bearing} : {}),
    ...(options.center !== undefined ? {center: options.center} : {}),
    ...(options.pitch !== undefined ? {pitch: options.pitch} : {}),
    ...(options.zoom !== undefined ? {zoom: options.zoom} : {}),
  };
}

export function normalizeTileflowRuntimeCenter(
  center: TileflowRuntimeCenterLike | undefined,
  fallback: readonly [number, number] = defaultTileflowRuntimeView.center,
): [number, number] {
  if (!center) return [fallback[0], fallback[1]];
  let longitude: number;
  let latitude: number;
  if (Array.isArray(center)) {
    [longitude, latitude] = center as readonly [number, number];
  } else {
    const objectCenter = center as {lat: number; lng?: number; lon?: number};
    longitude = objectCenter.lng ?? objectCenter.lon!;
    latitude = objectCenter.lat;
  }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return [fallback[0], fallback[1]];
  }
  return [longitude, latitude];
}

export function loadTileflowManifest(
  url: string,
  options: TileflowManifestFetchOptions = {},
): Promise<TileflowRuntimeManifest | null> {
  assertSafeManifestRequestUrl(url);
  const ttl = normalizeManifestCacheTtl(options.cacheTtlMs);
  const timeoutMs = normalizeManifestTimeout(options.timeoutMs);
  const cacheable = ttl > 0 && !options.fetch && !options.signal;
  const now = Date.now();
  const cached = cacheable ? manifestCache.get(url) : undefined;
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) manifestCache.delete(url);

  const fetchManifest = options.fetch ?? globalThis.fetch;
  const requestSignal = createManifestRequestSignal(options.signal, timeoutMs);
  const promise = Promise.resolve()
    .then(() => fetchManifest(url, {cache: 'no-store', signal: requestSignal.signal}))
    .then(async (response) => {
      if (response.status === 404) {
        manifestCache.delete(url);
        return null;
      }
      if (!response.ok) throw new Error(`Tileflow manifest failed: ${response.status}`);

      const source = await readBoundedManifestResponse(response);
      let input: unknown;
      try {
        input = JSON.parse(source) as unknown;
      } catch {
        throw new Error('Tileflow manifest is not valid JSON.');
      }
      try {
        const {parseTileflowRuntimeManifest} = await import('./manifest');
        return resolveLoadedTileflowManifestUrls(
          parseTileflowRuntimeManifest(input),
          response.url || resolveTileflowLoadedResourceUrl(url, getTileflowLocationBaseUrl()),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'schema validation failed';
        throw new Error(`Invalid Tileflow manifest: ${message}`);
      }
    })
    .catch((error: unknown) => {
      manifestCache.delete(url);
      throw error;
    })
    .finally(requestSignal.cleanup);

  if (cacheable) manifestCache.set(url, {expiresAt: now + ttl, promise});
  return promise;
}

function resolveLoadedTileflowManifestUrls(
  manifest: TileflowRuntimeManifest,
  manifestUrl: string,
): TileflowRuntimeManifest {
  return {
    ...manifest,
    maps: Object.fromEntries(
      Object.entries(manifest.maps).map(([mapName, entry]) => [
        mapName,
        {
          ...entry,
          themes: Object.fromEntries(
            Object.entries(entry.themes).map(([themeName, theme]) => {
              const styleUrl = resolveTileflowLoadedResourceUrl(theme.styleUrl, manifestUrl);
              return [
                themeName,
                {
                  ...theme,
                  styleUrl,
                  ...(theme.fontFaces
                    ? {
                        fontFaces: theme.fontFaces.map((definition) => ({
                          ...definition,
                          source: resolveTileflowLoadedResourceUrl(definition.source, styleUrl),
                        })),
                      }
                    : {}),
                },
              ];
            }),
          ),
        },
      ]),
    ),
  };
}

function resolveTileflowLoadedResourceUrl(value: string, baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new TypeError('Tileflow manifest resource URL is invalid.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash ||
    /%(?:2f|5c)/iu.test(value)
  ) {
    throw new TypeError('Tileflow manifest resource URL is invalid.');
  }
  return url.toString();
}

export function clearTileflowManifestCache(url?: string): void {
  if (url === undefined) manifestCache.clear();
  else manifestCache.delete(url);
}

export function resolveTileflowManifestMap(
  manifest: TileflowRuntimeManifest,
  mapName: string,
): TileflowRuntimeManifestMap | null {
  if (!Object.hasOwn(manifest.maps, mapName)) return null;
  const entry = manifest.maps[mapName]!;
  const defaultStyleUrl = entry.themes[entry.defaultTheme]?.styleUrl;
  const analytics = defaultStyleUrl
    ? inferTileflowAnalyticsFromStyleUrl(defaultStyleUrl)
    : undefined;

  return {
    apiUrl: entry.apiUrl ?? manifest.apiUrl ?? analytics?.apiUrl,
    mapId: entry.mapId ?? analytics?.mapId,
    name: mapName,
    defaultTheme: entry.defaultTheme,
    ...(entry.environment ? {environment: entry.environment} : {}),
    ...(entry.systemThemes ? {systemThemes: {...entry.systemThemes}} : {}),
    themes: entry.themes,
    usageMode: entry.usageMode,
    view: entry.view,
    worldGeneration: entry.worldGeneration,
  };
}

export function resolveTileflowStaticImageUrl(input: {
  center: [number, number];
  colorScheme?: TileflowRuntimeColorScheme;
  imageSize: {height: number; width: number} | null;
  manifestMap: TileflowRuntimeManifestMap | null;
  theme?: TileflowThemeSelection;
  zoom: number;
}): string | undefined {
  if (!input.manifestMap?.mapId) {
    warnMissingStaticMapId(input.manifestMap);
    return undefined;
  }

  if (!input.imageSize) {
    return undefined;
  }

  const apiUrl = normalizeTileflowUrl(input.manifestMap.apiUrl ?? 'https://api.tileflow.dev');
  const mapId = encodeURIComponent(input.manifestMap.mapId);
  const url = new URL(`/maps/${mapId}/static.png`, apiUrl);
  const theme = resolveTileflowRuntimeTheme(input.manifestMap, input.theme, input.colorScheme);

  url.searchParams.set('center', input.center.join(','));
  url.searchParams.set('theme', theme.name);
  url.searchParams.set('zoom', String(input.zoom));
  url.searchParams.set('width', String(input.imageSize.width));
  url.searchParams.set('height', String(input.imageSize.height));

  return url.toString();
}

function warnMissingStaticMapId(manifestMap: TileflowRuntimeManifestMap | null): void {
  const styleUrl = manifestMap ? manifestMap.themes[manifestMap.defaultTheme]?.styleUrl : undefined;

  if (!styleUrl || missingStaticMapIdWarnings.has(styleUrl) || typeof console === 'undefined') {
    return;
  }

  missingStaticMapIdWarnings.add(styleUrl);
  console.warn(
    'Tileflow image mode requires a deployed manifest entry with mapId. ' +
      `The manifest style URL "${styleUrl}" cannot be converted to a static image URL.`,
  );
}

export function normalizeTileflowStaticImageSize(input: {height: number; width: number}) {
  let width = clampTileflowImageDimension(input.width);
  let height = clampTileflowImageDimension(input.height);
  const pixelCount = width * height;

  if (pixelCount > maxStaticImagePixels) {
    const scale = Math.sqrt(maxStaticImagePixels / pixelCount);
    width = clampTileflowImageDimension(width * scale);
    height = clampTileflowImageDimension(height * scale);
  }

  return {height, width};
}

async function readBoundedManifestResponse(response: Response): Promise<string> {
  return readBoundedUtf8Response(response, maximumManifestBytes, {
    invalidUtf8: 'Tileflow manifest is not valid UTF-8.',
    tooLarge: 'Tileflow manifest is too large.',
  });
}

async function readBoundedUtf8Response(
  response: Response,
  maximumBytes: number,
  errors: {invalidUtf8: string; tooLarge: string},
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      throw new Error(errors.tooLarge);
    }
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      throw new Error(errors.tooLarge);
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new Error(errors.invalidUtf8);
  }
}

function normalizeManifestCacheTtl(value: number | undefined): number {
  if (value === undefined) return defaultManifestCacheTtlMs;
  if (!Number.isFinite(value) || value < 0 || value > 5 * 60_000) {
    throw new TypeError('cacheTtlMs must be between 0 and 300000 milliseconds.');
  }
  return value;
}

function normalizeManifestTimeout(value: number | undefined): number {
  if (value === undefined) return 10_000;
  if (!Number.isFinite(value) || value < 1 || value > 60_000) {
    throw new TypeError('timeoutMs must be between 1 and 60000 milliseconds.');
  }
  return value;
}

function createManifestRequestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(external?.reason);
  if (external?.aborted) abortFromExternal();
  else external?.addEventListener('abort', abortFromExternal, {once: true});
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    timeoutMs,
  );

  return {
    cleanup() {
      clearTimeout(timeout);
      external?.removeEventListener('abort', abortFromExternal);
    },
    signal: controller.signal,
  };
}

function assertSafeManifestRequestUrl(value: string): void {
  if (
    value.length < 1 ||
    value.length > 2_048 ||
    /[\p{Cc}\\]/u.test(value) ||
    value.startsWith('//') ||
    /%(?:2f|5c)/iu.test(value)
  ) {
    throw new TypeError('Tileflow manifest URL must be a safe HTTP(S) or relative URL.');
  }
  try {
    const url = new URL(value, getTileflowLocationOrigin());
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error('unsafe');
    }
  } catch {
    throw new TypeError('Tileflow manifest URL must be a safe HTTP(S) or relative URL.');
  }
}

export function inferTileflowAnalyticsFromStyleUrl(
  styleUrl: string,
): TileflowAnalytics | undefined {
  try {
    const url = new URL(styleUrl, getTileflowLocationOrigin());
    const match = url.pathname.match(/^\/maps\/([^/]+)\/style\.json$/);

    if (!match?.[1]) {
      return undefined;
    }

    return {
      apiUrl: url.origin,
      mapId: match[1],
      styleId: url.toString(),
    };
  } catch {
    return undefined;
  }
}

function isTileflowTileUrl(url: string, apiUrl: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const parsedApiUrl = new URL(apiUrl);

    return parsedUrl.origin === parsedApiUrl.origin && isTilePath(parsedUrl);
  } catch {
    return false;
  }
}

function isTilePath(url: URL): boolean {
  return url.pathname.startsWith('/tiles/') || url.pathname.startsWith('/v1/tiles/');
}

function clampTileflowImageDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 640;
  }

  return Math.max(64, Math.min(maxStaticImageDimension, Math.round(value)));
}

function getTileflowLocationOrigin(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost';
  }

  return window.location.origin;
}

function getTileflowLocationBaseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof window !== 'undefined' && window.location.href) return window.location.href;
  return `${getTileflowLocationOrigin().replace(/\/+$/u, '')}/`;
}
