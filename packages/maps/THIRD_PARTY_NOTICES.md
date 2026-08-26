# Third-party notices

The official Streets, Streets Dark, Ferraris, Härad, Siegfried, Soundings, Cyberpunk, Matrix, and
Verdant icon and pattern artwork published under `assets/` is original Tileflow artwork. It does not
incorporate a third-party icon set.

This file is shipped with `@tileflow/maps` so future third-party assets have a stable place for
their required notices. The repository's Apache-2.0 license and generated-output grant are
authoritative for the original Tileflow artwork.

The `ferraris` map and its nine SVG patterns are original Tileflow code and artwork. This package
does not include or redistribute any FerrarGIS assets, code, style files, textures, fonts, source
scans, or map data.

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

The `siegfried` map and its nine SVG patterns are original Tileflow code and artwork informed by
swisstopo's history, published examples, and 1873 conventional signs for the Siegfried Map. This
package does not include or redistribute swisstopo scans, raster pixels, legend artwork, fonts,
historical geospatial data, or map data. swisstopo is the source of the historical visual reference,
not of any packaged asset bytes. `siegfried` is an official Tileflow map; it is not affiliated with
or endorsed by swisstopo.

- Historical reference: <https://www.swisstopo.admin.ch/en/siegfried-map>
- 1873 conventional signs: <https://www.swisstopo.admin.ch/dam/en/sd-web/4OmbRYHBFpcd/Zeichenerklaerung-Siegfriedkarte-EN.pdf>

At runtime, Siegfried derives contour vectors in the browser from Mapterhorn terrain tiles. No
Mapterhorn tile is packaged or redistributed by `@tileflow/maps`. Mapterhorn publishes the full
catalog of its constituent open terrain sources and their individual attribution and license terms
at <https://mapterhorn.com/attribution/>. The compiled Style carries that link as source
attribution.

## Cormorant Garamond

Siegfried includes unmodified Cormorant Garamond Regular, SemiBold, and Italic font files under
`assets/siegfried/fonts/`, pinned to upstream revision
`cc1bfb51ce6568cb3abf9199ab718d543f6fa189`. Cormorant is copyright 2015 the Cormorant Project
Authors and is distributed under the SIL Open Font License 1.1 included beside the font files as
`LICENSE.txt`.

The `matrix` map and its three phosphor-green SVG pattern and symbol assets are original Tileflow code
and artwork. The package includes no pixels or vector artwork from an external screen or map
reference.

## Oxanium

Cyberpunk includes unmodified Oxanium Medium and SemiBold font files under
`assets/cyberpunk/fonts/`. Oxanium is copyright 2019 The Oxanium Project Authors and is
distributed under the SIL Open Font License 1.1 included beside the font files.
Matrix reuses that same packaged directory without duplicating the files. The canonical license
filename consumed by Tileflow's generic font pipeline is `LICENSE.txt`.
