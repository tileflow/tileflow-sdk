import nativeTileflowMap, {type Spec as MapSpec} from './specs/NativeTileflowMapModule';
import nativeTileflowOffline, {type Spec as OfflineSpec} from './specs/NativeTileflowOffline';
import nativeTileflowServices, {type Spec as ServicesSpec} from './specs/NativeTileflowServices';

/** The package's native code is missing: in Expo Go, or in a build made before installing it. */
export class TileflowNativeModuleUnavailableError extends Error {
  constructor(module: string) {
    super(
      `The Tileflow native module ${module} is not in this app. Tileflow needs a development build ` +
        'or a release build that includes @tileflow/react-native; Expo Go does not contain it. ' +
        'Rebuild the app after installing the package.',
    );
    this.name = 'TileflowNativeModuleUnavailableError';
  }
}

function required<Module>(module: Module | null, name: string): Module {
  if (!module) throw new TileflowNativeModuleUnavailableError(name);
  return module;
}

export function servicesModule(): ServicesSpec {
  return required(nativeTileflowServices(), 'TileflowServices');
}

export function offlineModule(): OfflineSpec {
  return required(nativeTileflowOffline(), 'TileflowOffline');
}

export function mapModule(): MapSpec {
  return required(nativeTileflowMap(), 'TileflowMapModule');
}
