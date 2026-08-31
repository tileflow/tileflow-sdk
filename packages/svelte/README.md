# @tileflow/svelte

Svelte component for rendering Tileflow maps with MapLibre.

Install `maplibre-gl` alongside the package and import its CSS once in your app.

```svelte
<script lang="ts">
  import {TileflowMap} from '@tileflow/svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
</script>

<TileflowMap
  source={{kind: 'tileflow', map: 'madrid'}}
  theme="system"
  center={[-3.7038, 40.4168]}
  zoom={12}
  mapOptions={{
    cooperativeGestures: true,
    maxZoom: 18,
  }}
/>
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

`theme` selects a published theme name. Omission uses `defaultTheme`; `"system"` requires the map's
explicit light/dark mapping. Switching preserves the MapLibre instance, camera, and interactions,
and rolls back a failed style. `onThemeChange` receives transition state.

```svelte
<TileflowMap
  source={{
    kind: 'tileflow',
    map: 'madrid',
    manifestUrl: 'https://cdn.example.com/tileflow/manifest.json',
  }}
/>

<TileflowMap
  source={{
    kind: 'maplibre',
    style: 'https://cdn.example.com/tileflow/styles/madrid/dark.json',
  }}
/>
```

`mode="image"` resolves an explicit or published image URL and renders an `<img>` without loading
or evaluating MapLibre. All environments follow the same published manifest contract.

Hosted maps automatically preflight a short-lived commercial session grant before eligible
resources. Setting `analytics={{enabled: false}}` disables the optional beacon only; it does not
remove hosted authorization or override a user `mapOptions.transformRequest` callback.
Use `analytics={{surfaceId: 'store-locator'}}` when the same Map is embedded in several stable
product locations. Missing or invalid Surface IDs become `default`; do not use URLs, branches,
random instance IDs, or user IDs.
Direct Tileflow World maps keep early `GRACE` silent, show a compact accessible owner-action pill
when late `GRACE` is activated, and show a stronger banner in `MANAGED_REQUIRED`. Missing tiles and
MapLibre failures do not remove that recovery path.

## Annotations and overlays

Use `annotations` for keyed markers with optional tooltips and popups. Tileflow supplies accessible,
text-only defaults; Svelte snippets can replace any surface and are mounted into the DOM containers
owned by the shared MapLibre interaction runtime.

```svelte
<script lang="ts">
  import {TileflowMap} from '@tileflow/svelte';
  import type {
    TileflowAnnotation,
    TileflowInteractionBinding,
    TileflowInteractionState,
  } from '@tileflow/interactions';

  const annotations: TileflowAnnotation[] = [
    {
      ariaLabel: 'Madrid',
      coordinate: [-3.7038, 40.4168],
      id: 'madrid',
      kind: 'marker',
      marker: {content: {kind: 'text', text: 'Madrid'}},
      popup: {content: {kind: 'view', name: 'city-card'}},
      tooltip: {content: {kind: 'text', text: 'Open Madrid'}},
    },
  ];

  const interactions: TileflowInteractionBinding[] = [
    {
      id: 'poi-details',
      popup: {content: {kind: 'view', name: 'poi-card'}},
      target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
      tooltip: {content: {field: 'name', fallback: 'Restaurant', kind: 'field'}},
    },
  ];

  let interactionState: TileflowInteractionState = {popup: null};
</script>

{#snippet marker(context)}
  <span>{context.annotation.ariaLabel}</span>
{/snippet}

{#snippet tooltip(context)}
  {#if context.target.kind === 'annotation'}
    <span>{context.target.annotation.ariaLabel}</span>
  {:else}
    <span>Point of interest</span>
  {/if}
{/snippet}

{#snippet popup(context)}
  <article>
    {#if context.target.kind === 'annotation'}
      <h2>{context.target.annotation.ariaLabel}</h2>
    {:else if context.target.kind === 'semantic-feature'}
      <h2>POI details</h2>
    {/if}
    <button type="button" onclick={context.close}>Close</button>
  </article>
{/snippet}

<TileflowMap
  source={{kind: 'tileflow', map: 'madrid'}}
  {annotations}
  {interactions}
  {interactionState}
  onInteractionStateChange={(next) => (interactionState = next)}
  onInteractionEvent={(event) => console.log(event.type)}
  onInteractionDiagnostic={(diagnostic) => console.error(diagnostic)}
  {marker}
  {tooltip}
  {popup}
/>
```

`annotations` is the only application-owned marker input. Controlled `interactionState` and
uncontrolled `defaultInteractionState` are mutually exclusive. `interactions` binds tooltips and
popups to semantic POIs exposed by the compiled style metadata; applications select the stable
`poi` domain and optional categories rather than physical style-layer IDs.

Snippet callbacks are read at the time an interaction occurs, and adding or removing a snippet
switches between custom and default rendering without recreating the map or its keyed markers.
`marker` receives the annotation-only context. `tooltip` and `popup` receive the general interaction
context and therefore handle both annotation and semantic-feature targets. Each context includes
resolved content, the target, optional view name, and `close()`.

Both runtimes are controlled by one interaction-state coordinator. Replacing an annotation popup
with a POI popup (or the reverse) closes the previous owner before opening the next one, so event
order remains `popup:close` followed by `popup:open`.

Annotations and semantic interactions are interactive-only. The TypeScript API excludes
annotations, interactions, interaction state, snippets, and interaction callbacks from the
`mode="image"` branch. Untyped JavaScript that supplies them still receives an
`UNSUPPORTED_MODE` diagnostic and capture readiness `error`, rather than pretending the static image
contains live overlays.

## Headless capture readiness

Use `captureId` to disambiguate repeated named maps:

```svelte
<TileflowMap source={{kind: 'tileflow', map: 'madrid'}} captureId="checkout-map" />
```

The root exposes `data-tileflow-map`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. It becomes idle only after MapLibre idle plus two
animation frames and, for custom interaction snippets, the Svelte DOM commit plus two current
animation frames. It returns to loading when either surface changes and marks map or interaction
errors. In image mode, readiness follows image decode/load when no interaction configuration is
present. Application capture selects exactly one ready target.

## Compatibility

The supported peer window is Svelte 5.x and MapLibre GL JS 5-6. Compatibility smoke tests install
Svelte 5.0.0 with the first release of both MapLibre majors from packed Tileflow tarballs, typecheck
the public declarations, and compile real Svelte consumers. Future Svelte majors stay outside the
peer range until that matrix passes.

Docs: https://tileflow.dev/docs
