import {offlineModule, servicesModule} from './sdk-modules';
import {createOfflineStore} from './offline/store';
import {createServiceClients} from './services/clients';

// The service clients and the offline store bound to the app's native modules. The modules are
// looked up on first use, so importing the package reads nothing.

export const {
  TileflowSearch,
  TileflowRouting,
  TileflowElevation,
  TileflowGeoIP,
  configuredServices,
} = createServiceClients(servicesModule);

export const {TileflowOfflineStore, TileflowOfflineSwitch} = createOfflineStore(
  offlineModule,
  (error) =>
    setTimeout(() => {
      throw error;
    }),
);
