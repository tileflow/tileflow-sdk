import {
  staticMapProcessingResultSchema,
  staticMapReadyResultSchema,
  type StaticMapResult,
  type StaticSceneInput,
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
  sceneKey: string;
}) {
  return stableStringify(input);
}

export async function resolveStaticMap(input: {
  createUrl: string;
  fetch?: typeof fetch;
  idempotencyKey: string;
  requestKey: string;
  scene: StaticSceneInput;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  let entry = inFlightRequests.get(input.requestKey);

  if (!entry) {
    const controller = new AbortController();
    const promise = requestStaticMapUntilReady({...input, signal: controller.signal});
    const created: InFlightStaticMapRequest = {
      controller,
      consumers: 0,
      promise,
      settled: false,
    };
    const settle = () => {
      created.settled = true;
      if (inFlightRequests.get(input.requestKey) === created) {
        inFlightRequests.delete(input.requestKey);
      }
    };
    void promise.then(settle, settle);
    inFlightRequests.set(input.requestKey, created);
    entry = created;
  }

  entry.consumers += 1;
  try {
    return await raceWithAbort(entry.promise, input.signal);
  } finally {
    entry.consumers -= 1;
    if (entry.consumers === 0 && !entry.settled) {
      if (inFlightRequests.get(input.requestKey) === entry) {
        inFlightRequests.delete(input.requestKey);
      }
      entry.controller.abort();
    }
  }
}

export async function requestStaticMapUntilReady(input: {
  createUrl: string;
  fetch?: typeof fetch;
  idempotencyKey: string;
  maxWaitMs?: number;
  scene: StaticSceneInput;
  signal?: AbortSignal;
}) {
  const maxWaitMs = input.maxWaitMs ?? 30_000;
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 120_000) {
    throw new Error('Static map maxWaitMs must be an integer from 1 to 120000');
  }

  return runWithinBudget(maxWaitMs, input.signal, async (signal) => {
    const body = JSON.stringify(input.scene);
    const fetcher = input.fetch ?? fetch;
    let operationId: string | null = null;

    while (true) {
      const response = await fetcher(input.createUrl, {
        body,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        method: 'POST',
        signal,
      });
      throwIfAborted(signal);
      if (!response.ok) throw new Error(`Static map endpoint failed: ${response.status}`);
      let value: unknown;
      try {
        value = (await response.json()) as unknown;
      } catch {
        throw new Error('Static map endpoint returned invalid JSON');
      }
      throwIfAborted(signal);
      if (response.status !== 202) {
        const ready = staticMapReadyResultSchema.safeParse(value);
        if (!ready.success) throw new Error('Static map endpoint returned an invalid response');
        assertStaticMapOperationIdentity(operationId, ready.data.operationId);
        return ready.data;
      }
      const pending = staticMapProcessingResultSchema.safeParse(value);
      if (!pending.success) throw new Error('Static map endpoint returned an invalid response');
      assertStaticMapOperationIdentity(operationId, pending.data.operationId);
      operationId ??= pending.data.operationId;
      await delay(pending.data.retryAfterMs, signal);
    }
  });
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function assertStaticMapOperationIdentity(expected: string | null, actual: string) {
  if (expected !== null && actual !== expected) {
    throw new Error('Static map endpoint changed operation identity while polling');
  }
}

async function runWithinBudget<T>(
  maxWaitMs: number,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Static map request timed out after ${maxWaitMs}ms`);
  const abortFromConsumer = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) abortFromConsumer();
  else externalSignal?.addEventListener('abort', abortFromConsumer, {once: true});

  const timeout = setTimeout(() => controller.abort(timeoutError), maxWaitMs);
  try {
    throwIfAborted(controller.signal);
    const pending = operation(controller.signal);
    return await raceWithAbort(pending, controller.signal);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromConsumer);
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };

    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  });
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}
