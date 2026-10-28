import {
  type CameraReason,
  type ErrorContext,
  type EventName,
  protocol,
  type ProtocolErrorCode,
  type SubscribableEvent,
  type Subscriptions,
} from './protocol';

export type Clock = Readonly<{
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}>;

export const systemClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A payload is computed only when it is delivered, so throttled events cost nothing. */
export type Producer = () => unknown;

const alwaysDelivered = (name: EventName) =>
  (protocol.events[name] as {delivery?: string}).delivery === 'always';

/**
 * Delivers only the events the host subscribes to. A throttled event is delivered at once when its
 * interval has passed; otherwise its latest payload is delivered when the interval ends, so the
 * last state is never lost. Throttling never applies to events delivered without a subscription.
 */
export function createEventHub(input: {
  send: (event: EventName, result: unknown) => void;
  clock?: Clock;
}) {
  const clock = input.clock ?? systemClock;
  type Entry = {throttleMs: number; last: number; pending?: Producer; timer?: unknown};
  const entries = new Map<SubscribableEvent, Entry>();
  let disposed = false;
  const clear = (entry: Entry) => {
    if (entry.timer !== undefined) clock.cancel(entry.timer);
    entry.timer = undefined;
    entry.pending = undefined;
  };
  const deliver = (name: EventName, produce: Producer) => {
    if (!disposed) input.send(name, produce());
  };

  return {
    /** Replaces every subscription. Pending deliveries of dropped events are discarded. */
    set(subscriptions: Subscriptions) {
      for (const [name, entry] of entries) {
        if (subscriptions[name]) continue;
        clear(entry);
        entries.delete(name);
      }
      for (const [name, subscription] of Object.entries(subscriptions) as [
        SubscribableEvent,
        {throttleMs: number},
      ][]) {
        const entry = entries.get(name);
        if (entry) entry.throttleMs = subscription.throttleMs;
        else entries.set(name, {throttleMs: subscription.throttleMs, last: -Infinity});
      }
    },
    wants(name: EventName): boolean {
      return !disposed && (alwaysDelivered(name) || entries.has(name as SubscribableEvent));
    },
    emit(name: EventName, produce: Producer) {
      if (disposed) return;
      if (alwaysDelivered(name)) {
        deliver(name, produce);
        return;
      }
      const entry = entries.get(name as SubscribableEvent);
      if (!entry) return;
      const now = clock.now();
      if (entry.timer === undefined && now - entry.last >= entry.throttleMs) {
        entry.last = now;
        deliver(name, produce);
        return;
      }
      entry.pending = produce;
      entry.timer ??= clock.schedule(
        () => {
          const pending = entry.pending;
          entry.timer = undefined;
          entry.pending = undefined;
          if (!pending || entries.get(name as SubscribableEvent) !== entry) return;
          entry.last = clock.now();
          deliver(name, pending);
        },
        Math.max(0, entry.last + entry.throttleMs - now),
      );
    },
    /** Drops a pending throttled delivery, for example when a later event supersedes it. */
    discard(name: SubscribableEvent) {
      const entry = entries.get(name);
      if (entry) clear(entry);
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) clear(entry);
      entries.clear();
    },
  };
}
export type EventHub = ReturnType<typeof createEventHub>;

export type Warning = Readonly<{code: ProtocolErrorCode; message: string; context: ErrorContext}>;

/**
 * Aggregates repeated warnings so a failing tile set cannot flood the bridge. The first warning of
 * a kind is reported at once; repeats within the window are reported together when it closes,
 * with their count. Warnings of a kind are those with equal code and context.
 */
export function createWarningAggregator(input: {
  report: (warning: Warning & {count: number}) => void;
  clock?: Clock;
  windowMs?: number;
  maximumKinds?: number;
}) {
  const clock = input.clock ?? systemClock;
  const windowMs = input.windowMs ?? protocol.limits.warningWindowMs;
  const maximumKinds = input.maximumKinds ?? 64;
  const windows = new Map<string, {warning: Warning; repeats: number; timer: unknown}>();
  let disposed = false;
  const close = (key: string) => {
    const window = windows.get(key);
    windows.delete(key);
    if (!disposed && window && window.repeats > 0)
      input.report({...window.warning, count: window.repeats});
  };
  return {
    warn(warning: Warning) {
      if (disposed) return;
      const {reason, resource, origin, status} = warning.context;
      const key = JSON.stringify([warning.code, reason, resource, origin, status]);
      const window = windows.get(key);
      if (window) {
        window.repeats += 1;
        window.warning = warning;
        return;
      }
      // Distinct kinds are few in practice; past the bound, new kinds wait for a window to close.
      if (windows.size >= maximumKinds) return;
      input.report({...warning, count: 1});
      windows.set(key, {warning, repeats: 0, timer: clock.schedule(() => close(key), windowMs)});
    },
    dispose() {
      disposed = true;
      for (const window of windows.values()) clock.cancel(window.timer);
      windows.clear();
    },
  };
}

/** Event data the runtime passes to MapLibre camera calls it makes for the application. */
export const apiCameraChange = {tileflowReason: 'api'} as const;

/**
 * Who moved the camera, from a MapLibre movement event. A person's gesture carries the DOM event
 * that caused it, including the motion that continues after it; application calls carry
 * `apiCameraChange`; anything else is the SDK itself.
 */
export function cameraReason(event: unknown): CameraReason {
  const data = event as {originalEvent?: unknown; tileflowReason?: unknown};
  if (data.originalEvent) return 'gesture';
  return data.tileflowReason === apiCameraChange.tileflowReason ? 'api' : 'system';
}
