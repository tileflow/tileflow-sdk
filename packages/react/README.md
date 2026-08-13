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

To reuse one published map across multiple repos, point every app at the same
manifest:

```tsx
<Map map="madrid" manifestUrl="https://cdn.example.com/tileflow/manifest.json" />
```

Or bypass the manifest and load a hosted style directly:

```tsx
<Map styleUrl="https://api.tileflow.dev/v1/styles/acme/madrid.json" />
```

For simple hosted static images, use image mode:

```tsx
<Map map="madrid" mode="image" center={[-3.7038, 40.4168]} zoom={12} />
```

When `mode="image"` does not include an explicit `imageUrl`, local development
hosts render the interactive map while `preferLocalDev` is enabled. Production
hosts render the deployed static image. Set `preferLocalDev={false}` to preview
the production image behavior locally.

For full static scenes with bounds, overlays, and server-side precache, use
`StaticMap` from `@tileflow/react/static` or helpers from `@tileflow/static`.

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
