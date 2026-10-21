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
| `glowColor`     | `#ffc68a` | The light round a low sun, which glows on the horizon towards it  |
| `starIntensity` | `0.6`     | The brightest the stars shine, from 0 (none) to 1                 |

Colors take `token.color(...)`, color operations, or `fixed(color, {reason})`, and must resolve to
opaque colors. Numbers take `token.number(...)`, `fixed(number, {reason})`, or a number, and must
resolve to 0–1. Unknown properties are rejected. Because tokens resolve per theme, one declaration
gives each theme its own sky. Streets uses its themes' `sky.color`, `sky.horizon`,
`sky.horizonBlend`, and `sky.glow` tokens:

```ts
sky: {
  color: token.color('sky.color'),
  horizonColor: token.color('sky.horizon'),
  horizonBlend: token.number('sky.horizonBlend'),
  glowColor: token.color('sky.glow'),
  starIntensity: 0.6,
},
```

A map that replaces Streets' themes supplies those tokens or declares its own `sky`.

## A sky that follows the sun

When an application places the sun with the theme controller's `setSun`, by direction or by the
real sun of a date and place, the sky follows its height continuously instead of staying on the
theme's preset. Above about 14 degrees the sky is the day theme's; it warms into the dawn or dusk
theme's sky as the sun nears the horizon, using dawn while the sun stands in the eastern half of
the sky and dusk in the western half; it holds that sky within two degrees of sunrise or sunset,
and it darkens into the night theme's sky as twilight ends, about ten degrees below the horizon.
The themes come from the map's `timeOfDay` family of the theme on screen, and every colour is
resolved from that theme's own tokens, so a Monochrome family stays grey and a client's own
family keeps its palette. A family with only one twilight uses it at both ends of the day; a theme
outside a family, or a family without a day and a night theme, keeps its own sky.
`setSun(undefined)` returns the sky to the themes. The map's colours on the ground stay those of
the theme or blend on screen; pair `setSun` with `setBlend` to move them too. See
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md).

<!-- docs:check -->

```ts
import type {TileflowThemeController} from '@tileflow/core/browser';

export function sunsetOverMadrid(controller: TileflowThemeController) {
  // 19:15 in Madrid on 21 October 2026: the sun stands 1.5 degrees above the western horizon.
  return controller.setSun({date: Date.UTC(2026, 9, 21, 17, 15), location: [-3.69, 40.45]});
}
```

## Glow, sun and stars

A low sun glows on the horizon towards it, in the theme's `glowColor` or, for a sun an application
placed, in the glow of its hour. The glow is strongest as the sun touches the horizon, fades by
mid-morning, and is gone once the sun is about nine degrees below. While the sun is low and above
the horizon, its disc shows too. The sun is the one the theme controller shows, so its
disc stands where the 3D scene's shadows say it is; without a controller, the theme's own sun.

Stars come out as the sky darkens: a night sky shows them, a day or dusk sky does not, and a
time-of-day blend or a placed sun moving into night brings them in with the dark. They sit on a
fixed dome, so they turn with the camera's bearing and pitch but not with its position.

The glow, the sun, and the stars draw beneath every map layer and only where nothing else has
drawn, so buildings and trees stand in front of them. With 3D terrain enabled, they are not
drawn.

## Browser integration

The compiler emits MapLibre `sky` in every concrete style and versioned `metadata['tileflow:sky']`
with the star brightness, the glow, and, for a theme in a time-of-day family, the family's skies;
`readTileflowSky` reads it and `tileflowSkyAtSun` mixes the sky of a sun's height. MapLibre draws the sky itself, so raw MapLibre consumers see it. On a
globe, the sky blends into MapLibre's atmosphere at world zooms; when a map also declares
`atmosphere`, the sky's colors replace the atmosphere's sky colors while its space background and
globe stars stay.

React, Vue, Svelte, and standalone browser capture draw the glow, the sun, and the stars through
`attachTileflowAtmosphere(map)`. A direct MapLibre integration calls that function, or
`attachTileflowSky(map)` from `@tileflow/core/browser` for the sky layer alone, after constructing
the map; each returns a cleanup function. The layer is the custom layer `tileflow-sky` at the
bottom of the layer stack. A sky that follows the sun needs the theme controller, which writes the
sky's colours; raw MapLibre consumers see each theme's own sky.

MapLibre applies its fog only to 3D terrain, so flat layers and 3D buildings stay sharp up to the
horizon. Native artifacts remove the sky during preparation and record the removal; see the
[native artifact profile](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md).
