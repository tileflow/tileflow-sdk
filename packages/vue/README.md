# @tileflow/vue

Vue components for interactive Tileflow maps, annotations, and existing-image display.
The component reads prepared manifests and styles; it does not compile `tileflow.config.ts` in the
browser.

## Install

Use an existing Vue 3 application. Supported peers are Vue `>=3.3 <4` and MapLibre GL JS
`>=6.4.1 <7`. The local build workflow below requires Node.js 22 or newer.

```sh
npm install @tileflow/vue@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
npm install --save-dev --save-exact tileflow@alpha
```

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

For Vite, add the following to the existing client entry before `createApp(...).mount(...)`:

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/vue';

configureTileflowMapLibre({workerUrl});
```

Configure this once before mounting an interactive map. The worker must come from the same installed
MapLibre package as the main module. The `?worker&url` import is Vite-specific; use the
[Webpack recipe](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md)
for Webpack. Keep MapLibre's CSS in the client application as well.

## Render a map

```vue
<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css';
import {TileflowMap} from '@tileflow/vue';
</script>

<template>
  <TileflowMap
    :source="{kind: 'tileflow', map: 'madrid'}"
    theme="system"
    :center="[-3.7038, 40.4168]"
    :zoom="12"
    :height="420"
    :map-options="{cooperativeGestures: true, maxZoom: 18}"
  />
</template>
```

Coordinates are `[longitude, latitude]`. `source.map` is the config's portable ID, not a hosted
`map_...` identifier. The default manifest URL is exactly `/tileflow/manifest.json`; provide
`source.manifestUrl` explicitly for a subpath, reverse proxy, or external host. The component does
not infer build-tool configuration.

Omitting `theme` uses `defaultTheme`. `system` needs the map's explicit light/dark mapping, which
Streets supplies. Switching themes preserves the map, camera, and interactions, with rollback on
failure. Listen to `themeChange` for transitions.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct props take
priority over those options, then the published view, then shared defaults. An unmanaged
`source: {kind: 'maplibre', style: styleUrl}` loads a single style without Tileflow theme selection
or manifest traceability; do not combine it with a Tileflow theme.

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
    :source="{kind: 'tileflow', map: 'madrid'}"
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

## Display an existing image

`mode="image"` renders an explicit `imageUrl` or a published manifest image without loading MapLibre.
A local style build does not generate an image. This mode does not create or poll a static render;
use the server-side [Static Maps client](https://github.com/tileflow/tileflow-sdk/blob/main/packages/static/README.md)
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
and [browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/framework-browser-runtime.md).
Use the installed package's declarations and README for a release; `main` can include newer changes.
