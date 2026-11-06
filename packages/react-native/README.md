# @tileflow/react-native

Tileflow maps, offline regions and services for React Native. `MapView` wraps the Tileflow Swift
and Android SDKs through Fabric. The package targets React 19.2.0 and React Native 0.83.10 with the
New Architecture. Expo 55 requires a development build; Expo Go does not include these modules.

## Install

This implementation is pre-release. When its matching alpha is available, install it and rebuild
the application's native projects:

```sh
npm install --save-exact @tileflow/react-native@alpha
```

For Expo, add `@tileflow/react-native` to the app's plugins and run prebuild. The plugin adds
Tileflow's Maven repository. Configure credentials through the plugin's environment variables
or native configuration.

For a React Native Community app, apply `tileflow_post_install(installer)` in the Podfile after
`react_native_post_install`. The package supplies the hook in `ios/tileflow_post_install.rb`.
Add Tileflow's repository to the root `android/build.gradle` and keep Maven Central for MapLibre:

```groovy
allprojects {
  repositories {
    exclusiveContent {
      forRepository { maven { url = uri('https://maven.tileflow.dev') } }
      filter { includeGroup('dev.tileflow') }
    }
  }
}
```

Source changes can precede published packages. Check the selected package version before adopting
an API. See the [mobile guides](https://tileflow.dev/docs).

## Show a map

<!-- docs:check -->

```tsx
import {Camera, CircleLayer, GeoJSONSource, MapView} from '@tileflow/react-native';

export function StoreMap() {
  return (
    <MapView source={{mapId: 'map_0123456789abcdef'}} style={{flex: 1}}>
      <Camera centerCoordinate={[-3.7038, 40.4168]} zoomLevel={16} />
      <GeoJSONSource
        id="stores"
        shape={{
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'sol',
              properties: {},
              geometry: {type: 'Point', coordinates: [-3.7038, 40.4168]},
            },
          ],
        }}
      >
        <CircleLayer id="store-points" style={{circleRadius: 7, circleColor: '#e9573f'}} />
      </GeoJSONSource>
    </MapView>
  );
}
```

Self-hosted sources use `{map, manifestUrl}`. The native SDK owns loading, resource access,
theme changes and offline delivery. Runtime sources and layers survive theme changes.

`Camera`, the five source components and ten layer components use declarative props. Layer styles
accept generated camelCase properties and expression arrays. `MapViewRef` provides projection,
queries, feature state and scene controls. `GeoJSONSourceRef` updates features by id and queries
clusters. Coordinates are `[longitude, latitude]`; screen coordinates use layout points and
durations use milliseconds.

`MapViewRef.joinBoundaryRows(rows, options)` resolves ISO, NUTS, Wikidata and `ref` codes against
the map's Boundaries release. Pass its result to `setBoundaryValues`. The first download validates
and stores each complete class table in SDK storage, independently of HTTP caching. Later joins
can use it offline, including different rows after a restart. A release change selects new tables;
an unavailable current table without network rejects with `resourceFailed` and reason
`boundaryLookupOffline`. A failed durable write also rejects the operation.
The exported pure `joinBoundaryRows` works with a supplied `createBoundaryLookup` without network
access. Both preserve the web join's duplicate, ambiguous and unmatched reports. This storage does
not download the map's styles or tiles and does not add Boundaries to offline packs.

Use `PointAnnotation` for native points, `MarkerView` for React views and `Images` for bundled or
URI images, including SDF images. An annotation that consumes a touch takes precedence over a POI
or background event. The application owns any popup or sheet.

`UserLocation` requests no permission on mount. Call `requestPermission()` explicitly after
configuring the platform's location permission descriptions. `visible={false}` hides the
indicator; an explicit `onUpdate` still receives fixes. Native lifecycle handling releases the
provider when it has no consumers.

`TileflowOfflineStore`, `TileflowOfflineSwitch`, `TileflowSearch`, `TileflowRouting`,
`TileflowElevation` and `TileflowGeoIP` delegate to the native SDKs. The example application covers
an offline download and remount with the server stopped. Optional background updates require the
plugin's `offline.backgroundUpdates` setting and the platform's background configuration.

Unsupported visual capabilities report developer diagnostics through `onWarning` and the console.
The SDK does not add a warning overlay to the application's map.
