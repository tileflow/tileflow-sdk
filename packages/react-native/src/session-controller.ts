import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';

const RESPONSE_BYTE_LIMIT = 65_536;
const GRANT_CHARACTER_LIMIT = 24_576;
const MAX_TILESETS = 18;
const MAX_GRANT_LIFETIME_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 30_000;
const ROTATION_AGE_MS = 6 * 60 * 60 * 1000;
const ROTATION_REQUEST_LIMIT = 10_000;
const FUTURE_ISSUE_SKEW_MS = 30_000;
const RETRY_INITIAL_MS = 1_000;
const RETRY_LIMIT_MS = 60_000;
const RETRY_AFTER_LIMIT_MS = 15 * 60 * 1000;
const RETRY_AFTER_SECONDS = /^\d{1,10}$/u;
// Only these 429 bodies mean the Map or Team is out of quota; any other 429 is rate limiting.
const QUOTA_CODES = new Set(['COMMERCIAL_MAP_LIMIT_REACHED', 'COMMERCIAL_SPENDING_LIMIT_REACHED']);
// A refusal reports the service's reason only from a small body with a well-formed code.
const SERVICE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SERVICE_CODE_BODY_LIMIT = 4096;
const MOBILE_CREDENTIAL = /^tf_public_[0-9a-f]{48}$/u;
const MAP_ID = /^map_[A-Za-z0-9_-]{16}$/u;
const CREDENTIAL_ID = /^key_[A-Za-z0-9_-]{8,80}$/u;
const COMPACT_ID = /^[A-Za-z0-9._:-]{1,255}$/u;
const SURFACE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const NATIVE_GRANT = /^tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const EXACT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ALLOWED_SCOPES = new Set<NativeSessionResourceScope>([
  'style',
  'tilejson',
  'tile',
  'sprite',
  'glyph',
  'font',
]);
const SUCCESS_KEYS = new Set([
  'ok',
  'kind',
  'version',
  'usageMode',
  'counted',
  'grant',
  'mapId',
  'sessionId',
  'surfaceId',
  'credentialId',
  'credentialRevision',
  'deliveryPolicyRevision',
  'issuedAt',
  'serverTime',
  'expiresAt',
  'meterMode',
  'disposition',
  'resourceOrigins',
  'resourceScopes',
  'tilesetIds',
]);
const RESTART_KEYS = new Set(['code', 'error', 'retryWithNewSession', 'sessionId']);

export type NativeSessionResourceScope =
  'style' | 'tilejson' | 'tile' | 'sprite' | 'glyph' | 'font';

export type HostedNativeSessionBinding =
  | Readonly<{
      kind: 'hosted';
      apiOrigin: string;
      credential: string;
      mapId: string;
      surfaceId?: string;
    }>
  | Readonly<{kind: 'direct'}>;

export type HostedNativeSessionAbortSignal = Readonly<{
  aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: {once?: boolean}): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}>;

export type HostedNativeSessionFetchInit = Readonly<{
  body: string;
  credentials: 'omit';
  headers: Readonly<Record<string, string>>;
  method: 'POST';
  signal: HostedNativeSessionAbortSignal;
}>;

export type HostedNativeSessionBodyReader = Readonly<{
  read(): Promise<{done: true; value?: undefined} | {done: false; value: Uint8Array}>;
  cancel(): void | Promise<void>;
}>;

export type HostedNativeSessionFetchResponse = Readonly<{
  status: number;
  headers: Readonly<{get(name: string): string | null}>;
  body: Readonly<{getReader(): HostedNativeSessionBodyReader}> | null;
}>;

export type HostedNativeSessionFetch = (
  url: string,
  init: HostedNativeSessionFetchInit,
) => Promise<HostedNativeSessionFetchResponse>;

export type HostedNativeSessionErrorCode =
  | 'NATIVE_SESSION_INPUT_INVALID'
  | 'NATIVE_SESSION_RESPONSE_TOO_LARGE'
  | 'NATIVE_SESSION_RESPONSE_UTF8_INVALID'
  | 'NATIVE_SESSION_RESPONSE_JSON_INVALID'
  | 'NATIVE_SESSION_RESPONSE_INVALID'
  | 'NATIVE_SESSION_CREDENTIAL_REJECTED'
  | 'NATIVE_SESSION_MAP_MISMATCH'
  | 'NATIVE_SESSION_MAP_NOT_FOUND'
  | 'NATIVE_SESSION_QUOTA_EXCEEDED'
  | 'NATIVE_SESSION_REJECTED'
  | 'NATIVE_SESSION_RATE_LIMITED'
  | 'NATIVE_SESSION_UNAVAILABLE'
  | 'NATIVE_SESSION_REPLACED'
  | 'NATIVE_SESSION_DISPOSED';

export type HostedNativeSessionErrorKind = 'terminal' | 'recoverable' | 'cancelled';

/**
 * The request, credential, Map or quota will not succeed again without a change outside the
 * device.
 */
const TERMINAL_CODES = new Set<HostedNativeSessionErrorCode>([
  'NATIVE_SESSION_INPUT_INVALID',
  'NATIVE_SESSION_CREDENTIAL_REJECTED',
  'NATIVE_SESSION_MAP_MISMATCH',
  'NATIVE_SESSION_MAP_NOT_FOUND',
  'NATIVE_SESSION_QUOTA_EXCEEDED',
  'NATIVE_SESSION_REJECTED',
]);

const ERROR_MESSAGES: Record<HostedNativeSessionErrorCode, string> = {
  NATIVE_SESSION_INPUT_INVALID: 'Native session configuration is invalid.',
  NATIVE_SESSION_RESPONSE_TOO_LARGE: 'Native session response exceeded its byte limit.',
  NATIVE_SESSION_RESPONSE_UTF8_INVALID: 'Native session response was not valid UTF-8.',
  NATIVE_SESSION_RESPONSE_JSON_INVALID: 'Native session response was not valid JSON.',
  NATIVE_SESSION_RESPONSE_INVALID: 'Native session response did not satisfy the expected contract.',
  NATIVE_SESSION_CREDENTIAL_REJECTED: 'Native session credential was rejected.',
  NATIVE_SESSION_MAP_MISMATCH: 'Native session authority does not match the requested Map.',
  NATIVE_SESSION_MAP_NOT_FOUND: 'Native session Map was not found.',
  NATIVE_SESSION_QUOTA_EXCEEDED: 'Native session quota was exceeded.',
  NATIVE_SESSION_REJECTED: 'Native session request was rejected.',
  NATIVE_SESSION_RATE_LIMITED: 'Native session requests are rate limited.',
  NATIVE_SESSION_UNAVAILABLE: 'Native session service is unavailable.',
  NATIVE_SESSION_REPLACED: 'Native session binding was replaced.',
  NATIVE_SESSION_DISPOSED: 'Native session controller is disposed.',
};

export class HostedNativeSessionError extends Error {
  readonly code: HostedNativeSessionErrorCode;
  readonly kind: HostedNativeSessionErrorKind;
  /** For `NATIVE_SESSION_REJECTED`, the service's code when its answer carried one. */
  declare readonly reason?: string;

  constructor(code: HostedNativeSessionErrorCode, reason?: string) {
    super(ERROR_MESSAGES[code]);
    this.name = 'HostedNativeSessionError';
    this.code = code;
    this.kind = errorKind(code);
    if (
      code === 'NATIVE_SESSION_REJECTED' &&
      typeof reason === 'string' &&
      SERVICE_CODE.test(reason)
    ) {
      this.reason = reason;
    }
  }
}

export type HostedNativeSessionAuthority = Readonly<{
  grant: string;
  mapId: string;
  sessionId: string;
  surfaceId: string;
  credentialId: string;
  credentialRevision: number;
  deliveryPolicyRevision: number;
  issuedAt: string;
  serverTime: string;
  expiresAt: string;
  meterMode: 'disabled' | 'shadow' | 'enforced';
  disposition: 'unmetered' | 'ordinary' | 'unbilled_fail_open';
  resourceOrigins: readonly string[];
  resourceScopes: readonly NativeSessionResourceScope[];
  tilesetIds: readonly string[];
}>;

/** Private graph classification data; it cannot authorize a resource request. */
export type HostedNativeResourcePolicy = Readonly<
  Pick<HostedNativeSessionAuthority, 'mapId' | 'resourceOrigins' | 'resourceScopes' | 'tilesetIds'>
>;

type SafeError = Readonly<{
  code: HostedNativeSessionErrorCode;
  kind: HostedNativeSessionErrorKind;
  reason?: string;
}>;
type Lifecycle = 'foreground' | 'background';

export type HostedNativeSessionState =
  | Readonly<{status: 'idle'; source: 'direct'; lifecycle: Lifecycle}>
  | Readonly<{
      status: 'idle' | 'loading';
      source: 'hosted';
      lifecycle: Lifecycle;
      mapId: string;
      sessionId: string;
    }>
  | Readonly<{
      status: 'ready';
      source: 'hosted';
      lifecycle: Lifecycle;
      mapId: string;
      sessionId: string;
      surfaceId: string;
      credentialId: string;
      credentialRevision: number;
      deliveryPolicyRevision: number;
    }>
  | Readonly<{
      status: 'error';
      source: 'hosted';
      lifecycle: Lifecycle;
      mapId: string;
      sessionId: string;
      error: SafeError;
    }>
  | Readonly<{status: 'disposed'; lifecycle: 'disposed'}>;

export type HostedNativeSessionController = Readonly<{
  readonly state: HostedNativeSessionState;
  acquire(): Promise<HostedNativeSessionAuthority | null>;
  prepare?(): Promise<HostedNativeResourcePolicy | null>;
  transportBudget(authority: HostedNativeSessionAuthority): number;
  background(): void;
  resume(): Promise<void>;
  replaceBinding(binding: HostedNativeSessionBinding): void;
  /** Clears a terminal stop and any retry delay; the next acquisition bootstraps again. */
  retry?(): void;
  /** Milliseconds until a bootstrap may follow a recoverable failure, or null without one. */
  retryDelay?(): number | null;
  subscribe(listener: (state: HostedNativeSessionState) => void): () => void;
  dispose(): void;
}>;

type HostedBinding = Readonly<{
  kind: 'hosted';
  apiOrigin: string;
  credential: string;
  mapId: string;
  surfaceId: string;
}>;
type Binding = HostedBinding | Readonly<{kind: 'direct'}>;

type StoredAuthority = Readonly<{
  public: HostedNativeSessionAuthority;
  validUntil: number;
  clockEpoch: number;
  bindingGeneration: number;
}>;

type SessionOperation = {
  abort: SessionAbortController;
  promise: Promise<{authority: StoredAuthority; session: SessionRecord}>;
};

type SessionRecord = {
  authority: StoredAuthority | null;
  error: SafeError | null;
  lastServerTime: number | null;
  operation: SessionOperation | null;
  pendingAdmissions: number;
  redirect: SessionRecord | null;
  requestCount: number;
  requestedSurfaceId: string;
  serverStartedAt: number | null;
  sessionId: string;
  startedAt: number;
};

type ClockState = {lastWall: number; logical: number; epoch: number};

export function createHostedNativeSessionController(input: {
  binding: HostedNativeSessionBinding;
  fetch: HostedNativeSessionFetch;
  now: () => Date;
  sessionIdFactory: () => string;
}): HostedNativeSessionController {
  if (
    !isRecord(input) ||
    typeof input.fetch !== 'function' ||
    typeof input.now !== 'function' ||
    typeof input.sessionIdFactory !== 'function'
  ) {
    throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
  }

  const fetch = input.fetch;
  const now = input.now;
  const sessionIdFactory = input.sessionIdFactory;
  const issuedSessionIds = new Set<string>();
  let binding = normalizeBinding(input.binding);
  let lifecycle: Lifecycle = 'foreground';
  let disposed = false;
  let bindingGeneration = 0;
  const admittedAuthorities = new WeakMap<HostedNativeSessionAuthority, StoredAuthority>();
  const clock: ClockState = {lastWall: readWallClock(now), logical: 0, epoch: 0};
  let activeSession: SessionRecord | null =
    binding.kind === 'hosted' ? createSession(binding.surfaceId, 0) : null;
  let state = snapshotIdle(binding, activeSession, lifecycle);
  const listeners = new Set<(state: HostedNativeSessionState) => void>();
  const operations = new Set<SessionAbortController>();

  function readClock() {
    const wall = readWallClock(now);
    if (wall < clock.lastWall) clock.epoch += 1;
    else clock.logical += wall - clock.lastWall;
    clock.lastWall = wall;
    return clock.logical;
  }

  function bindingIsDirect() {
    return binding.kind === 'direct';
  }

  function createSession(surfaceId: string, startedAt: number): SessionRecord {
    let sessionId: unknown;
    try {
      sessionId = sessionIdFactory();
    } catch {
      throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
    }
    if (
      typeof sessionId !== 'string' ||
      !COMPACT_ID.test(sessionId) ||
      secretShaped(sessionId) ||
      issuedSessionIds.has(sessionId)
    ) {
      throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
    }
    issuedSessionIds.add(sessionId);
    return {
      authority: null,
      error: null,
      lastServerTime: null,
      operation: null,
      pendingAdmissions: 0,
      redirect: null,
      requestCount: 0,
      requestedSurfaceId: surfaceId,
      serverStartedAt: null,
      sessionId,
      startedAt,
    };
  }

  function publish(next: HostedNativeSessionState) {
    if (disposed && next.status !== 'disposed') return;
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // Observers do not own controller state.
      }
    }
  }

  function publishSession(
    session: SessionRecord,
    status: 'idle' | 'loading' | 'ready' | 'error',
    error?: SafeError,
  ) {
    if (disposed || activeSession !== session || binding.kind !== 'hosted') return;
    if (status === 'ready') {
      if (!session.authority) return;
      const authority = session.authority.public;
      publish(
        Object.freeze({
          status: 'ready' as const,
          source: 'hosted' as const,
          lifecycle,
          mapId: binding.mapId,
          sessionId: session.sessionId,
          surfaceId: authority.surfaceId,
          credentialId: authority.credentialId,
          credentialRevision: authority.credentialRevision,
          deliveryPolicyRevision: authority.deliveryPolicyRevision,
        }),
      );
      return;
    }
    if (status === 'error') {
      if (!error) return;
      publish(
        Object.freeze({
          status: 'error' as const,
          source: 'hosted' as const,
          lifecycle,
          mapId: binding.mapId,
          sessionId: session.sessionId,
          error: Object.freeze({...error}),
        }),
      );
      return;
    }
    publish(
      Object.freeze({
        status,
        source: 'hosted' as const,
        lifecycle,
        mapId: binding.mapId,
        sessionId: session.sessionId,
      }),
    );
  }

  let terminal: SafeError | null = null;
  // Recoverable failures of the binding delay its next bootstrap; still-valid authority is kept.
  let failures = 0;
  let retryAt: number | null = null;
  let retryError: SafeError | null = null;

  function clearRetry() {
    failures = 0;
    retryAt = null;
    retryError = null;
  }

  function delayRetry(error: HostedNativeSessionError) {
    let at: number;
    try {
      at = readClock();
    } catch {
      return;
    }
    // Concurrent bootstraps that fail together count once; a later Retry-After still extends.
    if (retryAt === null || at >= retryAt) failures = Math.min(failures + 1, 16);
    const backoff = Math.min(RETRY_INITIAL_MS * 2 ** (failures - 1), RETRY_LIMIT_MS);
    retryAt = Math.max(retryAt ?? at, at + Math.max(backoff, retryAfterDelays.get(error) ?? 0));
    retryError = safeError(error);
  }

  function rotateIfRequired(at: number) {
    if (terminal) throw errorFrom(terminal);
    if (!activeSession || binding.kind !== 'hosted') return;
    if (
      at - activeSession.startedAt < ROTATION_AGE_MS &&
      activeSession.requestCount < ROTATION_REQUEST_LIMIT
    ) {
      return;
    }
    const previous = activeSession;
    activeSession = createSession(
      previous.authority?.public.surfaceId ?? previous.requestedSurfaceId,
      at,
    );
    publishSession(activeSession, 'idle');
  }

  function redirectSession(session: SessionRecord, at: number) {
    const replacement = createSession(
      session.authority?.public.surfaceId ?? session.requestedSurfaceId,
      at,
    );
    // Preparation has no ticket. Only actual pending acquisitions transfer accounting.
    replacement.requestCount = session.pendingAdmissions;
    replacement.operation = session.operation;
    session.redirect = replacement;
    activeSession = replacement;
    publishSession(replacement, 'loading');
    return replacement;
  }

  function latestSession(session: SessionRecord) {
    const seen = new Set<SessionRecord>();
    let current = session;
    while (current.redirect && !seen.has(current.redirect)) {
      seen.add(current);
      current = current.redirect;
    }
    return current;
  }

  async function ensureAuthority(session: SessionRecord, at: number) {
    if (terminal) throw errorFrom(terminal);
    if (
      session.authority &&
      session.authority.clockEpoch === clock.epoch &&
      session.authority.validUntil - at > REFRESH_MARGIN_MS
    ) {
      return {authority: session.authority, session};
    }
    if (session.operation) return session.operation.promise;
    if (binding.kind !== 'hosted') {
      throw new HostedNativeSessionError('NATIVE_SESSION_REPLACED');
    }
    if (retryAt !== null && retryError && at < retryAt) {
      if (
        session.authority &&
        session.authority.clockEpoch === clock.epoch &&
        session.authority.validUntil > at
      ) {
        return {authority: session.authority, session};
      }
      throw errorFrom(retryError);
    }

    const operationBinding = binding;
    const abort = new SessionAbortController();
    operations.add(abort);
    const operation: SessionOperation = {
      abort,
      promise: Promise.resolve().then(async () => {
        try {
          if (abort.signal.aborted) throw abort.error();
          session.error = null;
          publishSession(session, 'loading');
          if (abort.signal.aborted) throw abort.error();
          const result = await bootstrap(session, operationBinding, abort, true, true);
          if (abort.signal.aborted) throw abort.error();
          result.session.authority = result.authority;
          result.session.error = null;
          if (binding === operationBinding) clearRetry();
          if (activeSession === result.session) {
            publishSession(result.session, 'ready');
            if (abort.signal.aborted) throw abort.error();
          }
          return result;
        } catch (error) {
          const normalized = abort.signal.aborted ? abort.error() : normalizeError(error);
          const target = latestSession(session);
          if (normalized.kind === 'terminal' && binding === operationBinding && !terminal) {
            const failure = safeError(normalized);
            terminal = failure;
            const rejectedSession = activeSession;
            if (rejectedSession) {
              rejectedSession.authority = null;
              rejectedSession.error = failure;
            }
            // A rejection applies to the binding, including bootstraps across age rotation.
            // Snapshot before callbacks: cancellation observers may replace the binding.
            for (const pending of [...operations]) {
              pending.abort(failure.code, failure.reason);
            }
            if (binding === operationBinding && rejectedSession) {
              publishSession(rejectedSession, 'error', failure);
            }
          }
          if (normalized.kind === 'recoverable' && binding === operationBinding && !terminal) {
            delayRetry(normalized);
          }
          if (
            normalized.code !== 'NATIVE_SESSION_REPLACED' &&
            normalized.code !== 'NATIVE_SESSION_DISPOSED'
          ) {
            target.error = safeError(normalized);
            publishSession(target, 'error', target.error);
          }
          throw normalized;
        } finally {
          operations.delete(abort);
          let current: SessionRecord | null = session;
          const seen = new Set<SessionRecord>();
          while (current && !seen.has(current)) {
            seen.add(current);
            if (current.operation === operation) current.operation = null;
            current = current.redirect;
          }
        }
      }),
    };
    session.operation = operation;
    return operation.promise;
  }

  async function bootstrap(
    session: SessionRecord,
    hostedBinding: HostedBinding,
    abort: SessionAbortController,
    allowRestart: boolean,
    allowServerAgeRotation: boolean,
  ): Promise<{authority: StoredAuthority; session: SessionRecord}> {
    const requestStartedAt = readClock();
    const requestClockEpoch = clock.epoch;
    const requestBindingGeneration = bindingGeneration;
    if (abort.signal.aborted) throw abort.error();
    const expectedSurfaceId = session.authority?.public.surfaceId ?? session.requestedSurfaceId;
    const response = await fetchResponse(hostedBinding, session, expectedSurfaceId, abort);
    const {source, size} = await readBoundedResponse(response, abort);
    let body: unknown;
    try {
      body = source.length ? JSON.parse(source) : null;
    } catch {
      // Only success and restart bodies are contracts; a failure status classifies a proxy page.
      if (response.status === 201) {
        throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_JSON_INVALID');
      }
      body = null;
    }

    if (response.status === 409 && isExactRestart(body, session.sessionId)) {
      // A second restart in one bootstrap waits for the retry delay; it is not a refusal.
      if (!allowRestart) throw new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
      assertCurrentSession(session, hostedBinding);
      const replacement = redirectSession(session, readClock());
      if (abort.signal.aborted) throw abort.error();
      return bootstrap(replacement, hostedBinding, abort, false, false);
    }
    if (response.status !== 201) {
      const failure = statusError(response.status, body, size);
      const delay = retryAfterMs(response.headers, now);
      if (delay !== null) retryAfterDelays.set(failure, delay);
      throw failure;
    }
    if (!hasNoStore(response.headers.get('cache-control'))) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }

    const payload = parseSuccess(body, hostedBinding, session.sessionId, expectedSurfaceId);
    if (session.lastServerTime !== null && payload.serverTimeMs < session.lastServerTime) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    if (
      allowServerAgeRotation &&
      session.serverStartedAt !== null &&
      payload.serverTimeMs - session.serverStartedAt >= ROTATION_AGE_MS
    ) {
      assertCurrentSession(session, hostedBinding);
      const replacement = redirectSession(session, readClock());
      if (abort.signal.aborted) throw abort.error();
      return bootstrap(replacement, hostedBinding, abort, false, false);
    }

    session.serverStartedAt ??= payload.serverTimeMs;
    session.lastServerTime = payload.serverTimeMs;
    const ttl = payload.expiresAtMs - payload.serverTimeMs;
    return {
      authority: Object.freeze({
        public: payload.authority,
        validUntil: requestStartedAt + ttl,
        clockEpoch: requestClockEpoch,
        bindingGeneration: requestBindingGeneration,
      }),
      session,
    };
  }

  function assertCurrentSession(session: SessionRecord, expectedBinding: HostedBinding) {
    if (
      activeSession !== session ||
      binding.kind !== 'hosted' ||
      !sameHostedBinding(binding, expectedBinding)
    ) {
      throw new HostedNativeSessionError('NATIVE_SESSION_REPLACED');
    }
  }

  async function fetchResponse(
    hostedBinding: HostedBinding,
    session: SessionRecord,
    surfaceId: string,
    abort: SessionAbortController,
  ) {
    const body = JSON.stringify({
      mapId: hostedBinding.mapId,
      sessionId: session.sessionId,
      surfaceId,
    });
    const init: HostedNativeSessionFetchInit = Object.freeze({
      body,
      credentials: 'omit' as const,
      headers: Object.freeze({
        'Content-Type': 'application/json',
        'X-Tileflow-Mobile-Client': hostedBinding.credential,
      }),
      method: 'POST' as const,
      signal: abort.signal,
    });

    let pending: Promise<HostedNativeSessionFetchResponse>;
    try {
      pending = Promise.resolve(fetch(`${hostedBinding.apiOrigin}/v1/sessions/start`, init));
    } catch {
      if (abort.signal.aborted) throw abort.error();
      throw new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
    }
    pending.then(
      (response) => {
        if (abort.signal.aborted) void cancelResponse(response);
      },
      () => undefined,
    );
    try {
      return await raceWithAbort(pending, abort);
    } catch (error) {
      if (abort.signal.aborted) throw abort.error();
      throw normalizeError(error, 'NATIVE_SESSION_UNAVAILABLE');
    }
  }

  function currentSnapshot(): HostedNativeSessionState {
    if (disposed) return Object.freeze({status: 'disposed', lifecycle: 'disposed'});
    if (binding.kind === 'direct' || !activeSession) {
      return Object.freeze({status: 'idle', source: 'direct', lifecycle});
    }
    if (terminal) {
      return Object.freeze({
        status: 'error',
        source: 'hosted',
        lifecycle,
        mapId: binding.mapId,
        sessionId: activeSession.sessionId,
        error: terminal,
      });
    }
    if (activeSession.operation) {
      return Object.freeze({
        status: 'loading',
        source: 'hosted',
        lifecycle,
        mapId: binding.mapId,
        sessionId: activeSession.sessionId,
      });
    }
    if (activeSession.error) {
      return Object.freeze({
        status: 'error',
        source: 'hosted',
        lifecycle,
        mapId: binding.mapId,
        sessionId: activeSession.sessionId,
        error: Object.freeze({...activeSession.error}),
      });
    }
    if (activeSession.authority) {
      const authority = activeSession.authority.public;
      return Object.freeze({
        status: 'ready',
        source: 'hosted',
        lifecycle,
        mapId: binding.mapId,
        sessionId: activeSession.sessionId,
        surfaceId: authority.surfaceId,
        credentialId: authority.credentialId,
        credentialRevision: authority.credentialRevision,
        deliveryPolicyRevision: authority.deliveryPolicyRevision,
      });
    }
    return Object.freeze({
      status: 'idle',
      source: 'hosted',
      lifecycle,
      mapId: binding.mapId,
      sessionId: activeSession.sessionId,
    });
  }

  async function acquireAuthority(session: SessionRecord, at: number) {
    const expectedGeneration = bindingGeneration;
    let candidate = session;
    let checkedAt = at;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const resolved = await ensureAuthority(candidate, checkedAt);
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (bindingGeneration !== expectedGeneration) {
        throw new HostedNativeSessionError('NATIVE_SESSION_REPLACED');
      }
      if (terminal) throw errorFrom(terminal);
      checkedAt = readClock();
      if (
        resolved.authority.clockEpoch === clock.epoch &&
        resolved.authority.validUntil > checkedAt
      ) {
        admittedAuthorities.set(resolved.authority.public, resolved.authority);
        return resolved.authority.public;
      }
      resolved.session.authority = null;
      candidate = resolved.session;
    }
    const error = new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
    candidate.error = Object.freeze({code: error.code, kind: error.kind});
    publishSession(candidate, 'error', candidate.error);
    throw error;
  }

  return Object.freeze({
    get state() {
      return state;
    },
    async prepare() {
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (bindingIsDirect()) return null;
      if (lifecycle !== 'foreground')
        throw new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
      const at = readClock();
      rotateIfRequired(at);
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (bindingIsDirect() || !activeSession)
        throw new HostedNativeSessionError('NATIVE_SESSION_REPLACED');
      const authority = await acquireAuthority(activeSession, at);
      if (lifecycle !== 'foreground')
        throw new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
      // This snapshot is not a grant, ticket, or reservation. Each later request still acquires.
      return Object.freeze({
        mapId: authority.mapId,
        resourceOrigins: Object.freeze([...authority.resourceOrigins]),
        resourceScopes: Object.freeze([...authority.resourceScopes]),
        tilesetIds: Object.freeze([...authority.tilesetIds]),
      });
    },
    async acquire() {
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (bindingIsDirect()) return null;
      const at = readClock();
      rotateIfRequired(at);
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (bindingIsDirect() || !activeSession) return null;
      const session = activeSession;
      session.requestCount += 1;
      session.pendingAdmissions += 1;
      try {
        return await acquireAuthority(session, at);
      } finally {
        session.pendingAdmissions = Math.max(0, session.pendingAdmissions - 1);
      }
    },
    transportBudget(authority) {
      if (disposed || terminal || lifecycle !== 'foreground') return 0;
      const stored = admittedAuthorities.get(authority);
      if (!stored || stored.bindingGeneration !== bindingGeneration) return 0;
      try {
        const at = readClock();
        if (stored.clockEpoch !== clock.epoch) return 0;
        // Preserve the original local deadline; neither transport nor callers
        // may reconstruct a fresh lifetime from server timestamps.
        return Math.max(0, Math.floor(stored.validUntil - at));
      } catch {
        return 0;
      }
    },
    background() {
      if (disposed) return;
      lifecycle = 'background';
      publish(currentSnapshot());
    },
    async resume() {
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      lifecycle = 'foreground';
      if (terminal) {
        const error = errorFrom(terminal);
        publish(currentSnapshot());
        throw error;
      }
      if (binding.kind === 'direct' || !activeSession) {
        publish(currentSnapshot());
        return;
      }
      const previous = activeSession;
      const hadAuthority = Boolean(previous.authority || previous.operation);
      const at = readClock();
      rotateIfRequired(at);
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      publish(currentSnapshot());
      if (!hadAuthority || !activeSession) return;
      if (
        activeSession !== previous ||
        !activeSession.authority ||
        activeSession.authority.clockEpoch !== clock.epoch ||
        activeSession.authority.validUntil - at <= REFRESH_MARGIN_MS
      ) {
        await acquireAuthority(activeSession, at);
      }
    },
    replaceBinding(nextBinding) {
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      const next = normalizeBinding(nextBinding);
      if (sameBinding(binding, next)) return;
      bindingGeneration += 1;
      for (const operation of operations) operation.abort('NATIVE_SESSION_REPLACED');
      binding = next;
      terminal = null;
      clearRetry();
      activeSession = next.kind === 'hosted' ? createSession(next.surfaceId, readClock()) : null;
      publish(snapshotIdle(binding, activeSession, lifecycle));
    },
    retry() {
      if (disposed) throw new HostedNativeSessionError('NATIVE_SESSION_DISPOSED');
      if (!terminal && retryAt === null) return;
      terminal = null;
      clearRetry();
      // The same session identity bootstraps again; a stop never received authority to reuse.
      if (activeSession && !activeSession.operation) activeSession.error = null;
      publish(currentSnapshot());
    },
    retryDelay() {
      if (disposed || terminal || retryAt === null) return null;
      try {
        return Math.max(0, Math.ceil(retryAt - readClock()));
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
      }
      if (disposed) return () => undefined;
      listeners.add(listener);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bindingGeneration += 1;
      for (const operation of operations) operation.abort('NATIVE_SESSION_DISPOSED');
      operations.clear();
      activeSession = null;
      binding = Object.freeze({kind: 'direct'});
      publish(Object.freeze({status: 'disposed', lifecycle: 'disposed'}));
      listeners.clear();
    },
  });
}

function normalizeBinding(value: HostedNativeSessionBinding): Binding {
  try {
    if (!isRecord(value)) throw new Error();
    if (value.kind === 'direct') {
      if (Object.keys(value).length !== 1) throw new Error();
      return Object.freeze({kind: 'direct'});
    }
    if (
      value.kind !== 'hosted' ||
      Object.keys(value).some(
        (key) => !['kind', 'apiOrigin', 'credential', 'mapId', 'surfaceId'].includes(key),
      ) ||
      typeof value.credential !== 'string' ||
      !MOBILE_CREDENTIAL.test(value.credential) ||
      typeof value.mapId !== 'string' ||
      !MAP_ID.test(value.mapId)
    ) {
      throw new Error();
    }
    return Object.freeze({
      kind: 'hosted',
      apiOrigin: canonicalOrigin(value.apiOrigin),
      credential: value.credential,
      mapId: value.mapId,
      surfaceId: normalizeSurface(value.surfaceId),
    });
  } catch (error) {
    if (error instanceof HostedNativeSessionError) throw error;
    throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
  }
}

function canonicalOrigin(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim()
  ) {
    throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
  }
  try {
    const resolved = resolveTileflowNativeManifestUrl(value);
    if (!resolved.endsWith('/')) throw new Error();
    const origin = resolved.slice(0, -1);
    if (value !== origin) throw new Error();
    return origin;
  } catch {
    throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
  }
}

function normalizeSurface(value: unknown) {
  return typeof value === 'string' && SURFACE_ID.test(value) && !secretShaped(value)
    ? value
    : 'default';
}

function secretShaped(value: string) {
  return MOBILE_CREDENTIAL.test(value) || value.startsWith('tf_native_');
}

function sameHostedBinding(left: HostedBinding, right: HostedBinding) {
  return (
    left.apiOrigin === right.apiOrigin &&
    left.credential === right.credential &&
    left.mapId === right.mapId
  );
}

function sameBinding(left: Binding, right: Binding) {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'direct') return true;
  return right.kind === 'hosted' && sameHostedBinding(left, right);
}

function snapshotIdle(
  binding: Binding,
  session: SessionRecord | null,
  lifecycle: Lifecycle,
): HostedNativeSessionState {
  return binding.kind === 'direct' || !session
    ? Object.freeze({status: 'idle', source: 'direct', lifecycle})
    : Object.freeze({
        status: 'idle',
        source: 'hosted',
        lifecycle,
        mapId: binding.mapId,
        sessionId: session.sessionId,
      });
}

function parseSuccess(
  value: unknown,
  binding: HostedBinding,
  expectedSessionId: string,
  expectedSurfaceId: string,
) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== SUCCESS_KEYS.size ||
    Object.keys(value).some((key) => !SUCCESS_KEYS.has(key)) ||
    value.ok !== true ||
    value.kind !== 'native' ||
    value.version !== 1 ||
    value.usageMode !== 'session' ||
    value.counted !== false ||
    value.mapId !== binding.mapId ||
    value.sessionId !== expectedSessionId ||
    value.surfaceId !== expectedSurfaceId ||
    typeof value.surfaceId !== 'string' ||
    !SURFACE_ID.test(value.surfaceId) ||
    secretShaped(value.surfaceId) ||
    typeof value.credentialId !== 'string' ||
    !CREDENTIAL_ID.test(value.credentialId) ||
    !positiveRevision(value.credentialRevision) ||
    !positiveRevision(value.deliveryPolicyRevision) ||
    typeof value.grant !== 'string' ||
    value.grant.length === 0 ||
    value.grant.length > GRANT_CHARACTER_LIMIT ||
    !NATIVE_GRANT.test(value.grant) ||
    !['disabled', 'shadow', 'enforced'].includes(String(value.meterMode)) ||
    !['unmetered', 'ordinary', 'unbilled_fail_open'].includes(String(value.disposition)) ||
    (value.disposition === 'unmetered' && value.meterMode !== 'disabled')
  ) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }

  const issuedAtMs = parseExactIso(value.issuedAt);
  const serverTimeMs = parseExactIso(value.serverTime);
  const expiresAtMs = parseExactIso(value.expiresAt);
  if (
    issuedAtMs > serverTimeMs + FUTURE_ISSUE_SKEW_MS ||
    expiresAtMs <= serverTimeMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > MAX_GRANT_LIFETIME_MS ||
    // The local deadline is derived from serverTime, so this also bounds the transport budget.
    expiresAtMs - serverTimeMs > MAX_GRANT_LIFETIME_MS
  ) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }

  const authority = {
    mapId: value.mapId,
    sessionId: value.sessionId,
    surfaceId: value.surfaceId,
    credentialId: value.credentialId,
    credentialRevision: value.credentialRevision,
    deliveryPolicyRevision: value.deliveryPolicyRevision,
    issuedAt: value.issuedAt as string,
    serverTime: value.serverTime as string,
    expiresAt: value.expiresAt as string,
    meterMode: value.meterMode as HostedNativeSessionAuthority['meterMode'],
    disposition: value.disposition as HostedNativeSessionAuthority['disposition'],
    resourceOrigins: Object.freeze(parseOrigins(value.resourceOrigins)),
    resourceScopes: Object.freeze(parseScopes(value.resourceScopes)),
    tilesetIds: Object.freeze(parseTilesets(value.tilesetIds)),
  } as Omit<HostedNativeSessionAuthority, 'grant'>;
  const withGrant = Object.defineProperty(authority, 'grant', {
    value: value.grant,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as HostedNativeSessionAuthority;
  return {authority: Object.freeze(withGrant), serverTimeMs, expiresAtMs};
}

function parseOrigins(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    let origin: string;
    try {
      const resolved = resolveTileflowNativeManifestUrl(item);
      if (!resolved.endsWith('/')) throw new Error();
      origin = resolved.slice(0, -1);
      if (item !== origin) throw new Error();
    } catch {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    if (result.includes(origin)) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    result.push(origin);
  }
  return result;
}

function parseScopes(value: unknown): NativeSessionResourceScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ALLOWED_SCOPES.size) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }
  const result: NativeSessionResourceScope[] = [];
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      !ALLOWED_SCOPES.has(item as NativeSessionResourceScope) ||
      result.includes(item as NativeSessionResourceScope)
    ) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    result.push(item as NativeSessionResourceScope);
  }
  return result;
}

function parseTilesets(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_TILESETS) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !COMPACT_ID.test(item) || result.includes(item)) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
    }
    result.push(item);
  }
  return result;
}

function parseExactIso(value: unknown) {
  if (typeof value !== 'string' || !EXACT_ISO.test(value)) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }
  return parsed;
}

function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isExactRestart(value: unknown, expectedSessionId: string) {
  return (
    isRecord(value) &&
    Object.keys(value).length === RESTART_KEYS.size &&
    Object.keys(value).every((key) => RESTART_KEYS.has(key)) &&
    value.code === 'COMMERCIAL_SESSION_RESTART_REQUIRED' &&
    typeof value.error === 'string' &&
    value.error.length > 0 &&
    value.error.length <= 500 &&
    value.retryWithNewSession === true &&
    value.sessionId === expectedSessionId
  );
}

async function readBoundedResponse(
  response: HostedNativeSessionFetchResponse,
  abort: SessionAbortController,
) {
  let reader: HostedNativeSessionBodyReader;
  try {
    if (
      !response ||
      !Number.isSafeInteger(response.status) ||
      !response.headers ||
      typeof response.headers.get !== 'function' ||
      !response.body ||
      typeof response.body.getReader !== 'function'
    ) {
      throw new Error();
    }
    reader = response.body.getReader();
  } catch {
    throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (abort.signal.aborted) throw abort.error();
      const next = await raceWithAbort(Promise.resolve(reader.read()), abort);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
      }
      size += next.value.byteLength;
      if (size > RESPONSE_BYTE_LIMIT) {
        throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_TOO_LARGE');
      }
      chunks.push(next.value.slice());
    }
  } catch (error) {
    void Promise.resolve(reader.cancel()).catch(() => undefined);
    if (abort.signal.aborted) throw abort.error();
    throw normalizeError(error, 'NATIVE_SESSION_UNAVAILABLE');
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {source: decodeUtf8(bytes), size};
}

function decodeUtf8(bytes: Uint8Array) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint: number;
    let remaining: number;
    let minimum: number;
    if (first <= 0x7f) {
      codePoint = first;
      remaining = 0;
      minimum = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      remaining = 1;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      remaining = 2;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      remaining = 3;
      minimum = 0x10000;
    } else {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_UTF8_INVALID');
    }
    if (index + remaining > bytes.length) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_UTF8_INVALID');
    }
    for (let count = 0; count < remaining; count += 1) {
      const byte = bytes[index++];
      if ((byte & 0xc0) !== 0x80) {
        throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_UTF8_INVALID');
      }
      codePoint = (codePoint << 6) | (byte & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_UTF8_INVALID');
    }
    result += String.fromCodePoint(codePoint);
  }
  return result;
}

function hasNoStore(value: string | null) {
  return (
    typeof value === 'string' &&
    value.split(',').some((part) => part.trim().toLowerCase() === 'no-store')
  );
}

function statusError(status: number, body: unknown, size: number) {
  if (status === 401) return new HostedNativeSessionError('NATIVE_SESSION_CREDENTIAL_REJECTED');
  if (status === 403) return new HostedNativeSessionError('NATIVE_SESSION_MAP_MISMATCH');
  if (status === 404) return new HostedNativeSessionError('NATIVE_SESSION_MAP_NOT_FOUND');
  if (status === 429) {
    return new HostedNativeSessionError(
      isRecord(body) && typeof body.code === 'string' && QUOTA_CODES.has(body.code)
        ? 'NATIVE_SESSION_QUOTA_EXCEEDED'
        : 'NATIVE_SESSION_RATE_LIMITED',
    );
  }
  if (status === 408 || (status >= 500 && status <= 599)) {
    return new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE');
  }
  if (status >= 400 && status <= 499) {
    // Any other refusal, such as a Map without session delivery or a conflicting header, repeats
    // until something outside the device changes.
    return new HostedNativeSessionError(
      'NATIVE_SESSION_REJECTED',
      size <= SERVICE_CODE_BODY_LIMIT && isRecord(body) && typeof body.code === 'string'
        ? body.code
        : undefined,
    );
  }
  return new HostedNativeSessionError('NATIVE_SESSION_RESPONSE_INVALID');
}

/** The safe, frozen projection of an error that state and observers carry. */
function safeError(error: HostedNativeSessionError): SafeError {
  return Object.freeze(
    error.reason === undefined
      ? {code: error.code, kind: error.kind}
      : {code: error.code, kind: error.kind, reason: error.reason},
  );
}

function errorFrom(error: SafeError) {
  return new HostedNativeSessionError(error.code, error.reason);
}

const retryAfterDelays = new WeakMap<HostedNativeSessionError, number>();

/** Delta-seconds or an HTTP date, bounded so a hostile value cannot park the binding. */
function retryAfterMs(headers: HostedNativeSessionFetchResponse['headers'], now: () => Date) {
  let value: string | null;
  try {
    value = headers.get('retry-after');
  } catch {
    return null;
  }
  if (typeof value !== 'string' || value.length > 64) return null;
  const text = value.trim();
  let delay: number;
  if (RETRY_AFTER_SECONDS.test(text)) delay = Number(text) * 1000;
  else {
    const date = Date.parse(text);
    if (!Number.isFinite(date)) return null;
    try {
      delay = date - readWallClock(now);
    } catch {
      return null;
    }
  }
  return Math.min(Math.max(0, delay), RETRY_AFTER_LIMIT_MS);
}

function errorKind(code: HostedNativeSessionErrorCode): HostedNativeSessionErrorKind {
  if (code === 'NATIVE_SESSION_DISPOSED' || code === 'NATIVE_SESSION_REPLACED') return 'cancelled';
  return TERMINAL_CODES.has(code) ? 'terminal' : 'recoverable';
}

function normalizeError(
  error: unknown,
  fallback: HostedNativeSessionErrorCode = 'NATIVE_SESSION_RESPONSE_INVALID',
) {
  return error instanceof HostedNativeSessionError ? error : new HostedNativeSessionError(fallback);
}

function readWallClock(now: () => Date) {
  try {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
    return value.getTime();
  } catch {
    throw new HostedNativeSessionError('NATIVE_SESSION_INPUT_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function cancelResponse(response: HostedNativeSessionFetchResponse) {
  try {
    await response.body?.getReader().cancel();
  } catch {
    // Late cancelled responses are discarded without exposing adapter errors.
  }
}

class SessionAbortController {
  readonly signal: HostedNativeSessionAbortSignal;
  #aborted = false;
  #code: HostedNativeSessionErrorCode = 'NATIVE_SESSION_REPLACED';
  #reason: string | undefined;
  readonly #listeners = new Set<() => void>();

  constructor() {
    const isAborted = () => this.#aborted;
    this.signal = Object.freeze({
      get aborted() {
        return isAborted();
      },
      addEventListener: (type: 'abort', listener: () => void, _options?: {once?: boolean}) => {
        if (type === 'abort' && !this.#aborted) this.#listeners.add(listener);
      },
      removeEventListener: (type: 'abort', listener: () => void) => {
        if (type === 'abort') this.#listeners.delete(listener);
      },
    });
  }

  abort(code: HostedNativeSessionErrorCode, reason?: string) {
    if (this.#aborted) return;
    this.#code = code;
    this.#reason = reason;
    this.#aborted = true;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // Abort observers cannot prevent cancellation.
      }
    }
    this.#listeners.clear();
  }

  error() {
    return new HostedNativeSessionError(this.#code, this.#reason);
  }
}

function raceWithAbort<T>(promise: Promise<T>, controller: SessionAbortController): Promise<T> {
  if (controller.signal.aborted) return Promise.reject(controller.error());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(controller.error());
    };
    const cleanup = () => controller.signal.removeEventListener('abort', onAbort);
    controller.signal.addEventListener('abort', onAbort, {once: true});
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      () => {
        cleanup();
        reject(new HostedNativeSessionError('NATIVE_SESSION_UNAVAILABLE'));
      },
    );
  });
}
