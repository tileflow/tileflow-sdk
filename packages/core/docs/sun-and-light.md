# Sun and light

A theme can describe its sun and the light from its sky, as a light preset for that theme: a high
sun in white light for a day theme, a low amber sun in the west for an evening theme, a cold moon
with faint shadows for a night theme. In a browser, the theme controller returns the sun the map
shows, mixed between neighbouring themes during a blend, so an application's own 3D layers can light
their models and cast their shadows from it. An application can also place the sun itself, by
direction or by the real position of the sun for a date and place.

MapLibre lights its `fill-extrusion` layers with one directional light and casts no shadows. When a
theme describes a sun, the map's light is anchored to the map and points from the sun, so Tileflow's
3D buildings are shaded from where it stands. Shadows, ambient occlusion and lit windows are for the
application's own WebGL layers to draw, from the values `getSun()` returns.

## Describe a theme's sun

Set `lighting.sun` and `lighting.ambient` in the theme. Every value is optional; unset values take
the defaults in `tileflowDefaultSunPreset` (azimuth 210°, altitude 60°, white light at 0.5, full
shadows, a white sky at 0.5):

<!-- docs:check -->

```ts
import {defineTheme} from '@tileflow/core';
import {streetsThemes} from '@tileflow/maps';

export const evening = defineTheme(streetsThemes.dark, {
  id: 'city-evening',
  version: 1,
  colorScheme: 'dark',
  lighting: {
    // Degrees clockwise from north, and above the horizon.
    sun: {azimuth: 285, altitude: 9, color: '#ff9a50', intensity: 1, shadowIntensity: 0.9},
    ambient: {color: '#5a4290', intensity: 0.3},
  },
});
```

`intensity` values run from 0 to 1. `shadowIntensity` says how dark the shadows the sun casts fall,
from 0 (none) to 1. A theme derived from another changes single values of its sun and sky light; the
others are inherited. The compiled style carries the resolved sun in its metadata
(`tileflow:sun`) and a map-anchored `light` that points from it; MapLibre's `anchor` and the
direction in `lighting.position` no longer apply to a theme with a sun. A theme without `sun` or
`ambient` compiles exactly as before.

## Read the sun in an application

`themeController.getSun()` returns the sun the map shows:

- `azimuth` and `altitude`, in degrees, and `direction`, a unit vector towards the sun with x east,
  y north and z up.
- `color` and `rgb` (sRGB channels from 0 to 1) of the direct light, and its `intensity`, which fades
  to 0 over the sun's last degrees above the horizon: a sun below it lights nothing.
- `ambient`, the light from the sky, with its own `color`, `rgb` and `intensity`.
- `shadowIntensity`, how dark the sun's shadows fall.
- `brightness`, how bright flat, open ground is under this light, from 0 to 1: the sky's light plus
  the sun's at its height, each weighted by its colour's luminance. Use it to switch lamps or windows
  on as a scene darkens, whatever theme or sun lights it.
- `source`: `theme`, `direction`, or `date`.

During a blend the sun is mixed between the neighbouring themes' suns: the azimuth turns the short
way round, colours mix in OKLab as the map's colours do, and numbers mix linearly. Read it when a
custom layer draws; the map redraws whenever the sun changes.

## Place the sun

`setSun` places the sun by direction, or by the real sun of a date over a place given as
`[longitude, latitude]`, the map's centre when it is left out. The themes keep the sun's colours,
strengths and shadow strength; only its direction changes. `setSun(undefined)` returns it to the
themes. This example assumes an existing MapLibre map and a controller for it:

<!-- docs:check -->

```ts
import type {TileflowThemeController} from '@tileflow/core/browser';

export function followTheRealSun(controller: TileflowThemeController) {
  // Where the sun stands over Miami Beach now; a later call moves it on.
  void controller.setSun({date: Date.now(), location: [-80.13, 25.79]});
}

export function lowWesternSun(controller: TileflowThemeController) {
  // Turns the short way round to the west over a second.
  return controller.setSun({azimuth: 270, altitude: 8}, {transition: {duration: 1000}});
}
```

A request that follows an animation, such as a clock that moves every frame, passes no transition.
A request with a transition supersedes one still in progress, which resolves with
`status: 'superseded'`; a browser preference for reduced motion changes at once.

`tileflowSunPosition(date, [longitude, latitude])` returns the sun's azimuth and apparent altitude,
with atmospheric refraction, from NOAA's solar equations (accurate to about a hundredth of a degree
for years 1800 to 2200). It runs anywhere, without a map:

<!-- docs:check -->

```ts
import {tileflowSunPosition} from '@tileflow/core/browser';

// Solar noon in Miami at the June solstice, 17:22 UTC: the sun stands about 87.7° high, due south.
export const noon = tileflowSunPosition(Date.UTC(2026, 5, 21, 17, 22), [-80.19, 25.77]);
```

## Light a custom layer

For a custom WebGL layer that draws 3D content, light each surface with the sky's light, plus the
sun's where the surface faces it and nothing stands in the way:

    light = ambient.rgb × ambient.intensity + rgb × intensity × max(normal · direction, 0) × (1 − shadowIntensity × shadowed)

Convert the colours to linear light before adding them and back to sRGB after. MapLibre's own 2D
layers take no shadows, so a layer that casts shadows on the ground darkens the map it is drawn over:
draw the ground under the scene, after the scene's own geometry, with multiplying blending and a
depth test against it.

## Limits

- MapLibre shades extrusions with its one light; it has no shadow maps, ambient occlusion or
  emissive light. The sun gives custom layers what they need to draw them.
- Themes interpolate the sun linearly between presets; a request by date follows the real sun, not
  the themes' presets.
- Style expressions cannot read the sun yet. An application that wants a theme to react to it sets a
  [style state](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/style-states.md)
  from `getSun().brightness`.
