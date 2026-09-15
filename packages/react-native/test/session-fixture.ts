import assert from 'node:assert/strict';
import type {
  HostedNativeSessionFetch,
  HostedNativeSessionFetchInit,
  HostedNativeSessionFetchResponse,
  HostedNativeSessionState,
} from '../src/session-controller';

export const credential = `tf_public_${'a'.repeat(48)}`;
export const mapId = 'map_0123456789abcdef';
export const apiOrigin = 'https://api.tileflow.test';
export const grant = `tf_native_v1.${'b'.repeat(96)}.${'c'.repeat(43)}`;

export function createClock(initial = Date.parse('2026-09-15T20:00:00.000Z')) {
  let value = initial;
  return {
    now: () => new Date(value),
    advance(ms: number) {
      value += ms;
    },
    set(next: number) {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

export function createIds(prefix = 'ses_test') {
  let sequence = 0;
  return () => `${prefix}_${++sequence}`;
}

export function success(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    kind: 'native',
    version: 1,
    usageMode: 'session',
    counted: false,
    grant,
    mapId,
    sessionId: 'ses_test_1',
    surfaceId: 'store-locator',
    credentialId: 'key_mobile_12345678',
    credentialRevision: 4,
    deliveryPolicyRevision: 7,
    issuedAt: '2026-09-15T20:00:00.000Z',
    serverTime: '2026-09-15T20:00:00.000Z',
    expiresAt: '2026-09-15T20:15:00.000Z',
    meterMode: 'disabled',
    disposition: 'unmetered',
    resourceOrigins: ['https://api.tileflow.test', 'https://tiles.tileflow.test'],
    resourceScopes: ['style', 'tilejson', 'tile', 'sprite', 'glyph', 'font'],
    tilesetIds: ['world', 'tls_0123456789abcdef'],
    ...overrides,
  };
}

class HeadersView {
  readonly #values: Map<string, string>;

  constructor(values: Record<string, string>) {
    this.#values = new Map(
      Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
    );
  }

  get(name: string) {
    return this.#values.get(name.toLowerCase()) ?? null;
  }
}

export function response(
  status: number,
  body: unknown,
  options: {
    headers?: Record<string, string>;
    chunks?: readonly Uint8Array[];
    nullBody?: boolean;
  } = {},
): HostedNativeSessionFetchResponse {
  const bytes = options.chunks ?? [
    new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  ];
  let index = 0;
  let cancelled = false;
  return {
    status,
    headers: new HeadersView(options.headers ?? {'cache-control': 'no-store'}),
    body: options.nullBody
      ? null
      : {
          getReader() {
            return {
              async read() {
                if (cancelled || index >= bytes.length) return {done: true as const};
                return {done: false as const, value: bytes[index++]};
              },
              async cancel() {
                cancelled = true;
              },
            };
          },
        },
  };
}

export function createFetchQueue(
  entries: Array<
    HostedNativeSessionFetchResponse | (() => Promise<HostedNativeSessionFetchResponse>)
  >,
) {
  const calls: Array<{url: string; init: HostedNativeSessionFetchInit}> = [];
  const waiters: Array<{count: number; resolve: () => void}> = [];

  const flushWaiters = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (calls.length < waiter.count) continue;
      waiters.splice(index, 1);
      waiter.resolve();
    }
  };

  const fetch: HostedNativeSessionFetch = async (url, init) => {
    calls.push({url, init});
    flushWaiters();
    const next = entries.shift();
    if (!next) throw new Error('unexpected fetch');
    return typeof next === 'function' ? next() : next;
  };

  const waitForCalls = (count: number) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid call count');
    if (calls.length >= count) return Promise.resolve();
    return new Promise<void>((resolve) => waiters.push({count, resolve}));
  };

  return {calls, fetch, waitForCalls};
}

export function assertSafeState(state: HostedNativeSessionState, secrets: readonly string[]) {
  const serialized = JSON.stringify(state);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, serialized);
  assert.equal(serialized.includes('https://'), false, serialized);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, reject, resolve};
}
