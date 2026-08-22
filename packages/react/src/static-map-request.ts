import {
  requestStaticMapUntilReady,
  stableStringify,
  type PreparedStaticMapRequest,
  type StaticMapResult,
} from '@tileflow/static';

type InFlightStaticMapRequest = {
  controller: AbortController;
  consumers: number;
  promise: Promise<StaticMapResult>;
  settled: boolean;
};

const inFlightRequests = new Map<string, InFlightStaticMapRequest>();

export function createStaticMapRequestKey(input: {
  createUrl: string;
  idempotencyKey: string;
  request: PreparedStaticMapRequest;
}) {
  return stableStringify({
    createUrl: input.createUrl,
    idempotencyKey: input.idempotencyKey,
    sceneKey: input.request.sceneKey,
  });
}

export async function resolveStaticMap(input: {
  createUrl: string;
  fetch?: typeof fetch;
  idempotencyKey: string;
  maxWaitMs?: number;
  request: PreparedStaticMapRequest;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const requestKey = createStaticMapRequestKey(input);
  let entry = inFlightRequests.get(requestKey);

  if (!entry) {
    const controller = new AbortController();
    const promise = requestStaticMapUntilReady(input.request, {
      createUrl: input.createUrl,
      fetch: input.fetch,
      idempotencyKey: input.idempotencyKey,
      maxWaitMs: input.maxWaitMs,
      pollIntervalMs: 0,
      signal: controller.signal,
    });
    const created: InFlightStaticMapRequest = {
      controller,
      consumers: 0,
      promise,
      settled: false,
    };
    const settle = () => {
      created.settled = true;
      if (inFlightRequests.get(requestKey) === created) {
        inFlightRequests.delete(requestKey);
      }
    };
    void promise.then(settle, settle);
    inFlightRequests.set(requestKey, created);
    entry = created;
  }

  entry.consumers += 1;
  try {
    return await raceWithAbort(entry.promise, input.signal);
  } finally {
    entry.consumers -= 1;
    if (entry.consumers === 0 && !entry.settled) {
      if (inFlightRequests.get(requestKey) === entry) {
        inFlightRequests.delete(requestKey);
      }
      entry.controller.abort();
    }
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Static map request was aborted');
  error.name = 'AbortError';
  return error;
}
