# Third-party notices

Except for the Streets POI pictograms documented below, the official themed Streets, Baedeker,
Ferraris, Härad, Siegfried, Soundings, Cyberpunk, Matrix, Verdant, San Francisto, Cívica, and Super Tile World icon and pattern
artwork published under `assets/` is original Tileflow artwork.

This file is shipped with `@tileflow/maps` so future third-party assets have a stable place for
their required notices. The repository's Apache-2.0 license is
authoritative for the original Tileflow artwork.

## Maki POI pictograms

The `coffee.svg`, `culture.svg`, `education.svg`, `food.svg`, `health.svg`, `lodging.svg`,
`major-transit.svg`, `parking.svg`, `services.svg`, and `shopping.svg` assets under
`assets/streets/icons/` contain pictograms adapted from the corresponding `cafe`, `museum`,
`school`, `restaurant`, `hospital`, `lodging`, `rail-metro`, `parking`, `information`, and `shop`
icons in `@mapbox/maki` 8.2.0, upstream commit
`6ab50f392294aeb20b3af83e8a10067151876eb9`.

Maki is dedicated to the public domain under CC0-1.0. Tileflow authored the circular containers,
color system, sizing, composition, and SVG simplifications around those pictograms. The complete
upstream license is included at `assets/streets/LICENSE-MAKI.txt`.

The `ferraris` map and its nine SVG patterns are original Tileflow code and artwork. This package
does not include or redistribute any FerrarGIS assets, code, style files, textures, fonts, source
scans, or map data.

## Baedeker map references and terrain data

The `baedeker` map and its eight SVG patterns are original Tileflow code and artwork. Their visual
grammar was informed by late-nineteenth- and early-twentieth-century Baedeker travel maps and town
plans engraved by Wagner & Debes.

- Baedeker / Karl Wagner & Debes collection:
  <https://www.antiquemapsandprints.com/collections/baedeker-karl-wagner-debes?srsltid=AfmBOoqG_2Q_Zje0wPPVYjShDjDZe5aIgH_h08XcPkpu7zFaPvF6n5hq>
- Maps by Karl Baedeker of Italy:
  <https://commons.wikimedia.org/wiki/Category:Maps_by_Karl_Baedeker_of_Italy>
- Moscow I, Wagner & Debes, 1914:
  <https://imperiia.omeka.fas.harvard.edu/document/2461>
- Amiens, Baedeker, 1908:
  <https://commons.wikimedia.org/wiki/File:Amiens_%E2%80%94_Plan_extrait_du_guide_B%C3%A6deker_%E2%80%9CNord-Ouest_de_la_France%E2%80%9E_1908.jpg>
- Berlin-Westend, Baedeker, 1914:
  <https://commons.wikimedia.org/wiki/File:Baedeker,_Plan_von_Westend,_1914.jpg>

This package does not include or redistribute a historical scan, raster pixel, historical
typeface, legend artwork, geospatial data, or source map from either reference. The package
contains Tileflow-authored style code and original patterns plus the separately licensed Cormorant
Garamond files documented below. `baedeker` is an official Tileflow map; it is not affiliated with
or endorsed by Baedeker or Wagner & Debes.

At runtime, Baedeker derives contour vectors in the browser from Mapterhorn terrain tiles. No
Mapterhorn tile is packaged or redistributed by `@tileflow/maps`. Mapterhorn publishes the full
catalog of its constituent open terrain sources and their individual attribution and license terms
at <https://mapterhorn.com/attribution/>. The compiled Style carries that link as source
attribution.

## Häradsekonomiska kartan reference

The `harad` map and its nine SVG patterns are original Tileflow code and artwork inspired by the
visual grammar of Lantmäteriet's Häradsekonomiska kartan series (1859–1934) and official legend.
Lantmäteriet makes the [Häradsekonomiska kartan product](https://geotorget.lantmateriet.se/link/haradsekonomiska-kartan)
available under CC0 and publishes its
[official colored legend](https://www.lantmateriet.se/sv/kartor/vara-karttjanster/Historiska-kartor/Arkiven-som-ingar/Rikets-allmanna-kartverks-arkiv---RAK/contentassets/teckenforklaring.pdf).
Lantmäteriet is the source of the historical visual reference, not of any packaged asset bytes.

This package does not include or redistribute Lantmäteriet source scans, raster pixels, legend
artwork, fonts, geospatial data, or map data. The package contains only Tileflow-authored style code
and original SVG patterns for arable land, coniferous and deciduous woodland, orchards, paper grain,
sand, settlements, water lines, and wetlands.

The `verdant` map and its ten SVG icons and ten SVG patterns are original Tileflow code and artwork.
Its contemporary field-atlas direction was informed by publicly documented park-map information
design and general outdoor-navigation conventions. This package does not include or redistribute
National Park Service or Lantmäteriet artwork, symbols, logos, fonts, source sheets, scans, style
files, or map data.

## San Francisto blueprint artwork and terrain data

The `san-francisto` map and its four SVG patterns and one SVG technical symbol are original Tileflow
code and artwork. Its architectural-blueprint direction uses general drafting conventions; this
package does not include or redistribute an architectural drawing, CAD file, municipal plan,
survey sheet, font, source image, or third-party symbol artwork.

At runtime, San Francisto derives contour vectors in the browser from Mapterhorn terrain tiles. No
Mapterhorn tile is packaged or redistributed by `@tileflow/maps`. Mapterhorn publishes the full
catalog of its constituent open terrain sources and their individual attribution and license terms
at <https://mapterhorn.com/attribution/>. The compiled Style carries that link as source
attribution.

## Nautical-chart references

The `soundings` map and its ten SVG symbols and patterns are original Tileflow code and artwork.
Its visual grammar was informed by NOAA's
[Historical Map & Chart Collection](https://historicalcharts.noaa.gov/) and the IHO
[S-4 and INT 1 standards index](https://iho.int/standards-and-specifications) as cartographic
references. This package does not include or redistribute NOAA chart images, IHO publication
artwork, official symbol sheets, fonts, hydrographic surveys, or navigation data.

The map can visualize broad GEBCO-derived bathymetric bands exposed by the selected Tileflow data
source. Those bands are not packaged here and are not navigation-grade soundings. Soundings is a
general-purpose visual map, not a nautical chart for navigation.

## Siegfried Map reference and terrain data

The `siegfried` map and its nine light/dark SVG motif pairs are original Tileflow code and artwork informed by
swisstopo's history, published examples, and 1873 conventional signs for the Siegfried Map. This
package does not include or redistribute swisstopo scans, raster pixels, legend artwork, fonts,
historical geospatial data, or map data. swisstopo is the source of the historical visual reference,
not of any packaged asset bytes. `siegfried` is an official Tileflow map; it is not affiliated with
or endorsed by swisstopo. Its dark theme is an original nocturnal engraver's-proof interpretation,
not a reproduced or historically documented swisstopo colourway.

- Historical reference: <https://www.swisstopo.admin.ch/en/siegfried-map>
- 1873 conventional signs: <https://www.swisstopo.admin.ch/dam/en/sd-web/4OmbRYHBFpcd/Zeichenerklaerung-Siegfriedkarte-EN.pdf>

At runtime, Siegfried derives contour vectors in the browser from Mapterhorn terrain tiles. No
Mapterhorn tile is packaged or redistributed by `@tileflow/maps`. Mapterhorn publishes the full
catalog of its constituent open terrain sources and their individual attribution and license terms
at <https://mapterhorn.com/attribution/>. The compiled Style carries that link as source
attribution.

## Cormorant Garamond

Baedeker and Siegfried each include their own unmodified Cormorant Garamond Regular, SemiBold, and
Italic font files under `assets/baedeker/fonts/` and `assets/siegfried/fonts/`, respectively. Both
copies are pinned to upstream revision `cc1bfb51ce6568cb3abf9199ab718d543f6fa189`. Cormorant is
copyright 2015 the Cormorant Project Authors and is distributed under the SIL Open Font License
1.1 included beside each map's font files as `LICENSE.txt`.

The `matrix` map and its three phosphor-green SVG pattern and symbol assets are original Tileflow code
and artwork. The package includes no pixels or vector artwork from an external screen or map
reference.

## Oxanium

Cyberpunk and Matrix each include unmodified Oxanium Medium and SemiBold font files under their
respective `assets/cyberpunk/fonts/` and `assets/matrix/fonts/` directories. Oxanium is copyright
2019 The Oxanium Project Authors and is distributed under the SIL Open Font License 1.1 included
beside both font copies. The canonical license filename consumed by Tileflow's generic font
pipeline is `LICENSE.txt`.

## Cívica artwork and fonts

The `civica` map, its five SVG patterns, and its eleven SVG POI pictograms are original Tileflow
code and artwork. Its civic print-atlas vocabulary takes broad visual inspiration from the user's
[Inside the Belt Way — Washington DC reference](https://www.etsy.com/listing/990932175/inside-the-belt-way-washington-dc).
This package does not include or redistribute the reference map, geography, composition,
lettering, symbols, images, or other artwork. Cívica declares its own assets and does not import
another official map's artwork or font directories.

Cívica includes five unmodified upstream font files under `assets/civica/fonts/`:

- `DMSerifText-Regular.ttf` and `DMSerifText-Italic.ttf` are from the official Google Fonts
  [DM Serif Text directory](https://github.com/google/fonts/tree/2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9/ofl/dmseriftext),
  pinned to revision `2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9`. Their complete upstream
  SIL Open Font License 1.1 notice is preserved at `assets/civica/fonts/OFL.txt`.
- `BarlowSemiCondensed-Regular.ttf` and `BarlowSemiCondensed-SemiBold.ttf` are from the official
  Google Fonts [Barlow Semi Condensed directory](https://github.com/google/fonts/tree/3218ae2acc5bce7ccd97c477965b5b4094241fb0/ofl/barlowsemicondensed),
  pinned to revision `3218ae2acc5bce7ccd97c477965b5b4094241fb0`. Their complete upstream
  SIL Open Font License 1.1 notice is preserved at `assets/civica/fonts/LICENSE-BarlowSemiCondensed.txt`.
- `NotoSans-Regular.ttf` is from the official Noto
  [static hinted Noto Sans directory](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans),
  pinned to revision `c971829a87e7920f960e7277c3dafd9bedd3c601`. Its complete upstream
  SIL Open Font License 1.1 notice is preserved at `assets/civica/fonts/LICENSE-NotoSans.txt`.

`assets/civica/fonts/LICENSE.txt` combines all three complete upstream notices and licenses with
component filenames and source revisions for Tileflow's generic font preparation pipeline.
`assets/civica/fonts/README.md` records individual pinned source links and verified OpenType full
names. No font file has been subsetted, renamed internally, or modified.

## Super Tile World artwork and fonts

The `superTileWorld` map, sixteen SVG sprites, and seven SVG patterns are original Tileflow code
and artwork. Its pixel-art overworld takes visual inspiration from _Super Mario World_. This
package includes no extracted game sprites, Nintendo logo, source map, or downloaded icon artwork.
Super Mario World is a Nintendo trademark; this independent showcase has no affiliation with or
endorsement from Nintendo. The asset research references are recorded in
`assets/super-tile-world/README.md`.

Super Tile World packages three unmodified static upstream font files and one renamed derivative in its own
`assets/super-tile-world/fonts/` directory:

- `PixelifySans-Regular.ttf` and `PixelifySans-SemiBold.ttf` are from the official
  [Pixelify Sans project](https://github.com/eifetx/Pixelify-Sans/tree/39df74aba80df8157546034b878e8be1eb565ced),
  pinned to revision `39df74aba80df8157546034b878e8be1eb565ced`. Its complete SIL Open Font
  License 1.1 notice is preserved as `LICENSE-PixelifySans.txt`.
- `TileWorldArcade-Regular.ttf` is a name-table-only derivative of `PressStart2P-Regular.ttf`
  from the official Google Fonts
  [Press Start 2P directory](https://github.com/google/fonts/tree/e06fe11c39051bddaef73ec338a9d1c8175723f1/ofl/pressstart2p),
  pinned to revision `e06fe11c39051bddaef73ec338a9d1c8175723f1`. The derivative is named
  “Tile World Arcade” to satisfy the upstream reserved-font-name requirement and to give browser
  canvas rendering a compatible family name. Glyph outlines, metrics, and character mappings
  remain unchanged. Its complete SIL Open Font License 1.1 notice, including the upstream
  reserved font name, is preserved as `LICENSE-PressStart2P.txt`.
- `NotoSans-Regular.ttf` is from the official Noto
  [static hinted Noto Sans directory](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans),
  pinned to revision `c971829a87e7920f960e7277c3dafd9bedd3c601`. Its complete SIL Open Font
  License 1.1 notice is preserved as `LICENSE-NotoSans.txt`.

`LICENSE.txt` combines all three complete font-family notices and licenses for the generic local
font preparation pipeline. The adjacent `fonts/README.md` records the pinned source files,
verified OpenType full names, and the derivative's exact name-table changes. No font is subsetted;
Pixelify Sans and Noto Sans remain unmodified upstream files.
