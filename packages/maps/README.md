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

Open `http://127.0.0.1:3333`. This example imports Streets from source, so edits to the map reload in
Map DevTools without publishing a package. Add `--scene nyc` for the New York scene or
`--against-theme dark --map streets-workbench` to compare themes. The example is a map configuration;
the CLI owns the shared development interface. Changes to compiler or runtime packages require
rebuilding those packages.

## Choose a map

- `streets`: contemporary street cartography with Mapbox-inspired time-of-day and color themes,
  ranked POIs, generic road-reference shields, and regional hillshade.
- `baedeker`: warm travel-atlas styling, serif labels, original engraved patterns, and contours.
- `civica`: illustrated civic-print styling with warm paper, olive parks, blue annotations, and
  vermilion landmarks.
- `ferraris`: printed-atlas styling with patterned land cover and settlements.
- `harad`: the historical green-map design displayed as **Härad**.
- `siegfried`: a terrain atlas with coordinated light/dark ink palettes, contours, and engraved patterns.
- `soundings`: bathymetric reference cartography with depth bands, continuous relief, and port context.
- `blueprint`: a dark architectural drawing style, with a default camera centered on San Francisco.

Every official map is a complete, independent root using the same Core compiler. Official map
objects are deeply frozen shared instances. Do not mutate them; use `defineMap({extends: ...})`
to create an application-owned map.

### Streets appearance

Streets follows the visual direction of [Mapbox Standard](https://docs.mapbox.com/playground/standard-style/)
(default theme, day and night), reviewed on 2026-10-14. `light` retains the existing day/default
palette unchanged, and `dark` retains the existing night/default palette. Additional complete themes
cover dawn and dusk, plus faded and monochrome palettes in each of Mapbox's four time presets
(`day`, `dawn`, `dusk`, `night`). Day/default is `light`; night/default is `dark`. The other themes
are `dawn`, `dusk`, `faded`, `monochrome`, `dawn-faded`, `dawn-monochrome`, `dusk-faded`,
`dusk-monochrome`, `dark-faded`, and `dark-monochrome`. Mapbox exposes time and color as independent
controls; Streets flattens the combinations into selectable themes. Dawn/dusk adjust map colors
while retaining the current 3D lighting, so switching themes does not alter building shadows or
extrusion lighting.
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
Surface and bridge casings use continuous strokes, including paved footpaths. Construction
dashes stay in the fill, and tunnel borders keep their dashed treatment.
Surface caps become round at z14; tunnels retain butt caps and bridges use round fills.
The road regression checks every quarter zoom from 0 through 24 and both sides of the handoffs.
Crosswalks and one-way arrows fade in from z16.5 so city-scale roads retain their surface color.
From z17, mapped sidewalks and pedestrian plazas use a translucent neutral tint and dot pattern:
grass stays green underneath, while paved ground stays neutral. The surface has its own
`roads.sidewalk.surface` token, independent of road borders.
Mapped parking polygons use an opaque neutral fill above overlapping vegetation and below
roads. This requires a `landuse` polygon classified as `parking`; parking POIs and aisle lines
alone do not provide the boundary needed to fill the surface.

Ferry routes fade in from z8, use fine blue dashes from z13, and show uppercase route names
along the line from z15 when the data includes them. Their labels use a water-colored halo.

Regional hillshade uses [Mapterhorn's public Terrarium DEM](https://mapterhorn.com/data-access/)
from z5 through z13, with source attribution. This is an additional remote data request. To omit
it, set `terrain: 'none'` in a map extending `streets`. Hillshade does not change road geometry or
raise the terrain. Street views retain the flat footprints and optional building extrusion group;
the preview's **3D** control enables those buildings, and its **Trees** control enables vegetation.
Daytime 3D buildings use warm cream roofs and a soft, map-anchored light. Two blurred contact
bands darken the ground at their base, fading in from z15.5; elevated parts and zero-height
footprints do not cast these bands. The `buildings.contactShadow` token styles them independently
of flat-map shadows. This shading uses the existing style layers: it does not round building
edges or cast shadows between buildings.
Street names follow the road plane and draw below buildings, so roofs and walls hide the
stretches behind them in pitched views. POIs, transit names, and route shields remain above the
buildings. The street-name passes belong to the Streets labels module and retain their zoom
scales in 2D; replacing that module also replaces these passes. Disabling roads omits them.
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

Soundings is not a navigation product. Its depth-band edges are approximate reference geometry,
not surveyed isolines or vessel-specific safety contours. Experimental nautical aids and hazards
are not enabled by that official map.

## Themes and assets

`streetsThemes` and `siegfriedThemes` expose complete `light` and `dark` themes. Import those
collections when using `defineTheme()` to derive a new appearance. A declared `themes` collection
replaces the inherited collection, so also declare the intended `defaultTheme` and `systemThemes`
and optional `timeOfDay` mappings. `system` belongs to browser selection; captures and builds use concrete theme names.

Every map exports an icon-directory descriptor: `streetsIcons`, `baedekerIcons`, `civicaIcons`,
`ferrarisIcons`, `haradIcons`, `siegfriedIcons`, `soundingsIcons`, and `blueprintIcons`. The descriptors point into this installed package; they are not sprite URLs.
The CLI and build integrations compile the selected directories into runtime assets.

Baedeker and Siegfried also export `baedekerFonts` and `siegfriedFonts` for their packaged Cormorant
Garamond faces.
Cívica exports `civicaFonts` for DM Serif Text, Barlow Semi Condensed, and Noto Sans fallback.
Streets, Ferraris, Härad, Soundings, and Blueprint declare Noto Sans URL glyph providers
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

Streets offers three time-of-day families: `light`, `faded`, and `monochrome`, each with
`day`, `dawn`, `dusk`, and `night`. For example, `theme="faded" timeOfDay="night"` resolves to
`dark-faded`. DevTools shows these as separate Theme and Time of day controls. All twelve
concrete theme names remain available for existing applications and captures. This catalog
reuses the existing palettes and lighting; extending Streets without overriding it inherits it.
See the [time-of-day contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md#style-with-themes-and-semantic-modules).
