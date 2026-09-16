import {createAdmissionInstallation} from './admission-installation';
import {createMountedMapOwner, type MountedMapPorts} from './mounted-map-owner';
import {createReactNativeAdmissionTransport} from './native-admission-bridge';
import {createNativeAdmissionOwner} from './native-admission-owner';
import {observeNativeAppearance} from './native-appearance';
import {createReactNativeHostedBindingResolver} from './native-configuration-bridge';
import {getNativeDocumentTransport} from './native-document-bridge';
import {getNativeSurfaceTransport} from './native-surface-bridge';

const liveOwners = new Set<ReturnType<typeof createMountedMapOwner>>();
const installation = createAdmissionInstallation(() => {
  const transport = createReactNativeAdmissionTransport();
  const releaseLifecycle = transport.subscribeLifecycle((foreground) => {
    for (const owner of [...liveOwners]) owner.nativeLifecycle(foreground);
  });
  const owner = createNativeAdmissionOwner({
    bridge: transport.bridge,
    sessionFetch: transport.fetchForContext,
  });
  return Object.freeze({
    openMap: owner.openMap,
    async dispose() {
      try {
        return await owner.dispose();
      } finally {
        releaseLifecycle();
      }
    },
  });
});
const ports: MountedMapPorts = Object.freeze({
  documents: getNativeDocumentTransport(),
  createBinding: createReactNativeHostedBindingResolver,
  installation,
  surfaces: getNativeSurfaceTransport(),
  appearance: observeNativeAppearance,
  now: () => new Date(),
});

// Failed cleanup is retained for an explicit lifecycle retry, never reused by another Map.
const retiring = new Set<ReturnType<typeof createMountedMapOwner>>();
export function retireNativeMapOwner(owner: ReturnType<typeof createMountedMapOwner>): void {
  liveOwners.delete(owner);
  retiring.add(owner);
  void owner.dispose().then(
    () => retiring.delete(owner),
    () => undefined,
  );
}
export function createNativeMapOwner() {
  for (const owner of retiring) retireNativeMapOwner(owner);
  const owner = createMountedMapOwner(ports);
  liveOwners.add(owner);
  return owner;
}
