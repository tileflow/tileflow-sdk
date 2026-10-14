# 3D buildings

`createTileflowBuildings3D` raises the buildings of a Tileflow map's vector tiles round the camera
and lights them from the theme controller's sun: walls and roofs take the light by how they face
it, buildings cast shadows on each other and on the flat map, the ground darkens at the foot of the
walls, and at night flood lights wash the foot of shops, busy places, landmarks and towers while
the places busy at night light their ground floors. Showing, hiding and growing the city lays out
no source, so it works as a 3D switch and as an animated height.

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
`render_height`, `render_min_height`, `hide_3d`, `building_tone` and `night_use`, and the places in
World's `poi` layer (see [night light](#night-light)). `stats.declared` tells whether the map's
style describes its 3D buildings; a style compiled before this description gets the defaults below.

## Design the buildings in the map

The map describes how its 3D buildings look, in its buildings module, and publishes it with its
style for every theme; the renderer follows theme changes and blends. The design is visible in
`tileflow preview` and validated with the rest of the map:

<!-- docs:check -->

```ts
import {defineMap, expr, field, refine, refineRenderTarget} from '@tileflow/core';
import {streets} from '@tileflow/maps';

const floors = expr.divide(expr.toNumber(expr.get(field('renderHeight')), 0), 3.2);

export default defineMap({
  id: 'lit-city',
  name: 'Lit city',
  version: 1,
  extends: streets,
  modules: {
    buildings: refine({
      threeDimensional: {windows: true, nightLight: 0.6, edgeColor: '#2b2a33'},
      renderStack: {
        // Core's 3D buildings take the colour of the map's 3D building pass.
        tints: refineRenderTarget({
          target: 'buildings.render.extrusion',
          renderer: 'extrusion',
          style: {
            color: expr.step(expr.modulo(floors, 3), '#e8d9c4', [
              [1, '#d6e2d8'],
              [2, '#e5d4e6'],
            ]),
          },
        }),
      },
    }),
  },
});
```

- Colour: each building takes the colour the map gives its 3D buildings: Streets' 3D building pass
  (the theme's `buildings.extrusion`), else the buildings module's extrusion, else its roofs. A
  colour that depends on the building's data is evaluated per building and theme when a tile or the
  set of themes changes, and the themes either side of a blend's position mix on the GPU, so a
  moving blend costs nothing per frame.
- `threeDimensional.shadows` and `occlusion` (the band at the foot of the walls and the darker tight
  corners) default to true. `windows: true` adds invented night windows, lit by rooms; they are
  decoration, not data, and are off by default.
- `threeDimensional.edges` and `edgeColor` set the [edges](#edges), and `nightLight` the
  [night light](#night-light). Numbers and colours may be theme tokens.

## Light and shadows

The light comes from `controller.getSun()`: the theme's sun, mixed during a blend, or the sun an
application places by direction or by date and place (see
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md)).
A sunlit roof keeps the building's colour, a wall turned to a low sun glows, and shade takes the
sky's colour. As the sun sets, shadows lengthen while they fade; a sun below the horizon casts none.

A wall sees half the sky, so at night, when the ground gives back little light, walls in shade
stay darker than roofs. A theme's night `lighting.sun` set high (60° or more) lights roofs more than
any wall, so roofs and walls read apart under the moon.

MapLibre's own layers take no shadows, so the renderer darkens the map it is drawn over: after its
buildings, it multiplies the ground by the shadows and by a band at the foot of the walls. Labels
and icons drawn above it keep their colours. Layers kept under 3D content with
`createTileflowGroundLayers` are darkened with the ground. Other Core 3D layers on the map, such as
[3D trees](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/trees-3d.md), share
the buildings' shadows.

## Edges

Where one building ends and the next starts stays legible at any distance: each roof's outline and
each building's outer corners catch the light in a line one CSS pixel wide, whatever the zoom, and
each building is a little lighter or darker than its colour (up to 6%), so neighbours of one colour
stay apart. The lines are strongest at night; diagonals inside a roof, inner corners and the cuts at
a tile's edge draw none. `edges` sets their strength from 0 (none) to 1, the default.

`edgeColor` gives the lines a colour of the map's own, per theme through a token: a dark outline as
on a printed map, or a neon one at night. It is drawn as it is, unlit, at the full `edges` strength
by day and night, mixed between the themes either side of a blend's position.

## Night light

At night (as the sun's `brightness` falls), the buildings light the street from data, quietly by
default:

- Landmarks (World's `building_tone` `destination`) and towers of 40 m or more, one in two, are
  flood-lit at their foot, on the wall and the ground around it.
- Buildings that hold places busy at night light the windows of their ground floor and spill their
  light a few metres onto the pavement: bars and clubs in a neon of their own or a warm light,
  theatres and cinemas in a bright white, places to eat in amber. A building takes the strongest
  use of its places, nightlife before entertainment before dining. Walls round a courtyard stay
  dark.

The night use comes from World's `night_use` on each building. In tiles whose buildings do not
carry it, the renderer finds it in the tile's places: a place inside a building, or within a few
metres of its facade, gives the building its use.

`nightLight` sets how bright all of this shines, from 0 (none) to 2; it defaults to 1.

For the streets themselves, see
[street lights](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/street-lights.md),
which draws over the buildings so they hide the lamps behind them; both layers share each tile's
download.

## Options

The renderer's own options say only how it is delivered: `minzoom` (14.5 by default), `maxTiles`,
`beforeId` to place the layer before another one, and `transformRequest` to apply the map's request
rules to the tiles it reads.

## Cost

The shadow map (up to 4096 × 4096) is drawn again only when the sun, the buildings or their height
change, not when the camera moves. In a campaign over Miami at 1512 × 860 at 2×, a city lit this
way kept the frame pacing of the same city drawn without shadows.

## Limits

- Mercator only; the layer draws nothing below its `minzoom`.
- No terrain: buildings stand on flat ground.
- One building colour per feature and theme; facades, roof shapes and building parts as separate
  shapes are not drawn.
- A colour expression is evaluated at zoom 16.
