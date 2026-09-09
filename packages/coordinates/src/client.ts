import {
  type CoordinatesCommand,
  CoordinatesContractError,
  type CoordinatesErrorCode,
  type CoordinatesErrorReason,
  type CoordinatesRequest,
  type CoordinatesResponse,
  parseCoordinatesRequest,
  parseCoordinatesResponse,
} from './contract';

const defaultCoordinatesApiUrl = 'https://api.tileflow.dev';
const coordinatesClientDeadlineMs = 15_000;
const coordinatesClientMaximumResponseBytes = 4 * 1024 * 1024;
const clientOptionKeys = new Set(['apiKey', 'apiUrl', 'fetch', 'signal']);
const requestOptionKeys = new Set(['signal']);

export type CoordinatesClientOptions = Readonly<{
  apiKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}>;

export type CoordinatesClientRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type CoordinatesClient = Readonly<{
  search(
    request: CoordinatesRequest<'search'>,
    options?: CoordinatesClientRequestOptions,
  ): Promise<CoordinatesResponse<'search'>>;
  describe(
    request: CoordinatesRequest<'describe'>,
    options?: CoordinatesClientRequestOptions,
  ): Promise<CoordinatesResponse<'describe'>>;
  operations(
    request: CoordinatesRequest<'operations'>,
    options?: CoordinatesClientRequestOptions,
  ): Promise<CoordinatesResponse<'operations'>>;
  transform(
    request: CoordinatesRequest<'transform'>,
    options?: CoordinatesClientRequestOptions,
  ): Promise<CoordinatesResponse<'transform'>>;
}>;

type CoordinatesClientConfiguration = Readonly<{
  apiKey: string;
  apiUrl: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}>;

export function createCoordinatesClient(options: CoordinatesClientOptions): CoordinatesClient {
  const configuration = normalizeConfiguration(options);

  return Object.freeze({
    search: (request, requestOptions) =>
      requestCoordinates('search', request, configuration, requestOptions),
    describe: (request, requestOptions) =>
      requestCoordinates('describe', request, configuration, requestOptions),
    operations: (request, requestOptions) =>
      requestCoordinates('operations', request, configuration, requestOptions),
    transform: (request, requestOptions) =>
      requestCoordinates('transform', request, configuration, requestOptions),
  });
}

async function requestCoordinates<C extends CoordinatesCommand>(
  command: C,
  input: CoordinatesRequest<C>,
  configuration: CoordinatesClientConfiguration,
  options?: CoordinatesClientRequestOptions,
): Promise<CoordinatesResponse<C>> {
  const request = parseCoordinatesRequest(command, input);
  const requestSignal = normalizeRequestOptions(options);
  const body = JSON.stringify(request);
  const controller = new AbortController();
  let sent = false;
  let timedOut = false;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    controller.abort();
  };
  const signals = [configuration.signal, requestSignal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );

  for (const signal of signals) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, {once: true});
  }

  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, coordinatesClientDeadlineMs);

  try {
    if (controller.signal.aborted) throw cancellationFailure(command, sent, timedOut, cancelled);

    let response: Response;
    try {
      sent = true;
      const pending = Promise.resolve(
        configuration.fetcher(`${configuration.apiUrl}/v1/coordinates/${command}`, {
          body,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${configuration.apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
        }),
      );
      response = await awaitResponseOrAbort(pending, controller.signal);
    } catch {
      throw cancellationFailure(command, sent, timedOut, cancelled);
    }

    if (controller.signal.aborted) {
      cancelResponse(response);
      throw cancellationFailure(command, sent, timedOut, cancelled);
    }
    if (response.redirected) {
      cancelResponse(response);
      throw clientFailure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', sent);
    }

    let value: unknown;
    try {
      value = await readBoundedJson(response, controller.signal);
    } catch (error) {
      if (timedOut || cancelled || controller.signal.aborted)
        throw cancellationFailure(command, sent, timedOut, cancelled);
      throw clientFailure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', sent);
    }

    let parsed: CoordinatesResponse<C>;
    try {
      parsed = parseCoordinatesResponse(command, input, value, {mode: 'hosted'});
    } catch (error) {
      if (error instanceof CoordinatesContractError) throw error;
      throw clientFailure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', sent);
    }

    if ((response.ok && !parsed.ok) || (!response.ok && parsed.ok)) {
      throw clientFailure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', sent);
    }
    if (!parsed.ok) throw new CoordinatesContractError(parsed);
    return parsed;
  } finally {
    clearTimeout(deadline);
    for (const signal of signals) signal.removeEventListener('abort', cancel);
  }
}

function normalizeConfiguration(options: CoordinatesClientOptions): CoordinatesClientConfiguration {
  if (!hasOnlyOptionKeys(options, clientOptionKeys)) {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  const input = options as CoordinatesClientOptions;
  const apiKey = input?.apiKey;
  if (
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    apiKey.length > 4096 ||
    apiKey !== apiKey.trim() ||
    /\p{Cc}/u.test(apiKey)
  ) {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  if (!isAbortSignal(input.signal)) {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }

  const apiUrl = normalizeApiUrl(input.apiUrl ?? defaultCoordinatesApiUrl);
  const fetcher = input.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw clientFailure(null, 'COORDINATES_UNAVAILABLE', 'SERVICE_UNAVAILABLE', false);
  }
  return {apiKey, apiUrl, fetcher, ...(input.signal ? {signal: input.signal} : {})};
}

function normalizeRequestOptions(
  options: CoordinatesClientRequestOptions | undefined,
): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!hasOnlyOptionKeys(options, requestOptionKeys) || !isAbortSignal(options.signal)) {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  return options.signal;
}

function hasOnlyOptionKeys(
  value: unknown,
  keys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.has(key));
  } catch {
    return false;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  try {
    const signal = value as AbortSignal;
    return (
      typeof signal.aborted === 'boolean' &&
      typeof signal.addEventListener === 'function' &&
      typeof signal.removeEventListener === 'function'
    );
  } catch {
    return false;
  }
}

function normalizeApiUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw clientFailure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', false);
  }
  return url.href.replace(/\/+$/u, '');
}

function cancellationFailure(
  command: CoordinatesCommand,
  sent: boolean,
  timedOut: boolean,
  cancelled: boolean,
): CoordinatesContractError {
  if (timedOut) return clientFailure(command, 'COORDINATES_TIMEOUT', 'TIMEOUT', sent);
  if (cancelled) return clientFailure(command, 'COORDINATES_CANCELLED', 'CANCELLED', sent);
  return clientFailure(command, 'COORDINATES_UNAVAILABLE', 'SERVICE_UNAVAILABLE', sent);
}

function clientFailure(
  command: CoordinatesCommand | null,
  code: CoordinatesErrorCode,
  reason: CoordinatesErrorReason,
  sentTransform: boolean,
): CoordinatesContractError {
  return new CoordinatesContractError({
    schemaVersion: 1,
    ok: false,
    command,
    releaseId: null,
    provenance: null,
    warnings: [],
    usage:
      sentTransform && command === 'transform'
        ? {mode: 'hosted', state: 'unconfirmed', units: null}
        : null,
    error: {
      code,
      reason,
      phase: code === 'COORDINATES_INVALID_REQUEST' ? 'input' : 'response',
      details: {},
    },
  });
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
    if (Number(declaredLength) > coordinatesClientMaximumResponseBytes) {
      cancelResponse(response);
      throw new CoordinatesClientResponseError();
    }
  }
  if (!response.body) {
    throw new CoordinatesClientResponseError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let completed = false;
  try {
    while (true) {
      const chunk = await readWithAbort(reader, signal);
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > coordinatesClientMaximumResponseBytes) {
        cancelReader(reader);
        throw new CoordinatesClientResponseError();
      }
      chunks.push(chunk.value);
    }
    completed = true;
  } finally {
    if (!completed) cancelReader(reader);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw new CoordinatesClientResponseError();
  }
}

class CoordinatesClientResponseError extends Error {}
class CoordinatesClientAbortError extends Error {}

async function awaitResponseOrAbort(
  pending: Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) {
    void pending.then(cancelResponse, () => undefined);
    throw new CoordinatesClientAbortError();
  }
  let removeAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => {
      void pending.then(cancelResponse, () => undefined);
      reject(new CoordinatesClientAbortError());
    };
    signal.addEventListener('abort', abort, {once: true});
    removeAbortListener = () => signal.removeEventListener('abort', abort);
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    removeAbortListener?.();
  }
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new Error('aborted');
  let removeAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', abort, {once: true});
    removeAbortListener = () => signal.removeEventListener('abort', abort);
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    removeAbortListener?.();
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // A closed or released reader needs no further cancellation.
  }
}

function cancelResponse(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A closed body needs no further cancellation.
  }
}
