# 3D buildings

`createTileflowBuildings3D` raises the buildings of a Tileflow map's vector tiles round the camera.
By default it preserves the map's building colours and native extrusion lighting (`style.light`
and its vertical wall gradient). Showing, hiding and changing height are immediate. Cast shadows,
contact shadow, illuminated outlines, random colour variation and night lights are off.

Scene sun lighting, shadows, decorative effects and animated height remain available through
explicit options. They are independent of the map's trees.

Tileflow landmarks and a map's own building models can stand in the same 3D scene, replacing
the buildings under their footprints.

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
  // No animation unless requested.
  void buildings.show();
  return buildings;
}
```

`show()`, `hide()` and `grow(scale)` change the height immediately by default (duration 0).
To animate, pass `{transition: {duration: 800}}` explicitly; `grow(scale)` accepts a height share
from 0 to 1. Each returns a promise that resolves once the change ends; a newer call takes over from where the buildings stand. A browser preference for reduced
motion changes at once. `dispose()` takes the layer off the map.

The renderer reads the source's z15 tiles round the camera (z15 is where World's buildings carry
their heights; a source that stops earlier is read at its own maximum zoom), up to `maxTiles`
tiles (25 by default), and meshes them a few milliseconds per frame. It reads World's
`render_height`, `render_min_height`, `hide_3d`, `building_tone` and `night_use`, and the places in
World's `poi` layer (see [night light](#night-light)). `stats.declared` tells whether the map's
style describes its 3D buildings. Recompile existing maps to pick up the new defaults: previously
compiled metadata with explicit effects enabled continues to honour those values.

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
      threeDimensional: {
        lighting: 'sun',
        shadows: true,
        occlusion: true,
        edges: 1,
        colorVariation: 0.06,
        windows: true,
        nightLight: 0.6,
        edgeColor: '#2b2a33',
      },
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
  corners) default to false. `windows: true` adds invented night windows, lit by rooms; they are
  decoration, not data, and are off by default.
- `threeDimensional.edges` and `edgeColor` set the [edges](#edges), and `nightLight` the
  [night light](#night-light). Numbers and colours may be theme tokens.

## Landmarks

Maps on Tileflow World show Tileflow's landmarks, such as the Eiffel Tower, as 3D models in place of
the buildings under them. They come from a landmarks tileset kept apart from the map's data: each of
its tiles carries the models standing in it, with their levels of detail and footprints. The
renderer reads the tileset's TileJSON once the buildings show in 3D, then downloads only the
landmark tiles near the camera, so a landmark in Paris costs nothing in Madrid. New and improved
landmarks reach every map without a new build of the map.

A map switches them off, or names the TileJSON of another landmarks tileset:

<!-- docs:check -->

```ts
import {defineMap, refine} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'no-landmarks',
  name: 'Streets without landmarks',
  version: 1,
  extends: streets,
  modules: {
    buildings: refine({threeDimensional: {landmarks: false}}),
  },
});
```

The map's own building models come first: a landmark with the same id as one of them, or whose
footprint meets one's, is not drawn.

## Building models

A map can place its own 3D models of buildings in the city: a landmark the extruded footprints draw
badly, or the buildings an application presents. Each model stands where the map says, in the same
light, shadows and theme as the buildings round it, and the buildings under its footprint are no
longer raised while it stands. Put glTF binaries (`.glb`) in a directory, declare it in the map's
`models`, and say where each model stands:

<!-- docs:check -->

```ts
import {defineMap, refine} from '@tileflow/core';
import {streets, streetsModels} from '@tileflow/maps';

export default defineMap({
  id: 'paris-landmarks',
  name: 'Paris landmarks',
  version: 1,
  extends: streets,
  // ./models holds eiffel-tower.glb, and eiffel-tower.mid.glb and eiffel-tower.far.glb for
  // farther views.
  // Keep Streets' tree models alongside the building models.
  models: [streetsModels, './models'],
  modules: {
    buildings: refine({
      threeDimensional: {
        models: [{model: 'eiffel-tower', at: [2.294481, 48.858258], heading: 0}],
        modelColors: {surface: '#7a5c45', accent: '#5b4332'},
      },
    }),
  },
});
```

`at` is the longitude and latitude of the model's origin and `heading` the degrees clockwise from
north its own north is turned to. A map places up to 256 models; one model may stand in several
places. A placement may instead name a prepared model file served elsewhere with `url`, its HTTPS
address; the map then needs no `.glb` of its own for it.

How to prepare a model:

- **Materials name the parts.** Name each material `surface`, `secondary`, `glass`, `accent` or
  `roof` (an exporter's `.001` suffix is ignored); a model whose materials name a tree's parts is a
  [tree model](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/trees-3d.md)
  instead. Each part takes its colour from `modelColors`, or from the buildings' colour when the
  design gives it none, so the model follows the theme from day to night; vertex colours lighter or
  darker than the rest of their part shade it within that colour.
- **Metres round an origin on the ground.** The origin is where the model stands, with the model
  above it and its own north along +y once read Z up; nothing may lie more than half a metre below
  it.
- **What it stands in for.** A mesh whose material is named `footprint` is never drawn: it lays
  out on the ground what the model stands in for, such as a landmark's whole base. Without one, the
  model's own outline on the ground stands in, courtyards included.
- **Levels of detail.** `<id>.mid.glb` and `<id>.far.glb`, when present, are drawn farther from the
  camera's centre, from about 900 m and 2.6 km.
- **Budgets.** A level has at most 200,000 triangles and 200,000 vertices, and a map at most 64
  building models. Triangles of the default scene are read with their node transforms; textures,
  animations and compressed geometry (Draco or meshopt) are not.

The build reads each model, reports a problem with the file and what to change, works out its
footprint and writes it beside the style as a prepared model file: a glTF binary whose meshes are
quantised (`KHR_mesh_quantization`) and compressed by meshoptimizer (`EXT_meshopt_compression`),
which any glTF viewer opens. The renderer downloads a model only when it stands near the tiles round
the camera, keeps the nearest dozen, and builds the tiles under it again without the buildings that
reach more than half a metre into its footprint; a neighbour that only touches it stays. A model
that cannot be downloaded leaves those buildings standing. Reading a prepared model file loads
meshoptimizer's WebAssembly decoder, so a page with a Content Security Policy allows
`'wasm-unsafe-eval'` in its `script-src`.

## Light and shadows

`threeDimensional.lighting` defaults to `'style'`: it uses MapLibre's `light` position,
anchor, colour and intensity, together with the authored extrusion's `verticalGradient`.
Changing the scene sun does not change this base lighting. The style's native lighting defaults
apply when it declares no light.

With `lighting: 'sun'`, the light comes from `controller.getSun()`: the theme's sun, mixed during a blend, or the sun an
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
the buildings' shadows when `shadows: true`. With it off, buildings neither cast nor receive
scene shadows, even when another 3D layer uses them.

## Edges

Where one building ends and the next starts stays legible at any distance: each roof's outline and
each building's outer corners catch the light in a line one CSS pixel wide, whatever the zoom, when enabled. `colorVariation` independently varies building brightness by up to the specified
fraction (0–1); it defaults to 0, so authored colours remain unchanged. Use 0.06 for the earlier
6% variation. The lines are strongest at night; diagonals inside a roof, inner corners and the cuts at
a tile's edge draw none. `edges` sets their strength from 0 (the default, none) to 1.

`edgeColor` gives the lines a colour of the map's own, per theme through a token: a dark outline as
on a printed map, or a neon one at night. It is drawn as it is, unlit, at the full `edges` strength
by day and night, mixed between the themes either side of a blend's position.

## Night light

With `nightLight` above 0, the buildings light the street from data at night (as the sun's
`brightness` falls):

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

`nightLight` sets how bright all of this shines, from 0 (none) to 2; it defaults to 0.

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
- Building models and landmarks take no edges or night light of their own yet, and cannot be
  picked or styled by state.
- Hosted deploys do not take a map's own model files yet: `tileflow validate --target hosted` reports
  them. Models named by `url` deploy as they are.
