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

The result has a blue atmospheric rim, a dark space background, and a deterministic star field.
Stars move slightly with the camera. There is no continuous animation while the camera is still.
The space background, stars, and supplementary rim fade between zooms 3 and 6; native atmospheric
scattering fades out by zoom 7. Coordinates are longitude, then latitude.

Omit `atmosphere` to inherit it from the base map. A map without inherited atmosphere remains
unchanged. Set `atmosphere: false` to disable an inherited atmosphere. An enabled atmosphere requires
`projection: 'globe'`; validation rejects a Mercator or unspecified projection. Atmosphere options
replace the inherited object atomically rather than merging individual fields.

## Configure appearance

Use an object instead of `true` to override defaults:

| Option          | Default   | Meaning                                                 |
| --------------- | --------- | ------------------------------------------------------- |
| `skyColor`      | `#07152b` | Near-space sky color                                    |
| `horizonColor`  | `#83b9f4` | Horizon and supplementary rim color                     |
| `fogColor`      | `#bad2eb` | Native atmospheric fog color                            |
| `spaceColor`    | `#030916` | Outer space background color                            |
| `starIntensity` | `0.6`     | Brightness from 0 to 1; 0 hides stars                   |
| `starParallax`  | `0.4`     | Camera-relative motion from 0 to 1; 0 keeps stars still |

Colors follow the usual theme contract: use `token.color(...)`, color operations, or
`fixed(color, {reason})`. They must resolve to opaque colors. Compilation normalizes them to
six-digit hexadecimal values in the runtime metadata. Numeric options must be finite and within
0–1. Unknown properties are rejected. For example, this fragment belongs inside `defineMap(...)`
and uses `fixed` imported from `@tileflow/core`:

```ts
atmosphere: {
  horizonColor: fixed('#83b9f4', {reason: 'Earth atmosphere stays blue across map themes'}),
  starIntensity: 0.5,
  starParallax: 0.25,
},
```

The browser's reduced-motion preference overrides parallax while keeping the sky and stars visible.
No additional image, font, API key, or network request is needed for the effect.

## Browser integration

The compiler emits MapLibre `sky` and versioned `metadata['tileflow:atmosphere']` in every concrete
style. React, Vue, Svelte, and standalone browser capture attach the shared atmosphere runtime.
Theme changes update the effect from the newly loaded style. Loading a style without atmosphere
removes the decoration.

When constructing a MapLibre map directly, call `attachTileflowAtmosphere(map)` from
`@tileflow/core/browser` after constructing the map. Keep its returned cleanup function and call it
before removing the map; the map's `remove` event also disposes it. The helper creates its own
noninteractive, accessibility-hidden canvas inside the map container. It does not create a map,
change the camera, or add controls. Preserve the renderer's transparent canvas and standard
MapLibre CSS so space can show around the globe.

Importing the browser entry is safe during server rendering. Call the attachment only in the
browser, after mounting. Raw MapLibre consumers that do not attach the helper display the compiled
native atmosphere but do not receive Tileflow's stars or space background.

The native artifact profile does not support globe atmosphere and rejects `sky`. This browser
capability does not establish React Native or hosted Static Maps support. Public availability is
established by the installed package version, not by this repository's main branch.
