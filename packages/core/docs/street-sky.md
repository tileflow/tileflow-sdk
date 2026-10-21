# Street sky

A map's `sky` paints the sky above the horizon when the camera tilts up the street, in either
projection: blue by day, warm at dusk, dark with stars at night. Install `@tileflow/core` and
`@tileflow/maps` and use a browser adapter from the same compatible SDK release. Streets declares a
sky in every theme; the example extends it and keeps its sky.

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'street-level',
  version: 1,
  extends: streets,
  view: {center: [-3.6904, 40.4493], zoom: 17, bearing: 8, pitch: 80},
});
```

The view looks north along Paseo de la Castellana in Madrid, with the sky above the skyline.
Coordinates are longitude, then latitude.

## Camera pitch

React, Vue, Svelte, the Dev preview, and browser capture create maps with a maximum pitch of 85
degrees, `tileflowMaxPitch`, instead of MapLibre's default of 60. Every portable view already admits
pitch 0–85. Pass `mapOptions: {maxPitch}` to lower the limit for one map. A map constructed directly
with MapLibre keeps MapLibre's default unless it sets `maxPitch: tileflowMaxPitch` itself.

The React Native surface still uses the native engines' 60-degree limit.

## Configure the sky

`sky: true` uses the defaults. An options object replaces an inherited sky atomically, and
`sky: false` removes it.

| Option          | Default   | Meaning                                                           |
| --------------- | --------- | ----------------------------------------------------------------- |
| `color`         | `#5c9ce6` | The sky overhead                                                  |
| `horizonColor`  | `#dcebf7` | The pale band along the horizon, also 3D terrain's distance fog   |
| `horizonBlend`  | `0.6`     | How far up the band reaches, as a share of half the view's height |
| `starIntensity` | `0.6`     | The brightest the stars shine, from 0 (none) to 1                 |

Colors take `token.color(...)`, color operations, or `fixed(color, {reason})`, and must resolve to
opaque colors. Numbers take `token.number(...)`, `fixed(number, {reason})`, or a number, and must
resolve to 0–1. Unknown properties are rejected. Because tokens resolve per theme, one declaration
gives each theme its own sky. Streets uses its themes' `sky.color`, `sky.horizon`, and
`sky.horizonBlend` tokens:

```ts
sky: {
  color: token.color('sky.color'),
  horizonColor: token.color('sky.horizon'),
  horizonBlend: token.number('sky.horizonBlend'),
  starIntensity: 0.6,
},
```

A map that replaces Streets' themes supplies those tokens or declares its own `sky`.

## Stars

Stars come out as the sky darkens: a night sky shows them, a day or dusk sky does not, and a
time-of-day blend into night brings them in with the dark. They sit on a fixed dome, so they turn
with the camera's bearing and pitch but not with its position. The stars draw beneath every map
layer and only where nothing else has drawn, so buildings and trees hide the stars behind them.
With 3D terrain enabled, the stars are not drawn.

## Browser integration

The compiler emits MapLibre `sky` in every concrete style and, when the stars are on, versioned
`metadata['tileflow:sky']`. MapLibre draws the sky itself, so raw MapLibre consumers see it. On a
globe, the sky blends into MapLibre's atmosphere at world zooms; when a map also declares
`atmosphere`, the sky's colors replace the atmosphere's sky colors while its space background and
globe stars stay.

React, Vue, Svelte, and standalone browser capture draw the stars through
`attachTileflowAtmosphere(map)`. A direct MapLibre integration calls that function, or
`attachTileflowSkyStars(map)` from `@tileflow/core/browser` for the stars alone, after constructing
the map; each returns a cleanup function. The stars use the custom layer `tileflow-sky-stars` at
the bottom of the layer stack.

MapLibre applies its fog only to 3D terrain, so flat layers and 3D buildings stay sharp up to the
horizon. Native artifacts remove the sky during preparation and record the removal; see the
[native artifact profile](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md).
