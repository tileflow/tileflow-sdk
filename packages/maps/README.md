# `@tileflow/maps`

Official Tileflow maps and the assets they own.

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  defaultTheme: 'dark',
});
```

This still inherits both Streets themes; it changes only which concrete theme is selected by
default.

Every export is an ordinary, complete first-party Tileflow map. No official map imports or extends
another official map; each declares its data, modules, render stacks, themes, and asset
providers directly. Applications can still use the public `extends` contract to derive their own
maps from any official root. Streets and Siegfried each contain structurally identical `light` and
`dark` appearances.

The official map objects are deeply frozen package singletons so one consumer cannot mutate
the definition seen by another. This does not change Core authoring: `defineMap(...)` still returns
the application-owned object without freezing it, and an application extends an official map by
declaring its own modules or other atomic overrides.

```ts
import {
  cyberpunk,
  cyberpunkFonts,
  cyberpunkIcons,
  ferraris,
  ferrarisIcons,
  harad,
  haradIcons,
  matrix,
  matrixFonts,
  matrixIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  siegfriedThemes,
  soundings,
  soundingsIcons,
  streets,
  streetsIcons,
  streetsThemes,
  verdant,
  verdantIcons,
} from '@tileflow/maps';
```

`ferraris` is a self-contained printed-atlas design. It uses Core's semantic compiler, but
it does not import or extend the `streets` map and it does not inherit Streets assets. It declares
only `[ferrarisIcons]`, which contains nine original seamless SVG patterns for paper, cultivated
land, vegetation, settlements, sand, wetlands, and water. Applications can import it directly or
extend it like any other root.

`harad` is a self-contained historical green-map design named “Härad”. It uses Core's semantic
compiler ABI without importing or extending the `streets` map or reusing any Streets asset.
It declares only `[haradIcons]`, whose nine original Tileflow SVG patterns describe arable land,
coniferous and deciduous woodland, orchards, paper grain, sand, settlements, water lines, and
wetlands. The visual grammar is inspired by Lantmäteriet's CC0 Häradsekonomiska kartan series
(1859–1934) and official legend. The package redistributes no Lantmäteriet scan, source pixel, legend
artwork, font, or map data; the shipped style and SVG patterns are original Tileflow work.

`soundings` is a self-contained bathymetric-chart design with ivory land, thirteen-stop
depth-graded water, labelled band edges, continuous colour relief, multidirectional seabed shading,
port context, named ferry routes, and restrained technical magenta. Its initial camera faces the
Strait of Gibraltar, allowing an Iberian GEBCO pilot to exercise both Atlantic and Mediterranean
relief. It selects the public semantic compiler contract without importing or extending `streets`
and explicitly composes World with `bathymetry({display: 'hybrid'})` while setting Nautical to
`false`.

Vector bands come from `tileflow-bathymetry`; continuous colour relief and hillshade come from
`tileflow-bathymetry-dem`. The stronger DEM treatment is balanced against the vector wash and depth
labels rather than against experimental navigation symbols. Dashed outlines remain an honest
fallback traced from broad GEBCO band polygons until native contour geometry is released. Labels
show the absolute `min_depth` value, not an inferred range or vessel-specific safety contour.
Harbours and ferries are ordinary World context. Experimental `nautical-v1` tiles, aids, lights,
soundings, hazards, reefs, and wrecks are deliberately absent from the official map and remain
available only to explicitly configured laboratory maps. Soundings is reference cartography and is
not a navigation product.

`siegfried` is a self-contained terrain atlas based on the visual grammar documented for
swisstopo's nineteenth-century Siegfried Map. It does not import or extend `streets`. The default
`light` theme preserves black, brown, blue, and an ivory paper substrate; browser-derived contours
replace modern hillshade and retain the 30-metre Alpine cadence at detailed zooms. Rock and scree
are re-engraved in key ink after the contour deck, while dedicated SVG motifs distinguish forest,
glacier, wetland, gravel, orchard, and water. Its coordinated `dark` theme is explicitly a nocturnal
engraver's proof, not a historical facsimile: it keeps identical geometry and semantic ink roles on
charcoal paper. `[siegfriedIcons]` owns nine light and nine dark pattern variants,
`[siegfriedFonts]` owns the locally packaged Cormorant Garamond Regular, SemiBold, and Italic faces,
and `[siegfriedThemes]` exposes the two complete visual vocabularies for safe derivation.

`verdant` is a self-contained contemporary field-atlas design. It combines a park-map information
hierarchy with a cool mineral substrate, clean blue hydrography, graphite buildings, and a
trail-forward accent; its original botanical textures appear only where detailed zooms make them
useful. It uses the same semantic compiler contract without importing or extending `streets`,
declares its own Noto Sans glyph provider, and owns its complete icon and pattern set through
`[verdantIcons]`.

`cyberpunk` is a self-contained dark HUD root. Its road hierarchy, building signals, destination
beacons, semantic render passes, theme, World data selection, `[cyberpunkIcons]`, and
`[cyberpunkFonts]` are all declared directly; it does not import or extend `streets`.

`matrix` is a self-contained monochrome green-screen root. It explicitly owns its sparse HUD
geometry, reviewed phosphor-green ramp, modules, semantic render passes, and theme. It
omits a bright road centerline and building circuit texture, and uses compact square destination
nodes through `[matrixIcons]`. A translucent scanline and dot pattern masks the cartographic
linework so bright strokes break into the phosphor rows of an old CRT without baking that texture
into the map data; text layers render afterwards and stay crisp. `[matrixFonts]` owns Matrix's
packaged Oxanium faces for uppercase labels, independently of Cyberpunk's font provider.

`streetsThemes.light` and `streetsThemes.dark` are complete appearance documents consumed by the
same semantic module structure. Selecting `dark` changes colors, typography roles, image roles, and
lighting without changing a source, filter, layer order, zoom gate, collision rule, or module. Both
sidewalk patterns live in the shared `[streetsIcons]` atlas and the selected theme resolves the
semantic `roads.sidewalkPattern` image token to the correct asset.

Streets uses one ranked destination hierarchy in both themes. Major transit and cultural anchors
appear first; lodging, health, education, services, shopping, food, coffee, and parking enter
progressively as the camera approaches street level. Each visible destination is one collision
unit made from a colored circular pictogram and an optional neutral name, so the marker remains
useful when the label cannot fit. Portal-number labels are intentionally disabled. The ten POI
pictograms are adapted from the pinned CC0 Maki subset documented in
`THIRD_PARTY_NOTICES.md`; their containers, colors, sizing, and composition are Tileflow-authored.

Road references use a compact Tileflow-owned family of generic rectangular and circular shields.
The data's normalized `shield_kind` selects neutral, blue, green, red, orange, yellow, or circular
artwork; `shield_text_color` independently selects the light or dark theme token. Unknown and
unsupported networks fall back to the neutral rectangle with dark text instead of guessing a
country from the spelling of `ref`. Both themes retain the same signaling colors.

Streets has separate shield phases for scale, not separate hand-authored network layers. Overview
uses pre-deduplicated point candidates; detail switches to repeated line placement. Both the fitted
plate and its complete route reference are viewport-aligned, so shields remain horizontal as the
map rotates or pitches. The rectangular base plate is 20 by 14 pixels with a one-pixel outline;
the circular neutral base is 14 by 14. Both use 9-pixel bold text and a small width-only fit
allowance. Streets limits shields to the motorway-through-tertiary hierarchy; collision padding
and the overview candidate schedule keep regional views legible while preserving useful repetition
at street scale.

The two palettes are Tileflow-owned, deterministic snapshots calibrated from rendered Mapbox
Standard `default/day` and `default/night` references on 2026-08-27. They do not import Mapbox style
JSON, rules, assets, or runtime dependencies. Public roles such as `surface.background`,
`landuse.industrial`, `landuse.medical`, `labels.settlement`, `labels.neighborhood`, and
`labels.road` remain independently wired; `hydro.ocean` also separates Standard Night's deep sea
from urban and inland water. An agent can alter one cartographic intent without
knowing or perturbing the physical layer topology. Because Standard is evergreen, later parity work
must be an explicit dated recalibration rather than an implicit network-dependent change.

At detailed zooms, the road-bearing official maps round-cap ordinary surface-road and bridge
feature endpoints so adjacent vector segments overlap their antialiasing fringe instead of exposing
hairline cuts. Tunnel portals retain butt caps; Streets, Cyberpunk, and Matrix also keep butt caps on
steps and approaches carrying circular-road clearance so those structural ends do not protrude into
the connected geometry. Streets pairs its blue/slate road decks with a darker casing that grows from
1 px at z15 to 2 px at z22; tunnel casings use the compact dashed rhythm of the calibrated reference.

A theme is not a loose override cascade. Module styles explicitly reference roles such as
`roads.motorway`, `labels.road`, and `hydro.water`; the selected complete theme resolves those
references before MapLibre output is generated. Use `defaultTheme` for a deterministic default and
`systemThemes` plus the runtime `theme="system"` selection when the browser should follow the OS.

The directory descriptors point into this installed package. A map inherits its parent's icon or
font list when the property is omitted. Declaring a list replaces the inherited list, a later
directory wins for an exact duplicate ID, and `[]` selects no directories.

`@tileflow/maps` has a peer dependency on `@tileflow/core`. Core owns the map language and compiler;
this package owns the official map definitions, icon and pattern sources, Cyberpunk, Matrix, and
Siegfried fonts, and their notices. Core never depends on this package.
