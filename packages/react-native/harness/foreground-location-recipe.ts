import type {MapView, TileflowAnnotation} from '../src/index';

export type ApplicationLocationPermission =
  | 'granted-precise'
  | 'granted-approximate'
  | 'denied'
  | 'unavailable';

export type ApplicationLocationFix = Readonly<{
  accuracy: number;
  latitude: number;
  longitude: number;
}>;

export type ApplicationLocationObservation =
  | Readonly<{type: 'fix'; fix: unknown}>
  | Readonly<{type: 'revoked'}>
  | Readonly<{type: 'unavailable'}>;

/**
 * Application-owned adapter used only by this source-checkout recipe. A concrete location provider
 * belongs to the application and is intentionally absent from @tileflow/react-native.
 */
export type ApplicationForegroundLocationAdapter = Readonly<{
  requestPermission(): Promise<ApplicationLocationPermission>;
  observe(listener: (update: ApplicationLocationObservation) => void): () => void;
}>;

export type ApplicationForegroundLocationState =
  | Readonly<{status: 'idle' | 'requesting' | 'denied' | 'unavailable' | 'revoked'; fix: null}>
  | Readonly<{
      status: 'granted-precise' | 'granted-approximate';
      fix: ApplicationLocationFix | null;
    }>;

export type ApplicationLocationAnnotation = TileflowAnnotation<
  Readonly<{accuracyMeters: number; precision: 'approximate' | 'precise'}>
>;

const emptyAnnotations: readonly ApplicationLocationAnnotation[] = Object.freeze([]);
const idle: ApplicationForegroundLocationState = Object.freeze({fix: null, status: 'idle'});

function dataNumber(input: object, key: string): number | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && descriptor.enumerable && 'value' in descriptor && typeof descriptor.value === 'number'
    ? descriptor.value
    : undefined;
}

/** Normalize provider output before any coordinate reaches Map props. */
export function validateForegroundLocationFix(input: unknown): ApplicationLocationFix | undefined {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 3 ||
      !keys.every((key) =>
        typeof key === 'string' && ['accuracy', 'latitude', 'longitude'].includes(key),
      )
    )
      return undefined;
    const accuracy = dataNumber(input, 'accuracy');
    const latitude = dataNumber(input, 'latitude');
    const longitude = dataNumber(input, 'longitude');
    if (
      accuracy === undefined ||
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      return undefined;
    return Object.freeze({accuracy, latitude, longitude});
  } catch {
    return undefined;
  }
}

function permissionState(
  permission: unknown,
): Exclude<ApplicationForegroundLocationState, {status: 'idle' | 'requesting' | 'revoked'}> {
  if (permission === 'granted-precise')
    return Object.freeze({fix: null, status: 'granted-precise'});
  if (permission === 'granted-approximate')
    return Object.freeze({fix: null, status: 'granted-approximate'});
  if (permission === 'denied') return Object.freeze({fix: null, status: 'denied'});
  return Object.freeze({fix: null, status: 'unavailable'});
}

function canObserve(state: ApplicationForegroundLocationState): state is Extract<
  ApplicationForegroundLocationState,
  {status: 'granted-precise' | 'granted-approximate'}
> {
  return state.status === 'granted-precise' || state.status === 'granted-approximate';
}

/**
 * A small application-owned foreground controller. Construction never requests permission or
 * starts observation. Backgrounding retires the current observation; foregrounding restarts only
 * while the application's last permission decision remains granted.
 */
export function createForegroundLocationController(
  adapter: ApplicationForegroundLocationAdapter,
  initiallyForeground: boolean,
) {
  let disposed = false;
  let foreground = initiallyForeground;
  let permissionEpoch = 0;
  let observationEpoch = 0;
  let observing = false;
  let releaseObservation: (() => void) | undefined;
  let snapshot: ApplicationForegroundLocationState = idle;
  const listeners = new Set<() => void>();

  const publish = (next: ApplicationForegroundLocationState) => {
    if (disposed) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Application observers do not own provider lifetime. */
      }
    }
  };

  const stopObservation = () => {
    observationEpoch += 1;
    observing = false;
    const release = releaseObservation;
    releaseObservation = undefined;
    if (!release) return;
    try {
      release();
    } catch {
      /* A provider teardown failure cannot revive a retired observation. */
    }
  };

  const startObservation = () => {
    if (disposed || !foreground || observing || releaseObservation || !canObserve(snapshot)) return;
    const ticket = ++observationEpoch;
    observing = true;
    let release: (() => void) | undefined;
    try {
      release = adapter.observe((update) => {
        if (
          disposed ||
          !foreground ||
          ticket !== observationEpoch ||
          !canObserve(snapshot)
        )
          return;
        if (update.type === 'revoked') {
          stopObservation();
          publish(Object.freeze({fix: null, status: 'revoked'}));
          return;
        }
        if (update.type === 'unavailable') {
          stopObservation();
          publish(Object.freeze({fix: null, status: 'unavailable'}));
          return;
        }
        const fix = validateForegroundLocationFix(update.fix);
        if (!fix) {
          stopObservation();
          publish(Object.freeze({fix: null, status: 'unavailable'}));
          return;
        }
        const status = snapshot.status;
        if (status !== 'granted-precise' && status !== 'granted-approximate') return;
        publish(Object.freeze({fix, status}));
      });
    } catch {
      observing = false;
      if (!disposed && ticket === observationEpoch) {
        observationEpoch += 1;
        publish(Object.freeze({fix: null, status: 'unavailable'}));
      }
      return;
    }
    observing = false;
    if (
      disposed ||
      !foreground ||
      ticket !== observationEpoch ||
      !canObserve(snapshot)
    ) {
      try {
        release();
      } catch {
        /* The observation was already retired logically. */
      }
      return;
    }
    releaseObservation = release;
  };

  return Object.freeze({
    getSnapshot: (): ApplicationForegroundLocationState => snapshot,
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async requestPermission(): Promise<void> {
      if (disposed) return;
      const ticket = ++permissionEpoch;
      stopObservation();
      publish(Object.freeze({fix: null, status: 'requesting'}));
      let permission: unknown;
      try {
        permission = await adapter.requestPermission();
      } catch {
        permission = 'unavailable';
      }
      if (disposed || ticket !== permissionEpoch) return;
      publish(permissionState(permission));
      startObservation();
    },
    setForeground(next: boolean): void {
      if (disposed || foreground === next) return;
      foreground = next;
      if (!foreground) {
        stopObservation();
        return;
      }
      startObservation();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      permissionEpoch += 1;
      stopObservation();
      listeners.clear();
    },
  });
}

/** Derive the one stable-ID Map annotation only from a validated, currently granted fix. */
export function foregroundLocationAnnotations(
  state: ApplicationForegroundLocationState,
): readonly ApplicationLocationAnnotation[] {
  if (!canObserve(state) || !state.fix) return emptyAnnotations;
  const precision = state.status === 'granted-precise' ? 'precise' : 'approximate';
  const coordinate = Object.freeze([state.fix.longitude, state.fix.latitude] as const);
  const data = Object.freeze({accuracyMeters: state.fix.accuracy, precision});
  return Object.freeze([
    Object.freeze({
      ariaLabel: precision === 'precise' ? 'Current location' : 'Approximate current location',
      coordinate,
      data,
      id: 'application-foreground-location',
      kind: 'marker' as const,
    }),
  ]);
}

/** Explicit application action: immediate controlled-view update, with no animation contract. */
export function recenterForegroundLocationView(
  view: MapView,
  state: ApplicationForegroundLocationState,
): MapView {
  if (!canObserve(state) || !state.fix) return view;
  return Object.freeze({
    ...view,
    center: Object.freeze([state.fix.longitude, state.fix.latitude] as const),
  });
}
