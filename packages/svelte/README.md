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

In a Vite client entry, add the following before mounting the application:

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/svelte';

configureTileflowMapLibre({workerUrl});
```

Configure once before an interactive map mounts. In SvelteKit, place client-only setup in the
application's client initialization path rather than running browser setup in a server load
function. The `?worker&url` syntax is Vite-specific. Webpack users need the
[Webpack worker recipe](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md).
The worker and shared module must match the application's installed MapLibre version.

## Render a map

```svelte
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import {TileflowMap} from '@tileflow/svelte';
</script>

<TileflowMap
  source={{kind: 'tileflow', map: 'madrid'}}
  theme="system"
  center={[-3.7038, 40.4168]}
  zoom={12}
  mapOptions={{cooperativeGestures: true, maxZoom: 18}}
/>
```

Coordinates are `[longitude, latitude]`. `source.map` matches the config's portable ID, not a hosted
`map_...` identifier. The default manifest URL is exactly `/tileflow/manifest.json`. Set
`source.manifestUrl` for a subpath or external host; the browser does not infer bundler configuration.

Omitting `theme` uses `defaultTheme`. `system` needs an explicit light/dark mapping, which Streets
supplies. Theme changes keep the MapLibre instance, camera, and interactions, and roll back on
failure. `onThemeChange` reports transitions.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct props win over
those options, then the manifest view, then shared defaults. An unmanaged source with
`{kind: 'maplibre', style: styleUrl}` loads one style without Tileflow themes or manifest identity;
do not pass a Tileflow theme with it.

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
  source={{kind: 'tileflow', map: 'madrid'}}
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

## Display an existing image

`mode="image"` displays an explicit `imageUrl` or a published manifest image without loading
MapLibre. A local style build does not generate that image. This mode does not submit or poll a
Static Maps operation; use the server-side
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
and [browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/framework-browser-runtime.md).
Use the installed declarations and README for release-specific behavior; `main` may be newer than npm.
