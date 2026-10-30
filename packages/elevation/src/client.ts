import {z} from 'zod';
import {
  type ElevationErrorCode,
  elevationErrorCodes,
  elevationErrorStatus,
  elevationLimits,
  type ElevationLineString,
  type ElevationMultiLineString,
  type ElevationOperation,
  type ElevationPointsRequest,
  elevationPointsRequestSchema,
  type ElevationPointsResponse,
  elevationPointsResponseSchema,
  type ElevationPosition,
  elevationPositionSchema,
  type ElevationProfileRequest,
  elevationProfileRequestSchema,
  type ElevationProfileResponse,
  elevationProfileResponseSchema,
  type ElevationUnit,
} from './contract';

export type ElevationOptions = Readonly<{
  /** A Tileflow credential with the Elevation permission. */
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

/** A position with its elevation in the requested unit, or null where there is no data. */
export type ElevatedPosition = [number, number, number | null];

export type ElevationBatch = Readonly<{
  positions: ElevatedPosition[];
  unit: ElevationUnit;
  /** The credit to show with the data. */
  attribution: string;
  /** API units consumed by all the requests. */
  units: number;
}>;

export class ElevationError extends Error {
  readonly code: ElevationErrorCode | null;
  readonly requestId: string | null;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    input: {
      code?: ElevationErrorCode;
      requestId?: string;
      status: number;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message);
    this.name = 'ElevationError';
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

/** Requests run at the same time by the batch helpers. */
const batchConcurrency = 4;

/** The heights of 1 to 100 positions, in order. One request; one API unit. */
export async function elevationPoints(
  request: ElevationPointsRequest,
  options: ElevationOptions,
): Promise<ElevationPointsResponse> {
  const parsed = elevationPointsRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Invalid Tileflow elevation request');
  return requestElevation(
    'points',
    parsed.data,
    options,
    elevationPointsResponseSchema,
    (response) =>
      response.positions.length === parsed.data.positions.length &&
      response.unit === (parsed.data.unit ?? 'meters'),
  );
}

/**
 * Evenly spaced samples along a GeoJSON line or an encoded polyline, with their distances and a
 * summary of the climbs, drops and grades. One API unit for every 100 samples.
 */
export async function elevationProfile(
  request: ElevationProfileRequest,
  options: ElevationOptions,
): Promise<ElevationProfileResponse> {
  const parsed = elevationProfileRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Invalid Tileflow elevation profile request');
  return requestElevation(
    'profile',
    parsed.data,
    options,
    elevationProfileResponseSchema,
    (response) =>
      response.unit === (parsed.data.unit ?? 'meters') &&
      response.samples.length <= (parsed.data.maxSamples ?? elevationLimits.defaultSamples) &&
      response.lines.every(
        ([first, last], index) =>
          first <= last &&
          last < response.samples.length &&
          (index === 0 ? first === 0 : first === response.lines[index - 1]![1] + 1),
      ) &&
      response.lines.at(-1)?.[1] === response.samples.length - 1,
  );
}

/** The height of one position. */
export async function elevation(
  position: ElevationPosition,
  options: ElevationOptions & {unit?: ElevationUnit},
): Promise<ElevatedPosition> {
  const response = await elevationPoints(
    {positions: [position], ...(options.unit ? {unit: options.unit} : {})},
    options,
  );
  return response.positions[0]!;
}

/**
 * The heights of any number of positions, in order, 100 per request and up to four requests at a
 * time. Every request consumes one API unit.
 */
export async function elevationBatch(
  positions: readonly ElevationPosition[],
  options: ElevationOptions & {unit?: ElevationUnit},
): Promise<ElevationBatch> {
  if (
    !Array.isArray(positions) ||
    !positions.every((p) => elevationPositionSchema.safeParse(p).success)
  )
    throw new Error('Invalid Tileflow elevation positions');
  const unit = options.unit ?? 'meters';
  const chunks: ElevationPosition[][] = [];
  for (let index = 0; index < positions.length; index += elevationLimits.maximumPoints)
    chunks.push(
      positions.slice(index, index + elevationLimits.maximumPoints) as ElevationPosition[],
    );
  const answers: ElevationPointsResponse[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      answers[index] = await elevationPoints({positions: chunks[index]!, unit}, options);
    }
  };
  await Promise.all(Array.from({length: Math.min(batchConcurrency, chunks.length)}, worker));
  return Object.freeze({
    positions: answers.flatMap((answer) => answer.positions),
    unit,
    attribution: [...new Set(answers.map((answer) => answer.attribution))].join(' '),
    units: answers.reduce((total, answer) => total + answer.usage.units, 0),
  });
}

/**
 * A copy of a GeoJSON LineString whose positions carry their elevation as a third coordinate.
 * Positions without data keep two coordinates; the input is not changed.
 */
export async function elevateLineString(
  line: ElevationLineString,
  options: ElevationOptions & {unit?: ElevationUnit},
): Promise<{type: 'LineString'; coordinates: number[][]}> {
  if (line?.type !== 'LineString' || !Array.isArray(line.coordinates))
    throw new Error('Invalid Tileflow elevation line');
  const [coordinates] = await elevateParts([line.coordinates], options);
  return {type: 'LineString', coordinates: coordinates!};
}

/** {@link elevateLineString} for every line of a GeoJSON MultiLineString, in one batch. */
export async function elevateMultiLineString(
  line: ElevationMultiLineString,
  options: ElevationOptions & {unit?: ElevationUnit},
): Promise<{type: 'MultiLineString'; coordinates: number[][][]}> {
  if (line?.type !== 'MultiLineString' || !Array.isArray(line.coordinates))
    throw new Error('Invalid Tileflow elevation line');
  return {type: 'MultiLineString', coordinates: await elevateParts(line.coordinates, options)};
}

async function elevateParts(
  parts: readonly (readonly (readonly number[])[])[],
  options: ElevationOptions & {unit?: ElevationUnit},
) {
  const positions = parts.flatMap((part) =>
    part.map((position) => [position[0], position[1]] as ElevationPosition),
  );
  const {positions: elevated} = await elevationBatch(positions, options);
  let index = 0;
  return parts.map((part) =>
    part.map(() => {
      const [lng, lat, height] = elevated[index++]!;
      return height === null ? [lng, lat] : [lng, lat, height];
    }),
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
const elevationErrorResponseSchema = z
  .object({
    code: z.enum(elevationErrorCodes),
    error: safeErrorText,
    requestId: requestId.optional(),
  })
  .strict();

async function requestElevation<T>(
  operation: ElevationOperation,
  request: unknown,
  options: ElevationOptions,
  responseSchema: z.ZodType<T>,
  isExpectedResponse: (response: T) => boolean,
): Promise<T> {
  const bodyText = JSON.stringify(request);
  if (new TextEncoder().encode(bodyText).byteLength > elevationLimits.maximumRequestBytes)
    throw new Error('Tileflow Elevation request is too large');
  const apiKey = normalizeApiKey(options.apiKey);
  const app = normalizeApp(options.app);
  const apiUrl = normalizeApiUrl(options.apiUrl ?? 'https://api.tileflow.dev');
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/v1/elevation/${operation}`, {
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
    throw new ElevationError('Tileflow Elevation request failed', {status: 0});
  }
  if (response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new ElevationError('Tileflow Elevation request failed', {status: response.status});
  }
  if (!response.ok) throw await readElevationError(response, options.signal);
  let body: unknown;
  try {
    body = await readBoundedJson(response, elevationLimits.maximumResponseBytes, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new ElevationError('Tileflow Elevation returned an invalid response', {
      status: response.status,
    });
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || !isExpectedResponse(parsed.data))
    throw new ElevationError('Tileflow Elevation returned an invalid response', {
      status: response.status,
    });
  return parsed.data;
}

function normalizeApp(value: ElevationOptions['app']) {
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

async function readElevationError(response: Response, signal?: AbortSignal) {
  const value = response.headers.get('Retry-After');
  const retryAfterSeconds = value && /^\d{1,8}$/u.test(value) ? Number(value) : null;
  let body: unknown;
  try {
    body = await readBoundedJson(response, 8 * 1024, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return new ElevationError('Tileflow Elevation request failed', {
      status: response.status,
      retryAfterSeconds,
    });
  }
  const parsed = elevationErrorResponseSchema.safeParse(body);
  // A code is trusted only with the status the contract gives it; access errors may also arrive
  // as 401 from the credential check.
  const expected =
    parsed.success &&
    (elevationErrorStatus[parsed.data.code] === response.status ||
      (parsed.data.code === 'ELEVATION_ACCESS_DENIED' && response.status === 401));
  if (!parsed.success || !expected)
    return new ElevationError('Tileflow Elevation request failed', {
      status: response.status,
      retryAfterSeconds,
    });
  return new ElevationError(parsed.data.error, {
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
    throw new Error('Tileflow Elevation response is too large');
  }
  if (!response.body) throw new Error('Tileflow Elevation response is empty');
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
        throw new Error('Tileflow Elevation response is too large');
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
    if (aborted) throw signal.reason ?? new Error('Tileflow Elevation request was aborted');
    return chunk;
  } catch (error) {
    if (aborted) throw signal.reason ?? error;
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
