# @tileflow/react

React components for interactive Tileflow maps, annotations, and static-image display.
Interactive maps use MapLibre GL JS; browser components read prepared assets rather than compiling
`tileflow.config.ts`.

## Install

Use an existing React 18 or 19 application with matching `react-dom`. The following local build
workflow needs Node.js 22 or newer:

```sh
npm install @tileflow/react@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
npm install --save-dev --save-exact tileflow@alpha
```

The supported peer ranges are React/React DOM 18–19 and MapLibre GL JS `>=6.4.1 <7`. The worker
must come from the same MapLibre installation as the main module.

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
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/react';

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
import 'maplibre-gl/dist/maplibre-gl.css';
import {Map} from '@tileflow/react';

export function App() {
  return (
    <Map
      source={{kind: 'tileflow', map: 'madrid'}}
      theme="system"
      center={[-3.7038, 40.4168]}
      zoom={12}
      mapOptions={{cooperativeGestures: true, maxZoom: 18}}
    />
  );
}
```

Coordinates are `[longitude, latitude]`. `source.map` must match the config's portable map ID,
not a hosted `map_...` identifier. The default manifest URL is exactly `/tileflow/manifest.json`.
For a subpath or external host, provide `manifestUrl` in the source; the component does not infer
bundler configuration or search for assets.

`theme` selects a published concrete theme. Omission uses `defaultTheme`; `system` requires an
explicit light/dark mapping, which Streets supplies. Theme changes preserve the MapLibre instance,
camera, and interactions, and roll back on failure. `onThemeChange` reports transitions.

`mapOptions` accepts native MapLibre options except `container` and `style`. Direct camera props
take priority over `mapOptions`, then the manifest view, then shared defaults. To load one unmanaged
style, use `source={{kind: 'maplibre', style: styleUrl}}`; that source has no Tileflow theme switching
or manifest identity. Do not supply a Tileflow theme with an unmanaged source.

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
import {useState} from 'react';
import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';
import {Map} from '@tileflow/react';

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
      source={{kind: 'tileflow', map: 'madrid'}}
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

Text/field content uses safe text defaults. A `view` is an application renderer name, not HTML.
Keep tooltips non-interactive; put buttons, links, and forms in popups.

## Display an image or create a render

`<Map mode="image">` displays an existing explicit `imageUrl` or an image URL in the published
manifest. It does not create a static render, poll an operation, or load MapLibre. A local style
build alone does not create that image. Annotations, semantic bindings, and interaction state are
not supported in image mode.

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
import {useState} from 'react';
import {StaticMap} from '@tileflow/react/static';
import type {StaticMapAttributionEntry} from '@tileflow/static';

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
