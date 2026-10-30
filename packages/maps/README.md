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

Open `http://127.0.0.1:3333`. Source edits reload in Inspector without publishing.
Add `--scene nyc` for New York or `--against-theme dark --map streets-workbench` to compare themes.
The CLI owns the interface; compiler and runtime changes require rebuilding those packages.

## Choose a map

- `streets`: contemporary street cartography with Mapbox-inspired time-of-day and color themes,
  ranked POIs, Madrid transit network symbols, generic road-reference shields, and regional hillshade.
- `baedeker`: warm travel-atlas styling, serif labels, original engraved patterns, and contours.
- `civica`: illustrated civic-print styling with warm paper, olive parks, blue annotations, and
  vermilion landmarks.
- `map1777` (1777): 1777 ink and watercolor on current data, with 3D and four times of day.
- `siegfried`: a terrain atlas with coordinated light/dark ink palettes, contours, and engraved patterns.
- `soundings`: bathymetric reference cartography with depth bands, continuous relief, and port context.
- `blueprint`: a dark architectural drawing style, with a default camera centered on San Francisco.

Every official map is a complete, independent root using the same Core compiler. Official map
objects are deeply frozen shared instances. Do not mutate them; use `defineMap({extends: ...})`
to create an application-owned map.

### Streets appearance

Streets has twelve theme/time combinations. Inspector offers **Default**, **Faded**, and
**Monochrome** independently of the Time of day control's `day`, `dawn`, `dusk`, and `night`
presets. Default retains the configuration key `light`: `theme="light" timeOfDay="night"`
selects `dark`, while `theme="light" timeOfDay="day"` selects `light`. The other concrete themes
are `dawn`, `dusk`, `faded`, `monochrome`, `dawn-faded`, `dawn-monochrome`, `dusk-faded`,
`dusk-monochrome`, `dark-faded`, and `dark-monochrome`. Each combination selects a complete
palette and artwork; time presets do not apply a global lighting tint to the flat map.

Scene lighting is calibrated against Mapbox Standard. Streets owns its cartography: slate-blue
roads with stronger regional outlines, neutral urban surfaces, pale warm rural ground, green
parks and subtle cream buildings. Its palette is not a fixed copy of the provider's reference
colors. Day uses category-colored POI discs; dark mode uses pale discs with dark pictograms.
Maki pictograms distinguish transport modes and POI types. Scene-sun lighting preserves
unshadowed roof paint while allowing light color to affect walls.

At regional scales, the default day theme uses a packaged, attributed climate underlay to
separate humid and dry regions. It fades out by zoom 11, where mapped land cover and land use
supply local detail. Climate is broad context, not a claim of surveyed vegetation at a specific
site. The other themes retain their own authored land-cover palettes. Urban and education
areas use neutral surfaces; farmland stays pale, while mapped orchards and nurseries remain
green. Underground footprints flagged `hide_3d` are omitted from the flat building layers. Streets
suspends duplicate flat building footprints in 3D so roads remain visible under open landmarks;
2D mode restores ordinary footprints. Normal 3D buildings keep a small neutral/active tone difference. Authored models use
the neutral building color and independently configurable window shading.

Streets packages DINish Medium for roads, house numbers and POIs, and Bold for shields, approximating
the reference's DIN Pro lettering. Other roles retain Noto Sans Regular, Bold and Italic. All
five faces ship with their licenses; DIN Pro is not bundled.
POI discs use vivid category colors, 20px containers, and fixed native icon scale at every zoom.
Maki's 15px artwork is composed into a centered 12px box, leaving room inside the 17px colored
interior. Their 1x and 2x atlases rasterize these SVG compositions separately; the map displays
each complete icon at native scale instead of rescaling the bitmap as the zoom changes.

The day road network keeps major routes distinct at regional and city scales. Motorways and
trunks gain a darker outline from z6 through z14, blending into the detailed treatment at z15.
Regional connector widths remain readable between towns; their city casing palette holds through z14.
Primary, secondary, tertiary and local roads widen slightly at intermediate zooms and converge
with their detailed profiles at z15. Local streets become readable when their geometry arrives
at z12. Casing passes sit below all receiving road fills, preventing exposed round segment caps
at junctions. Links remain narrower and draw before receiving roads. Tunnel casings are dashed;
surface and bridge casings are continuous. Construction fills and marks draw below roads in
service. Crosswalks and compact blue-gray arrows fade in from z16.5.

Daytime surface footpaths and cycleways use white strokes over mapped green ground and a
muted gray-earth stroke elsewhere, at 92% of their authored width and without a casing.
The shared `roads.pathGround` compiler and browser protocol clip the green portions from the
same vector tiles; a complete ground-colored path remains visible if context cannot load.
Road carriageway outlines draw above these paths. This treatment belongs to the Streets
definition and survives normal artifact regeneration; other themes retain their own path styles.
Road palettes, width profiles, building outlines and the overview backgrounds are authored here
in Maps; consumers inherit them without installing a separately edited style snapshot.

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
Streets rounds exterior building corners with a 1.5-metre radius and softens the roof-to-wall
lighting transition (`threeDimensional.edgeRadius: 1.5`). Courtyards and tile cuts retain their shape.
Shields use 9 px DINish Bold and closer spacing at z11–13. Street names yield to destinations
and draw above flat footprints but below 3D buildings, with viewport-aligned letters.
3D lights use Standard's effective theme presets, retrieved on 2026-10-18: southern sun by day,
southeast at dawn, southwest at dusk and western moonlight at night. Monochrome has distinct
directions and strengths. Tileflow holds zoom 14+ values; Standard varies intensity below z14.
Shading differs; `controller.setSun({date, location})` uses the real sun instead of presets.
Streets enables `camera.adaptivePerspective`. See camera, landmark and lighting settings in
[3D buildings](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).
The buildings' `threeDimensional.lighting` and `shadows` options control the effect, and each
theme's `lighting.sun.shadowIntensity` and `lighting.ambient` control its strength.
Street lights are opt-in: set `roads.streetLights.enabled: true`.
Streets uses `groundOcclusion: 0.07` and `groundOcclusionRadius: 1.5` for subtle ground contact.
`buildings.threeDimensional.occlusion: false` disables contact and model occlusion.
`buildings.contactShadow` styles the flat fallback.
Streets selects Core's `labels.roadPlacement: 'ground'`: street names follow the road plane below
buildings; POIs, transit names and shields remain above.
Road names retain class zoom/size curves, favor major roads and add padding through z13.
Pedestrian paths group separately. Compact types preserve language;
`labels.roadNameFormat: 'full'` keeps source names.
Disabling roads omits their names.
Road rings, ramp and surface ordering use [Core's replaceable defaults](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md).
Streets owns colors, widths, typography and time-of-day themes.
Each theme paints a [street sky](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) with night stars; `atmosphere: true`
on a globe map adds space around it. Mercator and native targets remain supported.

Streets enables model trees by default (`mode: '3d'`, `fallback: 'none'`). They stay three-dimensional
in overhead and tilted interactive browser views. Disabling vegetation removes all trees. Renderers
without model support omit them. Extensions can opt into the included flat crown artwork with
`vegetation: refine({mode: 'flat'})`, or switch it with explicit view mode using `mode: 'auto'`.
Seven forms cover rounded, spreading and upright broadleaf trees, conifers, columns, feather and fan
palms. Light/dark crown images share their geometry. Rounded crowns have three large ovoid masses;
upright trees have an oval crown and two lower lobes. Open trees have curved, tapered leaves drooping
from branches; conifers are tiered. Broadleaf variants mix open and compact forms, smooth shading and
varied colors. An eight-metre visual minimum scales smaller trees and crowns proportionally without
changing source heights. All presets style bark and crowns independently.

The models have 222–386 triangles nearby and 44–78 at distance, using Core's instanced tree
renderer; flat crowns use the existing sprite atlas. Tree locations and attributes still come
from the source tiles. The artwork does not add trees to parks whose data has none. See
[3D trees](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for
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

POIs follow World ranks and category density, with extra detail for parks and transport.
Generic airport POIs are limited to rank 0 to reduce misplaced business listings; the dedicated
aerodrome layer continues to label mapped airports. This display policy does not repair source data.
Road-reference repetition is reduced at z11–13 and retains its detail interval from z14.
Gardens stay at ranks 0–1 at every zoom, keeping principal destinations while omitting botanical
collections and some small independent gardens. Other park and landmark types retain their usual
eligibility.

Cities and districts hand over at z15, smaller settlements at z13. Co-located cities share one
anchor. Districts use rank gates below z12, then source availability and collisions. Street names use 0.15 em letter spacing and
a 1 px halo; administrative regions use bold lettering and water names use italic lettering.
Road spacing grows from 250 px at z13 to 300 at z15, 400 at z17 and 450 at z19 to curb repetition.
House numbers start at z17 with wide padding. Labels default to the local language.

The map uses Tileflow data and assets, including packaged DINish and Noto Sans fonts. The
reference uses DIN Pro Medium, so font shapes and stroke weight
remain an approximation. Available POIs, abbreviated names,
proprietary landmark models, transit branding, and building detail can differ from the reference.

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
Streets exports `streetsFonts` for its packaged navigation lettering and Noto Sans fallback.
Soundings and Blueprint declare Noto Sans URL glyph providers
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

## Streets themes

Streets offers three time-of-day families: `light` (displayed as Default), `faded`, and `monochrome`, each with
`day`, `dawn`, `dusk`, and `night`. For example, `theme="faded" timeOfDay="night"` resolves to
`dark-faded`. Inspector shows these as separate Theme and Time of day controls. All twelve
concrete theme names remain available for existing applications and captures. This catalog
is inherited when extending Streets without overriding it.
See the [time-of-day contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md#style-with-themes-and-semantic-modules).

Streets packages its low-zoom climate artwork and attribution, contrasted routes and compact trees.
Models inherit ordinary-building shading. Glass parts can be recoloured independently through
`modelColors.glass`; windows use `modelLighting.window.colorScale: 0.94`.
Other maps can override their colour and material without regenerating the model.
