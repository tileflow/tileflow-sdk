# @tileflow/react

React components for rendering Tileflow maps with MapLibre.

Install `maplibre-gl` alongside the package and import its CSS once in your app.

```tsx
import {Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function App() {
  return (
    <Map
      source={{kind: 'tileflow', map: 'madrid'}}
      theme="system"
      center={[-3.7038, 40.4168]}
      zoom={12}
      mapOptions={{
        cooperativeGestures: true,
        maxZoom: 18,
      }}
    />
  );
}
```

## Annotations, tooltips, and popups

Use `annotations` for small application-owned marker sets. Annotation data is serializable, while
`renderMarker`, `renderTooltip`, and `renderPopup` render native React UI through portals into the
MapLibre-owned marker and overlay hosts.

```tsx
import {Map} from '@tileflow/react';
import {useState} from 'react';
import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';

type Property = {
  price: number;
  title: string;
};

const annotations = [
  {
    ariaLabel: 'Apartment in Madrid',
    coordinate: [-3.7038, 40.4168],
    data: {price: 320_000, title: 'Apartment in Madrid'},
    id: 'property-42',
    kind: 'marker',
    marker: {content: {kind: 'field', field: 'price'}},
    tooltip: {content: {kind: 'field', field: 'title'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation<Property>[];

export function PropertyMap() {
  const [interactionState, setInteractionState] = useState<TileflowInteractionState>({popup: null});

  return (
    <Map
      source={{kind: 'tileflow', map: 'madrid'}}
      annotations={annotations}
      interactionState={interactionState}
      onInteractionStateChange={setInteractionState}
      onInteractionDiagnostic={(diagnostic) => console.error(diagnostic)}
      onInteractionEvent={(event) => console.log(event.type, event.target)}
      renderMarker={({annotation}) => <strong>EUR {annotation.data.price.toLocaleString()}</strong>}
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

Omit `interactionState` and use `defaultInteractionState` for uncontrolled popup state. Callback and
renderer identity changes, annotation updates, and popup state changes do not recreate the MapLibre
map. Updating an annotation with the same ID preserves its compatible Marker instance and portal
host.

`renderMarker` is always annotation-only. Without `interactions`, `renderTooltip` and `renderPopup`
also infer the annotation-specific context, including typed `annotation.data`. When `interactions`
is present, they receive the common `TileflowInteractionViewContext`; narrow `context.target.kind`
(or check `annotation in context`) when one renderer serves both annotation and semantic targets.

## Semantic POI interactions

Use `interactions` to attach tooltip or popup behavior to POIs already rendered by a finalized
Tileflow style. Application code names the `poi` domain, never compiler-generated MapLibre layer
IDs. The runtime queries only manifest-declared layers and mounts DOM only for the active overlay.

```tsx
import {Map} from '@tileflow/react';
import type {TileflowInteractionBinding} from '@tileflow/interactions';

const interactions = [
  {
    id: 'poi-details',
    target: {kind: 'semantic-feature', domain: 'poi', categories: ['food-drink', 'retail']},
    tooltip: {content: {kind: 'field', field: 'name', fallback: 'Point of interest'}},
    popup: {content: {kind: 'view', name: 'poi-card'}},
  },
] satisfies readonly TileflowInteractionBinding[];

export function PoiMap() {
  return (
    <Map
      source={{kind: 'tileflow', map: 'madrid'}}
      interactions={interactions}
      renderPopup={(context) =>
        context.target.kind === 'semantic-feature' ? (
          <article>
            <h2>{String(context.target.feature.properties.name ?? 'Point of interest')}</h2>
            <button type="button" onClick={context.close}>
              Close
            </button>
          </article>
        ) : null
      }
    />
  );
}
```

Bindings and popup state are validated before reconciliation. An invalid replacement leaves the
last valid runtime state active and reports structured diagnostics. `interactionState` and
`defaultInteractionState` are mutually exclusive. Annotation and semantic overlays share one popup
state, so replacing either target closes the previous popup before opening the next.

`MapProps` rejects controlled and default interaction state together. Its `mode="image"` branch
excludes annotations, semantic bindings, interaction state, renderers, and interaction callbacks.
JavaScript callers and widened inputs still receive the corresponding runtime diagnostics.

`onInteractionDiagnostic` receives each newly reported structured runtime diagnostic. Changing any
callback identity does not resubscribe the runtime or recreate MapLibre.

Custom portal targets move capture readiness to `loading` until React commits the target and two
current animation frames complete. Removing or replacing a target invalidates pending frames.

When no render prop is present, text and safe field descriptors use the shared unbranded DOM
defaults. A `view` descriptor is a dispatch name for an application renderer; it is not HTML or a
serialized component tree. Tooltip content remains non-interactive, while popup content may contain
normal React controls.

`annotations` is the only application-owned marker input. Its singular `coordinate`, required
`ariaLabel`, and optional `marker` descriptor feed the keyed runtime directly. `mode="image"`
cannot render interaction configuration and shows an explicit `UNSUPPORTED_MODE` diagnostic
without loading MapLibre.

`mapOptions` accepts native MapLibre options except `container` and `style`, which
Tileflow resolves from `source`. Direct
Tileflow props such as `center`, `zoom`, and `interactive` take priority when
provided. Camera resolution is the same in interactive and image modes: direct props, then
`mapOptions`, then the published manifest view, then Tileflow's shared runtime defaults.

Every map has exactly one discriminated `source`. Use `kind: 'tileflow'` for a map published in a
Tileflow manifest. `kind: 'maplibre'` is the unmanaged MapLibre escape hatch for one direct style
object or URL: it deliberately has no Tileflow theme identity, `system` selection, switching, or
manifest traceability. Browser components do not compile `tileflow.config.ts`.

Without `manifestUrl`, the exact default is `/tileflow/manifest.json`. If Vite, Webpack, Next, a
reverse proxy, or the Tileflow plugin publishes it anywhere else, set the final public URL
explicitly; the component does not attempt runtime base-path discovery. Manifest 404s, unknown map
IDs, unresolved styles, and unresolved image URLs enter `data-tileflow-state="error"`.

`theme` selects a published theme name. Omitting it uses the map's `defaultTheme`; `"system"` is
available only when the map declares explicit light and dark mappings. Changes preload fonts, diff
the style on the existing MapLibre instance, preserve camera and interactions, and roll back if the
new style fails. `onThemeChange` reports preloading, applying, ready, and error transitions.

To reuse one published map across multiple repos, point every app at the same
manifest:

```tsx
<Map
  source={{
    kind: 'tileflow',
    map: 'madrid',
    manifestUrl: 'https://cdn.example.com/tileflow/manifest.json',
  }}
/>
```

Or deliberately leave the Tileflow theme contract and load one concrete Style JSON directly:

```tsx
<Map
  source={{
    kind: 'maplibre',
    style: 'https://cdn.example.com/tileflow/styles/madrid/dark.json',
  }}
/>
```

For a lightweight display of an already hosted static image, use image mode:

```tsx
<Map
  source={{kind: 'tileflow', map: 'madrid'}}
  mode="image"
  center={[-3.7038, 40.4168]}
  zoom={12}
/>
```

`Map mode="image"` only resolves an existing image URL (explicitly or from the published map
manifest) and renders an `<img>`; it does not submit a render scene, create an operation, poll, or
apply `StaticMap` overlays. This path does not load or evaluate MapLibre. Without an explicit
`imageUrl`, all environments use the image URL published for the Tileflow source.

For a new, fully specified render with exact size, center/bounds camera, overlays, idempotency, and
asynchronous create/poll behavior, use `StaticMap` from `@tileflow/react/static` or helpers from
`@tileflow/static`.

```tsx
import {StaticMap} from '@tileflow/react/static';
import {useState} from 'react';
import {createStaticMapIdempotencyKey} from '@tileflow/static';

export function Preview() {
  const [idempotencyKey] = useState(createStaticMapIdempotencyKey);

  return (
    <StaticMap
      map="madrid"
      camera={{type: 'center', center: [-3.7038, 40.4168], zoom: 12}}
      attribution={{mode: 'external'}}
      size={{width: 1200, height: 800}}
      createUrl="/api/static-maps"
      idempotencyKey={idempotencyKey}
      onReady={(result) => {
        if (result.resultVersion === 2) showAttribution(result.attribution.entries);
      }}
    />
  );
}
```

`idempotencyKey` is required in create mode. Keep one key for one intentional create action and
reuse it across retries and remounts. Concurrent React consumers share work only when URL,
normalized scene, and idempotency key all identify the same operation; unmounting the final
consumer aborts its in-flight request.

`StaticMap` forwards `attribution` as part of the normalized scene and request identity. Omission
uses embedded automatic placement. With `mode: 'external'`, the component still renders the image,
but the application must render every structured `onReady` attribution entry beside it. Existing
`imageUrl` mode has no operation result and cannot infer attribution from an immutable image URL.

Hosted interactive maps automatically preflight a short-lived commercial session grant before
eligible resources. Setting `analytics={{enabled: false}}` disables the optional beacon only; it
does not remove hosted authorization or override a user `mapOptions.transformRequest` callback.
Use `analytics={{surfaceId: 'store-locator'}}` when the same Map is embedded in several stable
product locations. Missing or invalid Surface IDs become `default`; do not use URLs, branches,
random instance IDs, or user IDs.
Direct Tileflow World maps keep early `GRACE` silent, show a compact accessible owner-action pill
when late `GRACE` is activated, and show a stronger banner in `MANAGED_REQUIRED`. Missing tiles and
MapLibre failures do not remove that recovery path.

## Headless capture readiness

Use `captureId` to disambiguate multiple maps with the same configured name:

```tsx
<Map source={{kind: 'tileflow', map: 'madrid'}} captureId="checkout-map" />
```

The root element exposes `data-tileflow-map`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. Interactive mode becomes idle after MapLibre is idle
and two animation frames; style/data work returns it to loading. Image mode waits for decode or a
successful load fallback, including cached hydration. `tileflow capture` uses these markers for
application scenes and requires exactly one target.

## Compatibility

The supported peer window is React 18-19 and MapLibre GL JS 5-6. Compatibility smoke tests install
the exact lower bound and the first release of every accepted major from packed Tileflow tarballs,
typecheck a consumer, and render the image/SSR path while rejecting any MapLibre import. Future
majors stay outside the peer range until that matrix passes.

Docs: https://tileflow.dev/docs
