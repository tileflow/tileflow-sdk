# Super Tile World artwork

The 23 SVGs in `icons/` are original vector drawings made for the Super Tile World Tileflow
showcase. The visual reference is the cheerful 16-bit overworld of _Super Mario World_: stepped
silhouettes, indigo contours, spotted mushroom roofs, striped green pipes, gold level nodes,
smiling hills, small castles, and sparse two-tone landscape details. No extracted game sprites,
existing map, Nintendo logo, or downloaded icon artwork is packaged here.

The drawings use a shared palette and a 2-pixel construction grid. Most POI artwork occupies
36–42 pixels of a transparent 48 × 48 authoring canvas. Tileflow normalizes ordinary icons to
24 × 24 CSS pixels in its sprite atlas. Use symbol size 1–1.2 for ordinary destinations and
1.3–1.7 for a few major landmarks. Silhouettes remain distinct at small sizes;
they are not all enclosed in interchangeable square badges. `stw-level-node` is the quiet
secondary location symbol. `stw-tree` and `stw-hill` also work as sparse landscape symbols.

Every SVG is self-contained with explicit intrinsic dimensions. The transparent patterns own
only illustrative texture marks; the map style owns the base terrain color. The miniature grove
and hill in `stw-meadow` decorate the terrain and do not claim factual tree locations. Their
green contours are deliberately softer than the indigo POI silhouettes. Pattern IDs remove the
`.pattern.svg` suffix:

| Runtime ID     | Intrinsic size | Drawing                                                                           |
| -------------- | -------------- | --------------------------------------------------------------------------------- |
| `stw-grass`    | 128 × 128      | Two small grass tufts and a pale flower.                                          |
| `stw-water`    | 128 × 128      | Two broken, stepped wave glints and two small water pixels.                       |
| `stw-forest`   | 128 × 128      | Two offset, softly stepped green tree crowns with tiny eyes.                      |
| `stw-brick`    | 32 × 32        | Offset warm brick courses with a light top edge.                                  |
| `stw-sand`     | 128 × 128      | Sparse ochre grains and one pale glint.                                           |
| `stw-meadow`   | 256 × 256      | Asymmetric miniature grove, smiling hill, four grass tufts, and two pale flowers. |
| `stw-farmland` | 128 × 128      | Two small, staggered three-stem crop groups.                                      |

POI and landscape runtime IDs are `stw-mushroom-house`, `stw-warp-pipe`, `stw-question-block`,
`stw-coin`, `stw-castle`, `stw-star`, `stw-mushroom`, `stw-heart`, `stw-flag`, `stw-tree`,
`stw-hill`, `stw-ghost-house`, `stw-airship`, `stw-book`, `stw-flower`, and `stw-level-node`.

Research references, inspected while developing this independent set:

- [Super Mario World overworld reference](https://www.snesmaps.com/maps/SuperMarioWorld/SMWOverworldMap.html).
- [ATeshGames' Super Mario World Style Tiles](https://opengameart.org/content/super-mario-world-style-tiles),
  a CC0 SVG tileset. Used to study the suitability of vector game tiles; its artwork is not included.
- [Pixelify Sans upstream](https://github.com/eifetx/Pixelify-Sans).
- [Press Start 2P in Google Fonts](https://github.com/google/fonts/tree/main/ofl/pressstart2p).

The font files under `fonts/` are separately licensed upstream assets. Their exact versions,
OpenType names, source links, and complete licenses are preserved beside them.
