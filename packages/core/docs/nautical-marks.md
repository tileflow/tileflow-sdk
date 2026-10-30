# Nautical marks

The `nautical` module draws navigation marks from a `nautical-v1` vector source: buoys, beacons,
lighthouses, lights that flash in their rhythm, rocks and other hazards, wrecks, reefs, navigation
areas, routes, submarine and overhead cables, bridges with their clearances, harbours, marinas,
berths, small-craft facilities, inland notice boards, waterway distance marks, ports, and a
restrained indication of where a provider publishes marks. It is reference cartography for
general-purpose maps. It is not a nautical chart, and a map that draws it always shows a "Not for
navigation" notice.

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
comma-separated in source order, for example `black,yellow`. Clearances, depths, and heights are in
metres. `tileflowNauticalV1Schema` lists the field names, layers, geometry types, and known
providers: `openstreetmap` (coverage class `community`), `nga-list-of-lights` (`list`), and the
`chart` providers `noaa-office-of-coast-survey` and `usace-ienc` (U.S. Army Corps of Engineers
Inland ENCs). The source's TileJSON owns every provider credit.

| Source layer      | Geometry                   | Fields the module reads                                                                                            |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `aid`             | Point                      | `class`, `subclass`, `category`, `color`, `rank`, `name`, `information`, `distance`, `distance_unit`               |
| `light`           | Point                      | `class` (`major` or `minor`), `color`, `label`, `rank`, `character`, `group`, `period_s`, `sequence`               |
| `hazard`          | Point, LineString, Polygon | `class`, `water_level`, `name`                                                                                     |
| `wreck`           | Point, Polygon             | `class`, `name`                                                                                                    |
| `reef`            | Polygon                    | `name`                                                                                                             |
| `navigation_area` | Point, LineString, Polygon | `class`, `subclass`, `size`, `rank`, `name`, `vertical_clearance` and its `_closed`, `_open`, and `_safe` variants |
| `coverage`        | Polygon                    | `families`                                                                                                         |
| `sounding`        | Point                      | `depth`                                                                                                            |

The Nautical source promotes each light's `provenance` as its feature ID
(`promoteId: {light: 'provenance'}`), so lights can be animated with MapLibre feature state.

Every layer filters on `min_zoom`, so a compatible source that keeps features in lower-zoom tiles
still shows each one from its own first zoom. Point groups place a lower `rank` first.

## Semantic groups

Each group is a style option of `nautical(...)`, with the same marker, symbol, area, and line style
objects as other modules.

| Option            | Draws                                                                        | Default symbology                                         |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `buoys`           | `aid` buoys, light floats, and light vessels                                 | Circle in the first colour, ringed with the second        |
| `beacons`         | `aid` beacons and daymarks                                                   | Small circle in the first colour                          |
| `lighthouses`     | `aid` lighthouses                                                            | Ink circle and name                                       |
| `aids`            | Other `aid` classes, such as moorings, fog signals, and racons               | Small hollow circle                                       |
| `lights`          | `light` points, one per sector                                               | Flare in the light's first colour and its chart `label`   |
| `hazards`         | `hazard` points                                                              | `+` for rocks, `*` for rocks that show; circled obstacles |
| `hazardAreas`     | `hazard` polygons; the outline also strokes linear hazards                   | Accent wash with a dotted outline                         |
| `wrecks`          | `wreck` points                                                               | `Wk`, in the accent colour when dangerous                 |
| `wreckAreas`      | `wreck` polygons                                                             | Ink wash with a dashed outline                            |
| `reefs`           | `reef` polygons                                                              | Sand wash with a dotted outline                           |
| `navigationAreas` | `navigation_area` polygons                                                   | Dashed outlines; accent for operational areas             |
| `routes`          | `navigation_area` lines of class `route` and `traffic-separation`            | Dashed line; accent for traffic separation                |
| `cables`          | `navigation_area` lines of class `cable`, `pipeline`, and their area classes | Fine dashed accent line                                   |
| `overheadCables`  | `navigation_area` lines of class `overhead-cable`                            | Dash-dot accent line                                      |
| `bridges`         | `navigation_area` bridge polygons; the outline also strokes bridge lines     | Land-coloured deck with an ink outline                    |
| `berths`          | `navigation_area` berth polygons; the outline also strokes berth lines       | Thin ink outline, wider and darker for `guest` berths     |
| `harbourAreas`    | `navigation_area` harbour and marina polygons                                | Faint ink wash with a solid outline                       |
| `harbours`        | `navigation_area` harbour points, and a symbol inside harbour polygons       | Ink circle and name; the marina token for marinas         |
| `facilities`      | `navigation_area` facility points, polygons, and line centres, from zoom 13  | Hollow circle; facility icons from the theme              |
| `notices`         | `aid` notice boards, from zoom 12                                            | Circle in the board's function colour and `information`   |
| `distanceMarks`   | `aid` distance marks, from zoom 11                                           | Ink dot and distance with its unit, fainter if not posted |
| `ports`           | `navigation_area` points of class `port`                                     | Ink circle and name sized by `size`, from low zooms       |
| `coverage`        | `coverage` polygons that cover every family                                  | Faint tint at low zooms only                              |
| `soundings`       | `sounding` points                                                            | Depth figure                                              |
| `labels`          | Names inside polygons, bridge and overhead-cable clearances; coverage opt-in | Collision-aware text                                      |

Bridge, berth, facility, and harbour polygons are drawn by their own groups rather than as
navigation areas. `labels.bridges` shows `clearance 4.5 m`, or `closed 3.6 m · open 12 m` for an
opening bridge, at bridge points, inside bridge polygons, and at the centre of bridge lines, from
zoom 13. `labels.overheadCables` shows `safe clearance 28.5 m`, or the plain clearance, at cable
points and along cable lines. Distance marks read `12 km`, `5 hm`, `300 m`, `12 mi`, or `4.5 NM`
from zoom 13. Notice boards follow the CEVNI colours: red for prohibitions, regulations, and
restrictions, green for recommendations, and blue for information; their `information`, such as a
speed limit, appears from zoom 14. Board orientation and impact are not drawn.

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

## Flashing lights

In React, Vue, Svelte, and the development preview, every light with a rhythm flashes: its flare or
circle draws at its styled opacity while the light shines and at 15 % of it during an eclipse.
Fixed lights, lights without a usable characteristic, reduced motion, capture, native renderers, and
static images show every light steadily, exactly as it is styled. Set `animateLights: false` to keep
a map's lights steady everywhere:

<!-- docs:check -->

```ts
import {defineMap, nautical} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'harbour-guide',
  version: 1,
  extends: streets,
  marine: 'nautical',
  modules: {nautical: nautical({animateLights: false})},
});
```

A light flashes by its published `sequence` when it has one: light and eclipse durations in
seconds, eclipses in parentheses, for example `0.5+(1.5)+0.5+(4.5)`. Otherwise
`tileflowLightRhythm(properties)` derives a conventional rhythm from `character`, `group`, and
`period_s`; `tileflowLightRhythmConventions` holds the values below.

| Character                             | Rhythm                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Fl`                                  | Flashes of `min(1 s, 0.3 × period ÷ flashes)`; gaps within a group at most twice the flash             |
| `Fl` with a group such as `2+1`       | Groups separated by twice the inner gap; the rest of the period is the final eclipse                   |
| `LFl`                                 | The same layout with 2 s flashes, shorter only when the period cannot hold them                        |
| `Q`, `VQ`, `UQ`                       | 60, 120, and 240 flashes a minute, lit for 30 % of each; a group of `n` flashes then eclipses          |
| `IQ`, `IVQ`, `IUQ`                    | Quick flashes for 60 % of the period, then an eclipse                                                  |
| `Iso`                                 | Equal light and eclipse                                                                                |
| `Oc`                                  | Eclipses totalling 25 % of the period, laid out like `Fl`, so the light is always longer               |
| `Mo`                                  | The Morse letter in `group`: 0.5 s dots, three-unit dashes, one-unit gaps, then the rest of the period |
| `FFl`, `F+LFl`                        | A fixed light at half intensity with full flashes, or long flashes                                     |
| `Q+LFl`, `VQ+LFl`, `UQ+LFl`, `Fl+LFl` | The group (six quick flashes by default), one 2 s long flash, then the eclipse                         |
| `Oc+Fl`                               | Its occulting part                                                                                     |
| `Al.<character>`, `Al`                | Each lit phase shows the next colour of `color`; `Al` alone shows each colour for an equal share       |
| `F`, unknown, or missing period       | Steady; grouped `Q` and `VQ` cardinal marks without a period use the IALA periods                      |

`tileflowLightStateAt(rhythm, seconds)` returns the intensity, colour index, and time to the next
change at any moment. Lights with the same rhythm flash together.

React, Vue, Svelte, the development preview, and standalone capture call
`attachTileflowNauticalLights(map)` from `@tileflow/core/browser`. It reads the light layers the
style declares in `metadata['tileflow:nautical-lights']`, and writes each rendered light's
`tileflowLightIntensity` and `tileflowLightColour` feature state only when its phase changes. It runs
one timer for the next change, and none while the page is hidden, while no light layer is visible at
the current zoom, or under reduced motion. A direct MapLibre integration attaches it after
constructing the map:

```ts
import maplibregl from 'maplibre-gl';
import {attachTileflowNauticalLights, attachTileflowNotices} from '@tileflow/core/browser';

const map = new maplibregl.Map({
  container: 'map',
  style: '/tileflow/styles/harbour-guide/light.json',
});
attachTileflowNotices(map);
const detach = attachTileflowNauticalLights(map);
// Call detach() to return every light to steady; removing the map also detaches it.
```

`steadyTileflowNauticalLights(style)` returns a copy that draws every light steadily without feature
state; native artifact preparation applies it automatically.

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
| `nautical.marina`         | Harbours whose `subclass` lists a marina   |
| `nautical.port`           | `ports`                                    |
| `nautical.notice`         | `notices`                                  |
| `nautical.notice.<role>`  | Notices of that function                   |
| `nautical.distance-mark`  | `distanceMarks`                            |
| `nautical.facility`       | `facilities`                               |
| `nautical.facility.<cat>` | Facilities listing that category           |

Notice roles are `prohibition`, `regulation`, `restriction`, `recommendation`, and `information`.
Facility categories are `fuel-station`, `slipway`, `boat-hoist`, `pump-out`, `water-tap`,
`visitor-berth` (also used for `visitors-mooring`), and `boatyard`: a facility listing several shows
the first in that order (`tileflowNauticalFacilityIcons`), and the others show `nautical.facility`.
Every icon expression selects among the declared image names only.

Buoys, beacons, other aids, and lights colour their icon with the mark's own colour, so declare
them as [SDF icons](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-icons.md)
that share one representation within each group. The defaults size icons for the SDF profile,
whose drawing occupies the central 12 of 24 pixels; set `icon.size` for other artwork. Notice
boards take their function colour. Soundings declares these tokens with its own buoy, light,
lighthouse, wreck, harbour, marina, notice-board, distance-mark, and facility symbols and keeps
beacons as coloured dots.
