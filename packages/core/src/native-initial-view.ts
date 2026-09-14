import {parse} from 'zod/mini';
import {miniManifestSchemaOperations} from './manifest-schema-mini';
import {TileflowNativeSourceError} from './native-source-types';
import {freezeNativeSnapshot, nativeOwnRecord} from './native-source-utils';
import {defaultTileflowRuntimeView, resolveTileflowRuntimeView} from './runtime';
import {createTileflowRuntimeViewSchema} from './runtime-view-schema';
import type {TileflowViewConfig} from './types';

export type TileflowNativeInitialView = Readonly<Required<TileflowViewConfig>>;

/** Inputs are views, not renderer props. Validate all supplied levels before applying precedence. */
export type TileflowNativeInitialViewOptions = {
  /** Highest precedence, supplied explicitly by the application. */
  view?: TileflowViewConfig;
  /** View values extracted by an adapter from its renderer options. */
  mapOptionsView?: TileflowViewConfig;
  /** The selected manifest map's view, when present. */
  manifestView?: TileflowViewConfig;
};

const viewSchema = createTileflowRuntimeViewSchema(miniManifestSchemaOperations);
const viewKeys = ['bearing', 'center', 'pitch', 'zoom'];
const inputKeys = ['view', 'mapOptionsView', 'manifestView'];
const invalid = (): never => {
  throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'view');
};

/** Resolve once or repeatedly without changing source generations, themes or acquisition. */
export function resolveTileflowNativeInitialView(
  options: TileflowNativeInitialViewOptions = {},
): TileflowNativeInitialView {
  try {
    const input = snapshotRecord(options, inputKeys);
    const manifestView = snapshotView(input.manifestView);
    const mapOptionsView = snapshotView(input.mapOptionsView);
    const view = snapshotView(input.view);
    // Each partial input omits undefined fields; shared defaults always complete the result.
    const resolved = resolveTileflowRuntimeView({
      ...view,
      fallback: {...defaultTileflowRuntimeView, ...manifestView, ...mapOptionsView},
    }) as Required<TileflowViewConfig>;
    return freezeNativeSnapshot({
      center: [resolved.center[0], resolved.center[1]] as [number, number],
      zoom: resolved.zoom,
      bearing: resolved.bearing,
      pitch: resolved.pitch,
    });
  } catch {
    return invalid();
  }
}

function snapshotRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const snapshot = nativeOwnRecord(input);
  if (!snapshot) return invalid();
  const ownKeys = Reflect.ownKeys(input as object);
  if (ownKeys.length !== Object.keys(snapshot).length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return invalid();
  return snapshot;
}

function snapshotView(input: unknown): TileflowViewConfig {
  if (input === undefined) return {};
  const snapshot = snapshotRecord(input, viewKeys);
  if (snapshot.center !== undefined) {
    const center = snapshot.center;
    if (!Array.isArray(center) || Object.getPrototypeOf(center) !== Array.prototype ||
      Reflect.ownKeys(center).length !== 3 ||
      Object.getOwnPropertyDescriptor(center, 'length')?.value !== 2) return invalid();
    const longitude = Object.getOwnPropertyDescriptor(center, '0');
    const latitude = Object.getOwnPropertyDescriptor(center, '1');
    if (!longitude?.enumerable || !latitude?.enumerable ||
      !('value' in longitude) || !('value' in latitude)) return invalid();
    snapshot.center = [longitude.value, latitude.value];
  }
  const parsed = parse(viewSchema, snapshot);
  return {
    ...(parsed.bearing === undefined ? {} : {bearing: parsed.bearing}),
    ...(parsed.center === undefined ? {} : {center: parsed.center}),
    ...(parsed.pitch === undefined ? {} : {pitch: parsed.pitch}),
    ...(parsed.zoom === undefined ? {} : {zoom: parsed.zoom}),
  };
}
