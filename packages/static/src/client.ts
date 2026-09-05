import {z} from 'zod';
import {
  StaticMapRequestError,
  staticMapRequestErrorResponseSchema,
  type StaticMapRequestFailure,
} from './auto-fit';
import {isSafeHttpUrl, jsonByteLength, stableStringify} from './canonical';
import {type StaticAttributionPosition, type StaticSceneInput, validateStaticScene} from './scene';

const maxStaticMapResponseBytes = 64 * 1024;
const staticMapIdempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const STATIC_MAP_RESULT_V2_MEDIA_TYPE =
  'application/vnd.tileflow.static-map-result+json;version=2';

export type StaticMapAttributionEntry = Readonly<{
  authority: 'platform-notice' | 'team-declared';
  links: readonly Readonly<{label: string; url: string}>[];
  text: string;
}>;

export type StaticMapAttributionResult = Readonly<{
  entries: readonly StaticMapAttributionEntry[];
  mode: 'embedded' | 'external';
  position: Exclude<StaticAttributionPosition, 'auto'> | null;
}>;

export type StaticMapResult = {
  attribution?: StaticMapAttributionResult;
  cached: boolean;
  hash: string;
  imageUrl: string;
  operationId: string | null;
  remainingUnits: number | null;
  resultVersion?: 2;
  status: 'ready';
  unitCost: 0 | 15;
};

export type StaticMapHostedResult = StaticMapResult &
  Readonly<{
    attribution: StaticMapAttributionResult;
    operationId: string;
    resultVersion: 2;
    unitCost: 15;
  }>;

export type StaticMapCreateOptions = {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  idempotencyKey: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type StaticMapEndpointRequestOptions = Omit<StaticMapCreateOptions, 'apiUrl'> & {
  createUrl: string;
};

export type PreparedStaticMapRequest = Readonly<{
  sceneKey: string;
}>;

const preparedStaticMapRequestBodies = new WeakMap<PreparedStaticMapRequest, string>();

export const staticMapReadyResultSchema = z
  .object({
    cached: z.boolean(),
    hash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    imageUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine(isSafeHttpUrl, {message: 'Expected an http(s) URL without credentials'}),
    operationId: z.string().min(20).max(68),
    remainingUnits: z.number().int().nonnegative().nullable(),
    status: z.literal('ready'),
    unitCost: z.literal(15),
  })
  .strict();

const safeAttributionTextSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(hasNoControlCharacters, {message: 'Attribution text contains control characters'});

export const staticMapAttributionEntrySchema = z
  .object({
    authority: z.enum(['platform-notice', 'team-declared']),
    links: z
      .array(
        z
          .object({
            label: safeAttributionTextSchema,
            url: z.string().trim().url().max(2048).refine(isSafeHttpUrl, {
              message: 'Expected an http(s) URL without credentials or a fragment',
            }),
          })
          .strict(),
      )
      .max(8),
    text: safeAttributionTextSchema,
  })
  .strict();

export const staticMapAttributionResultSchema = z
  .object({
    entries: z.array(staticMapAttributionEntrySchema).max(18),
    mode: z.enum(['embedded', 'external']),
    position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.mode === 'external' && result.position !== null) ||
      (result.mode === 'embedded' && result.position === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attribution position must match its mode',
        path: ['position'],
      });
    }

    if (jsonByteLength(result) > 32 * 1024) {
      context.addIssue({code: 'custom', message: 'Attribution result exceeds 32 KiB'});
    }
  });

export const staticMapHostedResultSchema = staticMapReadyResultSchema
  .extend({
    attribution: staticMapAttributionResultSchema,
    resultVersion: z.literal(2),
  })
  .strict();

export const staticMapProcessingResultSchema = z
  .object({
    operationId: z.string().min(20).max(68),
    retryAfterMs: z.number().int().min(0).max(5000),
    status: z.literal('processing'),
  })
  .strict();

export {stableStringify};

export function validateStaticMapIdempotencyKey(
  value: unknown,
): {key: string; ok: true} | {error: string; ok: false} {
  if (typeof value !== 'string' || !staticMapIdempotencyKeyPattern.test(value)) {
    return {
      error:
        'Idempotency key must contain 8-128 ASCII letters, digits, dot, underscore, colon, or hyphen and start with a letter or digit',
      ok: false,
    };
  }

  return {key: value, ok: true};
}

export function createStaticMapIdempotencyKey() {
  const key = `static_${crypto.randomUUID()}`;
  if (!validateStaticMapIdempotencyKey(key).ok) {
    throw new Error('Unable to create a valid Tileflow Static Maps idempotency key');
  }
  return key;
}

export function prepareStaticMapRequest(scene: StaticSceneInput): PreparedStaticMapRequest {
  const validation = validateStaticScene(scene);

  if (!validation.ok) {
    if (isStaticMapRequestFailure(validation)) {
      const {ok: _ok, ...response} = validation;
      throw new StaticMapRequestError(response);
    }

    throw new Error(`Invalid Tileflow static scene: ${validation.error}`);
  }

  const prepared = Object.freeze({
    sceneKey: stableStringify(validation.scene),
  });

  preparedStaticMapRequestBodies.set(prepared, JSON.stringify(validation.scene));
  return prepared;
}

export async function createStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions,
): Promise<StaticMapHostedResult> {
  return requestStaticMap(scene, options, '/v1/static/maps');
}

export async function precacheStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions,
): Promise<StaticMapHostedResult> {
  return requestStaticMap(scene, options, '/v1/static/maps/precache');
}

async function requestStaticMap(
  scene: StaticSceneInput,
  options: StaticMapCreateOptions,
  path: '/v1/static/maps' | '/v1/static/maps/precache',
): Promise<StaticMapHostedResult> {
  const preparedRequest = prepareStaticMapRequest(scene);
  const {apiUrl = 'https://api.tileflow.dev', ...requestOptions} = options;

  return requestStaticMapUntilReady(preparedRequest, {
    ...requestOptions,
    createUrl: `${normalizeUrl(apiUrl)}${path}`,
  });
}

export async function requestStaticMapUntilReady(
  request: PreparedStaticMapRequest,
  options: StaticMapEndpointRequestOptions,
): Promise<StaticMapHostedResult> {
  const body = preparedStaticMapRequestBodies.get(request);
  if (body === undefined) {
    throw new Error('Tileflow static map request must be created with prepareStaticMapRequest');
  }

  const idempotency = validateStaticMapIdempotencyKey(options.idempotencyKey);
  if (!idempotency.ok) {
    throw new Error(`Invalid Tileflow Static Maps idempotency key: ${idempotency.error}`);
  }

  const maxWaitMs = boundedClientDuration(options.maxWaitMs, 30_000, 100, 120_000, 'maxWaitMs');
  const pollIntervalMs = boundedClientDuration(
    options.pollIntervalMs,
    500,
    0,
    5_000,
    'pollIntervalMs',
  );
  const fetcher = options.fetch ?? fetch;
  const createUrl = normalizeStaticMapEndpointUrl(options.createUrl);
  const headers: Record<string, string> = {
    Accept: STATIC_MAP_RESULT_V2_MEDIA_TYPE,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotency.key,
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  return runWithinStaticMapBudget(maxWaitMs, options.signal, async (signal) => {
    let operationId: string | null = null;

    while (true) {
      const response = await fetcher(createUrl, {
        body,
        headers,
        method: 'POST',
        signal,
      });
      throwIfAborted(signal);

      if (!response.ok) {
        const requestError =
          response.status === 422
            ? await readStaticMapRequestErrorResponse(response, 8 * 1024)
            : await discardBoundedResponse(response, 8 * 1024);
        throwIfAborted(signal);

        if (requestError) {
          throw new StaticMapRequestError(requestError, response.status);
        }

        throw new Error(`Tileflow static map failed (${response.status}).`);
      }

      const json = await readJsonResponse(response);
      throwIfAborted(signal);
      if (response.status !== 202) {
        const parsed = staticMapHostedResultSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(
            `Tileflow static map returned an invalid response: ${parsed.error.message}`,
          );
        }
        assertStaticMapOperationIdentity(operationId, parsed.data.operationId);
        return parsed.data;
      }

      const pending = staticMapProcessingResultSchema.safeParse(json);
      if (!pending.success) {
        throw new Error(
          `Tileflow static map returned an invalid response: ${pending.error.message}`,
        );
      }
      assertStaticMapOperationIdentity(operationId, pending.data.operationId);
      operationId ??= pending.data.operationId;
      await delay(Math.max(pollIntervalMs, pending.data.retryAfterMs), signal);
    }
  });
}

function hasNoControlCharacters(value: string) {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function boundedClientDuration(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(
      `Tileflow Static Maps ${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return resolved;
}

async function readJsonResponse(response: Response) {
  const source = await readBoundedResponseText(response, maxStaticMapResponseBytes, '64 KiB');
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error('Tileflow static map returned an invalid response: expected JSON');
  }
}

async function readStaticMapRequestErrorResponse(response: Response, maximumBytes: number) {
  try {
    const source = await readBoundedResponseText(response, maximumBytes, `${maximumBytes} bytes`);
    const parsed = staticMapRequestErrorResponseSchema.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function discardBoundedResponse(response: Response, maximumBytes: number) {
  try {
    await readBoundedResponseText(response, maximumBytes, `${maximumBytes} bytes`);
  } catch {
    // Remote diagnostics remain bounded and are never reflected to callers.
  }

  return null;
}

function isStaticMapRequestFailure(value: {
  error: string;
  ok: false;
}): value is StaticMapRequestFailure {
  if (!('code' in value)) return false;
  const {ok: _ok, ...response} = value as StaticMapRequestFailure;
  return staticMapRequestErrorResponseSchema.safeParse(response).success;
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
  displayLimit: string,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      throw new Error(
        `Tileflow static map returned an invalid response: response exceeded ${displayLimit}`,
      );
    }
    chunks.push(value);
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
    throw new Error('Tileflow static map returned an invalid response: expected UTF-8 JSON');
  }
}

async function runWithinStaticMapBudget<T>(
  maxWaitMs: number,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Tileflow static map timed out after ${maxWaitMs}ms`);
  const abortFromCaller = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener('abort', abortFromCaller, {once: true});
  }

  const timeout = setTimeout(() => controller.abort(timeoutError), maxWaitMs);
  try {
    throwIfAborted(controller.signal);
    const pending = operation(controller.signal);
    return await raceWithAbort(pending, controller.signal);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function delay(milliseconds: number, signal: AbortSignal) {
  if (milliseconds === 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, {once: true});
    }
  });
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Tileflow static map request was aborted');
  error.name = 'AbortError';
  return error;
}

function assertStaticMapOperationIdentity(expected: string | null, actual: string) {
  if (expected !== null && actual !== expected) {
    throw new Error('Tileflow static map changed operation identity while polling');
  }
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  if (!isSafeHttpUrl(value) || url.search) {
    throw new TypeError(
      'Tileflow Static Maps apiUrl must be HTTP(S) without credentials, query, or fragment',
    );
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizeStaticMapEndpointUrl(value: string): string {
  if (value.startsWith('/')) {
    if (
      value.startsWith('//') ||
      value.length > 2_048 ||
      /[\\?#]/u.test(value) ||
      hasControlCharacter(value)
    ) {
      throw new TypeError(
        'Tileflow Static Maps createUrl must be HTTP(S) without credentials, query, or fragment or a safe root-relative path',
      );
    }
    return value;
  }

  const url = new URL(value);
  if (!isSafeHttpUrl(value) || url.search) {
    throw new TypeError(
      'Tileflow Static Maps createUrl must be HTTP(S) without credentials, query, or fragment or a safe root-relative path',
    );
  }
  return url.toString();
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
