import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {
  canonicalMobileApiOrigin,
  type MobileConfiguration,
  NativeConfigurationError,
  snapshotMobileConfiguration,
} from './mobile-configuration';
import type {HostedNativeSessionBinding} from './session-controller';

type Metadata = Readonly<{mapId: string; apiOrigin: string}>;

function field(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error();
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  const property = Object.getOwnPropertyDescriptor(record, key);
  if (!property) return undefined;
  if (!('value' in property)) throw new Error();
  return property.value;
}

function snapshotMetadata(source: TileflowNativeSourceState): Metadata | null {
  try {
    if (field(source, 'status') !== 'ready') throw new Error();
    const map = field(source, 'map');
    const usageMode = field(map, 'usageMode');
    // The accepted manifest grammar has only undefined (non-session) or "session".
    // Do not read unrelated delivery metadata, much less app configuration, in direct mode.
    if (usageMode === undefined) return null;
    if (usageMode !== 'session') throw new Error();
    const mapId = field(map, 'mapId');
    const name = field(map, 'name');
    if (
      typeof mapId !== 'string' ||
      mapId.length !== 20 ||
      !/^map_[A-Za-z0-9_-]{16}$/u.test(mapId) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 64 ||
      name !== field(field(source, 'source'), 'map')
    ) {
      throw new Error();
    }
    return Object.freeze({mapId, apiOrigin: canonicalMobileApiOrigin(field(map, 'apiUrl'))});
  } catch {
    throw new NativeConfigurationError('NATIVE_CONFIGURATION_SOURCE_INVALID');
  }
}

function bind(metadata: Metadata, configuration: MobileConfiguration): HostedNativeSessionBinding {
  const snapshot = snapshotMobileConfiguration(configuration);
  if (snapshot.apiOrigin !== metadata.apiOrigin) {
    throw new NativeConfigurationError('NATIVE_CONFIGURATION_ORIGIN_MISMATCH');
  }
  // A fresh binding belongs to this resolution. Only immutable application data is shared.
  // Ordinary serialization cannot copy the configured origin or credential into diagnostics.
  const binding = Object.defineProperties({kind: 'hosted', mapId: metadata.mapId}, {
    apiOrigin: {value: snapshot.apiOrigin},
    credential: {value: snapshot.credential},
  });
  return Object.freeze(binding) as HostedNativeSessionBinding;
}

/**
 * Private source-to-session boundary, with no network or renderer capability.
 * Its caller owns the separate session controller and retires it with the real Map.
 */
export function createHostedNativeBindingResolver(
  readConfiguration: () => Promise<MobileConfiguration>,
) {
  let disposed = false;
  let generation = 0;
  let active: {reject(error: NativeConfigurationError): void} | undefined;

  return Object.freeze({
    replace(source: TileflowNativeSourceState): Promise<HostedNativeSessionBinding> {
      if (disposed) {
        return Promise.reject(new NativeConfigurationError('NATIVE_CONFIGURATION_DISPOSED'));
      }
      if (generation >= Number.MAX_SAFE_INTEGER) {
        return Promise.reject(new NativeConfigurationError('NATIVE_CONFIGURATION_SOURCE_INVALID'));
      }
      const sequence = ++generation;
      let resolve!: (binding: HostedNativeSessionBinding) => void;
      let reject!: (error: NativeConfigurationError) => void;
      const result = new Promise<HostedNativeSessionBinding>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      // Retirement can be reentrant before the caller receives this promise.
      void result.catch(() => undefined);
      const previous = active;
      const own = {reject};
      active = own;
      const current = () => !disposed && generation === sequence && active === own;
      previous?.reject(new NativeConfigurationError('NATIVE_CONFIGURATION_REPLACED'));
      let metadata: Metadata | null;
      try {
        metadata = snapshotMetadata(source);
      } catch {
        if (current()) {
          active = undefined;
          reject(new NativeConfigurationError('NATIVE_CONFIGURATION_SOURCE_INVALID'));
        }
        return result;
      }
      if (!current()) return result;
      if (!metadata) {
        active = undefined;
        resolve(Object.freeze({kind: 'direct'}));
        return result;
      }
      const selected = metadata;
      void Promise.resolve()
        .then(() => {
          if (!current()) return undefined;
          return readConfiguration();
        })
        .then((configuration) => {
          if (!current()) return;
          const binding = bind(selected, configuration!);
          if (!current()) return;
          active = undefined;
          resolve(binding);
        })
        .catch((error: unknown) => {
          if (!current()) return;
          active = undefined;
          let code: unknown;
          try {
            if (error && typeof error === 'object') {
              code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
            }
          } catch {
            /* Never propagate an exception supplied by a bridge or an injected reader. */
          }
          reject(new NativeConfigurationError(
            code === 'NATIVE_CONFIGURATION_INVALID' || code === 'NATIVE_CONFIGURATION_ORIGIN_MISMATCH'
              ? code
              : 'NATIVE_CONFIGURATION_UNAVAILABLE',
          ));
        });
      return result;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const previous = active;
      active = undefined;
      previous?.reject(new NativeConfigurationError('NATIVE_CONFIGURATION_DISPOSED'));
    },
  });
}
