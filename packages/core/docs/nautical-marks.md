# Nautical marks

The `nautical` module draws navigation marks from a `nautical-v1` vector source: buoys, beacons,
lighthouses, lights, rocks and other hazards, wrecks, reefs, navigation areas, routes, cables,
harbours, ports, and a restrained indication of where a provider publishes marks. It is reference
cartography for general-purpose maps. It is not a nautical chart, and a map that draws it always
shows a "Not for navigation" notice.

## Enable Nautical on a map

Nautical is opt-in through the map's `marine` option. `'nautical'` adds it alone, `'chart'` adds it
with Bathymetry, and the object form selects or replaces each member. The official Soundings map
enables it with its own chart symbols; every other official map draws it with the module's default
symbology once the map opts in.

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'harbour-guide',
  version: 1,
  extends: streets,
  marine: 'nautical',
  view: {center: [-1.3, 50.77], zoom: 12},
});
```

`marine` is atomic: declaring it replaces the inherited value. Without a URL, the source is the
TileJSON at `/tiles/nautical/tiles.json` on the map's API base, with the style source ID
`tileflow-nautical`. Compiling a map that names this URL does not establish that a hosted Nautical
source is available to it. To use any schema-compatible source, name its TileJSON or PMTiles
archive and, when the TileJSON does not carry one, its attribution:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'harbour-guide',
  version: 1,
  extends: streets,
  marine: {
    bathymetry: false,
    nautical: {
      url: 'https://tiles.example.com/nautical/tiles.json',
      attribution: '© Example © OpenStreetMap contributors',
    },
  },
});
```

The selected TileJSON owns the provider credit. Core never invents a nautical provider or
attribution, and an explicit `attribution` replaces the one the TileJSON supplies.

## The "Not for navigation" notice

When any layer of the compiled style reads the Nautical source, the style declares a notice in its
`tileflow:notices` metadata:

```json
[
  {
    "id": "nautical-not-for-navigation",
    "sources": ["tileflow-nautical"],
    "text": "Not for navigation"
  }
]
```

React, Vue, Svelte, the development preview, and standalone capture render it as a compact,
always-visible control beside the attribution, and keep it in step with style replacements. A map
that does not draw Nautical, including one whose `nautical` module is disabled, declares no notice.
The notice is separate from the source attribution, so the provider credit stays complete.

A direct MapLibre integration attaches the same control after constructing the map:

```ts
import maplibregl from 'maplibre-gl';
import {attachTileflowNotices} from '@tileflow/core/browser';

const map = new maplibregl.Map({
  container: 'map',
  style: '/tileflow/styles/harbour-guide/light.json',
});
const detach = attachTileflowNotices(map, {position: 'bottom-right'});
// Call detach() to remove the control early; removing the map also removes it.
```

`readTileflowNotices(style.metadata)` returns the bounded notices of a style for an application
that draws its own legend or exports images by other means. Show the notice wherever such a map is
displayed.

## Source layers and fields

Every feature carries `provider`, `provenance`, `edition`, `coverage`, `licence`, and `min_zoom`,
the first zoom at which the feature appears. `rank` (1 is the most important feature of its layer)
and `name` are optional. Colours are S-57 colour names, and multi-valued colours and categories are
comma-separated in source order, for example `black,yellow`. `tileflowNauticalV1Schema` lists the
field names, layers, and geometry types.

| Source layer      | Geometry                   | Fields the module reads                                  |
| ----------------- | -------------------------- | -------------------------------------------------------- |
| `aid`             | Point                      | `class`, `subclass`, `category`, `color`, `rank`, `name` |
| `light`           | Point                      | `class` (`major` or `minor`), `color`, `label`, `rank`   |
| `hazard`          | Point, LineString, Polygon | `class`, `water_level`, `name`                           |
| `wreck`           | Point, Polygon             | `class`, `name`                                          |
| `reef`            | Polygon                    | `name`                                                   |
| `navigation_area` | Point, LineString, Polygon | `class`, `size`, `rank`, `name`                          |
| `coverage`        | Polygon                    | `families`                                               |
| `sounding`        | Point                      | `depth`                                                  |

Every layer filters on `min_zoom`, so a compatible source that keeps features in lower-zoom tiles
still shows each one from its own first zoom. Point groups place a lower `rank` first.

## Semantic groups

Each group is a style option of `nautical(...)`, with the same marker, symbol, area, and line style
objects as other modules.

| Option            | Draws                                                                           | Default symbology                                         |
| ----------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `buoys`           | `aid` buoys, light floats, and light vessels                                    | Circle in the first colour, ringed with the second        |
| `beacons`         | `aid` beacons and daymarks                                                      | Small circle in the first colour                          |
| `lighthouses`     | `aid` lighthouses                                                               | Ink circle and name                                       |
| `aids`            | Other `aid` classes, such as moorings, fog signals, and racons                  | Small hollow circle                                       |
| `lights`          | `light` points, one per sector                                                  | Flare in the light's first colour and its chart `label`   |
| `hazards`         | `hazard` points                                                                 | `+` for rocks, `*` for rocks that show; circled obstacles |
| `hazardAreas`     | `hazard` polygons; the outline also strokes linear hazards                      | Accent wash with a dotted outline                         |
| `wrecks`          | `wreck` points                                                                  | `Wk`, in the accent colour when dangerous                 |
| `wreckAreas`      | `wreck` polygons                                                                | Ink wash with a dashed outline                            |
| `reefs`           | `reef` polygons                                                                 | Sand wash with a dotted outline                           |
| `navigationAreas` | `navigation_area` polygons                                                      | Dashed outlines; accent for operational areas             |
| `routes`          | `navigation_area` lines of class `route` and `traffic-separation`               | Dashed line; accent for traffic separation                |
| `cables`          | `navigation_area` lines of class `cable`, `pipeline`, and their area classes    | Fine dashed accent line                                   |
| `harbours`        | `navigation_area` points of class `harbour`                                     | Ink circle and name                                       |
| `ports`           | `navigation_area` points of class `port`                                        | Ink circle and name sized by `size`, from low zooms       |
| `coverage`        | `coverage` polygons that cover every family                                     | Faint tint at low zooms only                              |
| `soundings`       | `sounding` points                                                               | Depth figure                                              |
| `labels`          | Names inside hazard, navigation-area, reef, and wreck polygons; coverage opt-in | Collision-aware text                                      |

Operational areas are restricted, military, anchorage, anchor-berth, dumping-ground, and
traffic-separation areas. Marks keep their conventional colours in every theme; a white light is
drawn as a warm yellow so it remains visible on pale water. Ink, halo, and accent come from the
theme's `hydro.label`, `hydro.water`, and `poi.transport` colours, so a theme can restyle Nautical
without new options. Override any group like any other module style:

<!-- docs:check -->

```ts
import {defineMap, fixed, nautical} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'harbour-guide',
  version: 1,
  extends: streets,
  marine: 'nautical',
  modules: {
    nautical: nautical({
      buoys: {minZoom: 12},
      cables: {visible: false},
      navigationAreas: {
        fill: {opacity: fixed(0.04, {reason: 'Keep operational areas quiet on the base map'})},
      },
      labels: {coverage: {visible: true}},
    }),
  },
});
```

## Chart symbols from the theme

A theme that declares the image tokens below replaces a point group's circle marker with that icon.
Buoy variants fall back to `nautical.buoy`. `tileflowNauticalImageRoles` lists the tokens.

| Token                     | Group                                      |
| ------------------------- | ------------------------------------------ |
| `nautical.buoy`           | `buoys`                                    |
| `nautical.buoy.port`      | Lateral buoys of a port-hand category      |
| `nautical.buoy.starboard` | Lateral buoys of a starboard-hand category |
| `nautical.buoy.cardinal`  | Cardinal buoys                             |
| `nautical.beacon`         | `beacons`                                  |
| `nautical.lighthouse`     | `lighthouses`                              |
| `nautical.light`          | `lights`                                   |
| `nautical.aid`            | `aids`                                     |
| `nautical.wreck`          | `wrecks`                                   |
| `nautical.harbour`        | `harbours`                                 |
| `nautical.port`           | `ports`                                    |

Buoys, beacons, other aids, and lights colour their icon with the mark's own colour, so declare
them as [SDF icons](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-icons.md)
that share one representation within each group. The defaults size icons for the SDF profile,
whose drawing occupies the central 12 of 24 pixels; set `icon.size` for other artwork. Soundings
declares these tokens with its own buoy, light, lighthouse, wreck, and harbour symbols and keeps
beacons as coloured dots.
