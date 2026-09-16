import type {MapColorScheme, MapThemeSelection} from './contract';

export type AppearanceState =
  | Readonly<{status: 'available'; colorScheme: MapColorScheme}>
  | Readonly<{status: 'unavailable'}>;

export type AppearanceSelection = Readonly<{theme?: MapThemeSelection}>;

/** Only public Appearance reads/subscriptions are needed. No mutation or acquisition capability. */
export type AppearancePort = {
  getColorScheme(): unknown;
  addChangeListener(listener: (preferences: unknown) => void): {remove(): void};
};

type Listener = {notify: (state: AppearanceState) => void; last?: AppearanceState};
type Connection = {
  closed: boolean;
  acceptEvents: boolean;
  revision: number;
  current?: AppearanceState;
  subscription?: {remove(): void};
};

const light: AppearanceState = Object.freeze({status: 'available', colorScheme: 'light'});
const dark: AppearanceState = Object.freeze({status: 'available', colorScheme: 'dark'});
const unavailable: AppearanceState = Object.freeze({status: 'unavailable'});

function normalize(value: unknown): AppearanceState {
  return value === 'light' ? light : value === 'dark' ? dark : unavailable;
}

function normalizeEvent(value: unknown): AppearanceState {
  try {
    if (!value || typeof value !== 'object') return unavailable;
    const property = Object.getOwnPropertyDescriptor(value, 'colorScheme');
    return property && 'value' in property ? normalize(property.value) : unavailable;
  } catch {
    return unavailable;
  }
}

function remove(subscription: {remove(): void} | undefined): void {
  try {
    subscription?.remove();
  } catch {
    /* Retirement is authoritative even if native cleanup throws. */
  }
}

/** One native listener per active broker, regardless of how many system-theme maps subscribe. */
export function createAppearanceObserver(port: AppearancePort) {
  const listeners = new Set<Listener>();
  let connection: Connection | undefined;

  const notify = (entry: Listener, state: AppearanceState) => {
    if (!listeners.has(entry) || entry.last === state) return;
    entry.last = state;
    try {
      void Promise.resolve(entry.notify(state)).catch(() => undefined);
    } catch {
      /* Application callback failures do not own the subscription. */
    }
  };
  const publish = (current: Connection, state: AppearanceState) => {
    if (connection !== current || current.closed || current.current === state) return;
    current.current = state;
    for (const entry of [...listeners]) {
      if (connection !== current || current.closed || current.current !== state) break;
      notify(entry, state);
    }
  };
  const activate = () => {
    const current: Connection = {closed: false, acceptEvents: true, revision: 0};
    connection = current;
    let subscription: {remove(): void};
    try {
      subscription = port.addChangeListener((event) => {
        if (connection !== current || current.closed || !current.acceptEvents) return;
        current.revision++;
        publish(current, normalizeEvent(event));
      });
    } catch {
      current.acceptEvents = false;
      publish(current, unavailable);
      return;
    }
    if (connection !== current || current.closed) {
      remove(subscription);
      return;
    }
    current.subscription = subscription;
    let initial: AppearanceState;
    try {
      initial = normalize(port.getColorScheme());
    } catch {
      initial = unavailable;
    }
    // An event observed while subscribing/reading is newer than a potentially cached initial value.
    if (current.revision === 0) publish(current, initial);
  };

  return {
    subscribe(
      selection: AppearanceSelection,
      listener: (state: AppearanceState) => void,
    ): () => void {
      if (selection.theme !== 'system') return () => undefined;
      if (typeof listener !== 'function') throw new TypeError('Expected an appearance listener.');
      const entry: Listener = {notify: listener};
      listeners.add(entry);
      if (!connection) activate();
      if (connection?.current) notify(entry, connection.current);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        listeners.delete(entry);
        if (listeners.size !== 0) return;
        const previous = connection;
        connection = undefined;
        if (!previous) return;
        previous.closed = true;
        previous.acceptEvents = false;
        const subscription = previous.subscription;
        previous.subscription = undefined;
        remove(subscription);
      };
    },
  };
}
