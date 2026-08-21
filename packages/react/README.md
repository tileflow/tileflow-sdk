# @tileflow/react

React components for rendering Tileflow maps with MapLibre.

Install `maplibre-gl` alongside the package and import its CSS once in your app.

```tsx
import {Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function App() {
  return (
    <Map
      map="madrid"
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

`mapOptions` accepts native MapLibre options except `container` and `style`, which
Tileflow resolves from the map name, manifest, or explicit style props. Direct
Tileflow props such as `center`, `zoom`, and `interactive` take priority when
provided.

Choose one style source: `config`, `style`, `styleUrl`, or a named `map`. A map name may accompany
`style` or `styleUrl` as the stable map/capture identity, and `styleBaseUrl` requires `map`.
`config` cannot be combined with those other sources; invalid combinations throw instead of being
silently ignored. `themes` is only meaningful with `config`.

To reuse one published map across multiple repos, point every app at the same
manifest:

```tsx
<Map map="madrid" manifestUrl="https://cdn.example.com/tileflow/manifest.json" />
```

Or bypass the manifest and load a hosted style directly:

```tsx
<Map styleUrl="https://api.tileflow.dev/maps/map_1234567890abcdef/style.json" />
```

For a lightweight display of an already hosted static image, use image mode:

```tsx
<Map map="madrid" mode="image" center={[-3.7038, 40.4168]} zoom={12} />
```

`Map mode="image"` only resolves an existing image URL (explicitly or from the published map
manifest) and renders an `<img>`; it does not submit a render scene, create an operation, poll, or
apply `StaticMap` overlays. When it does not include an explicit `imageUrl`, local development hosts
render the interactive map while `preferLocalDev` is enabled. Production hosts render the deployed
static image. Set `preferLocalDev={false}` to preview the production image behavior locally.

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
      size={{width: 1200, height: 800}}
      createUrl="/api/static-maps"
      idempotencyKey={idempotencyKey}
    />
  );
}
```

`idempotencyKey` is required in create mode. Keep one key for one intentional create action and
reuse it across retries and remounts. Concurrent React consumers share work only when URL,
normalized scene, and idempotency key all identify the same operation; unmounting the final
consumer aborts its in-flight request.

Hosted interactive maps automatically preflight a short-lived commercial session grant before
eligible resources. Setting `analytics={{enabled: false}}` disables the optional beacon only; it
does not remove hosted authorization or override a user `mapOptions.transformRequest` callback.

## Headless capture readiness

Use `captureId` to disambiguate multiple maps with the same configured name:

```tsx
<Map map="madrid" captureId="checkout-map" />
```

The root element exposes `data-tileflow-map`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. Interactive mode becomes idle after MapLibre is idle
and two animation frames; style/data work returns it to loading. Image mode waits for decode or a
successful load fallback, including cached hydration. `tileflow capture` uses these markers for
application scenes and requires exactly one target.

Docs: https://tileflow.dev/docs
