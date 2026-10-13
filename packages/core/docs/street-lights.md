# Street lights

`createTileflowStreetLights` lights a Tileflow map's streets at night from its own vector tiles. The
lamps the map's data holds shine where they stand, each with a pool of light on the ground and a
glowing head. Streets and pavements the data maps as lit, but whose lamps it does not hold, take a
soft light along them that claims no lamp's place. As the theme controller's sun darkens the map,
the lights switch on one by one; they go out as day comes.

It is a custom WebGL2 layer for MapLibre GL JS, drawn above the map's buildings and below its
labels. When `createTileflowBuildings3D` raises the buildings, they hide the lamps behind them. It
needs WebGL2 and the Mercator projection, and shines from zoom 14 by default.

## Light the streets

This example assumes an existing MapLibre map showing a Tileflow map whose vector source is called
`tileflow`, as Tileflow's maps call World, and a theme controller for it:

<!-- docs:check -->

```ts
import {
  createTileflowStreetLights,
  type TileflowStreetLightsMap,
  type TileflowThemeController,
} from '@tileflow/core/browser';

export function lightTheStreets(map: TileflowStreetLightsMap, controller: TileflowThemeController) {
  // The lights switch on as the theme's or the application's sun darkens the map.
  return createTileflowStreetLights({map, controller});
}
```

The lights follow `controller.getSun()`: they switch on as its `brightness` falls through dusk, each
lamp at its own moment, and are all on at night. A theme whose night has no `lighting.sun` keeps
the default daylight sun, so its lights stay off; see
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md).
`on` reports how far they have switched on, from 0 to 1, `stats` the lamps on screen, and
`dispose()` takes the layer off the map.

## What the light comes from

The layer reads the source's z15 tiles round the camera, the zoom at which World carries its street
detail:

- Lamps from World's `street_furniture` points whose `subclass` is `street_lamp`. Where the data
  gives them, a lamp's `height`, `lamp_mount`, `light_count`, `lamp_type` and `light_colour` set how
  high it stands, how far its light reaches and its colour: sodium lamps shine orange, LED and
  metal-halide lamps white. Other lamps take `color`, a warm white by default.
- Streets in World's `transportation` layer, and pavements in its `sidewalk` layer, that the data
  maps as lit (`lit`). A street mapped as unlit never takes light.

How much of this a city's data holds varies widely: some map most of their lamps or most of their
lit streets, others almost none. Where the data says nothing, the streets stay dark.

`estimate` chooses where the layer adds light the data does not map as lamps:

- `lit` (the default): along the streets and pavements mapped as lit.
- `streets`: also along streets the data says nothing about, in tiles where the data maps few
  lamps. This invents light, as night windows do, for maps that want every street lit; a tile whose
  data maps its lamps keeps to them.
- `none`: only mapped lamps shine.

Estimated light keeps to the middle of its street and shows no lamp head, so it reads as a lit
street rather than as lamps that may not stand there.

## Options

`intensity` scales the light from 0 to 2 (1 by default). `minzoom` (14 by default) and `maxTiles`
(25 by default, at most 64) bound where and how far the lights shine. `beforeId` places the layer
before another one; `source` names a vector source other than `tileflow`; `transformRequest`
applies the map's request rules to the tiles the layer reads.

Layers that read the same source share each tile's download, so the street lights and the 3D
buildings fetch a tile once between them.

## Limits

- Mercator only; the layer draws nothing below its `minzoom`.
- The light falls on the ground; walls the lamps face are not lit by them.
- No terrain: lamps stand on flat ground.
