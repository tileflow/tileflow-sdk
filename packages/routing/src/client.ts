import {z} from 'zod';
import {
  type RoutingErrorCode,
  routingErrorCodes,
  routingErrorStatus,
  type RoutingIsochroneRequest,
  routingIsochroneRequestSchema,
  type RoutingIsochroneResponse,
  routingIsochroneResponseSchema,
  routingLimits,
  type RoutingRouteRequest,
  routingRouteRequestSchema,
  type RoutingRouteResponse,
  routingRouteResponseSchema,
} from './contract';

export type RoutingOptions = Readonly<{
  /** A Tileflow credential with the Routing permission. */
  apiKey: string;
  /** Defaults to `https://api.tileflow.dev`. Plain HTTP is accepted only on loopback. */
  apiUrl?: string;
  /**
   * The native app a publishable credential admits: its iOS bundle ID, or its Android package name
   * with the SHA-256 fingerprint of its signing certificate. Browsers send their origin instead.
   */
  app?: Readonly<{id: string; certificateSha256?: string}>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}>;

export class RoutingError extends Error {
  readonly code: RoutingErrorCode | null;
  readonly requestId: string | null;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    input: {
      code?: RoutingErrorCode;
      requestId?: string;
      status: number;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message);
    this.name = 'RoutingError';
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

/**
 * The fastest route through two to five positions, with up to two alternatives between two
 * positions. Each route has its line, distance, duration and turn-by-turn steps.
 */
export async function route(
  request: RoutingRouteRequest,
  options: RoutingOptions,
): Promise<RoutingRouteResponse> {
  const parsed = routingRouteRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Invalid Tileflow route request');
  const legs = parsed.data.locations.length - 1;
  return requestRouting(
    '/v1/routing/route',
    parsed.data,
    options,
    routingRouteResponseSchema,
    (response) =>
      response.routes.length <= (parsed.data.alternatives ?? 0) + 1 &&
      response.routes.every((candidate) => candidate.legs.length === legs),
  );
}

/** The areas reachable from a position in one to four times, one polygon per time. */
export async function isochrone(
  request: RoutingIsochroneRequest,
  options: RoutingOptions,
): Promise<RoutingIsochroneResponse> {
  const parsed = routingIsochroneRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Invalid Tileflow isochrone request');
  return requestRouting(
    '/v1/routing/isochrone',
    parsed.data,
    options,
    routingIsochroneResponseSchema,
    (response) =>
      response.isochrones.features.length === parsed.data.minutes.length &&
      response.isochrones.features.every(
        (feature, index) => feature.properties.minutes === parsed.data.minutes[index],
      ),
  );
}

const safeErrorText = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/\p{Cc}/u.test(value));
const requestId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const routingErrorResponseSchema = z
  .object({code: z.enum(routingErrorCodes), error: safeErrorText, requestId: requestId.optional()})
  .strict();

async function requestRouting<T>(
  path: '/v1/routing/route' | '/v1/routing/isochrone',
  request: unknown,
  options: RoutingOptions,
  responseSchema: z.ZodType<T>,
  isExpectedResponse: (response: T) => boolean,
): Promise<T> {
  const bodyText = JSON.stringify(request);
  if (new TextEncoder().encode(bodyText).byteLength > routingLimits.maximumRequestBytes)
    throw new Error('Tileflow Routing request is too large');
  const apiKey = normalizeApiKey(options.apiKey);
  const app = normalizeApp(options.app);
  const apiUrl = normalizeApiUrl(options.apiUrl ?? 'https://api.tileflow.dev');
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}${path}`, {
      body: bodyText,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(app ? {'X-Tileflow-App': app.id} : {}),
        ...(app?.certificateSha256 ? {'X-Tileflow-App-Certificate': app.certificateSha256} : {}),
      },
      method: 'POST',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new RoutingError('Tileflow Routing request failed', {status: 0});
  }
  if (response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new RoutingError('Tileflow Routing request failed', {status: response.status});
  }
  if (!response.ok) throw await readRoutingError(response, options.signal);
  let body: unknown;
  try {
    body = await readBoundedJson(response, routingLimits.maximumResponseBytes, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new RoutingError('Tileflow Routing returned an invalid response', {
      status: response.status,
    });
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || !isExpectedResponse(parsed.data))
    throw new RoutingError('Tileflow Routing returned an invalid response', {
      status: response.status,
    });
  return parsed.data;
}

function normalizeApp(value: RoutingOptions['app']) {
  if (value === undefined) return null;
  const certificate = value?.certificateSha256?.replaceAll(':', '').toLowerCase();
  if (
    typeof value?.id !== 'string' ||
    value.id.length > 255 ||
    !/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/u.test(value.id) ||
    (certificate !== undefined && !/^[0-9a-f]{64}$/u.test(certificate))
  )
    throw new Error('Invalid Tileflow app identity');
  return {id: value.id, certificateSha256: certificate};
}

function normalizeApiKey(value: string) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4096 ||
    value !== value.trim() ||
    /\p{Cc}/u.test(value)
  )
    throw new Error('Invalid Tileflow API key');
  return value;
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
  )
    throw new Error('Invalid Tileflow API URL');
  return url.href.replace(/\/$/u, '');
}

async function readRoutingError(response: Response, signal?: AbortSignal) {
  const value = response.headers.get('Retry-After');
  const retryAfterSeconds = value && /^\d{1,8}$/u.test(value) ? Number(value) : null;
  let body: unknown;
  try {
    body = await readBoundedJson(response, 8 * 1024, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return new RoutingError('Tileflow Routing request failed', {
      status: response.status,
      retryAfterSeconds,
    });
  }
  const parsed = routingErrorResponseSchema.safeParse(body);
  // A code is trusted only with the status the contract gives it; access errors may also arrive
  // as 401 from the credential check.
  const expected =
    parsed.success &&
    (routingErrorStatus[parsed.data.code] === response.status ||
      (parsed.data.code === 'ROUTING_ACCESS_DENIED' && response.status === 401));
  if (!parsed.success || !expected)
    return new RoutingError('Tileflow Routing request failed', {
      status: response.status,
      retryAfterSeconds,
    });
  return new RoutingError(parsed.data.error, {
    code: parsed.data.code,
    status: response.status,
    retryAfterSeconds,
    ...(parsed.data.requestId ? {requestId: parsed.data.requestId} : {}),
  });
}

async function readBoundedJson(response: Response, maximumBytes: number, signal?: AbortSignal) {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Tileflow Routing response is too large');
  }
  if (!response.body) throw new Error('Tileflow Routing response is empty');
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
        throw new Error('Tileflow Routing response is too large');
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
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown;
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
    if (aborted) throw signal.reason ?? new Error('Tileflow Routing request was aborted');
    return chunk;
  } catch (error) {
    if (aborted) throw signal.reason ?? error;
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
