# @tileflow/vue

Vue component for rendering Tileflow maps with MapLibre.

Install `maplibre-gl` alongside the package and import its CSS once in your app.

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
    :map-options="{
      cooperativeGestures: true,
      maxZoom: 18,
    }"
  />
</template>
```

`mapOptions` accepts native MapLibre options except `container` and `style`, which
Tileflow resolves from `source`. Direct
Tileflow props such as `center`, `zoom`, and `interactive` take priority when
provided. Camera resolution is the same in interactive and image modes: direct props, then
`mapOptions`, then the published manifest view, then Tileflow's shared runtime defaults.

Every map has exactly one discriminated `source`. Use `kind: 'tileflow'` with `map` and an optional
`manifestUrl` for published delivery. `kind: 'maplibre'` is an unmanaged escape hatch for one direct
style object or URL; it has no Tileflow theme identity, `system` selection, switching, or manifest
traceability. Browser components do not compile `tileflow.config.ts`.

Without `manifestUrl`, the exact default is `/tileflow/manifest.json`. If a bundler, framework base
path, reverse proxy, or Tileflow plugin publishes it elsewhere, set the final public URL explicitly;
the component does not guess it. Manifest 404s, unknown map IDs, unresolved styles, and unresolved
image URLs enter `data-tileflow-state="error"`.

`theme` selects a published theme name; omission uses `defaultTheme`, while `"system"` requires the
map's explicit light/dark mapping. Switching themes preserves the MapLibre instance, camera, and
interaction state, with rollback on failure. Listen to `themeChange` for transition state.

```vue
<TileflowMap
  :source="{
    kind: 'tileflow',
    map: 'madrid',
    manifestUrl: 'https://cdn.example.com/tileflow/manifest.json',
  }"
/>

<TileflowMap
  :source="{
    kind: 'maplibre',
    style: 'https://cdn.example.com/tileflow/styles/madrid/dark.json',
  }"
/>
```

`mode="image"` resolves an explicit or published image URL and renders an `<img>` without loading
or evaluating MapLibre. All environments follow the same published manifest contract.

## Annotations, semantic POIs, and native Vue views

Use `annotations` for small, application-owned DOM markers. The portable annotation data and
interaction state remain JSON-safe. Use `interactions` to bind tooltip or popup behavior to
manifest-declared semantic POIs already rendered by the map style; this avoids creating one DOM
marker per feature. Scoped slots render native Vue UI into hosts owned by the shared interaction
runtime.

```vue
<script setup lang="ts">
import {ref} from 'vue';
import type {
  TileflowAnnotation,
  TileflowInteractionBinding,
  TileflowInteractionState,
} from '@tileflow/interactions';
import {TileflowMap} from '@tileflow/vue';

type Property = {address: string; price: number};

const annotations = [
  {
    kind: 'marker',
    id: 'property-42',
    coordinate: [-3.7, 40.4],
    ariaLabel: 'Apartment in Madrid',
    data: {address: 'Calle Mayor', price: 320_000},
    tooltip: {content: {kind: 'field', field: 'address'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation<Property>[];

const interactions = [
  {
    id: 'restaurant-details',
    target: {kind: 'semantic-feature', domain: 'poi', categories: ['food-drink']},
    tooltip: {content: {kind: 'field', field: 'name', fallback: 'Restaurant'}},
    popup: {content: {kind: 'view', name: 'poi-card'}},
  },
] satisfies readonly TileflowInteractionBinding[];

const interactionState = ref<TileflowInteractionState>({popup: null});
</script>

<template>
  <TileflowMap
    v-model:interaction-state="interactionState"
    :source="{kind: 'tileflow', map: 'madrid'}"
    :annotations="annotations"
    :interactions="interactions"
    @interaction-event="(event) => console.log(event.type, event.target)"
    @interaction-diagnostic="(diagnostic) => console.warn(diagnostic.code)"
  >
    <template #marker="{annotation}">
      <span class="price-marker">{{ annotation.data.price.toLocaleString() }}</span>
    </template>

    <template #tooltip="{target}">
      <span v-if="target.kind === 'annotation'">{{ target.annotation.data.address }}</span>
      <span v-else-if="target.kind === 'semantic-feature'">
        {{ target.feature.properties.name }}
      </span>
    </template>

    <template #popup="{target, close}">
      <article v-if="target.kind === 'annotation'">
        <strong>{{ target.annotation.data.address }}</strong>
        <button type="button" @click="close">Close</button>
      </article>
      <article v-else-if="target.kind === 'semantic-feature'">
        <strong>{{ target.feature.properties.name }}</strong>
        <button type="button" @click="close">Close</button>
      </article>
    </template>
  </TileflowMap>
</template>
```

Omit `interactionState` and use `default-interaction-state` for uncontrolled state. Do not provide
both or switch ownership modes during a component instance's lifetime. `annotations` is the only
application-owned marker input and uses singular `coordinate` plus required `ariaLabel`.

The `marker` slot is annotation-only and preserves the annotation's generic `data` type.
`tooltip` and `popup` receive the general `TileflowInteractionViewContext`; narrow
`target.kind` to access either `target.annotation` or the resolved semantic feature. Semantic POI
bindings require a compatible `tileflow:interaction-manifest` in the active style. Bindings are
validated before reaching MapLibre, POI hit tests are coalesced with `requestAnimationFrame`, and
annotation plus semantic runtimes share one controlled or uncontrolled popup state.
Values in `target.categories` use Tileflow's semantic taxonomy (for example `food` or `coffee`),
not raw OpenMapTiles classes.

Text content is inserted as text, `field` is a bounded declarative lookup, and `view` is only a
dispatch name for the corresponding application-owned scoped slot. No interaction path evaluates
HTML. Passing annotations, semantic interactions, or interaction state to `mode="image"` emits an `UNSUPPORTED_MODE`
diagnostic, marks capture readiness as `error`, and still does not load or evaluate MapLibre.

Changing annotations, semantic bindings, slots, state listeners, or diagnostic listeners
reconciles the existing runtimes; it does not recreate the map. The semantic runtime is initialized
lazily, and the component and its interaction imports remain SSR-safe.

Hosted maps automatically preflight a short-lived commercial session grant before eligible
resources. Setting `analytics` with `enabled: false` disables the optional beacon only; it does not
remove hosted authorization or override a user `mapOptions.transformRequest` callback.
Use `:analytics="{surfaceId: 'store-locator'}"` when the same Map is embedded in several stable
product locations. Missing or invalid Surface IDs become `default`; do not use URLs, branches,
random instance IDs, or user IDs.
Direct Tileflow World maps keep early `GRACE` silent, show a compact accessible owner-action pill
when late `GRACE` is activated, and show a stronger banner in `MANAGED_REQUIRED`. Missing tiles and
MapLibre failures do not remove that recovery path.

## Headless capture readiness

Pass `capture-id` when a page contains multiple copies of the same named map:

```vue
<TileflowMap :source="{kind: 'tileflow', map: 'madrid'}" capture-id="checkout-map" />
```

The root exposes `data-tileflow-map`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. It becomes idle only after MapLibre idle plus two
animation frames (or image decode/load in image mode). A change to custom tooltip/popup/marker
render-target keys independently returns interaction readiness to loading until Vue commits the
Teleports and two current animation frames pass. Map and interaction errors are combined;
application capture selects exactly one ready target.

## Compatibility

The supported peer window is Vue 3.3-3.x and MapLibre GL JS 5-6. Compatibility smoke tests install
Vue 3.3.0 with the first release of both MapLibre majors from packed Tileflow tarballs, typecheck a
consumer, and render the image/SSR path while rejecting any MapLibre import. Vue 4 stays outside the
peer range until that matrix passes.

Docs: https://tileflow.dev/docs
