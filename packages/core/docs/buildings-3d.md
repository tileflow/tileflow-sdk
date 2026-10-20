# 3D buildings

`createTileflowBuildings3D` raises the buildings of a Tileflow map's vector tiles round the camera.
By default it preserves the map's building colours, uses the scene sun, casts shadows, adds soft
contact shading and rounds exterior corners by 0.8 metres. An unspecified sun uses soft daylight
with directional intensity 0.2 and ambient intensity 0.8; authored theme lighting stays in control.
Showing, hiding and changing height are immediate. Illuminated outlines, random colour variation,
invented windows and night lights remain off. Every effect is independently overridable and
independent of the map's trees.

Streets supplies architectural flood lighting and subtle model wall emission for its dark
presets. These controls are independent of invented windows and the optional `nightLight` effects.

Tileflow landmarks and a map's own building models can stand in the same 3D scene, replacing
the buildings under their footprints.

It is a custom WebGL2 layer for MapLibre GL JS, drawn above the map's buildings and below its
labels. It needs WebGL2 and the Mercator projection, which MapLibre's globe turns into from about
zoom 12. On every map, buildings and placed models appear automatically from zoom 15,
with opacity rising linearly from 0 at 15 to 1 at 15.25. Zooming back out reverses the fade.
Their height stays unchanged throughout; shadows and contact shading fade with them.
`hide()` keeps them hidden at every zoom until `show()` is called.

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
  // Enabled on creation; hide() and show() override visibility.
  return buildings;
}
```

`show()`, `hide()` and `grow(scale)` change the height immediately by default (duration 0).
`show({transition: {duration: 800, mode: 'fade'}})` reveals full-height buildings with a
smooth opacity fade. The default animation mode is `grow`; both modes respect reduced-motion settings.
To animate, pass `{transition: {duration: 800}}` explicitly; `grow(scale)` accepts a height share
from 0 to 1. Each returns a promise that resolves once the change ends; a newer call takes over from where the buildings stand. A browser preference for reduced
motion changes at once. `dispose()` takes the layer off the map.

The renderer reads the source's z15 tiles round the camera (z15 is where World's buildings carry
their heights; a source that stops earlier is read at its own maximum zoom), up to `maxTiles`
tiles (25 by default), and meshes them a few milliseconds per frame. It reads World's
`render_height`, `render_min_height`, `hide_3d`, `height_source`, `building_tone`, `class`,
`night_use` and the roof fields (see [roofs](#roofs)), and the places in World's `poi` layer (see
[night light](#night-light)). `stats.declared` tells whether the map's
style describes its 3D buildings. Recompile existing maps to pick up the new defaults: previously
compiled metadata keeps explicit settings, including `false`, `0` and `lighting: 'style'`.

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
  corners) default to true. Set either to false independently. `windows: true` adds invented night windows, lit by rooms; they are
  decoration, not data, and are off by default. Where World says what a building is used for
  (`class`), sheds, garages, barns, factories, churches and service buildings get no rows of
  windows, homes light more of theirs at night, in a warm light, and offices, schools and hospitals
  fewer, in a cooler one.
- `threeDimensional.edges` and `edgeColor` set the [edges](#edges), and `nightLight` the
  [night light](#night-light). Numbers and colours may be theme tokens.
- `threeDimensional.edgeRadius` rounds convex exterior corners in the mesh and softens the
  roof/wall lighting transition. It accepts 0–1 metres and defaults to 0.8; use 0 for sharp corners.
  Courtyard corners and tile cuts stay unchanged. The authored roof shape is preserved; the top
  edge is softened through lighting, not a geometric roof bevel. Rounding adds a bounded number
  of vertices at convex corners, with no extra render pass. Changes to this radius rebuild the
  resident building meshes.

In both `style` and `sun` lighting, the vertical gradient darkens the foot of a facade by ten percent, fading smoothly over
at most three metres (half the height for low buildings). It is evaluated per fragment, so a tall
building does not acquire a full-height dark ramp. Disabling the authored extrusion's
`verticalGradient` disables this shading. Ground contact shadow is controlled by `occlusion`, enabled by default. It extends three metres
from grounded walls, darkening the ground by at most 16%, with a smooth distance falloff and round
corners. Every map uses these defaults when it enables `occlusion`. The reach is measured in world
metres, so its screen width scales continuously with zoom and becomes subtle at distant views.
Overlaps use the strongest
shade once, so shared walls, courtyards and tile joins do not accumulate dark bands. Raised building
parts do not cast contact shade. Facade occlusion darkens the base by at most 14% and fades
exponentially with a three-metre decay radius: about 5% remains one floor up and 2% two floors up.
It follows height above ground, so raised parts do not restart the contact gradient at their base.
The facade gradient, contact and inner-corner shade use the strongest contribution once, avoiding
an extra dark strip where they overlap. Both lighting modes use the same falloff at every zoom.
The ground mask uses one byte per drawing-buffer pixel while enabled and is released when disabled
or the renderer is removed; it resizes with the drawing buffer.

## Landmarks

Maps on Tileflow World show Tileflow's landmarks, such as the Eiffel Tower, as 3D models in place of
the buildings under them. They come from a landmarks tileset kept apart from the map's data: each of
its tiles carries the models standing in it, with their levels of detail and footprints, and each
region's index names its tiles by their hash, with where each landmark stands and its footprint.
The renderer reads the tileset's TileJSON, then only the indexes of the regions round the camera
and the landmark tiles near it, from a zoom before the buildings show, so a landmark in Paris costs
nothing in Madrid. New and improved landmarks reach every map without a new build of the map.

The buildings under a landmark are never raised and then taken away. A tile of buildings is built
once the indexes round it have arrived, waiting at most a second and a half; while a landmark's
tile is still on its way, the footprint its index names keeps the buildings under it flat, and the
landmark fades in when it arrives. A landmark tile that fails, or has not arrived three seconds
after the buildings round it show, lets those buildings rise until it does. A tileset that cannot be read is tried again
after five minutes, and the buildings stay drawn meanwhile.

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
- **Architectural roles control lighting.** A material may set
  `extras.tileflow.lightingRole` to `wall`, `door`, `roof`, `window`, `lamp`, `logo` or
  `unclassified`. This preserves its palette slot. Without a role, `surface`, `secondary` and
  `accent` are walls, `glass` is a window, and `roof` is a roof.
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
the camera, whether or not those tiles hold buildings, keeps the nearest dozen, and builds the tiles
under it again without the buildings that
reach more than half a metre into its footprint; a neighbour that only touches it stays. A tile of
buildings near a model waits for it, at most a second and a half, so its buildings are not raised
and then taken away, and the model fades in when it comes to stand. A model that cannot be
downloaded leaves those buildings standing. Reading a prepared model file loads
meshoptimizer's WebAssembly decoder, so a page with a Content Security Policy allows
`'wasm-unsafe-eval'` in its `script-src`.

Preparation also computes local geometric ambient visibility, independently of the model's
colour. `modelOcclusion` sets its strength from zero to one (default `0.75`); `occlusion: false`
disables it. Occluded cavities receive less ambient light while direct sun and dynamic shadows
remain independent. Existing prepared files with fully exposed vertices retain their appearance.
Reprepare their original GLBs to gain geometric occlusion. See
[model preparation](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/building-models.md)
for authoring, sampling and costs.

## Team 3D models

On Tileflow Hosted, a map's building models are its Team's 3D models: each is published once, under
its name, and every map of the Team that places a model of that name draws it. Locally, the map
draws its own `.glb` files, so the map is previewed and developed without an account.

```sh
npx tileflow models publish ./models/eiffel-tower.glb --team @acme
npx tileflow models status eiffel-tower --team @acme
```

`tileflow models publish` prepares each building model as a build does and publishes it as the
model's new current version; with no path, it publishes the building models of every map in the
project's config. Publishing the bytes of the current version again changes nothing. A hosted map
follows each model's current version: a new version, or `tileflow models restore`, which makes the
previous version current again, changes every map that places it the next time the map loads,
without deploying the maps again. A model keeps its current and previous versions.

`tileflow deploy` writes each placement of a building model as the placeholder
`tileflow://team-models/<name>` (`tileflowTeamModelUrl(name)`), which the deploy replaces with the
model's address in the map's Team; a model the Team has not published fails the deploy. The deploy
also reports a model whose published version was prepared from other files than the map's, so an
outdated model is easy to spot. A model's file, and what Tileflow shows about it, can be read
without decoding its meshes with `readTileflowModelFileSummary`. Models are served publicly and may
be cached, so they must not hold secrets or restricted personal data.

## Roofs

A building whose tiles carry a roof shape (World's `roof_shape`) gets that roof: `gabled`,
`hipped`, `half_hipped`, `pyramidal`, `skillion`, `gambrel`, `mansard` and `saltbox` roofs, and
faceted `dome`, `onion` and `round` ones. The ridge follows the building's long side, or
`roof_orientation` and `roof_direction` when the tiles state them, and the walls rise to the roof,
so gable ends are walls. Each slope takes the sun, shadows and edges like any face: the ridge and
the hips are drawn as edges too.

The roof's height is `roof_height` where the tiles state it, taken from the building's height.
Otherwise the roof keeps the pitch of its shape (30° for a gabled or hipped roof, a half sphere for a
dome); it stands on the walls when the height came from levels or a fallback, and reaches the
building's height when that was measured (`height_source` `height`). A building without a roof
shape, a flat roof, a building with courtyards or one far from a rectangle (an L, a U) keeps a flat
roof, and so does a building a tile's buffer cuts short.

## Light and shadows

Sun lighting and cast shadows are SDK defaults, including for Streets. Each map can choose its
own finish. For native extrusion lighting, sharp corners and no shadows in an extending map:

<!-- docs:check -->

```ts
import {defineMap, refine} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'graphic-streets',
  name: 'Graphic streets',
  version: 1,
  extends: streets,
  modules: {
    buildings: refine({
      threeDimensional: {lighting: 'style', edgeRadius: 0, shadows: false, occlusion: false},
    }),
  },
});
```

Select `timeOfDay` through your map adapter to change the authored direction, colour and strength
of direct and ambient light. Streets includes moonlight and shadows in its night presets. These
presets are independent of the user's clock and location. In DevTools, use the 3D view and
**Map → Buildings → Building light / Cast shadows**. The theme's `lighting.sun.shadowIntensity`
controls shadow strength; `lighting.ambient` fills the shade. Use `controller.setSun({date,
location})` for an astronomical direction instead, as described in
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md).

`threeDimensional.lighting: 'style'` uses MapLibre's `light` position,
anchor, colour and intensity, together with the authored extrusion's `verticalGradient`.
Changing the scene sun does not change this base lighting. The style's native lighting defaults
apply when it declares no light.

With the default `lighting: 'sun'`, the light comes from `controller.getSun()`: the theme's sun, mixed during a blend, or the sun an
application places by direction or by date and place (see
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md)).
Without a controller, the renderer reads the compiled style's sun, falling back to the style's
light direction and then the SDK daylight. It refreshes this cached light on style changes.
A sunlit roof keeps the building's colour, a wall turned to a low sun glows, and shade takes the
sky's colour. Shadows lengthen as the sun lowers, with their projected direction limited to 15°
above the horizon. The actual light retains its authored altitude; a sun below the horizon casts none.

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

Architectural illumination has two independent controls:

- `floodLight` selects ordinary buildings by height. Ground light starts at `minGroundHeight`
  (30 m by default), with a stable per-building `groundRadius` in metres (default `[30, 100]`).
  Wall light starts above `minWallHeight` (200 m); its reach is building height times
  `wallHeightRatio` (default `1/3`). `intensity` is zero to one and `color` is a theme colour.
  The effect fades with scene brightness; `brightnessScale` compensates an authored light-colour
  transform and defaults to one. Overlapping ground contributions use their strongest value.
- `modelLighting` assigns emission to architectural roles. Each profile accepts
  `emissiveStrength` (zero to two), optional `emissiveColor` (otherwise the part's own colour), and
  `emissiveHeight`: `[beginHeight, endHeight, beginMultiplier, endMultiplier, curve]`.
  Heights are fractions of the model's bounds, multipliers are zero to one, and the exponent is
  `10 ** curve`, with `curve` from -1 to 1. Equal heights give a constant multiplier of one.
  Strength and colour may use theme tokens. Emission is mixed in linear light and is independent
  of ambient occlusion and solar shadows. Values above one saturate the surface emission at one;
  they do not generate bloom or additional light geometry.

Streets leaves both effects off in its light presets. Its dusk/night wall profile uses a strength
of `0.1` and `[0.5, 0, 0, 1, 0.8]`, concentrating a warm wash near the foot. Monochrome uses a
weaker neutral wall profile and no architectural ground flood. Prepared models without role
metadata use their documented palette mapping. A role does not imply a door light on the ground
or generate missing windows.

The separate `nightLight` control retains its decorative building and shop effects:

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

The renderer's own options say only how it is delivered: `minzoom` (15 by default, with a 0.25-zoom opacity ramp), `maxTiles`,
`beforeId` to place the layer before another one, and `transformRequest` to apply the map's request
rules to the tiles it reads.

## Cost

During partial opacity, a depth-only geometry pass resolves the nearest surfaces before colour
blending, preventing rear walls from bleeding through. At full opacity only the normal geometry
pass runs; zoom fading schedules no extra animation frames or per-zoom mesh rebuilds.

The browser bundle prepares building meshes in one worker per renderer and transfers the finished
vertex and index buffers. No worker URL or extra asset hosting is needed. A Content Security Policy
must allow `worker-src blob:` to use this path; if workers are unavailable or blocked, the renderer
falls back to local meshing. The worker is terminated on `dispose()`. Pending tile updates retain
the previous mesh until their replacement is ready; cancelled and obsolete results are discarded.

Mercator rendering batches buildings spatially and skips batches outside the camera. Shadow
casting uses the light's bounds independently, so an offscreen building can still cast a visible
shadow. Ground contact and flood bands retain their physical reach when testing visibility.
Rounded corners use fewer segments when their screen radius is small and retain the original
tessellation up close. Latitude, radius and pitch inform this choice; very oblique views keep full
detail. Changes are prepared asynchronously; heights, feature colours,
and the contact-shadow settings stay the same. GPU uploads remain limited to two tiles per frame.

The shared shadow map is at most 4096 × 4096. On a planar view it concentrates resolution on visible
ground and raised surfaces, while every loaded caster can still project into that area. A snapped
Mercator texel grid stays stable during small pans, including changes of latitude, without fixing
the meshes' physical metre scale. One filtered depth comparison keeps edges sharp.
Missing camera capabilities, terrain or a view near the horizon use the full loaded area instead.
The depth pass runs again when its focused area, light or casting geometry changes and is reused
when they stay unchanged.

Model ambient visibility and lighting roles retain the existing 16-byte vertex stride. They add
no geometry pass or texture. Architectural ground lighting uses a separate one-byte-per-pixel
mask and one geometry/composite pair of passes while active; its mask is released when inactive.
At 1280 × 720 and DPR 1, the mask occupies 921,600 bytes, excluding driver overhead.

## Limits

- Mercator only; the layer draws nothing below its `minzoom`.
- No terrain: buildings stand on flat ground.
- One building colour per feature and theme, on its roof and walls alike; facades are not drawn.
- Roofs follow the building's smallest enclosing rectangle: a building with courtyards or far from a
  rectangle keeps a flat roof, and `sawtooth` roofs are drawn flat.
- A colour expression is evaluated at zoom 16.
- Building models and landmarks take no illuminated edges and cannot be picked or styled by state.
- Model materials use semantic colours and role emission; physical roughness, metallic
  reflections and authored textures are not rendered.
- A hosted map places its building models as its Team's 3D models: `tileflow deploy` uploads no
  model files (see [Team 3D models](#team-3d-models)). A deploy with `--with-native` does not take
  them, since MapLibre Native draws no models. Models named by `url` deploy as they are.
