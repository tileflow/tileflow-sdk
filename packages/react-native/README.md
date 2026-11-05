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

For Expo, add `@tileflow/react-native` to the app's plugins. Configure credentials through the
plugin's environment variables or native configuration. Credentials are never component props.
For a community application, apply `tileflow_post_install(installer)` in the Podfile after
`react_native_post_install`; the package supplies the hook in `ios/tileflow_post_install.rb`.
Android resolves the Tileflow native artifacts through Maven Central.

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
the map's Boundaries release. Pass its result to `setBoundaryValues`. It downloads the requested
class tables on demand and respects HTTP caching. The map method requires a connection, even with
cached data; offline calls reject with `resourceFailed` and reason `boundaryLookupOffline`.
The exported pure `joinBoundaryRows` works with a supplied `createBoundaryLookup` without network
access. Both preserve the web join's duplicate, ambiguous and unmatched reports. Boundaries
choropleths currently require connectivity; lookups are not added to offline packs.

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
