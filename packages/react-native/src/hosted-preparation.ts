import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {snapshotHostedNativeManifestIdentity} from './hosted-manifest-identity';
import {NativeConfigurationError} from './mobile-configuration';

type Identity = ReturnType<typeof snapshotHostedNativeManifestIdentity>;

/** Per mounted source: cache refresh may advance a deployment, never replace session identity. */
export function createHostedNativePreparationGuard() {
  let initialized = false;
  let identity: Identity = null;
  let reloadAvailable = true;
  return Object.freeze({
    select(): void {
      reloadAvailable = true;
    },
    validate(source: TileflowNativeSourceState): void {
      const next = snapshotHostedNativeManifestIdentity(source);
      if (
        initialized &&
        (Boolean(next) !== Boolean(identity) ||
          (next &&
            identity &&
            (next.mapId !== identity.mapId ||
              next.apiOrigin !== identity.apiOrigin ||
              next.deploymentVersion < identity.deploymentVersion)))
      )
        throw new NativeConfigurationError('NATIVE_CONFIGURATION_SOURCE_INVALID');
      identity = next;
      initialized = true;
    },
    retryManifest(): boolean {
      if (!initialized || !identity || !reloadAvailable) return false;
      reloadAvailable = false;
      return true;
    },
  });
}
