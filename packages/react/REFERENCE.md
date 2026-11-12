# React reference

Attribution stays visible during map interaction. The information button opens the full credits
and links. Tileflow ignores `mapOptions.attributionControl: false` and `compact: true`.
Use `mapOptions.attributionControl.customAttribution` to add credits.

## Runtime sources and layers

The unreleased `TileflowMapRef` extends `TileflowMapHandle` with asynchronous source/layer edits.
They survive theme changes; replacement and disposal cancel pending work. See
[methods, placement and errors](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/REFERENCE.md#runtime-sources-and-layers).

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
