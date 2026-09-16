import {createAdmissionInstallation} from './admission-installation';
import {createMountedMapOwner, type MountedMapPorts} from './mounted-map-owner';
import {createReactNativeAdmissionTransport} from './native-admission-bridge';
import {createNativeAdmissionOwner} from './native-admission-owner';
import {observeNativeAppearance} from './native-appearance';
import {createReactNativeHostedBindingResolver} from './native-configuration-bridge';
import {getNativeDocumentTransport} from './native-document-bridge';
import {getNativeSurfaceTransport} from './native-surface-bridge';

const installation = createAdmissionInstallation(() => {
  const transport = createReactNativeAdmissionTransport();
  return createNativeAdmissionOwner({bridge: transport.bridge, sessionFetch: transport.fetchForContext});
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
  retiring.add(owner);
  void owner.dispose().then(() => retiring.delete(owner), () => undefined);
}
export function createNativeMapOwner() {
  for (const owner of retiring) retireNativeMapOwner(owner);
  return createMountedMapOwner(ports);
}
