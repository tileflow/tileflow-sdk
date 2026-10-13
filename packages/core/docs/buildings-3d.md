# 3D buildings

`createTileflowBuildings3D` raises the buildings of a Tileflow map's vector tiles round the camera
and lights them from the theme controller's sun: walls and roofs take the light by how they face
it, buildings cast shadows on each other and on the flat map, the ground darkens at the foot of the
walls, and at night flood lights wash the foot of shops, busy places, landmarks and towers. Showing,
hiding and growing the city lays out no source, so it works as a 3D switch and as an animated
height.

It is a custom WebGL2 layer for MapLibre GL JS, drawn above the map's buildings and below its
labels. It needs WebGL2 and the Mercator projection, which MapLibre's globe turns into from about
zoom 12; the buildings stand from zoom 14.5 by default.

## Show the buildings

This example assumes an existing MapLibre map showing a Tileflow map whose vector source is called
`tileflow`, as Tileflow's maps call World, and a theme controller for it:

<!-- docs:check -->

```ts
import {
  createTileflowBuildings3D,
  type TileflowBuildings3DMap,
  type TileflowThemeController,
} from '@tileflow/core/browser';

export function raiseTheCity(map: TileflowBuildings3DMap, controller: TileflowThemeController) {
  const buildings = createTileflowBuildings3D({map, controller});
  // The buildings slide out of the ground over a second.
  void buildings.show({transition: {duration: 1000}});
  return buildings;
}
```

`show()` raises the buildings, `hide()` sinks them back into the flat map, and `grow(scale)` eases
them to a share of their height, from 0 to 1. Each returns a promise that resolves once the motion
ends; a newer call takes over from where the buildings stand. A browser preference for reduced
motion changes at once. `dispose()` takes the layer off the map.

The renderer reads the source's z15 tiles round the camera (z15 is where World's buildings carry
their heights; a source that stops earlier is read at its own maximum zoom), up to `maxTiles`
tiles (25 by default), and meshes them a few milliseconds per frame. It reads World's
`render_height`, `render_min_height`, `hide_3d` and `building_tone`.

## Light and shadows

The light comes from `controller.getSun()`: the theme's sun, mixed during a blend, or the sun an
application places by direction or by date and place (see
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md)).
A sunlit roof keeps the building's colour, a wall turned to a low sun glows, and shade takes the
sky's colour. As the sun sets, shadows lengthen while they fade; a sun below the horizon casts none.

MapLibre's own layers take no shadows, so the renderer darkens the map it is drawn over: after its
buildings, it multiplies the ground by the shadows and by a band at the foot of the walls. Labels
and icons drawn above it keep their colours. Layers kept under 3D content with
`createTileflowGroundLayers` are darkened with the ground.

Each effect can be turned off: `shadows`, `occlusion` (the band at the foot of the walls and the
darker tight corners) and `floodLights` default to true. `windows: true` adds invented night
windows, lit by rooms; they are decoration, not data, and are off by default.

## Colours

Without `color`, buildings take the theme's 3D building colour, the colour Tileflow's buildings
module compiles for its extrusion, and follow theme changes and blends.

`color(properties, theme)` colours each building from its feature properties for each theme, as a
CSS colour. The renderer calls it once per building and theme when a tile or the set of themes
changes, and mixes the colours of the themes either side of a blend's position on the GPU, so a
moving blend costs nothing per frame:

<!-- docs:check -->

```ts
import {createTileflowBuildings3D, type TileflowBuildings3DMap} from '@tileflow/core/browser';

const tints: Record<string, readonly string[]> = {
  day: ['#f1d4cd', '#d3e8da', '#f6e0b5', '#e2d5f0', '#cfe3f2'],
  night: ['#353d41', '#2f3a3d', '#3a3b44', '#33363f', '#2d3540'],
};

export function tintedCity(map: TileflowBuildings3DMap) {
  return createTileflowBuildings3D({
    map,
    color(properties, theme) {
      const floors = Math.floor(Number(properties.render_height ?? 5) / 3.2);
      const palette = tints[theme] ?? tints.day!;
      return palette[floors % palette.length]!;
    },
  });
}
```

## Cost

The shadow map (up to 4096 × 4096) is drawn again only when the sun, the buildings or their height
change, not when the camera moves. In a campaign over Miami at 1512 × 860 at 2×, a city lit this
way kept the frame pacing of the same city drawn without shadows.

## Limits

- Mercator only; the layer draws nothing below its `minzoom`.
- No terrain: buildings stand on flat ground.
- One building colour per feature and theme; facades, roof shapes and building parts as separate
  shapes are not drawn.
