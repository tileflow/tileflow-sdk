import {
  type NativeAdmissionBridge,
  type NativeAdmissionCode,
  type NativeAdmissionEvent,
  nativeAdmissionLimits,
  type NativeAdmissionResource,
  type NativeAdmissionResult,
  type NativeRemovalAck,
} from './native-admission-contract';
import {createNativeAdmissionCatalog} from './native-admission-catalog';
import {
  authorityAllowsResource,
  isNativeToken,
  normalizeNativeResources,
} from './native-admission-url';
import {
  createHostedNativeSessionController,
  type HostedNativeResourcePolicy,
  type HostedNativeSessionAuthority,
  type HostedNativeSessionController,
  type HostedNativeSessionFetch,
} from './session-controller';

type SessionInput = Parameters<typeof createHostedNativeSessionController>[0];
export type NativeMapAdmissionInput = Omit<SessionInput, 'fetch' | 'sessionIdFactory'> &
  Readonly<{
    fetch?: HostedNativeSessionFetch;
    sessionIdFactory?: () => string;
    resources: readonly NativeAdmissionResource[];
    onRetired?: () => void;
  }>;
export type NativeMapAdmission = Readonly<{
  context: string;
  generation: number;
  scope: Readonly<{installation: string; context: string}>;
  readonly state: Readonly<{status: 'active' | 'retired'; context: string}>;
  prepare(): Promise<HostedNativeResourcePolicy | null>;
  discriminate(url: string): string;
  discriminateForTest(url: string): string;
  extendResources(resources: readonly NativeAdmissionResource[]): Promise<Readonly<{resources: number}>>;
  retire(): Promise<Readonly<{retired: true}>>;
}>;

export class NativeAdmissionError extends Error {
  readonly code: NativeAdmissionCode;
  constructor(code: NativeAdmissionCode) {
    super('Native resource admission failed.');
    this.name = 'NativeAdmissionError';
    this.code = code;
  }
}

type TicketState = {cancelled: boolean};
type Context = {
  id: string;
  generation: number;
  mapId: string | null;
  live: boolean;
  lastBatch: number;
  batch: string | null;
  tickets: Map<string, TicketState>;
  catalog: ReturnType<typeof createNativeAdmissionCatalog>;
  controller: HostedNativeSessionController;
  handle: NativeMapAdmission;
};

export function createNativeAdmissionOwner(options: {
  bridge: NativeAdmissionBridge;
  sessionFetch?: (context: string) => HostedNativeSessionFetch;
  createController?: (input: SessionInput) => HostedNativeSessionController;
  onObservation?: (observation: Readonly<{context: string; status: number}>) => void;
}) {
  const bridge = options.bridge;
  const factory = options.createController ?? createHostedNativeSessionController;
  const contexts = new Map<string, Context>();
  const pendingControllers = new Set<HostedNativeSessionController>();
  let installation: string | null = null;
  let installed: Promise<string> | undefined;
  let installResult: Promise<Readonly<{installation: string}>> | undefined;
  let disposed = false;
  let foreground = true;
  let contextSequence = 0;
  let status: 'idle' | 'installing' | 'ready' | 'error' | 'disposed' = 'idle';
  let disposal: Promise<NativeRemovalAck> | undefined;

  function cancel(code: NativeAdmissionCode = 'NATIVE_ADMISSION_CANCELLED') {
    return new NativeAdmissionError(code);
  }

  function install(): Promise<Readonly<{installation: string}>> {
    if (disposed) return Promise.reject(cancel());
    if (installResult) return installResult;
    status = 'installing';
    try {
      installed = bridge.install().then(
        (ack) => {
          if (!ack || !isNativeToken(ack.installation)) throw cancel('NATIVE_ADMISSION_INVALID');
          installation = ack.installation;
          return ack.installation;
        },
        () => { throw cancel('NATIVE_ADMISSION_UNAVAILABLE'); },
      );
    } catch {
      installed = Promise.reject(cancel('NATIVE_ADMISSION_UNAVAILABLE'));
    }
    const attempt = installed.then(
      (id) => {
        if (disposed) throw cancel();
        status = 'ready';
        return Object.freeze({installation: id});
      },
      () => {
        if (!disposed) status = 'error';
        throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
      },
    );
    installResult = attempt;
    void attempt.catch(() => {
      if (!disposed && installation === null && installResult === attempt) {
        installed = undefined;
        installResult = undefined;
      }
    });
    return attempt;
  }

  function retire(context: Context): Promise<Readonly<{retired: true}>> {
    return context.handle.retire();
  }
  function failContext(context: Context) {
    // The lease retains failed acknowledgement state. Only installation-wide ownership
    // loss may retire another Map; one context's cleanup failure cannot do so.
    void retire(context).catch(() => undefined);
  }

  async function handleBatch(
    context: Context,
    event: Extract<NativeAdmissionEvent, {kind: 'batch'}>,
  ) {
    if (!context.live || !foreground || event.generation !== context.generation) return;
    const serial = typeof event.batch === 'string' && /^[1-9][0-9]{0,15}$/u.test(event.batch)
      ? Number(event.batch) : NaN;
    if (Number.isSafeInteger(serial) && serial <= context.lastBatch) return;
    if (!Number.isSafeInteger(serial) || context.batch !== null || !Array.isArray(event.tickets) ||
      event.tickets.length === 0 || event.tickets.length > nativeAdmissionLimits.batchSize) {
      failContext(context);
      return;
    }
    const selected = new Map<string, NativeAdmissionResource>();
    for (const ticket of event.tickets) {
      if (!ticket || !isNativeToken(ticket.ticket) || selected.has(ticket.ticket) || typeof ticket.url !== 'string') {
        failContext(context);
        return;
      }
      const resource = context.catalog.match(ticket.url);
      if (!resource) { failContext(context); return; }
      selected.set(ticket.ticket, resource);
    }
    context.lastBatch = serial;
    context.batch = event.batch;
    const tickets = new Map(event.tickets.map((ticket) => [ticket.ticket, {cancelled: false}]));
    context.tickets = tickets;
    // One logical acquisition per eligible ticket, in ticket order. Joining their
    // promises never shares an acquisition or preallocates a commercial admission.
    const acquisitions = event.tickets.map(
      async (ticket): Promise<HostedNativeSessionAuthority | null | false> => {
        if (!context.live || tickets.get(ticket.ticket)?.cancelled) return false;
        if (context.mapId === null) return null;
        try { return await context.controller.acquire(); } catch { return false; }
      },
    );
    const authorities = await Promise.all(acquisitions);
    if (disposed || !context.live || context.batch !== event.batch || installation !== event.installation) return;
    const results: NativeAdmissionResult[] = event.tickets.map((ticket, index) => {
      const reject = (code: NativeAdmissionCode): NativeAdmissionResult => ({ticket: ticket.ticket, kind: 'reject', code});
      if (!foreground || tickets.get(ticket.ticket)?.cancelled) return reject('NATIVE_ADMISSION_CANCELLED');
      const authority = authorities[index];
      if (authority === false) return reject('NATIVE_ADMISSION_DENIED');
      if (context.mapId === null) return {ticket: ticket.ticket, kind: 'delegate'};
      const resource = selected.get(ticket.ticket)!;
      if (!authority || !authorityAllowsResource(authority, resource, context.mapId)) return reject('NATIVE_ADMISSION_DENIED');
      const validForMs = context.controller.transportBudget(authority);
      if (!Number.isSafeInteger(validForMs) || validForMs <= nativeAdmissionLimits.validitySafetyMs || validForMs > 900000) {
        return reject('NATIVE_ADMISSION_EXPIRED');
      }
      return {
        ticket: ticket.ticket,
        kind: 'grant',
        validForMs,
        authority: {
          grant: authority.grant,
          mapId: authority.mapId,
          resourceOrigins: [...authority.resourceOrigins],
          resourceScopes: [...authority.resourceScopes],
          tilesetIds: [...authority.tilesetIds],
        },
      };
    });
    // This temporary wire envelope is never exposed as a snapshot or diagnostic.
    if (JSON.stringify(results).length > nativeAdmissionLimits.bridgeBytes) { failContext(context); return; }
    context.batch = null;
    context.tickets = new Map();
    try {
      await bridge.completeBatch(event.installation, context.id, context.generation, event.batch, results);
    } catch { if (context.live) failContext(context); }
  }

  function onEvent(event: NativeAdmissionEvent) {
    if (disposed || !event || event.installation !== installation) return;
    if (event.kind === 'ownershipLost') { void dispose().catch(() => undefined); return; }
    if (event.kind === 'lifecycle') {
      foreground = event.foreground === true;
      for (const context of contexts.values()) {
        if (foreground) void context.controller.resume().catch(() => undefined);
        else {
          context.controller.background();
          for (const ticket of context.tickets.values()) ticket.cancelled = true;
        }
      }
      return;
    }
    const context = contexts.get(event.context);
    if (!context || !context.live || event.generation !== context.generation) return;
    if (event.kind === 'retired') { failContext(context); return; }
    if (event.kind === 'cancel') {
      if (!Array.isArray(event.tickets) || event.tickets.length > nativeAdmissionLimits.queueDepth) {
        failContext(context);
        return;
      }
      for (const id of event.tickets) {
        const ticket = context.tickets.get(id);
        if (ticket) ticket.cancelled = true;
      }
      return;
    }
    if (event.kind === 'response') {
      if (Number.isInteger(event.status) && event.status >= 100 && event.status <= 599) {
        try { options.onObservation?.(Object.freeze({context: context.id, status: event.status})); }
        catch { /* Observers cannot change admission. */ }
      }
      return;
    }
    if (event.kind === 'batch') void handleBatch(context, event).catch(() => failContext(context));
  }
  const unsubscribe = bridge.subscribe((event) => {
    try { onEvent(event); } catch { void dispose().catch(() => undefined); }
  });

  async function openMap(input: NativeMapAdmissionInput): Promise<NativeMapAdmission> {
    if (disposed) throw cancel();
    let resources: readonly NativeAdmissionResource[];
    try {
      resources = normalizeNativeResources(input.resources);
      if (input.onRetired !== undefined && typeof input.onRetired !== 'function') throw cancel();
    } catch { throw cancel('NATIVE_ADMISSION_INVALID'); }
    if (input.fetch && options.sessionFetch) throw cancel('NATIVE_ADMISSION_INVALID');
    const ack = await install();
    if (disposed) throw cancel();
    if (contexts.size + pendingControllers.size >= nativeAdmissionLimits.contexts || contextSequence >= Number.MAX_SAFE_INTEGER) {
      throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
    }
    const identity = `${ack.installation}.${++contextSequence}`;
    let sessionSequence = 0;
    const sessionIdFactory = input.sessionIdFactory ?? (() => {
      if (sessionSequence >= Number.MAX_SAFE_INTEGER) throw cancel('NATIVE_ADMISSION_INVALID');
      return `${identity}.${++sessionSequence}`;
    });
    let boundFetch: HostedNativeSessionFetch | undefined;
    const fetch: HostedNativeSessionFetch | undefined = options.sessionFetch
      ? (url, init) => {
          if (!boundFetch) return Promise.reject(cancel('NATIVE_ADMISSION_CANCELLED'));
          return boundFetch(url, init);
        }
      : (input.fetch ?? (input.binding.kind === 'direct'
          ? async () => { throw cancel('NATIVE_ADMISSION_INVALID'); }
          : undefined));
    if (!fetch) throw cancel('NATIVE_ADMISSION_INVALID');
    let controller: HostedNativeSessionController;
    try { controller = factory({binding: input.binding, fetch, now: input.now, sessionIdFactory}); }
    catch { throw cancel('NATIVE_ADMISSION_INVALID'); }
    pendingControllers.add(controller);
    const mapId = input.binding.kind === 'hosted' ? input.binding.mapId : null;
    let orphan: string | undefined;
    try {
      const registered = await bridge.registerContext(ack.installation, {mapId, resources});
      if (!registered || !isNativeToken(registered.context) || !Number.isSafeInteger(registered.generation) ||
        registered.generation < 1 || contexts.has(registered.context)) {
        void dispose().catch(() => undefined);
        throw cancel('NATIVE_ADMISSION_INVALID');
      }
      orphan = registered.context;
      if (disposed) throw cancel();
      if (options.sessionFetch) boundFetch = options.sessionFetch(registered.context);
      let retirement: Promise<Readonly<{retired: true}>> | undefined;
      let retirementNotified = false;
      const catalog = createNativeAdmissionCatalog(resources, registered.context, (additions) => {
        if (!bridge.extendContext) return Promise.reject(cancel('NATIVE_ADMISSION_UNAVAILABLE'));
        return bridge.extendContext(ack.installation, registered.context, additions);
      });
      const context: Context = {
        id: registered.context,
        generation: registered.generation,
        mapId,
        live: true,
        lastBatch: 0,
        batch: null,
        tickets: new Map(),
        catalog,
        controller,
        handle: undefined as unknown as NativeMapAdmission,
      };
      context.handle = Object.freeze({
        context: context.id,
        generation: context.generation,
        scope: Object.freeze({installation: ack.installation, context: context.id}),
        get state() {
          return Object.freeze({status: context.live ? ('active' as const) : ('retired' as const), context: context.id});
        },
        async prepare() {
          if (!context.live || disposed) throw cancel();
          if (context.mapId === null) return null;
          if (!foreground || !controller.prepare) throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
          try {
            const policy = await controller.prepare();
            if (!context.live || disposed) throw cancel();
            if (!foreground || !policy || policy.mapId !== context.mapId) throw cancel('NATIVE_ADMISSION_DENIED');
            return policy;
          } catch {
            throw cancel(context.live && !disposed ? 'NATIVE_ADMISSION_DENIED' : 'NATIVE_ADMISSION_CANCELLED');
          }
        },
        discriminate: catalog.discriminate,
        discriminateForTest: catalog.discriminate,
        extendResources: catalog.extend,
        retire() {
          if (retirement) return retirement;
          context.live = false;
          context.batch = null;
          context.tickets.clear();
          catalog.retire();
          contexts.delete(context.id);
          controller.dispose();
          boundFetch = undefined;
          const attempt = Promise.resolve().then(async () => {
            try {
              const retired = await bridge.retireContext(ack.installation, context.id);
              if (retired?.retired !== true) throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
              return Object.freeze({retired: true as const});
            } catch { throw cancel('NATIVE_ADMISSION_UNAVAILABLE'); }
          });
          retirement = attempt;
          void attempt.catch(() => { if (retirement === attempt) retirement = undefined; });
          // Publish only after idempotent cleanup owns its promise: observers may reenter.
          if (!retirementNotified) {
            retirementNotified = true;
            try { input.onRetired?.(); } catch { /* Cleanup is not owned by observers. */ }
          }
          return attempt;
        },
      });
      if (!foreground) controller.background();
      contexts.set(context.id, context);
      orphan = undefined;
      return context.handle;
    } catch (error) {
      controller.dispose();
      boundFetch = undefined;
      if (orphan) {
        try { await bridge.retireContext(ack.installation, orphan); }
        catch { void dispose().catch(() => undefined); }
      }
      throw error instanceof NativeAdmissionError ? error : cancel('NATIVE_ADMISSION_UNAVAILABLE');
    } finally { pendingControllers.delete(controller); }
  }

  function dispose(): Promise<NativeRemovalAck> {
    if (disposal) return disposal;
    disposed = true;
    status = 'disposed';
    const retiring = [...contexts.values()].map((context) => retire(context).catch(() => undefined));
    for (const controller of pendingControllers) controller.dispose();
    const attempt = (async () => {
      try {
        let id: string | undefined;
        try { id = await installed; } catch { /* No successful installation to remove. */ }
        await Promise.all(retiring);
        if (!id) return Object.freeze({removed: false, ownershipLost: false});
        try {
          const ack = await bridge.remove(id);
          if (!ack || typeof ack.removed !== 'boolean' || typeof ack.ownershipLost !== 'boolean') throw cancel('NATIVE_ADMISSION_INVALID');
          return Object.freeze({removed: ack.removed, ownershipLost: ack.ownershipLost});
        } catch { throw cancel('NATIVE_ADMISSION_UNAVAILABLE'); }
      } finally { unsubscribe(); }
    })();
    disposal = attempt;
    void attempt.catch(() => { if (disposal === attempt) disposal = undefined; });
    return attempt;
  }
  return Object.freeze({
    install,
    openMap,
    async replaceMap(previous: NativeMapAdmission, input: NativeMapAdmissionInput) {
      if (disposed) throw cancel();
      await previous.retire();
      return openMap(input);
    },
    dispose,
    get state() {
      return Object.freeze({status, contexts: contexts.size, pendingRegistrations: pendingControllers.size});
    },
  });
}
