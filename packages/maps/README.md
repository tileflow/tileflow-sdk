# @tileflow/maps

Official Tileflow maps with their icon, pattern, and font assets. Extend a map with
`@tileflow/core`; render its prepared output with a framework adapter or MapLibre.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/maps@alpha @tileflow/core@alpha
```

Core is a peer dependency: it owns the map language and compiler. This package owns map definitions
and assets. It does not include a tile archive, a browser renderer, or a hosted service subscription.

## Use an official map

Create `tileflow.config.ts`:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  defaultTheme: 'dark',
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

This inherits Streets' themes and changes only the default selection and initial view.
Coordinates are `[longitude, latitude]`. To preview it:

```sh
npm install --save-dev --save-exact tileflow@alpha
npx tileflow validate
npx tileflow preview
```

Rendering can request remote tiles, glyphs, or terrain. Installing the package does not make those
resources available offline.

### Develop Streets in an SDK checkout

After installing and building this workspace, run from its root:

```sh
node packages/cli/dist/index.js preview --config packages/maps/tileflow.config.ts
```

Open `http://127.0.0.1:3333`. Source edits reload in Map DevTools without publishing.
Add `--scene nyc` for New York or `--against-theme dark --map streets-workbench` to compare themes.
The CLI owns the interface; compiler and runtime changes require rebuilding those packages.

## Choose a map

- `streets`: contemporary street cartography with Mapbox-inspired time-of-day and color themes,
  ranked POIs, generic road-reference shields, and regional hillshade.
- `baedeker`: warm travel-atlas styling, serif labels, original engraved patterns, and contours.
- `civica`: illustrated civic-print styling with warm paper, olive parks, blue annotations, and
  vermilion landmarks.
- [`map1777` (1777)](docs/map-1777.md): 1777 ink and watercolor on current data, with 3D and four times of day.
- `siegfried`: a terrain atlas with coordinated light/dark ink palettes, contours, and engraved patterns.
- `soundings`: bathymetric reference cartography with depth bands, continuous relief, and port context.
- `blueprint`: a dark architectural drawing style, with a default camera centered on San Francisco.

Every official map is a complete, independent root using the same Core compiler. Official map
objects are deeply frozen shared instances. Do not mutate them; use `defineMap({extends: ...})`
to create an application-owned map.

### Streets appearance

Streets follows the visual direction of [Mapbox Standard](https://docs.mapbox.com/playground/standard-style/)
(twelve theme/time combinations), calibrated on 2026-10-18. DevTools offers **Default**, **Faded**, and
**Monochrome** in its Theme control, independently of the Time of day control's `day`, `dawn`,
`dusk`, and `night` presets. Each of the twelve combinations selects a complete theme, including
its map colors and artwork. Default retains the configuration key `light` for compatibility:
`theme="light" timeOfDay="night"` selects `dark`, while `theme="light" timeOfDay="day"`
selects `light`. The other concrete themes are `dawn`, `dusk`, `faded`, `monochrome`,
`dawn-faded`, `dawn-monochrome`, `dusk-faded`, `dusk-monochrome`, `dark-faded`, and
`dark-monochrome`. Dawn and day use light artwork; dusk and night use dark artwork. Time presets
adjust authored map colors; selecting one does not apply a global lighting tint to the flat map.
Ground, water, vegetation, roads, zoning, labels and halos use independently evaluated colors
from Standard's 2026-10-08 style, including each material's theme LUT, lighting, emission and
transparency. Ground colors are checked against sRGB framebuffer samples from Mapbox GL JS
3.28.1 across all twelve combinations; footprints and 3D roofs use separate GPU measurements.
Water retains its own material and zoom 5–7 / 13–14 transitions; it no longer inherits a
swimming pool's color offset. Background emission changes between zoom 13 and 14. These values
are baked into theme tokens, so they add no lighting or LUT work per frame.
Scene-sun lighting preserves unshadowed roof paint while allowing light color to affect walls.
The underlying tile data and rendering pipeline differ, so these are close palette matches rather
than a pixel-identical copy. Streets' own semantic design retains slate-blue
roads, uppercase road names, warm building footprints, green parks, and compact category-colored
POI discs. Dark mode uses pale discs with dark pictograms. Pictograms adapted from Maki follow
World's transport mode and POI type: metro, rail, tram, bus, ferry, cable-car, and airport stations
are distinct, as are bars, cafés, museums, galleries, car dealers, and places of worship by
religion.

The reference uses DIN Pro Medium for POIs, roads, major settlements, and districts.
Streets uses hosted Noto Sans Regular for these roles: Noto Sans Bold makes their strokes and
word widths too heavy at the reference's sizes. Bold is reserved for administrative regions and
road shields; water labels keep Italic. This is a visual approximation, not a bundled DIN face.
POI discs use vivid category colors, 20px containers, and fixed native icon scale at every zoom.
Maki's 15px artwork is composed into a centered 12px box, leaving room inside the 17px colored
interior. Their 1x and 2x atlases rasterize these SVG compositions separately; the map displays
each complete icon at native scale instead of rescaling the bitmap as the zoom changes.

The light surface palette is compared with lossless captures of Standard with 3D buildings and
trees disabled. Parks use a stronger green with lighter lawns and meadows drawn above them;
flat buildings use a neutral cream. City roads keep the same slate-blue family through the
z14–z15 transition, with blue borders and translucent tunnels. Road widths retain their hierarchy.
Road carriageways follow the reference's exponential zoom curves (base 1.5), including
fractional zooms. Motorways and trunks start at z3, primary roads at z6, secondary and tertiary
roads at z8, streets and links at z12, and service roads at z15. Surface casings begin at z15
(z16 for service roads and tracks); they grow from a fine edge independently of the matching
carriageway gap. This keeps regional views light while preserving detail at street zooms.
Motorway and trunk links retain their class colors and narrower widths. On the surface and on
bridges, their fills draw before the receiving carriageways so overlapping round endpoints do
not leave a contrasting patch over a junction. Tunnels keep their separate treatment.
Surface and bridge casings are continuous; tunnel casings are dashed. Construction carriageway
fills and marks draw below roads in service, including motorway ramps.
Borders use Standard's 2026-10-08 style, theme LUTs and unshadowed ground lighting, without
carriageway emissive lift. HD-road borders match across classes, bridges, tunnels and roundabouts
from z15; lower-zoom tunnels retain class colors. Paths keep separate emission. Streets uses the reference border colors without an additional darkening multiplier. These baked
2D colors exclude fog and Standard's full lighting pipeline.
Surface caps become round at z14; tunnels retain butt caps and bridges use round fills.
The road regression checks every quarter zoom from 0 through 24 and both sides of the handoffs.
Crosswalks and one-way arrows fade in from z16.5 so city-scale roads retain their surface color.
From z13, pedestrian plazas use an opaque pale surface above commercial zoning and below
explicit grass, gardens and parks. The `roads.pedestrian.surface` token follows the ground's
theme and time of day. From z17, mapped sidewalks add a translucent tint and dot pattern through
`roads.sidewalk.surface`, preserving the underlying ground color.
Mapped parking polygons use an opaque neutral fill above overlapping vegetation and below
roads. This requires a `landuse` polygon classified as `parking`; parking POIs and aisle lines
alone do not provide the boundary needed to fill the surface.
Hedges (from z15, shaded from z17), fences and walls (from z16) come from `traffic_control`.

Ferry routes fade in from z8, use fine blue dashes from z13, and show uppercase route names
along the line from z15 when the data includes them. Their labels use a water-colored halo.

Regional hillshade uses [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
from z5 through z13, with source attribution. The 256-pixel Terrarium source is capped at native z12;
closer views reuse that resolution, avoiding requests for coverage-dependent high-resolution DEM tiles. This is an additional remote data request. To omit
it, set `terrain: 'none'` in a map extending `streets`. Hillshade does not change road geometry or
raise the terrain. Buildings appear automatically from zoom 15 with an opacity fade through 15.25;
the preview's **3D** control can hide them, and its **Trees** control enables vegetation.
Road shields and exit references use 10 px text. Category text and halos follow the reference's
emission and palette without a separate contrast recoloring step; marker artwork retains its
own colors.
3D lights use Standard's effective theme presets, retrieved on 2026-10-18: southern sun by day,
southeast at dawn, southwest at dusk and western moonlight at night. Monochrome has distinct
directions and strengths. Tileflow holds zoom 14+ values; Standard varies intensity below z14.
Shading differs; `controller.setSun({date, location})` uses the real sun instead of presets.
The buildings' `threeDimensional.lighting` and `shadows` options control the effect, and each
theme's `lighting.sun.shadowIntensity` and `lighting.ambient` control its strength.
Street lights are opt-in: set `roads.streetLights.enabled: true`.
Core's 3D renderer
adds a soft ten-percent shade at the foot of the facades, fading within the lowest three metres
(less on low buildings). Exterior corners have a 0.8 m radius and the roof/wall junction has a narrow
lighting transition; roofs keep their authored colour. Streets enables soft three-metre contact
shadows without dark overlaps; `buildings.threeDimensional.occlusion: false` disables them.
Core replaces the extrusion fallback's blurred bands, styled by `buildings.contactShadow`.
Streets selects Core's `labels.roadPlacement: 'ground'`: street names follow the road plane below
buildings; POIs, transit names and shields remain above. Disabling roads omits their names.
Road rings, ramp and surface ordering use [Core's replaceable defaults](../core/docs/cartographic-defaults.md).
Streets owns its colors, widths, typography and optional time-of-day themes.
Browser atmosphere is separately enabled with `atmosphere: true` on a globe map; the base definition
also remains usable with Mercator and native targets.

Streets enables model trees by default (`mode: '3d'`, `fallback: 'none'`). They stay three-dimensional
in overhead and tilted interactive browser views. Disabling vegetation removes all trees. Renderers
without model support omit them. Extensions can opt into the included flat crown artwork with
`vegetation: refine({mode: 'flat'})`, or switch it with explicit view mode using `mode: 'auto'`.
Seven original forms cover rounded, spreading and upright broadleaf trees, conifers, columns,
feather palms and fan palms. Their light/dark crown images come from the same geometry as the
models. Broadleaf trees have flared trunks, visible forks and separated crown clusters, with
both compact and open silhouettes. This artwork does not change the map's lighting.

All twelve presets independently style bark and crowns from tilted Standard samples, preserving
geometry. Mesh and lighting differences prevent identical pixels.

The models have 120–386 triangles nearby and 44–96 at distance. They reuse Core's instanced tree
renderer; flat crowns use the existing sprite atlas. Tree locations and attributes still come
from the source tiles. The artwork does not add trees to parks whose data has none. See
[3D trees](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/trees-3d.md) for
browser rendering and platform support. To remove both representations, extend the map:

<!-- docs:check -->

```ts
import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'streets-without-trees',
  version: 1,
  extends: streets,
  modules: {vegetation: disable()},
});
```

POI categories use World eligibility and ranks at one density and are placed in one importance
order, so a category never displaces a more important place of another category. World's two most
important ranks are placed before street and place names. Each disc needs its name; parking and
toilets appear as a disc alone, and other unnamed POIs are omitted.
Ordinary POI and transit names use 13 px lettering, with 18 px for the highest-priority destinations.
World's size ranks differ from the reference, so a small park with size rank zero does not become
a large destination label by that value alone. Text padding falls from 6 px to 4 px between z16
and z17, and collision determines which names fit.

City labels hand over at z15, smaller settlements at z13, and districts at z15. Co-located city
candidates share one anchor to prevent duplicate names at world scale. Districts retain an overview
rank gate below z12; from z12 onward, source availability and collisions control their appearance
because World ranks can change between tile zooms. Street names use 0.15 em letter spacing and
a 1 px halo; administrative regions use bold lettering and water names use italic lettering.
House numbers appear from z17 with wide collision padding. Local-language labels remain the default.

The map uses Tileflow data and assets, including hosted Noto Sans Regular, Bold, and Italic. The
reference's DIN Pro Medium is not part of that glyph provider, so font shapes and stroke weight
remain an approximation. Available POIs, abbreviated names,
proprietary landmark models, transit branding, and building detail can differ from the reference.
See [map design and asset provenance](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/docs/design-and-assets.md).

### Blueprint naming

Use `blueprint` and `blueprintIcons` for the architectural drawing map. Its map ID and
asset directory are `blueprint`, its theme key is `blueprint`, its theme ID is `blueprint-dark`,
and its grid artwork ID is `blueprint-grid`.

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {blueprint} from '@tileflow/maps';

export default defineMap({
  id: 'city-plan',
  version: 1,
  extends: blueprint,
  view: {center: [-3.7038, 40.4168], zoom: 14},
});
```

### Community maps

Cyberpunk, Terminal, and Super Tile World are maintained in
[Tileflow Community Maps](https://github.com/tileflow/community-maps), with editable source,
assets, previews, and contribution instructions. They are not part of this package.
The GitHub-distributed `@tileflow/community-maps` package exports `cyberpunk`, `terminal`, and
`superTileWorld`, plus each map's font and icon descriptors. Install an exact Git commit using
the instructions and compatible Core version in that repository.

Soundings is not a navigation product; its depth-band edges are approximate. It draws Nautical
marks with its chart symbols and a "Not for navigation" notice; other maps opt in with
`marine: 'nautical'` (see Core's Nautical marks guide).

## Themes and assets

`streetsThemes` and `siegfriedThemes` expose complete `light` and `dark` themes. Import those
collections when using `defineTheme()` to derive a new appearance. A declared `themes` collection
replaces the inherited collection, so also declare the intended `defaultTheme` and `systemThemes`
and optional `timeOfDay` mappings. `system` belongs to browser selection; captures and builds use concrete theme names.

Every map exports an icon-directory descriptor: `streetsIcons`, `baedekerIcons`, `civicaIcons`,
`map1777Icons`, `siegfriedIcons`, `soundingsIcons`, and `blueprintIcons`. The descriptors point into this installed package; they are not sprite URLs.
The CLI and build integrations compile the selected directories into runtime assets.

Baedeker, 1777 and Siegfried export `baedekerFonts`, `map1777Fonts` and `siegfriedFonts` for
their packaged Cormorant Garamond faces.
Cívica exports `civicaFonts` for DM Serif Text, Barlow Semi Condensed, and Noto Sans fallback.
Streets, Soundings, and Blueprint declare Noto Sans URL glyph providers
from one immutable Hosted base-asset set, versioned independently of World data.

Omitting `icons` inherits the parent's directory list. Declaring a list replaces it; `[]` removes
all icon directories. Compose explicitly when adding application icons:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets, streetsIcons} from '@tileflow/maps';

export default defineMap({
  id: 'store-locator',
  version: 1,
  extends: streets,
  icons: [streetsIcons, './icons'],
});
```

Create `icons/` beside the config and add supported image files before building. Later directories
replace earlier files with the same exact icon ID. Fonts follow the same ordered-directory model;
`fonts` and `glyphs` are mutually exclusive providers.

## Delivery and attribution

Use the CLI or a build integration to prepare a map's complete asset set. Copying Style JSON alone
can leave missing sprites, font files, or browser protocols. Keep the generated manifest and its
referenced files together.

Hosted deployment currently requires Tileflow World and rejects local/package font bundles before
uploading a style. Maps with packaged fonts therefore need self-hosted delivery or an explicitly
replaced, compatible public glyph provider. Check with `tileflow validate --target hosted` before
planning a hosted deployment.

Tileflow-owned designs and artwork use Apache-2.0. Historical inspiration does not mean the package
redistributes historical scans, source cartography, or data. Third-party fonts and the pinned Maki
icon subset retain their own terms. Preserve
[THIRD_PARTY_NOTICES.md](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/THIRD_PARTY_NOTICES.md)
and the notices next to packaged assets. Map data and terrain services have separate attribution
and usage requirements.

See the [Core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
for inheritance and styling, or the
[public exports](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/src/index.ts)
for exact names. The installed package's definitions and README take precedence over a newer `main`.

## Design and asset reference

The [design and asset notes](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/docs/design-and-assets.md) describe each map's visual grammar, source references, and third-party asset boundaries. They are also included under
`docs/` in the installed package.

Streets offers three time-of-day families: `light` (displayed as Default), `faded`, and `monochrome`, each with
`day`, `dawn`, `dusk`, and `night`. For example, `theme="faded" timeOfDay="night"` resolves to
`dark-faded`. DevTools shows these as separate Theme and Time of day controls. All twelve
concrete theme names remain available for existing applications and captures. This catalog
is inherited when extending Streets without overriding it.
See the [time-of-day contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md#style-with-themes-and-semantic-modules).
