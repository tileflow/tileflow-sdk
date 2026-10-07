# Map designs and assets

## civica

`civica` is a self-contained civic print design named “Cívica”. Pale paper, warm stone blocks,
olive parkland, blue water, and vermilion landmarks give cities the character of an illustrated
wall map. Broad urban shapes lead at overview scale; solid building masses, cream streets, and
selected destinations describe the city. Large italic serif park titles and blue uppercase station
names anchor the district drawing; smaller parks keep a quieter italic size, and condensed captions
provide supporting detail. Fine paths and sparse landscape textures enter at closer zooms.
It declares its complete World data selection,
modules, render stacks, and theme directly,
owns its patterns and symbols through `[civicaIcons]`, and selects its own packaged DM Serif Text
Regular and Italic lettering, Barlow Semi Condensed detail labels, and Noto Sans Regular fallback
through `[civicaFonts]`. Its graphic direction was informed by the
[Inside the Beltway Washington DC print](https://www.etsy.com/listing/990932175/inside-the-belt-way-washington-dc).
The map definition and vector artwork are original Tileflow work; no source map, image pixels,
illustrations, or third-party style are included.

Cívica changes its drawing and label hierarchy with scale:

| Zoom  | Cartographic treatment                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 0–6   | Continental and country lettering over broad land and water shapes.                                           |
| 7–11  | Regional roads, settlements, and landscape areas; global landcover fades out by z10.                          |
| 12–14 | District names, broad pedestrian promenades, and generalized footprints from z13; eligible POIs use rank 0–1. |
| 15–17 | Solid building masses and street names; POIs admit rank 2 from z15 and featured rank 3 from z17.              |
| 18–19 | Fine paths and their names enter progressively; trees and sparse botanical textures begin at z19.             |
| 20+   | Address numbers, sidewalks, and quiet industrial texture complete the close street view.                      |

Buildings, park parcels, and water bodies have no outlines. Ordinary surface streets use one cream
stroke, with broader widths at city and neighborhood scales to separate the printed blocks.
Motorway, trunk, and bridge casings retain the main transport hierarchy. Pedestrian areas
and roundabouts omit their extra outline, and tunnel hatches are disabled. Ordinary fine path lines
are solid: cycleways begin at z17, footways and tracks at z17.5, paths at z18, and steps at z19. The
corresponding labels wait until z18–20. Water remains a flat color at every zoom, and tree points
have no stroke.

The red building plate selects civic buildings directly and destination buildings only when
`importanceTier` is at least 3. Tier-2 destinations use darker gray; lower-ranked destinations and
ordinary buildings share the same warm-gray fill. It uses World `building_tone`; building height
never determines landmark color.
The generalized footprint pass ends at z15 with the same opacity at which the
detail pass begins.

POI symbols and names form one collision unit. Each category retains its own filter, and candidates
must carry the schema-bound `poiCategory`, `poiFilterRank`, and `poiSizeRank` fields (`category`,
`filter_rank`, and `size_rank` in World V1). Size ranks must be 0–16, filter ranks must be
nonnegative, and the producer's `minZoom` (`min_zoom`) is honored when present. Landmarks, culture,
parks, transport, and medical destinations can reach rank 3; other categories stop at rank 2.
Food, retail, visitor amenities, and lodging begin at z17.5. Generic `public_transit_facility`
POIs also wait until z17.5, while train stations retain their earlier schedule. Culture, education,
public-service, and medical POIs with filter rank 2 or higher and size rank 16 enter at z17.5;
rank-1 destinations and other valid size ranks retain their earlier schedule. These rules preserve
major stations even when their size rank is 16 and leave room for parks and selected institutions
at district scale. They use source categories and ranks without place-name or location exceptions.
Park titles use DM Serif Text Italic, with larger type for size ranks 0–4. Transport uses Barlow
Semi Condensed SemiBold in uppercase; supporting captions use Barlow Semi Condensed Regular.
Classic OpenMapTiles data without those category and rank fields renders the base map without
POIs; Cívica does not infer or retrofit those fields. All five font faces are packaged locally:
DM Serif Text Regular and Italic, Barlow Semi Condensed Regular and SemiBold, and the Noto Sans
Regular fallback.

## baedeker

`baedeker` is a self-contained travel-atlas and town-plan design with open warm paper, fine coral
building and residential hatching, paper-negative streets, dominant black railways, horizontally
engraved cyan water, ring-stippled gardens, and browser-derived Mapterhorn contours. Travel POIs
are rendered as compact serif labels without modern pictograms. It declares
`[baedekerIcons]`, whose eight original Tileflow SVG patterns describe hachures, orchards, paper
grain, public gardens, residential blocks, sand, water lines, and wetlands, plus
`[baedekerFonts]`, its own package copy of Cormorant Garamond Regular, SemiBold, and Italic. Its
visual grammar was informed by the
[Baedeker / Karl Wagner & Debes collection](https://www.antiquemapsandprints.com/collections/baedeker-karl-wagner-debes)
and Wikimedia Commons'
[maps by Karl Baedeker of Italy](https://commons.wikimedia.org/wiki/Category:Maps_by_Karl_Baedeker_of_Italy).
The package includes no historical scan, raster pixel, historical typeface, legend artwork,
geospatial data, or source map; the style and patterns are original Tileflow work. The packaged
Cormorant faces are unmodified upstream font software under the SIL Open Font License 1.1. No
Mapterhorn terrain tile is packaged or redistributed. Baedeker is an official Tileflow map and is
not affiliated with or endorsed by Baedeker or Wagner & Debes.

## ferraris

`ferraris` is a self-contained printed-atlas design. It uses Core's semantic compiler, but
it does not import or extend the `streets` map and it does not inherit Streets assets. It declares
only `[ferrarisIcons]`, which contains nine original seamless SVG patterns for paper, cultivated
land, vegetation, settlements, sand, wetlands, and water. Applications can import it directly or
extend it like any other root.

## harad

`harad` is a self-contained historical green-map design named “Härad”. It uses Core's semantic
compiler ABI without importing or extending the `streets` map or reusing any Streets asset.
It declares only `[haradIcons]`, whose nine original Tileflow SVG patterns describe arable land,
coniferous and deciduous woodland, orchards, paper grain, sand, settlements, water lines, and
wetlands. The visual grammar is inspired by Lantmäteriet's CC0 Häradsekonomiska kartan series
(1859–1934) and official legend. The package redistributes no Lantmäteriet scan, source pixel, legend
artwork, font, or map data; the shipped style and SVG patterns are original Tileflow work.

## soundings

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

## siegfried

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

## blueprint

`blueprint` is a self-contained dark architectural-blueprint design centered on San Francisco.
Fine technical road strokes, survey-like uppercase labels, precise building footprints, contour
dimensions, and dedicated landscape and water hatches replace naturalistic map color. It declares
the canonical Noto Sans glyph provider and only `[blueprintIcons]`, whose four original patterns
and schematic POI node form its complete sprite vocabulary.
Prominent building height callouts use World `render_height`; the map does not require unpublished
building names or raw heights.

## Shared themes and asset preparation

`streetsThemes.light` and `streetsThemes.dark` are complete appearance documents consumed by the
same semantic module structure. Selecting `dark` changes colors, typography roles, image roles, and
lighting without changing a source, filter, layer order, zoom gate, collision rule, or module. Both
sidewalk patterns live in the shared `[streetsIcons]` atlas and the selected theme resolves the
semantic `roads.sidewalkPattern` image token to the correct asset.

Streets uses one ranked destination hierarchy in both themes. Major transit and cultural anchors
appear first; lodging, health, education, services, shopping, food, coffee, and parking enter
progressively as the camera approaches street level. Each visible destination is one collision
unit made from a colored circular pictogram and an optional neutral name, so the marker remains
useful when the label cannot fit. The pictogram scale grows gently from 1× at z12 to 1.06× at z17,
giving detailed street views a little more visual presence without increasing POI density.
Portal-number labels are intentionally disabled. The ten POI
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
hairline cuts. Tunnel portals retain butt caps; Streets also keeps butt caps on
steps and controlled surface approaches so those structural ends do not protrude into connected
geometry. Streets pairs its blue/slate road decks with a darker casing that grows from
1 px at z15 to 2 px at z22; tunnel casings use the compact dashed rhythm of the calibrated reference.

A theme is not a loose override cascade. Module styles explicitly reference roles such as
`roads.motorway`, `labels.road`, and `hydro.water`; the selected complete theme resolves those
references before MapLibre output is generated. Use `defaultTheme` for a deterministic default and
`systemThemes` plus the runtime `theme="system"` selection when the browser should follow the OS.

The directory descriptors point into this installed package. A map inherits its parent's icon or
font list when the property is omitted. Declaring a list replaces the inherited list, a later
directory wins for an exact duplicate ID, and `[]` selects no directories.

`@tileflow/maps` has a peer dependency on `@tileflow/core`. Core owns the map language and compiler;
this package owns the official map definitions, icon and pattern sources, Baedeker, Cívica,
and Siegfried fonts, and their notices. Core never depends on this package.
