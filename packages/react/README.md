# @tileflow/react

React components for interactive Tileflow maps, annotations, and static-image display.
Interactive maps use MapLibre GL JS; browser components read prepared assets rather than compiling
`tileflow.config.ts`.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing React 18 or 19 application with matching `react-dom`. The following local build
workflow needs Node.js 22 or newer:

```sh
npm install @tileflow/react@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
npm install --save-dev --save-exact tileflow@alpha
```

The supported peer ranges are React/React DOM 18–19 and MapLibre GL JS `>=6.4.1 <7`. The worker
must come from the same MapLibre installation as the main module.

Prepared styles may retain relative asset URLs. The component loads them through Core's shared
resource loader before creating the map and before changing or blending themes. Sprites, fonts,
data and model resources resolve against their declaring documents. Pending document loads are
cancelled when the map is replaced or unmounted; `mapOptions.transformRequest` also applies to
style and HTTP TileJSON requests.

## Prepare a map

Create `tileflow.config.ts` at the application root:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  version: 1,
  extends: streets,
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

Build the assets into the application's public directory:

```sh
npx tileflow build --out public/tileflow
```

This assumes the application serves `public/` at its URL root. Rebuild after config or asset
changes, or use the [Vite](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vite/README.md),
[Next.js](https://github.com/tileflow/tileflow-sdk/blob/main/packages/next/README.md), or
[Webpack](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md) integration
for watched development and production builds. Do not use both workflows to overwrite the same
hosted manifest.

## Configure the worker

In a Vite application's client entry, add this before mounting React:

```ts
import {configureTileflowMapLibre} from '@tileflow/react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

configureTileflowMapLibre({workerUrl});
```

This import syntax is specific to Vite. Use the Next.js or Webpack guide linked above for that
bundler's worker-delivery recipe. Configure the worker once, outside component rendering. Do not
use a CDN worker from another MapLibre version. Next.js interactive components belong behind a
`'use client'` boundary.

## Render a map

Import MapLibre's CSS once in the application. After the worker and assets are ready, render:

<!-- docs:check -->

```tsx
import {Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function App() {
  return (
    <Map
      source={{map: 'madrid'}}
      theme="system"
      center={[-3.7038, 40.4168]}
      zoom={12}
      mapOptions={{cooperativeGestures: true, maxZoom: 18}}
    />
  );
}
```

Coordinates are `[longitude, latitude]`. `source` is one object, `{map, manifestUrl?}`.
`source.map` must match the config's portable map ID, not a hosted `map_...` identifier.
The default manifest URL is exactly `/tileflow/manifest.json`. For a subpath or external host,
provide `manifestUrl` in the source; the component does not infer bundler configuration or search
for assets.

`theme` selects a published concrete theme. Omission uses `defaultTheme`; `system` requires an
explicit light/dark mapping, which Streets supplies. Theme changes preserve the MapLibre instance,
camera, and interactions, and roll back on failure. `onThemeChange` reports transitions.

Add `timeOfDay="dusk"` beside `theme` to select a map's optional `day`, `dawn`, `dusk`, or
`night` preset. For Streets, `theme="light"` with this preset selects the existing `dusk` palette.
Maps without this capability ignore the option; omitting it keeps the selected theme unchanged.
Changing it uses the existing theme transition. `themeBlend` takes precedence. See the
[authoring contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/REFERENCE.md#style-with-themes-and-semantic-modules).

Theme and `timeOfDay` changes cross-fade over 450 ms by default, respecting reduced motion.
`themeTransition={{duration: 700}}` customizes the duration; use `duration: 0` for an immediate change.
`themeBlend={{themes: ['night', 'dusk', 'day'], position}}` shows a continuous blend of the map's
themes instead of `theme`: position 0 is the first theme and 1.5 is halfway from the second to the
third. Moving the position updates the map at once. See
[theme transitions and blends](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).

`colors={{'surface.land': '#f4f1ea'}}` overrides named colour tokens of the map's
theme, and `emphasis={{recede: {roads: 0.3}, labels: 0.6}}` makes modules recede and labels fade so
your own content reads first. Both ease in over `themeTransition`, stay through theme changes, and
follow the props: an empty `colors` or no `emphasis` restores the map as designed. An unknown token or an
invalid value is reported as an error and leaves the colours unchanged.

`onError` receives `{code, error}` when the map cannot do what you asked, where `error` is an `Error` and
`code` is one of:

- `manifest`: the manifest could not be loaded, or it has no map named `source.map`.
- `theme`: the requested theme or `timeOfDay` is not in the map, or the change failed.
- `blend`: a `themeBlend` names a theme the map does not have, or the blend failed.
- `colors` and `emphasis`: the setting was rejected, for example an unknown token or an invalid value.
- `runtime`: the map could not be created, loaded, or taken down.
- `scene`: the 3D scene could not be loaded.
- `camera`: `bounds` or `fitAnnotations` could not be turned into a view.

Without a handler, these failures go to `console.error`. Interactive-state problems keep their own
channel, `onInteractionDiagnostic`.

Interactive maps show the 3D scene their style declares by default: buildings with Tileflow
landmarks and the map's Team building models, 3D trees, and street lights where the map enables
them. The 3D renderers load only when the style declares a scene, so 2D maps do not download them.
`viewMode` is `3d` by default; `viewMode="2d"` opts out, mounting no 3D buildings or street lights, and
draws vegetation as the map's policy sets for the 2D view (Streets keeps its model trees in either
view). `vegetation` overrides vegetation visibility (omitting it uses the map default); `vegetation={false}`
hides models and flat artwork alike. Changing either prop updates the existing map immediately.
They do not change camera pitch and do not apply in image mode. See
[the map's 3D scene](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
and [vegetation controls](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).

Interactive maps show no zoom or compass buttons unless you ask for them. `navigationControl` shows
them at the top right, and `navigationControl={{position: 'bottom-left', showCompass: false}}` moves
them or limits their buttons.

`bounds={[west, south, east, north]}` starts the map on those bounds and moves it when they change;
`fitBoundsOptions={{padding: 24, maxZoom: 14, duration: 600}}` shapes the fit. `fitAnnotations` fits
the map to all `annotations`, with 48 pixels of padding and at most zoom 15, and again when their
positions change. `bounds` takes precedence over it, and `center` and `zoom` set the first view only
until one of them is given.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct camera props
take priority over `mapOptions`, then the manifest view, then shared defaults. `Map` always selects
a Tileflow map through its manifest; it has no renderer discriminator or direct-style mode.
Tileflow's styles are validated when they are compiled, so `validateStyle` defaults to `false`; pass
`true` to validate them again in the browser.
The map canvas is multisampled by default (`canvasContextAttributes.antialias` is `true`) so the
thin edges of 3D models stay continuous; other context attributes you pass are kept, and
`canvasContextAttributes: {antialias: false}` trades that smoothing for lower GPU cost.
The obsolete source fields `kind` and `style` are rejected. For a completely unmanaged map, use
`maplibre-gl` directly rather than a Tileflow component.

## Color boundary areas from application data

For a map that declares `boundaryAreas` and a `boundaryChoropleth()` overlay without `values`,
`useBoundaryFeatureState` keeps its feature-state equal to your rows. Take the map from `onLoad`
and memoize the values; each new object replaces the previous ones, and `null` clears them:

<!-- docs:check -->

```tsx
import {Map, useBoundaryFeatureState} from '@tileflow/react';
import {useMemo, useState} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';

export function Unemployment({rates}: {rates: {ine: string; rate: number}[]}) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const values = useMemo(
    () => ({
      joinBy: 'ref' as const,
      rows: rates.map(({ine, rate}) => ({key: `ES:INE:${ine}`, value: rate})),
    }),
    [rates],
  );
  useBoundaryFeatureState(map, values);
  return <Map source={{map: 'madrid-unemployment'}} onLoad={setMap} />;
}
```

Rows join by `ref` here, so this map declares `boundaryAreas: {family: 'boundaries', promoteId:
'ref'}`. Without `promoteId`, rows join by registry `id`. See
[boundary areas and choropleths](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
for scales, joins and the lookup table.

## Add annotations and popups

Install the contract package when importing its types directly:

```sh
npm install @tileflow/interactions@alpha
```

Annotations are small, application-owned marker sets. Every annotation has a stable `id`, singular
`coordinate`, and non-empty `ariaLabel`. Data must be JSON-safe. Native React renderers use portals
into hosts managed by the interaction runtime:

<!-- docs:check -->

```tsx
import {Map} from '@tileflow/react';
import {useState} from 'react';
import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';

type Property = {price: number; title: string};

const annotations = [
  {
    id: 'property-42',
    kind: 'marker',
    coordinate: [-3.7038, 40.4168],
    ariaLabel: 'Apartment in Madrid',
    data: {price: 320_000, title: 'Apartment in Madrid'},
    tooltip: {content: {kind: 'field', field: 'title'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation<Property>[];

export function PropertyMap() {
  const [state, setState] = useState<TileflowInteractionState>({popup: null});

  return (
    <Map
      source={{map: 'madrid'}}
      annotations={annotations}
      interactionState={state}
      onInteractionStateChange={setState}
      onInteractionDiagnostic={(diagnostic) => console.error(diagnostic.code)}
      renderPopup={({annotation, close}) => (
        <article>
          <h2>{annotation.data.title}</h2>
          <p>EUR {annotation.data.price.toLocaleString()}</p>
          <button type="button" onClick={close}>
            Close
          </button>
        </article>
      )}
    />
  );
}
```

This uses the worker/CSS setup from the preceding sections. Omit controlled `interactionState` and
use `defaultInteractionState` for uncontrolled state; never supply both or switch ownership during
the component's lifetime. Updating annotations, renderers, callbacks, or state does not recreate
the map. Reusing an annotation ID preserves a compatible marker host.

Use `interactions` with `target: {kind: 'semantic-feature', domain: 'poi'}` for POIs already in the
compiled map instead of creating a DOM marker for every feature. Optional categories use Tileflow's
semantic taxonomy, such as `food-drink` or `retail`, not raw source classes. The style must contain
compatible interaction metadata. With semantic bindings, narrow `context.target.kind` in
`renderTooltip` or `renderPopup` before accessing annotation or feature data. `renderMarker` remains
annotation-only. See the
[interaction guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/README.md).

`renderMarker` receives `state`, `{hovered, focused, selected}`, where `selected` means the marker's
popup is open. Each marker's view updates on its own when its state changes. A `renderPopup` or
`renderTooltip` with no annotation or interaction that sets `popup` or `tooltip` has nothing to draw,
so the map reports an `UNUSED_RENDERER` diagnostic. A wrapper component that forwards its props to
`Map` can type them as `MapAnnotationProps<TAnnotation>`, or `MapInteractionProps<TAnnotation>` when
it takes `interactions`, so an inline `renderPopup` keeps its parameter types.

Text/field content uses safe text defaults. A `view` is an application renderer name, not HTML.
Keep tooltips non-interactive; put buttons, links, and forms in popups.

## Cluster points and draw density

Use `annotationClusters` for up to 1,000 annotations, or `dataSources` and `dataOverlays` for larger
GeoJSON sets. Clicking a cluster zooms in and reports a `cluster` target through `onInteractionEvent`.

<!-- docs:check -->

```ts
import {clusterOverlay, geojsonSource} from '@tileflow/core/runtime';

export const dataSources = {stores: geojsonSource({cluster: true, clusterRadius: 50})};
export const dataOverlays = {
  stores: clusterOverlay({id: 'stores', placement: 'above-labels', source: 'stores'}),
};
```

See the
[interactions reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/REFERENCE.md)
for heatmaps, events, and polygon drawing with Terra Draw.

## Display an image or create a render

`<Map mode="image">` displays an explicit `imageUrl` or derives an image URL from the selected
manifest map's `mapId`, `apiUrl`, concrete theme and view. It still requires a valid Tileflow source.
It does not create a static render, poll an operation, or load MapLibre. A local style build alone
does not create that image. Annotations, semantic bindings, and interaction state are not supported
in image mode.

To request a new static render, use `StaticMap` from `@tileflow/react/static`. First install the
shared client/types used by this example:

```sh
npm install @tileflow/static@alpha
```

The application must implement an authorized `/api/static-maps` endpoint that forwards the normalized
scene and idempotency key to the hosted service and returns its result contract. Keep privileged
Tileflow credentials on that server, not in React props or a browser bundle.

<!-- docs:check -->

```tsx
import {StaticMap} from '@tileflow/react/static';
import {useState} from 'react';
import type {StaticMapAttributionEntry} from '@tileflow/static/client';

export function StaticPreview({idempotencyKey}: {idempotencyKey: string}) {
  const [entries, setEntries] = useState<readonly StaticMapAttributionEntry[]>([]);

  return (
    <figure>
      <StaticMap
        map="madrid"
        theme="dark"
        alt="Map of central Madrid"
        camera={{type: 'center', center: [-3.7038, 40.4168], zoom: 12}}
        size={{width: 1200, height: 800}}
        attribution={{mode: 'external'}}
        createUrl="/api/static-maps"
        idempotencyKey={idempotencyKey}
        onReady={(result) => {
          if ('attribution' in result) setEntries(result.attribution.entries);
        }}
      />
      <figcaption>
        {entries.map((entry, index) => (
          <p key={index}>
            {entry.text}{' '}
            {entry.links.map((link) => (
              <a key={link.url} href={link.url}>
                {link.label}
              </a>
            ))}
          </p>
        ))}
      </figcaption>
    </figure>
  );
}
```

Create the key with `createStaticMapIdempotencyKey()` once per intentional render action and retain
it in the owning application state across retries and remounts. Pass it into this component; do not
regenerate it on every render. A new scene is a new action and needs a new key.

Hosted results have `resultVersion: 1` and attribution. `onReady` also supports existing-image
results, which have no attribution field; narrow the union before reading it. External attribution
must remain visible beside the image. Omitted attribution uses embedded automatic placement.
See the [Static Maps guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/static/README.md)
for server transport, errors, overlays, and limits.

## Capture, authorization, and errors

`captureId` disambiguates repeated maps on a page. The root exposes `data-tileflow-map`, the resolved
`data-tileflow-theme`, optional `data-tileflow-capture-id`, and `data-tileflow-state="loading|idle|error"`.
Capture waits for MapLibre/image readiness and committed custom interaction views. Manifest 404s,
unknown maps/themes, and missing styles or images enter the error state rather than silently using
another map.

Hosted interactive maps acquire a short-lived session grant before eligible resource requests.
`analytics={{enabled: false}}` disables the optional beacon, not hosted authorization. A stable
`surfaceId`, such as `store-locator`, identifies a product location; do not use user IDs or URLs.
Existing request transforms remain application-owned, and direct World use can display an
owner-action notice when managed delivery is required.

The image/SSR path does not load MapLibre. Interactive rendering needs a browser with WebGL and the
matching worker assets. For release-specific APIs, use the installed declarations and README;
source `main` may be ahead of npm. Report defects in the
[issue tracker](https://github.com/tileflow/tileflow-sdk/issues).
