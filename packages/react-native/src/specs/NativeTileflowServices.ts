import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

// Search, Routing, Elevation and GeoIP through the native clients. The native side reads the
// credentials from the application's native configuration; none of them crosses this boundary.
export interface Spec extends TurboModule {
  /** Which services have a credential in the native configuration. */
  configuredServices(): CodegenTypes.UnsafeObject;
  /** Runs one operation of a native client and resolves with its answer. */
  call(
    service: string,
    operation: string,
    request: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
}

/** Looks the native module up on first use, so that importing the package reads nothing. */
export default function nativeTileflowServices(): Spec | null {
  return TurboModuleRegistry.get<Spec>('TileflowServices');
}
