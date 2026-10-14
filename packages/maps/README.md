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

This inherits both Streets themes and changes only the default selection and initial view.
Coordinates are `[longitude, latitude]`. To preview it:

```sh
npm install --save-dev --save-exact tileflow@alpha
npx tileflow validate
npx tileflow preview
```

Rendering can request remote tiles, glyphs, or terrain. Installing the package does not make those
resources available offline.

## Choose a map

- `streets`: contemporary street cartography with coordinated light and dark themes, ranked POIs,
  and generic road-reference shields. The light theme uses orange motorways, yellow trunk roads,
  white local streets, neutral footprints, and compact destination markers.
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

### Streets cartography

Streets light follows the visual hierarchy of Mapbox Streets v12 using Tileflow World geometry
and Tileflow's own theme and assets. Its dark theme shares the same zoom gates and label layout.
Country names give way to settlements, then neighborhoods and streets; road names keep their
source casing. Labels prefer English with local-name fallback. Override `modules.labels.language`
to choose another language.

Ranked destinations use compact category markers and optional names. Buildings fade in between
z15 and z16; pedestrian paving begins at z16 and house numbers at z17 where supplied by the data.
Individual trees are disabled by default. Applications can explicitly enable the vegetation
module or opt into the existing building extrusion toggle. Low-zoom bathymetry provides geographic context.
Streets does not require a DEM or a hillshade source.

For a web globe, opt into the blue atmosphere using the theme's appearance roles:

<!-- docs:check -->

```ts
import {defineMap, token} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'streets-globe',
  version: 1,
  extends: streets,
  atmosphere: {
    skyColor: token.color('atmosphere.sky'),
    horizonColor: token.color('atmosphere.horizon'),
    fogColor: token.color('atmosphere.fog'),
    spaceColor: token.color('atmosphere.space'),
    starIntensity: 0.1,
    starParallax: 0.1,
  },
});
```

Atmosphere is opt-in so the base map can also be extended with Mercator projection or prepared
for the native renderer, whose current profile does not support sky.

Tileflow World determines which destinations, addresses, and geometry exist at each zoom.
The style does not manufacture missing features or replace them with another provider's data.

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
mapping. `system` belongs to browser selection; captures and builds use concrete theme names.

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
