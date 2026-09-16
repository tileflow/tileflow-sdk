import {snapshotCameraView} from './camera-input';
import {isNativeToken} from './native-admission-url';
import {
  type NativeSurface,
  NativeSurfaceError,
  type NativeSurfaceEvent,
  type NativeSurfaceModule,
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
      let released = false;
      let retirement: Promise<void> | undefined;
      let unsubscribe: (() => void) | undefined;
      const fail = () => {
        if (!live || failed) return;
        failed = true;
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
              if (ack?.acknowledged !== true) fail();
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
          const ack = await safe(() =>
            native.applyCamera(surface, command, snapshotCameraView(view)),
          );
          check();
          return Object.freeze({command: ack.command, view: snapshotCameraView(ack.view)});
        },
        async cancelCamera(command) {
          if (!positive(command)) throw new NativeSurfaceError();
          const ack = await safe(() => native.cancelCamera(surface, command));
          if (ack?.cancelled !== true) throw new NativeSurfaceError();
          return Object.freeze({cancelled: true as const});
        },
        retire(): Promise<void> {
          if (retirement) return retirement;
          live = false;
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
