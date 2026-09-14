import {nativeManifestUtf8ByteLength} from './native-manifest-utf8';
import {tileflowNativeProfileLimits} from './native-profile-helpers';
import {TileflowNativeSourceError} from './native-source-types';
import {freezeNativeSnapshot} from './native-source-utils';
import type {TileflowNativeNetworkOptions} from './native-url-policy';
import {resolveTileflowNativeManifestUrl} from './native-urls';
import {validateTileflowRuntimeSource} from './runtime';
import type {MapLibreStyle} from './types';

/** Copy caller-owned style data; do not interpret or rewrite the Style Specification. */
export function snapshotNativeDirectStyle(
  value: unknown,
  network: TileflowNativeNetworkOptions,
): string | MapLibreStyle {
  const fail = (): never => {
    throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
  };
  try {
    if (!validateTileflowRuntimeSource({kind: 'maplibre', style: value}).ok) return fail();
    if (typeof value === 'string') return resolveTileflowNativeManifestUrl(value, network);
    const copy = cloneDirectStyleJson(value, fail) as MapLibreStyle;
    if (Array.isArray(copy.layers) && copy.layers.length > tileflowNativeProfileLimits.maximumLayers)
      return fail();
    if (copy.sources && typeof copy.sources === 'object' && !Array.isArray(copy.sources) &&
      Object.keys(copy.sources).length > tileflowNativeProfileLimits.maximumSources) return fail();
    return freezeNativeSnapshot(copy);
  } catch {
    return fail();
  }
}

/**
 * Admission uses the existing raw style budgets, not the larger prepared-output allowance.
 * Unlike a boolean preflight, copying descriptors here prevents later caller/observer mutation.
 */
function cloneDirectStyleJson(input: unknown, fail: () => never): unknown {
  const limits = tileflowNativeProfileLimits;
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const node = (depth: number) => {
    if (++nodes > limits.maximumNodes || depth > limits.maximumDepth) fail();
  };
  const addBytes = (count: number) => {
    bytes += count;
    if (bytes > limits.maximumStyleBytes) fail();
  };
  const stringBytes = (value: string) => {
    if (value.length > limits.maximumStyleBytes) return fail();
    // Serializing a primitive cannot invoke caller getters, toJSON or coercion hooks.
    return nativeManifestUtf8ByteLength(JSON.stringify(value));
  };
  const visit = (value: unknown, depth: number): unknown => {
    node(depth);
    if (value === null) { addBytes(4); return null; }
    if (typeof value === 'string') { addBytes(stringBytes(value)); return value; }
    if (typeof value === 'boolean') { addBytes(value ? 4 : 5); return value; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return fail();
      addBytes(JSON.stringify(value).length);
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) return fail();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      return fail();
    const keys = Reflect.ownKeys(value);
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1)) return fail();
    const entries = array ? keys.length - 1 : keys.length;
    // Every property/index and value consumes at least two more visits.
    if (entries * 2 > limits.maximumNodes - nodes) return fail();
    const output: unknown[] | Record<string, unknown> = array ? [] : {};
    ancestors.add(value);
    addBytes(2);
    let emitted = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key))
        return fail();
      if (array) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) return fail();
      }
      node(depth + 1);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail();
      if (emitted++ > 0) addBytes(1);
      if (!array) addBytes(stringBytes(key) + 1);
      const child = visit(descriptor.value, depth + 1);
      Object.defineProperty(output, key, {value: child, enumerable: true, writable: true, configurable: true});
    }
    ancestors.delete(value);
    return output;
  };
  return visit(input, 0);
}
