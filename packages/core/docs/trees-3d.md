# 3D trees

`createTileflowTrees3D` stands the trees of a Tileflow map's vector tiles round the camera as 3D
trees, lit by the theme controller's sun. Each tree takes the form and the size its data gives:
palms, conifers, columns and three broadleaf forms, at their mapped height and crown where the data
has them. Trees cast shadows on the ground and, with `createTileflowBuildings3D`, on the buildings,
and take the buildings' shadows; nearer buildings hide them.

The map describes how its trees look; the renderer only stands them. A map that declares
`vegetation({mode: '3d'})`, as Streets does, publishes its tree colours, scales and forms in the
style it compiles, for every theme, and the renderer follows theme changes and blends.

It is a custom WebGL2 layer for MapLibre GL JS, drawn above the map's buildings and below its
labels. It needs WebGL2 and the Mercator projection, and the trees stand from zoom 15 by default.
Elsewhere (Capture, Static Maps, Native, or a browser without WebGL2) the map draws the vegetation
module's flat trees.

## Stand the trees

This example assumes an existing MapLibre map showing a Tileflow map whose vector source is called
`tileflow`, as Tileflow's maps call World, and a theme controller for it:

<!-- docs:check -->

```ts
import {
  createTileflowTrees3D,
  type TileflowThemeController,
  type TileflowTrees3DMap,
} from '@tileflow/core/browser';

export function standTheTrees(map: TileflowTrees3DMap, controller: TileflowThemeController) {
  const trees = createTileflowTrees3D({map, controller});
  // The trees grow out of the ground over a second.
  void trees.show({transition: {duration: 1000}});
  return trees;
}
```

`show()` grows the trees, `hide()` sinks them back into the ground, and `grow(scale)` eases them to
a share of their size, from 0 to 1. Each returns a promise that resolves once the motion ends; a
newer call takes over from where the trees stand. A browser preference for reduced motion changes at
once. `dispose()` takes the layer off the map.

While they stand, the 3D trees stand in for the map's flat trees: the layers the vegetation module
draws them with are hidden when the trees are shown, and come back as they were once the trees have
sunk or the layer leaves the map.

`stats.declared` tells whether the map's style describes 3D trees. When it is false the layer draws
nothing: declare `vegetation({mode: '3d'})` in the map. `stats` also counts the tiles, the trees
placed and the trees drawn in the last frame.

## What the trees come from

The renderer reads the source's z15 tiles round the camera:

- World's `tree` layer: the trees OpenStreetMap maps one by one, as points, and its rows of trees,
  as lines, along which a tree stands every 8 metres. A tree's `leaf_type`, `genus`, `species` and
  `taxon` choose its form; its `height` and `diameter_crown` its size, and a trunk's
  `circumference` sizes a tree with neither. A row's attributes apply to each of its trees.
- World's `canopy` layer, where the data has it: decorative points in urban parks and gardens, each
  standing one to three trees by its canopy cover, inside the room it leaves before a path, a
  building or the park's edge. They stand for measured canopy, not for mapped trees.

| Form       | From the data                                                                |
| ---------- | ---------------------------------------------------------------------------- |
| `palm`     | `leaf_type` `palm`, `taxon` `Arecaceae`, or a palm genus such as `Roystonea` |
| `columnar` | the cypress genera `Cupressus`, `Calocedrus` and `Thuja`                     |
| `conifer`  | `leaf_type` `needleleaved`, or a conifer genus such as `Pinus` or `Cedrus`   |
| `open`     | spreading genera such as `Quercus`, `Olea`, `Ficus` or `Jacaranda`           |
| `tall`     | upright genera such as `Platanus`, `Populus`, `Ulmus` or `Ginkgo`            |
| `round`    | rounded genera such as `Acer`, `Tilia`, `Aesculus` or `Prunus`               |

A tree whose data gives no form, and every canopy tree, takes one of the three broadleaf forms; a
tree the data calls broadleaved keeps to them. Each tree's form, size, turn and shade come from a
stable hash of where it stands, so it looks the same at every zoom and on every device. Points in a
tile's buffer belong to the neighbouring tile, so no tree stands twice.

## Design the trees in the map

Colours come from the theme: `vegetation.tree.bark`, `vegetation.tree.broadleaf.a` to `.d`,
`vegetation.tree.conifer.a` to `.c` and `vegetation.tree.palm.a` to `.c`, sunlit, from darkest to
lightest. A crown facing a sunlit sky takes its colour; shade takes the sky's light, as on 3D
buildings. The vegetation module's `threeDimensional` options refine them for one map:

<!-- docs:check -->

```ts
import {defineMap, token, vegetation} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'subtropical-city',
  name: 'Subtropical city',
  version: 1,
  extends: streets,
  modules: {
    vegetation: vegetation({
      mode: '3d',
      threeDimensional: {
        barkColor: token.color('vegetation.tree.bark'),
        heightScale: 1.1,
        finish: 'toon',
        edges: 1,
        // Along this coast most trees the data does not describe are palms.
        regions: [{bounds: [-81.0, 24.4, -79.8, 26.9], unknownForms: {palm: 3, round: 1, open: 1}}],
      },
    }),
  },
});
```

`finish` sets how trees take the light: `faceted` (the default), low-poly facets softened towards a
round crown; `smooth`, round crowns; or `toon`, three bands of light and a crisp shadow, as a drawn
tree has them. `edges` rings each tree with an outline a constant width on screen, from 0 (none,
the default) to 1, in `edgeColor` or the crown's darkest colour deepened; buildings use the same
two words for their outlines.

`heightScale` and `crownScale` stretch every tree, and `forms` each form on top of them, such as
`forms: {palm: {heightScale: 1.2}}` for taller palms. `unknownForms` sets, as relative weights, the
forms of trees whose data gives none, and `regions` sets them inside `[west, south, east, north]`
bounds in degrees, the first region holding a tree applying. They are a choice of look, not data:
they never change a tree whose data gives its form, and as mapping improves they apply to fewer
trees.

## Your own trees

A map can draw a form with its own models. Put glTF binaries (`.glb`) in a directory, declare it in
the map's `models`, and name the models a form draws by their file names:

<!-- docs:check -->

```ts
import {defineMap, vegetation} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'palm-coast',
  name: 'Palm coast',
  version: 1,
  extends: streets,
  // ./models holds sabal-palm.glb and royal-palm.glb, and sabal-palm.far.glb for far trees.
  models: ['./models'],
  modules: {
    vegetation: vegetation({
      mode: '3d',
      threeDimensional: {
        forms: {palm: {models: ['sabal-palm', 'royal-palm'], heightScale: 1.1}},
      },
    }),
  },
});
```

Each tree of the form draws one of its models, one to four, by its stable hash, so a palm keeps its
model wherever it is read. The data still chooses each tree's form and size: a model replaces how a
form looks, not which trees take it.

How to prepare a model:

- **Materials name the parts.** Name each material `bark`, `leaves`, `fronds` or `stem` (an
  exporter's `.001` suffix is ignored). Each part takes its theme colours, as Core's trees do; the
  material's colour and any vertex colours set how light or dark each part of the model is within
  them, so the model follows the theme from day to night.
- **The origin is where the trunk meets the ground**, with the tree above it. Tileflow stands the
  model as a unit tree: its top is the tree's height, and its widest leaf half its crown.
- **Budgets.** A model has at most 1,000 triangles and 4,096 vertices; `<id>.far.glb`, drawn
  beyond the nearest tiles, at most 120 triangles. Without a far model, the form's own far tree
  stands in. A map draws at most 16 models.
- **What is read.** Triangles of the default scene with their node transforms; textures,
  animations and compressed geometry (Draco or meshopt) are not. Export without compression.

`tileflow preview` and every build read the models, report a problem with the file and what to
change, and watch the directories. The models travel inside the compiled style, so they need no
files of their own when the map is deployed. A later directory's model replaces an earlier one of
the same name; omitting `models` inherits them, and `[]` declares none.

## Light and shadows

The light comes from `controller.getSun()`: the theme's sun, mixed during a blend, or the sun an
application places by direction or by date and place (see
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md)).
Leaves take light round their edges and glow a little against a low sun; the underside and the
inside of a crown stay darker.

Trees and 3D buildings on one map share one shadow map: trees cast shadows on the ground and on the
buildings, and stand in the buildings' shade. The flat map darkens under both. Without 3D buildings
the trees darken the map themselves.

## Options

`minzoom` (15 by default) and `maxTiles` (25 by default, at most 64) bound where and how far trees
stand; trees thin out and fade with distance from the map's centre, and near trees take more detail
than far ones. `canopySource` names a vector source with canopy points when they are not in the
map's World source. `beforeId` places the layer before another one; `transformRequest` applies the
map's request rules to the tiles the layer reads. Layers that read the same source share each
tile's download.

## Cost

A near tree has 60 to 120 triangles and a far one about 20, and each form is one instanced draw per
tile. The shadow map is drawn again only when the sun, the trees on screen or their size change, not
when the camera moves. Over the Champ de Mars in Paris, where OpenStreetMap maps every tree, about
13,000 trees stand in a pitched view at zoom 16.6.

## Limits

- Mercator only; the layer draws nothing below its `minzoom`.
- No terrain: trees stand on flat ground.
- No wind or seasons; one form per tree.
- Models replace a form's look; a model per genus or species is not available.
