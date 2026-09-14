import type {MapCameraProps, MapInitialViewInputs, MapView, MapViewChangeEvent} from './contract';
import {resolveMapInitialView} from './initial-view';

const messages = {
  CAMERA_INPUT_INVALID: 'Expected valid camera ownership and a canonical view.',
  CAMERA_MODE_CHANGE: 'Camera ownership cannot change on a mounted instance.',
  CAMERA_NOT_MOUNTED: 'The camera instance has not been mounted.',
  CAMERA_DISPOSED: 'The camera instance has been disposed.',
  CAMERA_COMMAND_FAILED: 'The camera command could not be applied.',
} as const;

/** Internal owner diagnostic, never a forwarded native exception or public renderer event. */
export class CameraControllerError extends Error {
  readonly code: keyof typeof messages;
  constructor(code: keyof typeof messages) {
    super(messages[code]);
    this.name = 'CameraControllerError';
    this.code = code;
  }
}

export type CameraFallbacks = Pick<MapInitialViewInputs, 'mapOptionsView' | 'manifestView'>;
export type CameraPropsSnapshot = Readonly<{
  mode: 'controlled' | 'initial';
  view: MapView;
  onViewChange?: (event: MapViewChangeEvent) => void;
}>;

const fail = (): never => {
  throw new CameraControllerError('CAMERA_INPUT_INVALID');
};

/** Only inspect own data descriptors; Core owns all actual view shape/range validation. */
function ownRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) return fail();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) return fail();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !('value' in property)) return fail();
    copy[key] = property.value;
  }
  return copy;
}

function requireCompleteView(value: unknown): void {
  if (!value || typeof value !== 'object') return fail();
  for (const key of ['center', 'zoom', 'bearing', 'pitch']) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || property.value === undefined) return fail();
  }
}

export function snapshotCameraProps(
  props: MapCameraProps,
  fallbacks: CameraFallbacks = {},
): CameraPropsSnapshot {
  try {
    const input = ownRecord(props, ['view', 'initialView', 'onViewChange']);
    const fallback = ownRecord(fallbacks, ['mapOptionsView', 'manifestView']);
    const controlled = input.view !== undefined;
    if (controlled && input.initialView !== undefined) return fail();
    if (input.onViewChange !== undefined && typeof input.onViewChange !== 'function') return fail();
    if (controlled) {
      if (typeof input.onViewChange !== 'function') return fail();
      requireCompleteView(input.view);
    }
    const view = resolveMapInitialView({
      view: (controlled ? input.view : input.initialView) as MapInitialViewInputs['view'],
      mapOptionsView: fallback.mapOptionsView as MapInitialViewInputs['mapOptionsView'],
      manifestView: fallback.manifestView as MapInitialViewInputs['manifestView'],
    });
    return Object.freeze({
      mode: controlled ? 'controlled' : 'initial',
      view,
      onViewChange: input.onViewChange as CameraPropsSnapshot['onViewChange'],
    });
  } catch {
    return fail();
  }
}

export function snapshotCameraView(view: unknown): MapView {
  try {
    requireCompleteView(view);
    return resolveMapInitialView({view: view as MapView});
  } catch {
    return fail();
  }
}

export function sameCameraView(left: MapView, right: MapView): boolean {
  return (
    left.zoom === right.zoom &&
    left.bearing === right.bearing &&
    left.pitch === right.pitch &&
    left.center[0] === right.center[0] &&
    left.center[1] === right.center[1]
  );
}
