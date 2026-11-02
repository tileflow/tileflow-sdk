# Offline regions, services and native configuration

`@tileflow/react-native` exposes the offline store and the Search, Routing, Elevation and GeoIP
clients of the Tileflow Swift and Android SDKs. Install the package and its native integration as
the [package README](../README.md#native-integration) describes.

## Configuration and credentials

Credentials never reach JavaScript: there is no setter, prop or method that takes or returns one.
The native SDKs read the app's native configuration, as Swift and Kotlin apps do: the
`TileflowAPIOrigin`, `TileflowMapCredential`, `TileflowServicesCredential`,
`TileflowSearchCredential`, `TileflowRoutingCredential` and `TileflowElevationCredential` keys of
the iOS Info.plist, and the `tileflow_api_origin`, `tileflow_map_credential`,
`tileflow_services_credential`, `tileflow_search_credential`, `tileflow_routing_credential` and
`tileflow_elevation_credential` Android string resources.

The Expo plugin writes them at prebuild from the `TILEFLOW_MAP_CREDENTIAL`,
`TILEFLOW_SERVICES_CREDENTIAL`, `TILEFLOW_SEARCH_CREDENTIAL`, `TILEFLOW_ROUTING_CREDENTIAL` and
`TILEFLOW_ELEVATION_CREDENTIAL` environment variables, and the API origin from its `apiOrigin` prop
(`https://api.tileflow.dev` by default). It refuses credentials as props: Expo embeds the app
config, plugin props included, where JavaScript can read it. `configuredServices()` reports which
credentials are present, never their values.

## Offline regions

`TileflowOfflineStore` downloads regions for use without a network, after Mapbox's tile store.
Loading a stored region again downloads only what changed:

<!-- docs:check -->

```ts
import {TileflowOfflineStore} from '@tileflow/react-native';

export async function downloadMadrid() {
  const subscription = TileflowOfflineStore.subscribe((event) => {
    if (event.type === 'changed') console.log(event.region.state, event.region.completedPackCount);
  });
  await TileflowOfflineStore.loadRegion('madrid', {
    geometry: {type: 'boundingBox', west: -3.75, south: 40.39, east: -3.65, north: 40.45},
    content: {type: 'hosted', mapId: 'map_0123456789abcdef', themes: ['day']},
    maxZoom: 15,
    metadata: {name: 'Madrid'},
  });
  return subscription;
}
```

A region's geometry is a box, a GeoJSON geometry or collection, or a corridor around a line. Its
content is a Hosted map's themes, downloaded with the map credential, or a manifest you serve.
`estimateRegion`, `allRegions`, `region`, `pauseRegion`, `resumeRegion`, `cancelRegion`,
`removeRegion` and `updateRegionMetadata` follow the native store, and regions report their
download, update and expiry state. Failures reject with `TileflowOfflineError`.

Downloads continue in the background. On iOS, automatic updates (`setAutomaticUpdates(true)`) run
as a background task, and the app forwards its background download session's events. The Expo
plugin's `offline.backgroundUpdates` option adds both; other apps list
`dev.tileflow.offline.update` under `BGTaskSchedulerPermittedIdentifiers`, add `fetch` to
`UIBackgroundModes` and call, from the `AppDelegate`:

```swift
import TileflowReactNative

// In application(_:didFinishLaunchingWithOptions:):
TileflowReactNativeApp.registerBackgroundTasks()

// In application(_:handleEventsForBackgroundURLSession:completionHandler:):
if TileflowReactNativeApp.handleEventsForBackgroundURLSession(identifier, completionHandler: completionHandler) {
  return
}
```

Background downloads on iOS need a signed app, also in the simulator. Android uses WorkManager and
needs nothing more. `TileflowOfflineSwitch.setNetworkEnabled(false)` stops Tileflow's network use:
downloads wait until it is turned on again.

## Services

`TileflowSearch`, `TileflowRouting`, `TileflowElevation` and `TileflowGeoIP` call the native
service clients, with the credentials of the native configuration:

<!-- docs:check -->

```ts
import {TileflowRouting, TileflowSearch, TileflowServiceError} from '@tileflow/react-native';

export async function routeToSol() {
  const {results} = await TileflowSearch.geocode({query: 'Puerta del Sol', limit: 1});
  const destination = results[0]?.position;
  if (!destination) return undefined;
  try {
    return await TileflowRouting.route({locations: [[-3.69, 40.41], destination], mode: 'walking'});
  } catch (error) {
    if (error instanceof TileflowServiceError && error.retryAfter) {
      // Wait error.retryAfter milliseconds before trying again.
    }
    throw error;
  }
}
```

Requests and answers follow the native clients' names, with positions as `[longitude, latitude]`
and boxes as `[west, south, east, north]`. Failures reject with `TileflowServiceError`, whose
`kind` is `configuration`, `invalidRequest`, `network`, `rejected` or `invalidResponse`.
