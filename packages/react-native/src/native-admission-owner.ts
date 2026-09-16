import {
  type NativeAdmissionBridge,
  type NativeAdmissionCode,
  type NativeAdmissionEvent,
  nativeAdmissionLimits,
  type NativeAdmissionResource,
  type NativeAdmissionResult,
  type NativeRemovalAck,
} from './native-admission-contract';
import {
  authorityAllowsResource,
  discriminateNativeResourceForTest,
  isNativeToken,
  normalizeNativeResources,
} from './native-admission-url';
import {
  createHostedNativeSessionController,
  type HostedNativeSessionAuthority,
  type HostedNativeSessionController,
  type HostedNativeSessionFetch,
} from './session-controller';

type SessionInput = Parameters<typeof createHostedNativeSessionController>[0];
export type NativeMapAdmissionInput = Omit<SessionInput, 'fetch'> &
  Readonly<{
    fetch?: HostedNativeSessionFetch;
    resources: readonly NativeAdmissionResource[];
  }>;
export type NativeMapAdmission = Readonly<{
  context: string;
  generation: number;
  readonly state: Readonly<{status: 'active' | 'retired'; context: string}>;
  discriminateForTest(url: string): string;
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
  resources: ReadonlyMap<string, NativeAdmissionResource>;
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
        () => {
          throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
        },
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
    void retire(context).catch(() => {
      void dispose().catch(() => undefined);
    });
  }

  async function handleBatch(
    context: Context,
    event: Extract<NativeAdmissionEvent, {kind: 'batch'}>,
  ) {
    if (!context.live || !foreground || event.generation !== context.generation) return;
    const serial =
      typeof event.batch === 'string' && /^[1-9][0-9]{0,15}$/u.test(event.batch)
        ? Number(event.batch)
        : NaN;
    if (Number.isSafeInteger(serial) && serial <= context.lastBatch) return;
    if (
      !Number.isSafeInteger(serial) ||
      context.batch !== null ||
      !Array.isArray(event.tickets) ||
      event.tickets.length === 0 ||
      event.tickets.length > nativeAdmissionLimits.batchSize
    ) {
      failContext(context);
      return;
    }
    const seen = new Set<string>();
    for (const ticket of event.tickets) {
      if (
        !ticket ||
        !isNativeToken(ticket.ticket) ||
        seen.has(ticket.ticket) ||
        typeof ticket.url !== 'string' ||
        !context.resources.has(ticket.url)
      ) {
        failContext(context);
        return;
      }
      seen.add(ticket.ticket);
    }
    context.lastBatch = serial;
    context.batch = event.batch;
    const tickets = new Map(event.tickets.map((ticket) => [ticket.ticket, {cancelled: false}]));
    context.tickets = tickets;
    // Invoke acquire in ticket order, once per eligible ticket. Promise.all
    // joins independent logical admissions; it never represents one grant.
    const acquisitions = event.tickets.map(
      async (ticket): Promise<HostedNativeSessionAuthority | null | false> => {
        if (!context.live || tickets.get(ticket.ticket)?.cancelled) return false;
        if (context.mapId === null) return null;
        try {
          return await context.controller.acquire();
        } catch {
          return false;
        }
      },
    );
    const authorities = await Promise.all(acquisitions);
    if (
      disposed ||
      !context.live ||
      context.batch !== event.batch ||
      installation !== event.installation
    )
      return;
    const results: NativeAdmissionResult[] = event.tickets.map((ticket, index) => {
      const reject = (code: NativeAdmissionCode): NativeAdmissionResult => ({
        ticket: ticket.ticket,
        kind: 'reject',
        code,
      });
      if (!foreground || tickets.get(ticket.ticket)?.cancelled)
        return reject('NATIVE_ADMISSION_CANCELLED');
      const authority = authorities[index];
      if (authority === false) return reject('NATIVE_ADMISSION_DENIED');
      if (context.mapId === null) return {ticket: ticket.ticket, kind: 'delegate'};
      const resource = context.resources.get(ticket.url)!;
      if (!authority || !authorityAllowsResource(authority, resource, context.mapId))
        return reject('NATIVE_ADMISSION_DENIED');
      const validForMs = context.controller.transportBudget(authority);
      if (
        !Number.isSafeInteger(validForMs) ||
        validForMs <= nativeAdmissionLimits.validitySafetyMs ||
        validForMs > 900000
      )
        return reject('NATIVE_ADMISSION_EXPIRED');
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
    // Temporary wire-size check, never a snapshot. Validated authority and
    // catalog strings are ASCII; each native receiver enforces its bound too.
    if (JSON.stringify(results).length > nativeAdmissionLimits.bridgeBytes) {
      failContext(context);
      return;
    }
    context.batch = null;
    context.tickets = new Map();
    try {
      await bridge.completeBatch(
        event.installation,
        context.id,
        context.generation,
        event.batch,
        results,
      );
    } catch {
      if (context.live) failContext(context);
    }
  }

  function onEvent(event: NativeAdmissionEvent) {
    if (disposed || !event || event.installation !== installation) return;
    if (event.kind === 'ownershipLost') {
      void dispose().catch(() => undefined);
      return;
    }
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
    if (event.kind === 'retired') {
      failContext(context);
      return;
    }
    if (event.kind === 'cancel') {
      if (
        !Array.isArray(event.tickets) ||
        event.tickets.length > nativeAdmissionLimits.queueDepth
      ) {
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
        try {
          options.onObservation?.(Object.freeze({context: context.id, status: event.status}));
        } catch {
          /* Observers cannot change admission. */
        }
      }
      return;
    }
    if (event.kind === 'batch') void handleBatch(context, event).catch(() => failContext(context));
  }
  const unsubscribe = bridge.subscribe((event) => {
    try {
      onEvent(event);
    } catch {
      void dispose().catch(() => undefined);
    }
  });

  async function openMap(input: NativeMapAdmissionInput): Promise<NativeMapAdmission> {
    if (disposed) throw cancel();
    let resources: readonly NativeAdmissionResource[];
    try {
      resources = normalizeNativeResources(input.resources);
    } catch {
      throw cancel('NATIVE_ADMISSION_INVALID');
    }
    if (input.fetch && options.sessionFetch) throw cancel('NATIVE_ADMISSION_INVALID');
    const ack = await install();
    if (disposed) throw cancel();
    if (contexts.size + pendingControllers.size >= nativeAdmissionLimits.contexts)
      throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
    let boundFetch: HostedNativeSessionFetch | undefined;
    const fetch: HostedNativeSessionFetch | undefined = options.sessionFetch
      ? (url, init) => {
          if (!boundFetch) return Promise.reject(cancel('NATIVE_ADMISSION_CANCELLED'));
          return boundFetch(url, init);
        }
      : (input.fetch ??
        (input.binding.kind === 'direct'
          ? async () => {
              throw cancel('NATIVE_ADMISSION_INVALID');
            }
          : undefined));
    if (!fetch) throw cancel('NATIVE_ADMISSION_INVALID');
    let controller: HostedNativeSessionController;
    try {
      controller = factory({
        binding: input.binding,
        fetch,
        now: input.now,
        sessionIdFactory: input.sessionIdFactory,
      });
    } catch {
      throw cancel('NATIVE_ADMISSION_INVALID');
    }
    pendingControllers.add(controller);
    const mapId = input.binding.kind === 'hosted' ? input.binding.mapId : null;
    let orphan: string | undefined;
    try {
      const registered = await bridge.registerContext(ack.installation, {mapId, resources});
      if (
        !registered ||
        !isNativeToken(registered.context) ||
        !Number.isSafeInteger(registered.generation) ||
        registered.generation < 1 ||
        contexts.has(registered.context)
      ) {
        void dispose().catch(() => undefined);
        throw cancel('NATIVE_ADMISSION_INVALID');
      }
      orphan = registered.context;
      if (disposed) throw cancel();
      if (options.sessionFetch) boundFetch = options.sessionFetch(registered.context);
      let retirement: Promise<Readonly<{retired: true}>> | undefined;
      const context: Context = {
        id: registered.context,
        generation: registered.generation,
        mapId,
        live: true,
        lastBatch: 0,
        batch: null,
        tickets: new Map(),
        resources: new Map(resources.map((resource) => [resource.url, resource])),
        controller,
        handle: undefined as unknown as NativeMapAdmission,
      };
      context.handle = Object.freeze({
        context: context.id,
        generation: context.generation,
        get state() {
          return Object.freeze({
            status: context.live ? ('active' as const) : ('retired' as const),
            context: context.id,
          });
        },
        discriminateForTest(url: string) {
          if (!context.live || !context.resources.has(url))
            throw cancel('NATIVE_ADMISSION_INVALID');
          try {
            return discriminateNativeResourceForTest(url, context.id);
          } catch {
            throw cancel('NATIVE_ADMISSION_INVALID');
          }
        },
        retire() {
          if (retirement) return retirement;
          context.live = false;
          context.batch = null;
          context.tickets.clear();
          contexts.delete(context.id);
          controller.dispose();
          boundFetch = undefined;
          const attempt = Promise.resolve().then(async () => {
            try {
              const retired = await bridge.retireContext(ack.installation, context.id);
              if (retired?.retired !== true) throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
              return Object.freeze({retired: true as const});
            } catch {
              throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
            }
          });
          retirement = attempt;
          void attempt.catch(() => {
            if (retirement === attempt) retirement = undefined;
          });
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
        try {
          await bridge.retireContext(ack.installation, orphan);
        } catch {
          void dispose().catch(() => undefined);
        }
      }
      throw error instanceof NativeAdmissionError ? error : cancel('NATIVE_ADMISSION_UNAVAILABLE');
    } finally {
      pendingControllers.delete(controller);
    }
  }

  function dispose(): Promise<NativeRemovalAck> {
    if (disposal) return disposal;
    disposed = true;
    status = 'disposed';
    const retiring = [...contexts.values()].map((context) =>
      retire(context).catch(() => undefined),
    );
    for (const controller of pendingControllers) controller.dispose();
    const attempt = (async () => {
      try {
        let id: string | undefined;
        try {
          id = await installed;
        } catch {
          /* No successful installation to remove. */
        }
        await Promise.all(retiring);
        if (!id) return Object.freeze({removed: false, ownershipLost: false});
        try {
          const ack = await bridge.remove(id);
          if (!ack || typeof ack.removed !== 'boolean' || typeof ack.ownershipLost !== 'boolean')
            throw cancel('NATIVE_ADMISSION_INVALID');
          return Object.freeze({removed: ack.removed, ownershipLost: ack.ownershipLost});
        } catch {
          throw cancel('NATIVE_ADMISSION_UNAVAILABLE');
        }
      } finally {
        unsubscribe();
      }
    })();
    disposal = attempt;
    void attempt.catch(() => {
      if (disposal === attempt) disposal = undefined;
    });
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
      return Object.freeze({
        status,
        contexts: contexts.size,
        pendingRegistrations: pendingControllers.size,
      });
    },
  });
}
