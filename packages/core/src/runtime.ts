import {createStyle, type TileflowConfig} from './project';
import {type MapLibreStyle, type TileflowProjectThemes} from './types';

export const defaultTileflowManifestUrl = '/tileflow/manifest.json';
export const defaultTileflowStyleBaseUrl = 'http://localhost:3333';

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
};

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

export type TileflowMapMarker = {
  id: string;
  coordinates: [number, number];
  color?: string;
  label?: string;
};

export type TileflowMapMode = 'interactive' | 'image';

export type TileflowMapModeOptions = {
  imageUrl?: string;
  mode?: TileflowMapMode;
  preferLocalDev?: boolean;
};

export type TileflowRuntimeManifestMapEntry =
  | string
  | {
      apiUrl?: string;
      environment?: string;
      mapId?: string;
      styleId?: string;
      styleUrl?: string;
      url?: string;
    };

export type TileflowRuntimeManifest = {
  apiUrl?: string;
  maps?: Record<string, TileflowRuntimeManifestMapEntry>;
  styles?: Record<string, string>;
  version?: 2;
};

export type TileflowRuntimeManifestMap = {
  apiUrl?: string;
  mapId?: string;
  styleId?: string;
  styleUrl?: string;
};

export type TileflowRuntimeStyle = {
  analytics?: TileflowAnalytics;
  style: MapLibreStyle | string;
};

export type TileflowRuntimeStyleOptions = {
  config?: TileflowConfig;
  manifestMap?: TileflowRuntimeManifestMap | null;
  map?: string;
  preferLocalDev?: boolean;
  style?: MapLibreStyle;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: TileflowProjectThemes;
};

export type TileflowRuntimeStyleInputs = {
  config?: unknown;
  map?: string;
  style?: unknown;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: unknown;
};

export type TileflowRuntimeStyleInputsValidation =
  | {ok: true}
  | {
      code: 'config-conflict' | 'missing-config' | 'missing-map' | 'multiple-style-sources';
      error: string;
      ok: false;
    };

export type TileflowManifestLoadOptions = {
  config?: unknown;
  imageMode?: boolean;
  imageUrl?: string;
  map?: string;
  style?: unknown;
  styleBaseUrl?: string;
  styleUrl?: string;
};

const maxStaticImageDimension = 1280;
const maxStaticImagePixels = 1280 * 1280;
const manifestCache = new globalThis.Map<string, Promise<TileflowRuntimeManifest | null>>();
const missingStaticMapIdWarnings = new Set<string>();

export function shouldLoadTileflowManifest(options: TileflowManifestLoadOptions): boolean {
  return Boolean(
    options.map &&
    !options.config &&
    ((options.imageMode && !options.imageUrl) ||
      (!options.imageMode && !options.style && !options.styleUrl && !options.styleBaseUrl)),
  );
}

export function validateTileflowRuntimeStyleInputs(
  input: TileflowRuntimeStyleInputs,
): TileflowRuntimeStyleInputsValidation {
  const hasConfig = input.config !== undefined;
  const hasMap = input.map !== undefined;
  const explicitSources = [
    input.style !== undefined ? 'style' : null,
    input.styleUrl !== undefined ? 'styleUrl' : null,
    input.styleBaseUrl !== undefined ? 'styleBaseUrl' : null,
  ].filter((name): name is string => name !== null);

  if (hasConfig) {
    const conflicts = [hasMap ? 'map' : null, ...explicitSources].filter(
      (name): name is string => name !== null,
    );
    if (conflicts.length > 0) {
      return {
        code: 'config-conflict',
        error: `config cannot be combined with ${formatPropertyList(conflicts)}; choose one style source`,
        ok: false,
      };
    }
  }

  if (explicitSources.length > 1) {
    return {
      code: 'multiple-style-sources',
      error: `${formatPropertyList(explicitSources)} are mutually exclusive style sources`,
      ok: false,
    };
  }
  if (input.styleBaseUrl !== undefined && !hasMap) {
    return {code: 'missing-map', error: 'styleBaseUrl requires map', ok: false};
  }
  if (input.themes !== undefined && !hasConfig) {
    return {code: 'missing-config', error: 'themes requires config', ok: false};
  }
  return {ok: true};
}

export function assertValidTileflowRuntimeStyleInputs(input: TileflowRuntimeStyleInputs): void {
  const validation = validateTileflowRuntimeStyleInputs(input);
  if (!validation.ok) {
    throw new TypeError(`Invalid Tileflow runtime style inputs: ${validation.error}`);
  }
}

export function resolveTileflowRuntimeStyle(
  options: TileflowRuntimeStyleOptions,
): TileflowRuntimeStyle | null {
  assertValidTileflowRuntimeStyleInputs(options);

  if (options.style) {
    return {style: options.style};
  }

  if (options.styleUrl) {
    return {
      analytics: inferTileflowAnalyticsFromStyleUrl(options.styleUrl),
      style: options.styleUrl,
    };
  }

  if (options.map && options.styleBaseUrl && !options.config) {
    return {
      style: resolveTileflowStyleUrl(options.map, options.styleBaseUrl),
    };
  }

  if (options.map) {
    if (options.manifestMap?.styleUrl) {
      return {
        analytics: {
          apiUrl: options.manifestMap.apiUrl,
          mapId: options.manifestMap.mapId,
          styleId: options.manifestMap.styleId,
        },
        style: options.manifestMap.styleUrl,
      };
    }

    if (options.preferLocalDev !== false && isTileflowLocalDevHost()) {
      return {style: resolveTileflowStyleUrl(options.map)};
    }

    return null;
  }

  if (!options.config) return null;

  return {
    style: createStyle(options.config, {
      themes: options.themes,
    }),
  };
}

function formatPropertyList(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

export function resolveTileflowStyleUrl(mapName: string, styleBaseUrl?: string): string {
  const baseUrl = normalizeTileflowUrl(styleBaseUrl ?? getDefaultTileflowStyleBaseUrl());
  return `${baseUrl}/styles/${mapName}.json`;
}

export function getDefaultTileflowStyleBaseUrl(): string {
  const globalValue = (globalThis as {__TILEFLOW_STYLE_BASE_URL__?: string})
    .__TILEFLOW_STYLE_BASE_URL__;

  return globalValue ?? defaultTileflowStyleBaseUrl;
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
      }),
      credentials: 'omit',
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      signal,
    });
    throwIfSessionGrantAborted(signal);
    const body = (await response.json().catch(() => null)) as unknown;
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
      url.pathname === `/maps/${encodeURIComponent(mapId)}/style.json` ||
      url.pathname.startsWith('/tiles/') ||
      url.pathname.startsWith('/v1/tiles/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname.startsWith('/sprites/')
    );
  } catch {
    return false;
  }
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
  };
}

export function isTileflowLocalDevHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

export function resolveTileflowMapMode(options: TileflowMapModeOptions): TileflowMapMode {
  if (
    options.mode === 'image' &&
    !options.imageUrl &&
    options.preferLocalDev !== false &&
    isTileflowLocalDevHost()
  ) {
    return 'interactive';
  }

  return options.mode ?? 'interactive';
}

export function loadTileflowManifest(url: string): Promise<TileflowRuntimeManifest | null> {
  if (!manifestCache.has(url)) {
    const promise = fetch(url, {cache: 'no-store'})
      .then(async (response) => {
        if (response.status === 404) {
          manifestCache.delete(url);
          return null;
        }

        if (!response.ok) {
          throw new Error(`Tileflow manifest failed: ${response.status}`);
        }

        return (await response.json()) as TileflowRuntimeManifest;
      })
      .catch((error: unknown) => {
        manifestCache.delete(url);
        throw error;
      });

    manifestCache.set(url, promise);
  }

  return manifestCache.get(url)!;
}

export function resolveTileflowManifestMap(
  manifest: TileflowRuntimeManifest,
  mapName: string,
): TileflowRuntimeManifestMap | null {
  const entry = manifest.maps?.[mapName] ?? manifest.styles?.[mapName];

  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    const analytics = inferTileflowAnalyticsFromStyleUrl(entry);

    return {
      apiUrl: analytics?.apiUrl ?? manifest.apiUrl,
      mapId: analytics?.mapId,
      styleId: analytics?.styleId,
      styleUrl: entry,
    };
  }

  const styleUrl = entry.styleUrl ?? entry.url;

  if (!styleUrl && !entry.mapId) {
    return null;
  }

  const analytics = styleUrl ? inferTileflowAnalyticsFromStyleUrl(styleUrl) : undefined;

  return {
    apiUrl: entry.apiUrl ?? manifest.apiUrl ?? analytics?.apiUrl,
    mapId: entry.mapId ?? analytics?.mapId,
    styleId: entry.styleId ?? analytics?.styleId,
    styleUrl,
  };
}

export function resolveTileflowStaticImageUrl(input: {
  center: [number, number];
  imageSize: {height: number; width: number} | null;
  manifestMap: TileflowRuntimeManifestMap | null;
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
  const url = new URL(`/maps/${input.manifestMap.mapId}/static.png`, apiUrl);

  url.searchParams.set('center', input.center.join(','));
  url.searchParams.set('zoom', String(input.zoom));
  url.searchParams.set('width', String(input.imageSize.width));
  url.searchParams.set('height', String(input.imageSize.height));

  return url.toString();
}

function warnMissingStaticMapId(manifestMap: TileflowRuntimeManifestMap | null): void {
  const styleUrl = manifestMap?.styleUrl;

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
