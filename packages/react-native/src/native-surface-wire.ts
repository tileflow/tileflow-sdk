import {snapshotCameraView} from './camera-input';
import {isNativeToken} from './native-admission-url';
import {
  type NativeSurface,
  NativeSurfaceError,
  type NativeSurfaceEvent,
  type NativeSurfaceModule,
  type NativeThemeValues,
} from './native-surface-contract';

const methods = [
  'attachSurface',
  'expectStyle',
  'commitLayout',
  'requestFrame',
  'applyCamera',
  'cancelCamera',
  'acknowledgeSurface',
  'retireSurface',
  'retireRoot',
] as const;
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const motionDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 5000;
export const nativeThemeValueLimits = Object.freeze({values: 8192, images: 64, depth: 32});
const layerOrImage = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512;
const propertyName = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z-]{0,63}$/u.test(value);
function plain(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= nativeThemeValueLimits.depth || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.every((item) => plain(item, depth + 1));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((item) => plain(item, depth + 1));
}
/** Values come from the SDK's own blend plan; this bounds them before they cross the bridge. */
function themeValues(values: unknown): values is NativeThemeValues {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const {paint = [], layout = [], images = [], light} = values as Record<string, unknown>;
  if (
    Object.keys(values).some((key) => !['paint', 'layout', 'images', 'light'].includes(key)) ||
    !Array.isArray(paint) ||
    !Array.isArray(layout) ||
    !Array.isArray(images) ||
    paint.length + layout.length > nativeThemeValueLimits.values ||
    images.length > nativeThemeValueLimits.images
  )
    return false;
  for (const entry of [...paint, ...layout]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      !layerOrImage(entry[0]) ||
      !propertyName(entry[1]) ||
      !plain(entry[2], 0)
    )
      return false;
  }
  for (const entry of images) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      !layerOrImage(entry[0]) ||
      !layerOrImage(entry[1]) ||
      !layerOrImage(entry[2]) ||
      typeof entry[3] !== 'number' ||
      !(entry[3] >= 0 && entry[3] <= 1)
    )
      return false;
  }
  if (light === undefined) return true;
  return Boolean(light) && typeof light === 'object' && !Array.isArray(light) && plain(light, 0);
}
function own(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeSurfaceError();
  const property = Object.getOwnPropertyDescriptor(value, name);
  if (!property || !('value' in property)) throw new NativeSurfaceError();
  return property.value;
}
function eventFromNative(value: unknown): NativeSurfaceEvent {
  const surface = own(value, 'surface');
  const style = own(value, 'style');
  const sequence = own(value, 'sequence');
  const layout = own(value, 'layout');
  const kind = own(value, 'kind');
  if (!isNativeToken(surface) || !isNativeToken(style) || !positive(sequence) || !positive(layout))
    throw new NativeSurfaceError();
  const keys = Reflect.ownKeys(value as object);
  if (kind === 'gesture-start' || kind === 'gesture-change' || kind === 'gesture-end') {
    const gesture = own(value, 'gesture');
    if (
      !positive(gesture) ||
      keys.length !== 7 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['surface', 'style', 'sequence', 'layout', 'kind', 'gesture', 'view'].includes(key),
      )
    )
      throw new NativeSurfaceError();
    return Object.freeze({
      surface,
      style,
      sequence,
      layout,
      kind,
      gesture,
      view: snapshotCameraView(own(value, 'view')),
    });
  }
  if (
    !['style', 'render', 'invalidate', 'error'].includes(String(kind)) ||
    keys.length !== 5 ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !['surface', 'style', 'sequence', 'layout', 'kind'].includes(key),
    )
  )
    throw new NativeSurfaceError();
  return Object.freeze({surface, style, sequence, layout, kind}) as NativeSurfaceEvent;
}

/** Shared module capability only; each attachment has isolated callbacks, sequence and retirement. */
export function createNativeSurfaceTransport(
  locate: () => unknown,
  listen: (callback: (event: unknown) => void) => () => void,
) {
  let reservations = 0;
  function module(): NativeSurfaceModule {
    try {
      const value = locate() as NativeSurfaceModule;
      if (!value || methods.some((name) => typeof value[name] !== 'function'))
        throw new NativeSurfaceError();
      return value;
    } catch {
      throw new NativeSurfaceError();
    }
  }
  async function safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new NativeSurfaceError();
    }
  }
  return Object.freeze({
    available(): void {
      module();
    },
    /** Whether the native build can apply blend values; older builds cannot. */
    blending(): boolean {
      try {
        return typeof module().applyThemeValues === 'function';
      } catch {
        return false;
      }
    },
    async attach(
      root: number,
      notify: (event: NativeSurfaceEvent) => void,
      failure: () => void,
    ): Promise<NativeSurface> {
      if (!positive(root) || reservations >= 16) throw new NativeSurfaceError();
      const native = module();
      reservations++;
      let id: string | undefined;
      let live = true;
      let failed = false;
      let lastSequence = 0;
      let acknowledgedSequence = 0;
      let released = false;
      let retirement: Promise<void> | undefined;
      let unsubscribe: (() => void) | undefined;
      type AcknowledgementWaiter = {
        sequence: number;
        resolve(): void;
        reject(error: NativeSurfaceError): void;
      };
      const acknowledgementWaiters = new Set<AcknowledgementWaiter>();
      const rejectAcknowledgementWaiters = () => {
        if (!acknowledgementWaiters.size) return;
        const error = new NativeSurfaceError();
        for (const waiter of acknowledgementWaiters) waiter.reject(error);
        acknowledgementWaiters.clear();
      };
      const resolveAcknowledgementWaiters = () => {
        for (const waiter of [...acknowledgementWaiters]) {
          if (waiter.sequence > acknowledgedSequence) continue;
          acknowledgementWaiters.delete(waiter);
          waiter.resolve();
        }
      };
      const waitForAcknowledgement = (sequence: number): Promise<void> => {
        if (!positive(sequence) || !live || failed) return Promise.reject(new NativeSurfaceError());
        if (sequence <= acknowledgedSequence) return Promise.resolve();
        if (acknowledgementWaiters.size >= 16) return Promise.reject(new NativeSurfaceError());
        return new Promise<void>((resolve, reject) => {
          acknowledgementWaiters.add({sequence, resolve, reject});
        });
      };
      const fail = () => {
        if (!live || failed) return;
        failed = true;
        rejectAcknowledgementWaiters();
        try {
          failure();
        } catch {
          /* Application observers cannot own native lifetime. */
        }
      };
      const check = () => {
        if (!live || failed || module() !== native) throw new NativeSurfaceError();
      };
      try {
        unsubscribe = listen((value) => {
          if (!live || !id) return;
          try {
            if (own(value, 'surface') !== id) return;
          } catch {
            return;
          }
          try {
            check();
            const event = eventFromNative(value);
            if (event.sequence > lastSequence) {
              lastSequence = event.sequence;
              notify(event);
            }
            void safe(() => native.acknowledgeSurface(id!, event.sequence)).then((ack) => {
              if (ack?.acknowledged !== true) {
                fail();
                return;
              }
              if (!live || failed) return;
              if (event.sequence > acknowledgedSequence) {
                acknowledgedSequence = event.sequence;
                resolveAcknowledgementWaiters();
              }
            }, fail);
          } catch {
            fail();
          }
        });
        const ack = await safe(() => native.attachSurface(root));
        if (!ack || !isNativeToken(ack.surface) || module() !== native)
          throw new NativeSurfaceError();
        id = ack.surface;
      } catch {
        live = false;
        rejectAcknowledgementWaiters();
        unsubscribe?.();
        reservations--;
        throw new NativeSurfaceError();
      }
      const surface = id;
      return Object.freeze({
        id: surface,
        async expectStyle(style) {
          check();
          if (!isNativeToken(style)) throw new NativeSurfaceError();
          const ack = await safe(() => native.expectStyle(surface, style));
          check();
          if (ack?.accepted !== true) throw new NativeSurfaceError();
        },
        async commitLayout(style) {
          check();
          const ack = await safe(() => native.commitLayout(surface, style));
          check();
          if (!positive(ack?.layout)) throw new NativeSurfaceError();
          return ack.layout;
        },
        async requestFrame(style) {
          check();
          const ack = await safe(() => native.requestFrame(surface, style));
          check();
          if (ack?.requested !== true) throw new NativeSurfaceError();
        },
        async applyCamera(command, view) {
          check();
          if (!positive(command)) throw new NativeSurfaceError();
          const before = lastSequence;
          const ack = await safe(() =>
            native.applyCamera(surface, command, snapshotCameraView(view)),
          );
          check();
          if (ack.command !== command || !positive(ack.invalidation) || ack.invalidation <= before)
            throw new NativeSurfaceError();
          const receipt = Object.freeze({command: ack.command, view: snapshotCameraView(ack.view)});
          await waitForAcknowledgement(ack.invalidation);
          check();
          return receipt;
        },
        async cancelCamera(command) {
          if (!positive(command)) throw new NativeSurfaceError();
          const ack = await safe(() => native.cancelCamera(surface, command));
          if (ack?.cancelled !== true) throw new NativeSurfaceError();
          return Object.freeze({cancelled: true as const});
        },
        ...(typeof native.coverSurface === 'function' &&
        typeof native.revealSurface === 'function' &&
        typeof native.discardSurfaceCover === 'function'
          ? {
              async cover(duration: number) {
                check();
                if (!motionDuration(duration)) throw new NativeSurfaceError();
                const ack = await safe(() => native.coverSurface!(surface, duration));
                check();
                if (typeof ack?.covered !== 'boolean') throw new NativeSurfaceError();
                return ack.covered;
              },
              async reveal(duration: number) {
                check();
                if (!motionDuration(duration)) throw new NativeSurfaceError();
                const ack = await safe(() => native.revealSurface!(surface, duration));
                if (ack?.revealed !== true) throw new NativeSurfaceError();
              },
              async discardCover() {
                const ack = await safe(() => native.discardSurfaceCover!(surface));
                if (ack?.discarded !== true) throw new NativeSurfaceError();
              },
            }
          : {}),
        ...(typeof native.applyThemeValues === 'function'
          ? {
              async applyThemeValues(style: string, values: NativeThemeValues) {
                check();
                if (!isNativeToken(style) || !themeValues(values)) throw new NativeSurfaceError();
                const ack = await safe(() => native.applyThemeValues!(surface, style, values));
                check();
                if (!Number.isSafeInteger(ack?.applied) || ack.applied < 0)
                  throw new NativeSurfaceError();
                return ack.applied;
              },
            }
          : {}),
        retire(): Promise<void> {
          if (retirement) return retirement;
          live = false;
          rejectAcknowledgementWaiters();
          unsubscribe?.();
          unsubscribe = undefined;
          const attempt = safe(() => native.retireSurface(surface)).then((ack) => {
            if (ack?.detached !== true) throw new NativeSurfaceError();
            if (!released) {
              released = true;
              reservations--;
            }
          });
          retirement = attempt;
          void attempt.catch(() => {
            if (retirement === attempt) retirement = undefined;
          });
          return attempt;
        },
      });
    },
    async retireRoot(root: number): Promise<void> {
      if (!positive(root)) throw new NativeSurfaceError();
      const native = module();
      const ack = await safe(() => native.retireRoot(root));
      if (ack?.detached !== true) throw new NativeSurfaceError();
    },
  });
}
