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
    map="madrid"
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
Tileflow resolves from the map name, manifest, or explicit style props. Direct
Tileflow props such as `center`, `zoom`, and `interactive` take priority when
provided.

Choose a single style source. `config` may only be combined with `themes`. A named `map` may be
used alone or with exactly one of `mapStyle`, `styleUrl`, or `styleBaseUrl`; keeping `map` alongside
an explicit style preserves map identity for capture and analytics. `styleBaseUrl` requires a named
map, and `themes` has no effect without `config`, so invalid combinations throw a `TypeError` rather
than being resolved by silent precedence.

Hosted maps automatically preflight a short-lived commercial session grant before eligible
resources. Setting `analytics` with `enabled: false` disables the optional beacon only; it does not
remove hosted authorization or override a user `mapOptions.transformRequest` callback.

## Headless capture readiness

Pass `capture-id` when a page contains multiple copies of the same named map:

```vue
<TileflowMap map="madrid" capture-id="checkout-map" />
```

The root exposes `data-tileflow-map`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. It becomes idle only after MapLibre idle plus two
animation frames (or image decode/load in image mode), returns to loading for new style/data work,
and marks terminal load errors. Application capture selects exactly one ready target.

Docs: https://tileflow.dev/docs
