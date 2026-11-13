# @tileflow/vue

Vue components for interactive Tileflow maps, annotations, and existing-image display.
The component reads prepared manifests and styles; it does not compile `tileflow.config.ts` in the
browser.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing Vue 3 application. Supported peers are Vue `>=3.3 <4` and MapLibre GL JS
`>=6.4.1 <7`. The local build workflow below requires Node.js 22 or newer.

```sh
npm install @tileflow/vue@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
npm install --save-dev --save-exact tileflow@alpha
```

Prepared styles may retain relative asset URLs. The component loads them through Core's shared
resource loader before creating the map and before changing or blending themes. Sprites, fonts,
data and model resources resolve against their declaring documents. Pending document loads are
cancelled when the map is replaced or unmounted; `mapOptions.transformRequest` also applies to
style and HTTP TileJSON requests, and to the DEM TileJSON and DEM tiles that contours read.

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

```sh
npx tileflow build --out public/tileflow
```

Serve `public/` at the application's URL root. Rebuild after map or asset changes, or use the
[Vite integration](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vite/README.md)
for watched development and production output. Local build and validation need no API key;
rendering may still request configured remote tiles and fonts.

## Configure the worker

With Vite, the plugin from `@tileflow/vite` gives every map MapLibre's worker, in development and
in production builds, so the application configures nothing. `tileflow()` prepares maps and adds
the worker. When the CLI build or a hosted manifest provides the maps, add only the worker
(`npm install --save-dev @tileflow/vite@alpha`):

```ts
import {defineConfig} from 'vite';
import {tileflowMapLibreWorker} from '@tileflow/vite';

export default defineConfig({plugins: [tileflowMapLibreWorker()]});
```

The worker comes from the same installed MapLibre as the map's main module.

For Webpack, follow the
[Webpack recipe](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md).
With another bundler, configure the worker once before mounting an interactive map, with the URL at
which the application serves `maplibre-gl/dist/maplibre-gl-worker.mjs`:

```ts
import {configureTileflowMapLibre} from '@tileflow/vue';

configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});
```

An explicit configuration wins over the Vite plugin's. Keep MapLibre's CSS in the client
application as well.

## Render a map

```vue
<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css';
import {TileflowMap} from '@tileflow/vue';
</script>

<template>
  <TileflowMap
    :source="{map: 'madrid'}"
    theme="system"
    :center="[-3.7038, 40.4168]"
    :zoom="12"
    :height="420"
    :map-options="{cooperativeGestures: true, maxZoom: 18}"
  />
</template>
```

Coordinates are `[longitude, latitude]`. `source` is one object, `{map, manifestUrl?}`.
`source.map` is the config's portable ID, not a hosted `map_...` identifier. The default manifest
URL is exactly `/tileflow/manifest.json`; provide `source.manifestUrl` explicitly for a subpath,
reverse proxy, or external host. The component does not infer build-tool configuration.

Omitting `theme` uses `defaultTheme`. `system` needs the map's explicit light/dark mapping, which
Streets supplies. Switching themes preserves the map, camera, and interactions, with rollback on
failure. Listen to `themeChange` for transitions.

Add `time-of-day="dusk"` beside `theme` to select a map's optional `day`, `dawn`, `dusk`, or
`night` preset. For Streets, `theme="light"` with this preset selects the existing `dusk` palette.
Maps without this capability ignore the option; omitting it keeps the selected theme unchanged.
Changing it uses the existing theme transition. `themeBlend` takes precedence. See the
[authoring contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/REFERENCE.md#style-with-themes-and-semantic-modules).

Theme and `time-of-day` changes cross-fade over 450 ms by default, respecting reduced motion.
`:theme-transition="{duration: 700}"` customizes the duration; use `duration: 0` for an immediate change.
`:theme-blend="{themes: ['night', 'dusk', 'day'], position}"` shows a continuous blend of the
map's themes instead of `theme`: position 0 is the first theme and 1.5 is halfway from the second to
the third. Moving the position updates the map at once. See
[theme transitions and blends](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).

`:colors="{'surface.land': '#f4f1ea'}"` overrides named colour tokens of the map's
theme, and `:emphasis="{recede: {roads: 0.3}, labels: 0.6}"` makes modules recede and labels fade so
your own content reads first. Both ease in over `theme-transition`, stay through theme changes, and
follow the props: an empty `colors` or no `emphasis` restores the map as designed. An unknown token or an
invalid value is reported as an error and leaves the colours unchanged.
A map that declares colour knobs, as Streets does, also takes them by name, such as `:colors="{water: '#2563eb', roads: '#9aa5b1'}"`; see [Streets' knobs](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/REFERENCE.md#streets-colour-knobs).

A colour may use CSS variables, so the map follows your design tokens: `:colors="{'surface.land':
'var(--background)', 'surface.water': 'color-mix(in oklab, var(--primary) 30%, var(--background))'}"`.
The map reads each variable where it sits, with `var(--name, fallback)` and nested variables
supported, and reads them again, showing new colours only if the result changed, when the `class`,
`style`, or `data-theme` attribute of `<html>` or `<body>` changes (for example a `dark` class) and
when the system's colour-scheme preference changes. A variable with no value and no fallback is
emitted as an `error` event with code `colors`, naming the variable.

`@error="onError"` receives `{code, error}` when the map cannot do what you asked, where `error` is
an `Error` and `code` is one of:

- `manifest`: the manifest could not be loaded, or it has no map named `source.map`.
- `theme`: the requested theme or `timeOfDay` is not in the map, or the change failed.
- `blend`: a `themeBlend` names a theme the map does not have, or the blend failed.
- `colors` and `emphasis`: the setting was rejected, for example an unknown token or an invalid value.
- `runtime`: the map could not be created, loaded, or taken down.
- `scene`: the 3D scene could not be loaded.
- `camera`: `bounds` or `fitAnnotations` could not be turned into a view.

Without an `error` listener, these failures go to `console.error`. Interactive-state problems keep
their own channel, the `interaction-diagnostic` event.

A template `ref` on `TileflowMap` exposes two methods: `getMap()` returns the MapLibre map, and
`getThemeController()` returns the controller that changes the map's theme, colours, and emphasis
at run time. Both return `null` until the map has loaded, in image mode, and after it is taken
down, so call them from event handlers and from `@load`. `TileflowMapHandle` types the ref.

```vue
<script setup lang="ts">
import {ref} from 'vue';
import {TileflowMap, type TileflowMapHandle} from '@tileflow/vue';

const map = ref<TileflowMapHandle | null>(null);
const fly = () => map.value?.getMap()?.flyTo({center: [-3.7, 40.4], zoom: 12});
</script>

<template>
  <TileflowMap ref="map" :source="{map: 'madrid'}" />
</template>
```

Interactive maps show the 3D scene their style declares by default: buildings with Tileflow
landmarks and the map's Team building models, 3D trees, and street lights where the map enables
them. The 3D renderers load only when the style declares a scene, so 2D maps do not download them.
`viewMode` is `3d` by default; `view-mode="2d"` opts out, mounting no 3D buildings or street lights, and
draws vegetation as the map's policy sets for the 2D view (Streets keeps its model trees in either
view). `vegetation` overrides vegetation visibility (omitting it uses the map default); `:vegetation="false"`
hides models and flat artwork alike. Changing either prop updates the existing map immediately.
They do not change camera pitch and do not apply in image mode. See
[the map's 3D scene](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
and [vegetation controls](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).

Interactive maps show no zoom or compass buttons unless you ask for them. `navigation-control` shows
them at the top right, and `:navigation-control="{position: 'bottom-left', showCompass: false}"` moves
them or limits their buttons.

`:bounds` starts the map on those bounds and moves it when they change; `:fit-bounds-options` shapes the
fit with `padding`, `maxZoom` and `duration`. `fit-annotations` fits the map to all `annotations`, with
48 pixels of padding and at most zoom 15, and again when their positions change. `bounds` takes
precedence, and `center` and `zoom` set the first view only until one of them is given.

The marker slot receives `state`, `{hovered, focused, selected}`, where `selected` means the
marker's popup is open. A popup or tooltip slot that no annotation or interaction can reach, because
none sets `popup` or `tooltip`, reports an `UNUSED_RENDERER` warning diagnostic.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct props take
priority over those options, then the published view, then shared defaults. `TileflowMap` always
selects a Tileflow map through its manifest; it has no renderer discriminator or direct-style mode.
Tileflow's styles are validated when they are compiled, so `validateStyle` defaults to `false`; pass
`true` to validate them again in the browser.
The map canvas is multisampled by default (`canvasContextAttributes.antialias` is `true`) so the
thin edges of 3D models stay continuous; other context attributes you pass are kept, and
`canvasContextAttributes: {antialias: false}` trades that smoothing for lower GPU cost.
The obsolete source fields `kind` and `style` are rejected. Add your own layers, sources and
controls to the MapLibre map from `getMap()`.

## Add annotations and native popup UI

Install the contracts when importing them directly:

```sh
npm install @tileflow/interactions@alpha
```

This component uses the worker and CSS setup above:

```vue
<script setup lang="ts">
import {ref} from 'vue';
import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';
import {TileflowMap} from '@tileflow/vue';

const annotations = [
  {
    id: 'property-42',
    kind: 'marker',
    coordinate: [-3.7038, 40.4168],
    ariaLabel: 'Apartment in Madrid',
    tooltip: {content: {kind: 'text', text: 'View apartment'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation[];

const state = ref<TileflowInteractionState>({popup: null});
</script>

<template>
  <TileflowMap
    v-model:interaction-state="state"
    :source="{map: 'madrid'}"
    :annotations="annotations"
    @interaction-diagnostic="(diagnostic) => console.error(diagnostic.code)"
  >
    <template #popup="{target, close}">
      <article v-if="target.kind === 'annotation'">
        <h2>{{ target.annotation.ariaLabel }}</h2>
        <button type="button" @click="close">Close</button>
      </article>
    </template>
  </TileflowMap>
</template>
```

Annotations require a stable `id`, singular `coordinate`, and non-empty `ariaLabel`; optional data
must be JSON-safe. `marker` receives annotation-only context. `tooltip` and `popup` receive the
shared interaction context; narrow `target.kind` before reading annotation or semantic feature data.

Use `interactions` with `target: {kind: 'semantic-feature', domain: 'poi'}` for POIs already rendered
by the style. Categories use Tileflow's taxonomy, such as `food-drink` or `retail`, not raw source
classes. Semantic bindings require compatible metadata in the active style and avoid creating one
DOM marker per feature.

Omit controlled state and use `default-interaction-state` for uncontrolled ownership. Do not supply
both or change ownership during a component's lifetime. Annotations, bindings, slots, and callbacks
reconcile without recreating MapLibre. Text/field descriptors render as text; `view` dispatches to
an application slot and never evaluates HTML. Tooltips must remain non-interactive; use a popup for
links, buttons, or forms.

## Cluster points and draw density

Use `annotationClusters` for up to 1,000 annotations, or `dataSources` and `dataOverlays` for larger
GeoJSON sets. Clicking a cluster zooms in and reports a `cluster` target through `@interaction-event`.

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

## Display an existing image

`mode="image"` renders an explicit `imageUrl` or derives an image URL from the selected manifest
map's `mapId`, `apiUrl`, concrete theme and view, without loading MapLibre. It still requires a valid
Tileflow source. A local style build does not generate an image. This mode does not create or poll
a static render; use the server-side
[Static Maps client](https://github.com/tileflow/tileflow-sdk/blob/main/packages/static/README.md)
for that operation and keep privileged keys on the server.

Do not pass annotations, semantic bindings, state, or interaction slots to image mode. Unsupported
interaction input reports `UNSUPPORTED_MODE` and capture readiness `error`; it does not silently
pretend the image contains live overlays.

## Capture, authorization, and troubleshooting

Pass `capture-id` when multiple components show the same map. The root exposes `data-tileflow-map`,
resolved `data-tileflow-theme`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. Readiness includes MapLibre or image loading plus committed
Vue interaction views. Application capture needs exactly one ready target and the application's
normal loopback server.

For a blank/error map, check that the manifest URL returns JSON, the map and theme exist, MapLibre
CSS is imported, and the matching worker/shared assets are served. Manifest 404s and unresolved
styles/images are errors; the component does not guess another URL.

Hosted maps preflight a short-lived session grant. `:analytics="{enabled: false}"` disables only the
optional beacon, not authorization. Use a stable product `surfaceId` rather than a user ID or URL.
Direct World maps can show owner-action notices when managed delivery is required. Imports and the
image path remain SSR-safe; interactive rendering needs a browser with WebGL.

See the [interaction guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/README.md)
and [browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/README.md).
Use the installed package's declarations and README for a release; `main` can include newer changes.
