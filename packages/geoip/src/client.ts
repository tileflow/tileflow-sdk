import {z} from 'zod';
import {geoIpLimits, type GeoIpResponse, geoIpResponseSchema} from './contract';

declare const process: {env: {NODE_ENV?: unknown}};

export const GEOIP_ERROR_CODES = [
  'GEOIP_ABORTED',
  'GEOIP_ANONYMOUS_LIMITED',
  'GEOIP_DISABLED',
  'GEOIP_INVALID_REQUEST',
  'GEOIP_MAP_NOT_FOUND',
  'GEOIP_ORIGIN_FORBIDDEN',
  'GEOIP_QUOTA_EXCEEDED',
  'GEOIP_REQUEST_TOO_LARGE',
  'GEOIP_UNAVAILABLE',
  'GEOIP_USAGE_UNCONFIRMED',
] as const;

export type GeoIpErrorCode = (typeof GEOIP_ERROR_CODES)[number];

const geoIpErrorStatuses: Record<GeoIpErrorCode, number> = {
  GEOIP_ABORTED: 499,
  GEOIP_ANONYMOUS_LIMITED: 429,
  GEOIP_DISABLED: 503,
  GEOIP_INVALID_REQUEST: 400,
  GEOIP_MAP_NOT_FOUND: 404,
  GEOIP_ORIGIN_FORBIDDEN: 403,
  GEOIP_QUOTA_EXCEEDED: 429,
  GEOIP_REQUEST_TOO_LARGE: 413,
  GEOIP_UNAVAILABLE: 503,
  GEOIP_USAGE_UNCONFIRMED: 503,
};

const mapIdPattern = /^map_[A-Za-z0-9_-]{16}$/u;
const safeErrorText = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/\p{Cc}/u.test(value));
const requestId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const geoIpErrorResponseSchema = z
  .object({
    code: z.enum(GEOIP_ERROR_CODES),
    error: safeErrorText,
    requestId: requestId.optional(),
  })
  .strip();
const genericErrorResponseSchema = z
  .object({
    code: z.undefined().optional(),
    error: safeErrorText,
    requestId: requestId.optional(),
  })
  .strip();

const geoIpAnonymousOptionsSchema = z
  .object({
    apiUrl: z.string().optional(),
    fetch: z.custom<typeof fetch>((value) => typeof value === 'function').optional(),
    signal: z.custom<AbortSignal>(isAbortSignal).optional(),
  })
  .strict();
const geoIpManagedOptionsSchema = z
  .object({
    apiUrl: z.string().optional(),
    fetch: z.custom<typeof fetch>((value) => typeof value === 'function').optional(),
    mapId: z.string().trim().regex(mapIdPattern),
    signal: z.custom<AbortSignal>(isAbortSignal).optional(),
  })
  .strict();

export type GeoIpAnonymousOptions = Readonly<{
  apiUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}>;

export type GeoIpManagedOptions = Readonly<{
  apiUrl?: string;
  fetch?: typeof fetch;
  mapId: string;
  signal?: AbortSignal;
}>;

export type GeoIpOptions = GeoIpAnonymousOptions | GeoIpManagedOptions;

const anonymousAccessWarning =
  'Tileflow GeoIP is using anonymous best-effort access. Anonymous access has shared limits and no availability guarantee. For managed production, use geolocate({ mapId }).';
let anonymousAccessWarned = false;

export class GeoIpError extends Error {
  readonly code: GeoIpErrorCode | null;
  readonly requestId: string | null;
  readonly status: number;

  constructor(message: string, input: {code?: GeoIpErrorCode; requestId?: string; status: number}) {
    super(message);
    this.name = 'GeoIpError';
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.status = input.status;
  }
}

/**
 * Returns approximate geography for the calling connection, using managed access when `mapId` is present.
 * Anonymous access has shared limits and no availability guarantee.
 */
export function geolocate(): Promise<GeoIpResponse>;
export function geolocate(options: GeoIpOptions): Promise<GeoIpResponse>;
export async function geolocate(options?: GeoIpOptions): Promise<GeoIpResponse> {
  const parsedOptions =
    options === undefined ? geoIpAnonymousOptionsSchema.parse({}) : parseOptions(options);
  const managed = 'mapId' in parsedOptions;
  const request = managed ? {mapId: parsedOptions.mapId} : {};
  const body = JSON.stringify(request);

  if (new TextEncoder().encode(body).byteLength > geoIpLimits.maximumRequestBytes) {
    throw new Error('Invalid Tileflow GeoIP request');
  }

  const apiUrl = normalizeApiUrl(parsedOptions.apiUrl ?? 'https://api.tileflow.dev');
  const fetcher = parsedOptions.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('Tileflow GeoIP requires fetch');
  if (!managed) warnAnonymousAccessOnce();

  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/v1/geoip`, {
      body,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      redirect: 'error',
      signal: parsedOptions.signal,
    });
  } catch (error) {
    if (parsedOptions.signal?.aborted) throw parsedOptions.signal.reason ?? error;
    throw new GeoIpError('Tileflow GeoIP request failed', {status: 0});
  }

  if (response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new GeoIpError('Tileflow GeoIP request failed', {status: response.status});
  }

  if (!response.ok) throw await readGeoIpError(response, parsedOptions.signal);

  let bodyResponse: unknown;
  try {
    bodyResponse = await readBoundedJson(
      response,
      geoIpLimits.maximumResponseBytes,
      parsedOptions.signal,
    );
  } catch (error) {
    if (parsedOptions.signal?.aborted) throw parsedOptions.signal.reason ?? error;
    throw new GeoIpError('Tileflow GeoIP returned an invalid response', {status: response.status});
  }

  const parsedResponse = geoIpResponseSchema.safeParse(bodyResponse);
  if (!parsedResponse.success || !matchesUsage(managed, parsedResponse.data)) {
    throw new GeoIpError('Tileflow GeoIP returned an invalid response', {status: response.status});
  }

  return parsedResponse.data;
}

function parseOptions(options: GeoIpOptions) {
  const result = z
    .union([geoIpManagedOptionsSchema, geoIpAnonymousOptionsSchema])
    .safeParse(options);
  if (!result.success) throw new Error('Invalid Tileflow GeoIP options');
  return result.data;
}

function matchesUsage(managed: boolean, response: GeoIpResponse) {
  if (response.status === 'unavailable') return response.usage.units === 0;
  return response.usage.units === (managed ? 1 : 0);
}

function warnAnonymousAccessOnce() {
  if (anonymousAccessWarned || !isExplicitDevelopmentRuntime()) return;
  anonymousAccessWarned = true;
  try {
    globalThis.console?.warn(anonymousAccessWarning);
  } catch {
    // Logging must not change GeoIP behavior.
  }
}

function isExplicitDevelopmentRuntime() {
  try {
    return process.env.NODE_ENV === 'development';
  } catch {
    return false;
  }
}

function normalizeApiUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Tileflow API URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid Tileflow API URL');
  }
  return url.href.replace(/\/$/u, '');
}

async function readGeoIpError(response: Response, signal?: AbortSignal) {
  let body: unknown;
  try {
    body = await readBoundedJson(response, geoIpLimits.maximumResponseBytes, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return new GeoIpError('Tileflow GeoIP request failed', {status: response.status});
  }

  const geoIp = geoIpErrorResponseSchema.safeParse(body);
  if (geoIp.success && geoIpErrorStatuses[geoIp.data.code] === response.status) {
    return new GeoIpError(geoIp.data.error, {
      code: geoIp.data.code,
      requestId: geoIp.data.requestId,
      status: response.status,
    });
  }
  const generic = genericErrorResponseSchema.safeParse(body);
  if (generic.success && [403, 429].includes(response.status)) {
    return new GeoIpError(generic.data.error, {
      requestId: generic.data.requestId,
      status: response.status,
    });
  }
  return new GeoIpError('Tileflow GeoIP request failed', {status: response.status});
}

async function readBoundedJson(response: Response, maximumBytes: number, signal?: AbortSignal) {
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Tileflow GeoIP response is too large');
  }

  if (!response.body) throw new Error('Tileflow GeoIP response is empty');
  if (signal?.aborted) {
    void response.body.cancel(signal.reason).catch(() => undefined);
    throw signal.reason ?? new Error('Tileflow GeoIP request was aborted');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await readResponseChunk(reader, signal);
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error('Tileflow GeoIP response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new Error('Tileflow GeoIP response is not UTF-8');
  }
  return JSON.parse(source) as unknown;
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  if (!signal) return reader.read();
  let aborted = false;
  const abort = () => {
    aborted = true;
    void reader.cancel(signal.reason).catch(() => undefined);
  };

  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, {once: true});
  try {
    const chunk = await reader.read();
    if (aborted) throw signal.reason ?? new Error('Tileflow GeoIP request was aborted');
    return chunk;
  } catch (error) {
    if (aborted) throw signal.reason ?? error;
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function' &&
    typeof (value as AbortSignal).removeEventListener === 'function'
  );
}
