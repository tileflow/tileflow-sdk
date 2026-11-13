# @tileflow/svelte

Svelte components for interactive Tileflow maps, annotations, and existing-image display.
The component consumes prepared assets; it does not compile executable map configuration in the
browser.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing Svelte 5 application. Supported peers are Svelte `>=5 <6` and MapLibre GL JS
`>=6.4.1 <7`. The local build workflow below requires Node.js 22 or newer.

```sh
npm install @tileflow/svelte@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
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

For a Vite application serving `public/` at the URL root:

```sh
npx tileflow build --out public/tileflow
```

SvelteKit serves static files from `static/` by default; for that setup, build to `static/tileflow`
instead. Set the component's manifest URL to the final public URL when a base path changes it.
Rebuild after config/asset changes or use the
[Vite integration](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vite/README.md)
for watched development and production output. Local preparation needs no API key; rendering can
still fetch configured remote resources.

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

The worker comes from the same installed MapLibre as the map's main module. SvelteKit uses the same Vite plugin; server rendering never loads the
worker.

Webpack users need the
[Webpack worker recipe](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md).
With another bundler, configure the worker once before an interactive map mounts, in the
application's client initialization path rather than a server load function, with the URL at which
the application serves `maplibre-gl/dist/maplibre-gl-worker.mjs`:

```ts
import {configureTileflowMapLibre} from '@tileflow/svelte';

configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});
```

An explicit configuration wins over the Vite plugin's. The worker and shared module must match the
application's installed MapLibre version.

## Render a map

```svelte
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import {TileflowMap} from '@tileflow/svelte';
</script>

<TileflowMap
  source={{map: 'madrid'}}
  theme="system"
  center={[-3.7038, 40.4168]}
  zoom={12}
  mapOptions={{cooperativeGestures: true, maxZoom: 18}}
/>
```

Coordinates are `[longitude, latitude]`. `source` is one object, `{map, manifestUrl?}`.
`source.map` matches the config's portable ID, not a hosted `map_...` identifier. The default
manifest URL is exactly `/tileflow/manifest.json`. Set `source.manifestUrl` for a subpath or external
host; the browser does not infer bundler configuration.

Omitting `theme` uses `defaultTheme`. `system` needs an explicit light/dark mapping, which Streets
supplies. Theme changes keep the MapLibre instance, camera, and interactions, and roll back on
failure. `onThemeChange` reports transitions.

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
A map that declares colour knobs, as Streets does, also takes them by name, such as `colors={{water: '#2563eb', roads: '#9aa5b1'}}`; see [Streets' knobs](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/REFERENCE.md#streets-colour-knobs).

A colour may use CSS variables, so the map follows your design tokens: `colors={{'surface.land':
'var(--background)', 'surface.water': 'color-mix(in oklab, var(--primary) 30%, var(--background))'}}`.
The map reads each variable where it sits, with `var(--name, fallback)` and nested variables
supported, and reads them again, showing new colours only if the result changed, when the `class`,
`style`, or `data-theme` attribute of `<html>` or `<body>` changes (for example a `dark` class) and
when the system's colour-scheme preference changes. A variable with no value and no fallback is
reported through `onError` as `colors`, naming the variable.

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

`bind:this` on `TileflowMap` gives the component, which has two methods: `getMap()` returns the
MapLibre map, and `getThemeController()` returns the controller that changes the map's theme,
colours, and emphasis at run time. Both return `null` until the map has loaded, in image mode, and
after it is taken down, so call them from event handlers and from `on:load`. `TileflowMapHandle`
types the bound value.

```svelte
<script lang="ts">
  import {TileflowMap, type TileflowMapHandle} from '@tileflow/svelte';

  let map: TileflowMapHandle | undefined;
  const fly = () => map?.getMap()?.flyTo({center: [-3.7, 40.4], zoom: 12});
</script>

<TileflowMap bind:this={map} source={{map: 'madrid'}} />
```

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

`bounds` starts the map on those bounds and moves it when they change; `fitBoundsOptions` shapes the
fit with `padding`, `maxZoom` and `duration`. `fitAnnotations` fits the map to all `annotations`, with
48 pixels of padding and at most zoom 15, and again when their positions change. `bounds` takes
precedence, and `center` and `zoom` set the first view only until one of them is given.

The marker snippet receives `state`, `{hovered, focused, selected}`, where `selected` means the
marker's popup is open. A popup or tooltip snippet that no annotation or interaction can reach, because
none sets `popup` or `tooltip`, reports an `UNUSED_RENDERER` warning diagnostic.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct props win over
those options, then the manifest view, then shared defaults. `TileflowMap` always selects a Tileflow
map through its manifest; it has no renderer discriminator or direct-style mode. Tileflow's styles
are validated when they are compiled, so `validateStyle` defaults to `false`; pass `true` to
validate them again in the browser.
The map canvas is multisampled by default (`canvasContextAttributes.antialias` is `true`) so the
thin edges of 3D models stay continuous; other context attributes you pass are kept, and
`canvasContextAttributes: {antialias: false}` trades that smoothing for lower GPU cost.
The obsolete source fields `kind` and `style` are rejected. Add your own layers, sources and
controls to the MapLibre map from `getMap()`.

Attribution stays visible during map interaction. The information button opens the full credits
and links. Tileflow ignores `mapOptions.attributionControl: false` and `compact: true`.
Use `mapOptions.attributionControl.customAttribution` to add credits.

## Add sources and layers through a reference

This runtime reference API is unreleased. Use the matching local packed packages until a
compatible alpha is published.

The component reference exposes `addSource`, `removeSource`, `addLayer`, `moveLayer`, and
`removeLayer`. Each returns `Promise<void>` and waits for the map and any theme transition.
Use the worker and CSS setup above:

```svelte
<script lang="ts">
  import {TileflowRuntimeStyleError} from '@tileflow/core/browser';
  import {TileflowMap, type TileflowMapRef} from '@tileflow/svelte';

  let map: TileflowMapRef | null = null;

  async function addPoints() {
    const current = map;
    if (!current) return;
    try {
      await current.addSource('app-points', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {type: 'Point', coordinates: [-3.7038, 40.4168]},
          properties: {},
        },
      });
      await current.addLayer(
        {
          id: 'app-points',
          type: 'circle',
          source: 'app-points',
          paint: {'circle-radius': 6, 'circle-color': '#e9573f'},
        },
        {slot: 'above-labels', slotIndex: 0},
      );
    } catch (error) {
      if (error instanceof TileflowRuntimeStyleError) console.error(error.code, error.context);
      else console.error(error);
    }
  }
</script>

<TileflowMap bind:this={map} source={{map: 'madrid'}} on:load={addPoints} />
```

These resources belong to this component's map and survive theme changes and blends. Replacing
the source or unmounting the component rejects pending calls and removes its resources. Image mode
rejects these operations. The existing `load` event still carries the raw MapLibre map in `detail`.

`slotIndex` is a zero-based insertion index among application layers in the same slot; a move
excludes the moving layer from that count. Use `aboveLayerId` or `belowLayerId` instead for relative
placement within the same slot. Change the slot explicitly to cross that boundary. Remove dependent
layers with `removeLayer` before calling `removeSource`; the reference cannot remove base-map
resources. Validation failures expose `TileflowRuntimeStyleError.code` and actionable `context`.

## Add annotations and native popup UI

Install the contract types used below:

```sh
npm install @tileflow/interactions@alpha
```

This Svelte 5 component uses the worker and CSS setup above:

```svelte
<script lang="ts">
  import type {
    TileflowAnnotation,
    TileflowInteractionState,
    TileflowInteractionViewContext,
  } from '@tileflow/interactions';
  import {TileflowMap} from '@tileflow/svelte';

  const annotations = [
    {
      id: 'madrid',
      kind: 'marker',
      coordinate: [-3.7038, 40.4168],
      ariaLabel: 'Madrid',
      tooltip: {content: {kind: 'text', text: 'View Madrid'}},
      popup: {content: {kind: 'view', name: 'city-card'}},
    },
  ] satisfies readonly TileflowAnnotation[];

  let state = $state<TileflowInteractionState>({popup: null});
</script>

{#snippet popup(context: TileflowInteractionViewContext)}
  {#if context.target.kind === 'annotation'}
    <article>
      <h2>{context.target.annotation.ariaLabel}</h2>
      <button type="button" onclick={context.close}>Close</button>
    </article>
  {/if}
{/snippet}

<TileflowMap
  source={{map: 'madrid'}}
  {annotations}
  interactionState={state}
  onInteractionStateChange={(next) => (state = next)}
  onInteractionDiagnostic={(diagnostic) => console.error(diagnostic.code)}
  {popup}
/>
```

Annotations need a stable `id`, singular `coordinate`, and non-empty `ariaLabel`; optional data must
be JSON-safe. `marker` receives annotation-only context. `tooltip` and `popup` receive the shared
interaction context; narrow `target.kind` before reading annotation or semantic feature data.

Use `interactions` with `target: {kind: 'semantic-feature', domain: 'poi'}` for POIs already rendered
by the style. Optional categories use Tileflow's taxonomy, such as `food-drink` or `retail`, not raw
source classes. Semantic bindings require compatible style metadata and avoid one DOM marker per
feature. Annotation and semantic overlays share one popup state.

Controlled `interactionState` and uncontrolled `defaultInteractionState` are mutually exclusive.
Do not change ownership during the component's lifetime. Updating annotations, bindings, state, or
snippets reconciles existing runtimes rather than recreating MapLibre.

Text/field descriptors render as text. A `view` names an application snippet; it is not serialized
HTML. Keep tooltips non-interactive and put buttons, links, and forms in popups.

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

Pass plain data: `$state` proxies cannot reach MapLibre's worker, so use `$state.raw`. See the
[interactions reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/REFERENCE.md)
for heatmaps, events, and polygon drawing with Terra Draw.

## Display an existing image

`mode="image"` displays an explicit `imageUrl` or derives an image URL from the selected manifest
map's `mapId`, `apiUrl`, concrete theme and view, without loading MapLibre. It still requires a valid
Tileflow source. A local style build does not generate that image. This mode does not submit or poll
a Static Maps operation; use the server-side
[Static Maps client](https://github.com/tileflow/tileflow-sdk/blob/main/packages/static/README.md)
for new renders, keeping privileged credentials off the browser.

Annotations, semantic bindings, interaction state, and interaction snippets are interactive-only.
Untyped callers that pass them to image mode receive `UNSUPPORTED_MODE` and capture readiness
`error`, not simulated live overlays.

## Capture, authorization, and troubleshooting

Use `captureId` to disambiguate repeated maps. The root exposes `data-tileflow-map`, resolved
`data-tileflow-theme`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. Readiness includes MapLibre/image loading and committed
Svelte interaction views. Application capture needs exactly one ready target and the application's
normal loopback server.

For an error or blank map, check the manifest URL, map/theme IDs, imported CSS, and matching
worker/shared assets. The component does not guess a new manifest location after a 404.

Hosted maps acquire a short-lived session grant before eligible resource requests.
`analytics={{enabled: false}}` disables the optional beacon, not authorization. Use a stable product
`surfaceId`, not a URL or user identifier. Direct World maps can show owner-action notices when
managed delivery is required. Imports and the image path remain SSR-safe; interactive rendering
requires a browser with WebGL.

See the [interaction guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/README.md)
and [browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/README.md).
Use the installed declarations and README for release-specific behavior; `main` may be newer than npm.
