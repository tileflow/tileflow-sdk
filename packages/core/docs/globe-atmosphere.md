# Globe atmosphere

Enable atmosphere in the map exported by `tileflow.config.ts`. Install `@tileflow/core` and
`@tileflow/maps` and use a browser adapter from the same compatible SDK release. The example
extends the complete Streets map, including its data and text resources.

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'earth',
  version: 1,
  extends: streets,
  projection: 'globe',
  atmosphere: true,
  view: {center: [2.3522, 48.8566], zoom: 2},
});
```

The result has a pale white rim with a soft blue halo, a muted blue-gray space background, and a
deterministic field of 1,100 stars per repeating 1,600 × 1,000 CSS-pixel area. The halo follows the
globe's contour without brightening its surface or adding glow to labels. Stars have a minimum
radius of 0.6 CSS pixels so the fainter stars remain visible on high-density screens.
Stars move slightly with the camera. There is no continuous animation while the camera is still.
The space background, stars, and rim fade between zooms 3 and 6. Native sun scattering is disabled
when `atmosphere` is enabled, including maps that also declare `sky`. Coordinates are longitude,
then latitude.

Omit `atmosphere` to inherit it from the base map. A map without inherited atmosphere remains
unchanged. Set `atmosphere: false` to disable an inherited atmosphere. An enabled atmosphere requires
`projection: 'globe'`; validation rejects a Mercator or unspecified projection. Atmosphere options
replace the inherited object atomically rather than merging individual fields.

## Configure appearance

Use an object instead of `true` to override defaults:

| Option          | Default   | Meaning                                                        |
| --------------- | --------- | -------------------------------------------------------------- |
| `skyColor`      | `#263b50` | Near-space sky color                                           |
| `horizonColor`  | `#b6cfe2` | Horizon and outer halo color                                   |
| `fogColor`      | `#d4e1ec` | Native atmospheric fog color                                   |
| `spaceColor`    | `#142233` | Outer space background color                                   |
| `starColor`     | `#e0ebff` | Star color                                                     |
| `starCount`     | `1100`    | Stars per repeating 1600 × 1000 CSS-pixel area; integer 0–4096 |
| `starSize`      | `1`       | Radius multiplier from 0 to 4; 0 hides stars                   |
| `starIntensity` | `0.6`     | Brightness from 0 to 1; 0 hides stars                          |
| `starParallax`  | `0.4`     | Camera-relative motion from 0 to 1; 0 keeps stars still        |

Colors follow the usual theme contract: use `token.color(...)`, color operations, or
`fixed(color, {reason})`. They must resolve to opaque colors. Compilation normalizes them to
six-digit hexadecimal values in the runtime metadata. Numeric options must be finite and within
the ranges above. `starCount` controls density rather than the total visible count: the field
repeats on larger viewports. `starSize` scales both the stars and their glow; changing density
preserves the positions of existing stars. Unknown properties are rejected. For example, this fragment belongs inside `defineMap(...)`
and uses `fixed` imported from `@tileflow/core`:

```ts
atmosphere: {
  horizonColor: fixed('#b6cfe2', {reason: 'Earth atmosphere stays blue across map themes'}),
  starCount: 650,
  starSize: 0.8,
  starColor: fixed('#e0ebff', {reason: 'Cool stars across map themes'}),
  starIntensity: 0.5,
  starParallax: 0.25,
},
```

The browser's reduced-motion preference overrides parallax while keeping the sky and stars visible.
No additional image, font, API key, or network request is needed for the effect.

## Browser integration

The compiler emits MapLibre `sky` and versioned `metadata['tileflow:atmosphere']` in every concrete
style. React, Vue, Svelte, Inspector, and standalone browser capture attach the shared atmosphere
runtime. Metadata version 2 includes star appearance; the runtime also reads version 1 with
the established star defaults. Use matching compiler and browser packages for new styles.
Theme changes update the effect from the newly loaded style. Loading a style without atmosphere
removes the decoration.

When constructing a MapLibre map directly, call `attachTileflowAtmosphere(map)` from
`@tileflow/core/browser` after constructing the map. Keep its returned cleanup function and call it
before removing the map; the map's `remove` event also disposes it. The helper creates its own
noninteractive, accessibility-hidden canvases for the stars and halo behind the map. A custom layer
reads the globe projection; the halo stays outside theme snapshots, preserving its appearance
through time-of-day transitions. It does not create a map, change the camera, filter the map canvas,
or add controls.
Preserve the renderer's transparent canvas and standard
MapLibre CSS so space can show around the globe.

For a camera-driven presentation, the optional second argument can adjust star speed and direction:
`attachTileflowAtmosphere(map, {starParallaxScale: -5})` moves stars five times as fast in the
opposite direction. The multiplier must be finite; it defaults to `1`, and `0` freezes the stars.
This runtime option does not change the compiled style or animate a stationary map. Reduced motion
still disables star movement, and stopping the camera also stops the stars.
Use the map's `starParallax` for its authored appearance; reserve `starParallaxScale` for the
embedding application's camera presentation. The effective motion multiplies both values, so a
map declaring `starParallax: 0` remains stationary under any runtime multiplier. Inspector preview
uses the shared atmosphere helper with its default multiplier, just like the framework adapters.

Importing the browser entry is safe during server rendering. Call the attachment only in the
browser, after mounting. Raw MapLibre consumers must attach the helper to display the globe halo,
stars, and space background. The compiled sky alone does not include these effects.

A map that also declares a [street sky](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/street-sky.md)
uses the sky's colors for MapLibre's `sky`; the atmosphere keeps its halo, space background and stars.

The native artifact profile does not support globe atmosphere and rejects `sky`. This browser
capability does not establish React Native or hosted Static Maps support. Public availability is
established by the installed package version, not by this repository's main branch.
