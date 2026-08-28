# Siegfried assets

This directory contains original Tileflow vector patterns and locally packaged fonts for the
official `siegfried` map. The visual system is informed by swisstopo's public history, examples,
and 1873 legend for the Siegfried Map, but no historical scan, legend artwork, or swisstopo data is
included or redistributed. `siegfried` is an official Tileflow map; it is not affiliated with or
endorsed by swisstopo.

Nine motifs were drawn specifically for Tileflow. Each has a light source and an independently
calibrated dark source, for 18 SVG files in one deterministic sprite atlas. The light runtime IDs
are:

- `siegfried-forest`
- `siegfried-glacier`
- `siegfried-gravel`
- `siegfried-orchard`
- `siegfried-paper-grain`
- `siegfried-rock`
- `siegfried-scree`
- `siegfried-water-lines`
- `siegfried-wetland`

The dark variants use the parallel IDs `siegfried-dark-forest`, `siegfried-dark-glacier`,
`siegfried-dark-gravel`, `siegfried-dark-orchard`, `siegfried-dark-paper-grain`,
`siegfried-dark-rock`, `siegfried-dark-scree`, `siegfried-dark-water-lines`, and
`siegfried-dark-wetland`. They preserve the same semantic motifs and geometry but use reduced
internal opacity against charcoal paper. This dark treatment is an original nocturnal
engraver's-proof interpretation; it is not presented as a historical Siegfried printing.

The `fonts/` directory packages Cormorant Garamond Regular, SemiBold, and Italic at pinned upstream
revision `cc1bfb51ce6568cb3abf9199ab718d543f6fa189`. Cormorant is licensed under the SIL Open Font
License 1.1; the complete license remains beside the font files as `fonts/LICENSE.txt`.

References:

- <https://www.swisstopo.admin.ch/en/siegfried-map>
- <https://www.swisstopo.admin.ch/dam/en/sd-web/4OmbRYHBFpcd/Zeichenerklaerung-Siegfriedkarte-EN.pdf>
- <https://github.com/CatharsisFonts/Cormorant/tree/cc1bfb51ce6568cb3abf9199ab718d543f6fa189>
