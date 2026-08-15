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

export function resolveTileflowRuntimeStyle(
  options: TileflowRuntimeStyleOptions,
): TileflowRuntimeStyle | null {
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
    analytics.endpoint ?? `${getTileflowAnalyticsApiUrl(analytics)}/v1/sessions/start`;
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
  });
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
  if (userAnalytics?.enabled === false) {
    return userAnalytics;
  }

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
    const match = url.pathname.match(/\/(?:v1\/)?maps\/([^/]+)\/style\.json$/);

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
