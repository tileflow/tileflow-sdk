import {NativeEventEmitter, NativeModules} from 'react-native';
import {NativeSurfaceError} from './native-surface-contract';
import {createNativeSurfaceTransport} from './native-surface-wire';

// The shared capability contains no Map/controller identity and creates no native view.
const transport = createNativeSurfaceTransport(
  () => NativeModules.TileflowNativeSurface,
  (listener) => {
    const module = NativeModules.TileflowNativeSurface;
    if (
      !module ||
      typeof module.addListener !== 'function' ||
      typeof module.removeListeners !== 'function'
    ) {
      throw new NativeSurfaceError();
    }
    const emitter = new NativeEventEmitter(module);
    const subscription = emitter.addListener('TileflowNativeSurfaceEvent', listener);
    return () => subscription.remove();
  },
);

export function getNativeSurfaceTransport() {
  return transport;
}
