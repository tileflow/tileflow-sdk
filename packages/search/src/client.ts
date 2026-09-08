import {z} from 'zod';
import {
  type AutocompleteRequest,
  autocompleteRequestSchema,
  type AutocompleteResponse,
  autocompleteResponseSchema,
  type GeocodingForwardRequest,
  geocodingForwardRequestSchema,
  type GeocodingForwardResponse,
  geocodingForwardResponseSchema,
  geocodingLimits,
  type GeocodingReverseRequest,
  geocodingReverseRequestSchema,
  type GeocodingReverseResponse,
  type ReverseGeocodingKind,
  type ResolveSuggestionRequest,
  resolveSuggestionRequestSchema,
  type ResolveSuggestionResponse,
  resolveSuggestionResponseSchema,
} from './contract';

export const GEOCODING_ERROR_CODES = [
  'GEOCODING_ABORTED',
  'GEOCODING_DISABLED',
  'GEOCODING_INVALID_REQUEST',
  'GEOCODING_INVALID_SUGGESTION',
  'GEOCODING_PICK_LIMIT_EXCEEDED',
  'GEOCODING_QUOTA_EXCEEDED',
  'GEOCODING_REQUEST_TOO_LARGE',
  'GEOCODING_SUGGESTION_EXPIRED',
  'GEOCODING_TERRITORY_UNSUPPORTED',
  'GEOCODING_UNAVAILABLE',
  'GEOCODING_UPSTREAM_INVALID',
  'GEOCODING_UPSTREAM_THROTTLED',
  'GEOCODING_UPSTREAM_TIMEOUT',
  'GEOCODING_UPSTREAM_UNAVAILABLE',
  'GEOCODING_USAGE_UNCONFIRMED',
] as const;

export type GeocodingErrorCode = (typeof GEOCODING_ERROR_CODES)[number];

const geocodingErrorStatuses: Record<GeocodingErrorCode, number> = {
  GEOCODING_ABORTED: 499,
  GEOCODING_DISABLED: 503,
  GEOCODING_INVALID_REQUEST: 400,
  GEOCODING_INVALID_SUGGESTION: 400,
  GEOCODING_PICK_LIMIT_EXCEEDED: 429,
  GEOCODING_QUOTA_EXCEEDED: 429,
  GEOCODING_REQUEST_TOO_LARGE: 413,
  GEOCODING_SUGGESTION_EXPIRED: 410,
  GEOCODING_TERRITORY_UNSUPPORTED: 422,
  GEOCODING_UNAVAILABLE: 503,
  GEOCODING_UPSTREAM_INVALID: 502,
  GEOCODING_UPSTREAM_THROTTLED: 429,
  GEOCODING_UPSTREAM_TIMEOUT: 504,
  GEOCODING_UPSTREAM_UNAVAILABLE: 502,
  GEOCODING_USAGE_UNCONFIRMED: 503,
};

export type GeocodeOptions = Readonly<{
  apiKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}>;

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
const geocodingErrorResponseSchema = z
  .object({
    code: z.enum(GEOCODING_ERROR_CODES),
    error: safeErrorText,
    requestId: requestId.optional(),
  })
  .strict();
const credentialErrorResponseSchema = z
  .object({
    error: safeErrorText,
    requestId: requestId.optional(),
  })
  .strict();

export class GeocodingError extends Error {
  readonly code: GeocodingErrorCode | null;
  readonly requestId: string | null;
  readonly status: number;

  constructor(
    message: string,
    input: {code?: GeocodingErrorCode; requestId?: string; status: number},
  ) {
    super(message);
    this.name = 'GeocodingError';
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.status = input.status;
  }
}

export async function geocode(
  request: GeocodingForwardRequest,
  options: GeocodeOptions,
): Promise<GeocodingForwardResponse> {
  const parsedRequest = geocodingForwardRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error('Invalid Tileflow geocoding request');
  }

  return requestGeocoding(
    '/v1/geocoding/forward',
    parsedRequest.data,
    options,
    geocodingForwardResponseSchema,
    (response) =>
      response.results.length <= (parsedRequest.data.limit ?? geocodingLimits.defaultLimit),
  );
}

export async function geocodeReverse(
  request: GeocodingReverseRequest,
  options: GeocodeOptions,
): Promise<GeocodingReverseResponse> {
  const parsedRequest = geocodingReverseRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error('Invalid Tileflow geocoding request');
  }

  return requestGeocoding(
    '/v1/geocoding/reverse',
    parsedRequest.data,
    options,
    geocodingForwardResponseSchema,
    (response) =>
      response.results.length <= parsedRequest.data.limit &&
      containsOnlyKinds(response, parsedRequest.data.kinds),
  );
}

export async function autocomplete(
  request: AutocompleteRequest,
  options: GeocodeOptions,
): Promise<AutocompleteResponse> {
  const parsedRequest = autocompleteRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error('Invalid Tileflow geocoding request');
  }

  return requestGeocoding(
    '/v1/geocoding/autocomplete',
    parsedRequest.data,
    options,
    autocompleteResponseSchema,
    (response) => response.suggestions.length <= parsedRequest.data.limit,
  );
}

export async function resolveSuggestion(
  request: ResolveSuggestionRequest,
  options: GeocodeOptions,
): Promise<ResolveSuggestionResponse> {
  const parsedRequest = resolveSuggestionRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error('Invalid Tileflow geocoding request');
  }

  return requestGeocoding(
    '/v1/geocoding/resolve-suggestion',
    parsedRequest.data,
    options,
    resolveSuggestionResponseSchema,
  );
}

async function requestGeocoding<T>(
  path:
    | '/v1/geocoding/autocomplete'
    | '/v1/geocoding/forward'
    | '/v1/geocoding/resolve-suggestion'
    | '/v1/geocoding/reverse',
  request: unknown,
  options: GeocodeOptions,
  responseSchema: z.ZodType<T>,
  isExpectedResponse: (response: T) => boolean = () => true,
): Promise<T> {
  const apiKey = normalizeApiKey(options.apiKey);
  const apiUrl = normalizeApiUrl(options.apiUrl ?? 'https://api.tileflow.dev');
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}${path}`, {
      body: JSON.stringify(request),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new GeocodingError('Tileflow geocoding request failed', {status: 0});
  }

  if (response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new GeocodingError('Tileflow geocoding request failed', {status: response.status});
  }

  if (!response.ok) {
    throw await readGeocodingError(response, options.signal);
  }

  let body: unknown;
  try {
    body = await readBoundedJson(response, geocodingLimits.maximumResponseBytes, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new GeocodingError('Tileflow geocoding returned an invalid response', {
      status: response.status,
    });
  }
  const parsedResponse = responseSchema.safeParse(body);
  if (!parsedResponse.success || !isExpectedResponse(parsedResponse.data)) {
    throw new GeocodingError('Tileflow geocoding returned an invalid response', {
      status: response.status,
    });
  }

  return parsedResponse.data;
}

function containsOnlyKinds(
  response: GeocodingForwardResponse,
  allowedKinds: readonly ReverseGeocodingKind[] | undefined,
) {
  if (!allowedKinds) return true;

  const kindFilter = new Set<string>(allowedKinds);
  return response.results.every(({kind}) => kindFilter.has(kind));
}

function normalizeApiKey(value: string) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4096 ||
    value !== value.trim() ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('Invalid Tileflow API key');
  }
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
  ) {
    throw new Error('Invalid Tileflow API URL');
  }
  return url.href.replace(/\/$/u, '');
}

async function readGeocodingError(response: Response, signal?: AbortSignal) {
  let body: unknown;
  try {
    body = await readBoundedJson(response, geocodingLimits.maximumSafeErrorBytes, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return new GeocodingError('Tileflow geocoding request failed', {status: response.status});
  }

  const geocoding = geocodingErrorResponseSchema.safeParse(body);
  if (geocoding.success && geocodingErrorStatuses[geocoding.data.code] === response.status) {
    return new GeocodingError(geocoding.data.error, {
      code: geocoding.data.code,
      requestId: geocoding.data.requestId,
      status: response.status,
    });
  }
  const credential = credentialErrorResponseSchema.safeParse(body);
  if (credential.success && [401, 403, 429].includes(response.status)) {
    return new GeocodingError(credential.data.error, {
      requestId: credential.data.requestId,
      status: response.status,
    });
  }
  return new GeocodingError('Tileflow geocoding request failed', {status: response.status});
}

async function readBoundedJson(response: Response, maximumBytes: number, signal?: AbortSignal) {
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Tileflow geocoding response is too large');
  }

  if (!response.body) throw new Error('Tileflow geocoding response is empty');
  if (signal?.aborted) {
    void response.body.cancel(signal.reason).catch(() => undefined);
    throw signal.reason ?? new Error('Tileflow geocoding request was aborted');
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
        throw new Error('Tileflow geocoding response is too large');
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
    throw new Error('Tileflow geocoding response is not UTF-8');
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
    if (aborted) throw signal.reason ?? new Error('Tileflow geocoding request was aborted');
    return chunk;
  } catch (error) {
    if (aborted) throw signal.reason ?? error;
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
