# Official map assets

These directories contain the package-owned sources required by the official Streets, Baedeker,
Ferraris, Härad, Siegfried, Soundings, Cyberpunk, Matrix, Verdant, and San Francisto maps. Their SVG icons and
patterns live under each map's `icons/` directory. Streets includes a pinned CC0 subset of Maki
pictograms inside Tileflow-authored circular POI markers; its provenance is recorded in
`../THIRD_PARTY_NOTICES.md` and the upstream license is kept at `streets/LICENSE-MAKI.txt`. A map
refers to those directories through the exported `streetsIcons`, `baedekerIcons`, `ferrarisIcons`,
`haradIcons`, `siegfriedIcons`, `soundingsIcons`, `cyberpunkIcons`, `matrixIcons`, `verdantIcons`,
and `sanFrancistoIcons` descriptors. Baedeker, Cyberpunk, Matrix, and Siegfried refer to their own
packaged font directories through `baedekerFonts`, `cyberpunkFonts`, `matrixFonts`, and
`siegfriedFonts`; the files and their `LICENSE.txt` remain beside the map that owns them.

The seven `road-shield-*` SVGs are original Tileflow artwork: a deliberately generic neutral,
colored-rectangle, and neutral-circle vocabulary. They do not reproduce a national sign template
or third-party sprite; normalized source metadata selects among them and falls back to the neutral
rectangle when no supported network classification is available.

Official maps use the same public asset contract as application maps. Streets declares
`icons: [streetsIcons]`; its light and dark themes select distinct semantic image IDs from that
shared atlas. Every official map is an independent root and declares only its own asset descriptors.
Cyberpunk uses `[cyberpunkIcons]`; Matrix uses `[matrixIcons]`, whose directory owns its full-screen
CRT scanline mask, subtle data-grid pattern, and compact green-screen POI node. Neither imports nor
inherits Streets assets. The Ferraris directory contains nine
original intrinsic-size SVG patterns:
`ferraris-crop-hatch`, `ferraris-heath`, `ferraris-orchard`, `ferraris-paper-grain`,
`ferraris-residential`, `ferraris-sand`, `ferraris-water-ripples`, `ferraris-wetland`, and
`ferraris-woodland`.

The Baedeker directory contains eight original intrinsic-size SVG patterns:
`baedeker-hachures`, `baedeker-orchard`, `baedeker-paper-grain`, `baedeker-park-stipple`,
`baedeker-residential`, `baedeker-sand`, `baedeker-water-lines`, and `baedeker-wetland`. Tileflow
authored them from scratch using the
[Baedeker / Karl Wagner & Debes collection](https://www.antiquemapsandprints.com/collections/baedeker-karl-wagner-debes?srsltid=AfmBOoqG_2Q_Zje0wPPVYjShDjDZe5aIgH_h08XcPkpu7zFaPvF6n5hq)
and Wikimedia Commons'
[maps by Karl Baedeker of Italy](https://commons.wikimedia.org/wiki/Category:Maps_by_Karl_Baedeker_of_Italy)
as visual references. No historical scan, raster pixel, historical typeface, legend artwork,
geospatial data, or source map is included or redistributed. Baedeker also owns a package copy of
the three Cormorant Garamond faces selected by the map. Browser-derived Mapterhorn contours are
runtime terrain and no Mapterhorn tile is packaged here. Baedeker is not affiliated with or
endorsed by Baedeker or Wagner & Debes. See `baedeker/README.md` and the package-level
`THIRD_PARTY_NOTICES.md`.

The Härad directory contains nine original intrinsic-size SVG patterns: `harad-arable`,
`harad-conifer`, `harad-deciduous`, `harad-orchard`, `harad-paper-grain`, `harad-sand`,
`harad-settlement`, `harad-water-lines`, and `harad-wetland`. Tileflow authored these vectors from
scratch using Lantmäteriet's CC0 Häradsekonomiska kartan series (1859–1934) and official legend
as visual references. No Lantmäteriet scan, raster pixel, legend artwork, font, or map data is
included or redistributed. See `harad/README.md` and the package-level `THIRD_PARTY_NOTICES.md`.

The Siegfried directory contains nine original intrinsic-size motifs, each drawn in coordinated
light and dark artwork: forest, glacier, gravel, orchard, paper grain, rock, scree, water lines, and
wetland. The 18 runtime IDs use `siegfried-<motif>` for the historical light treatment and
`siegfried-dark-<motif>` for the nocturnal engraver-proof treatment. It also owns the three locally
packaged Cormorant Garamond faces selected by both themes. See `siegfried/README.md` and the
package-level `THIRD_PARTY_NOTICES.md` for provenance and licensing.

The Soundings directory contains ten original nautical symbols and intrinsic-size patterns:
`soundings-harbor`, `soundings-lighthouse`, `soundings-light-flare`, `soundings-buoy-port`,
`soundings-buoy-starboard`, `soundings-buoy-cardinal`, `soundings-wreck`,
`soundings-rock-awash`, `soundings-paper-grain`, and `soundings-water-dots`. They express familiar
paper-chart concepts without bundling a historical chart, specification artwork, or navigation
data. Official Soundings references only `soundings-paper-grain` and `soundings-water-dots`;
the eight point symbols remain available to the separate experimental Nautical canary. A generic
World POI is deliberately not relabelled as a harbour. Soundings uses GEBCO-derived depth bands only
as broad cartographic context and is not a navigation product.

The San Francisto directory contains four original intrinsic-size patterns and one original
technical symbol: `san-francisto-blueprint-grid`, `san-francisto-building-hatch`,
`san-francisto-landscape-hatch`, `san-francisto-water-hatch`, and `san-francisto-poi-node`.
Together they provide drawing-paper grid, building, landscape, and water notation plus a schematic
POI marker without importing another official map's sprite assets.

`@tileflow/dev` resolves each package descriptor, verifies that its real path remains inside the
installed package, and compiles the complete ordered directory composition into deterministic
MapLibre sprite atlases. `<id>.<ext>` publishes an icon as `<id>` and
`<id>.pattern.<ext>` publishes an intrinsic-size pattern as `<id>`. Published IDs are canonical
lower-kebab, and a later directory wins on an exact duplicate ID.

Font preparation is generic: it reads any map's declared `fonts` directories, derives IDs from
OpenType full names, includes only used faces, and publishes content-addressed font and license
assets. A self-hosted Cyberpunk build therefore materializes its currently selected font files and
license without a Cyberpunk or font-family special case. Its manifest and Style carry the strict
`tileflow:fontFaces` public-asset contract; asset ownership remains in `@tileflow/maps`. Style `font`
values are exact OpenType full names. Cyberpunk and Matrix each select their own directory, whose
stacks contain the two packaged Oxanium faces, so either map's primary-face local pipeline remains
independent and never depends on an unfixed system or remote fallback.
The compiler never manufactures a face ID by adding a weight. Streets, Ferraris, Härad, Soundings,
Verdant, and San Francisto each declare the canonical Tileflow glyph URL with exact
`Noto Sans Regular` and `Noto Sans Bold` stacks. Cyberpunk and Matrix name `Oxanium Medium` and
`Oxanium SemiBold`, while Baedeker and Siegfried each name `Cormorant Garamond Regular`,
`Cormorant Garamond SemiBold`, and `Cormorant Garamond Italic` from their respective packaged
directories. The compatibility URL
is canonical but not content-addressed; responses
revalidate and do not provide an exact-byte receipt. Reproducible official PBF delivery will use the
separate `/base/<assetSetSha256>/glyphs/...` contract once Hosted has verified and published that
immutable global base-asset set. In that URL, the name belongs to the global base-asset manifest;
its hash does not use the per-map
`tileflow-map-asset-set-v1` output domain recorded as `assetSetSha256` in `build-manifest.json`. It
is independent of managed font-bundle IDs and World descriptors. No compiler fallback invents
either provider.

The sources are shipped so local preview, capture, self-hosted framework builds, and Hosted
preparation compile the same pixels. Hosted preparation creates one bounded canonical font bundle,
uploads its exact font and license closure before the dependent Style, and binds the Style to the
immutable URL returned for the project-owned opaque bundle ID. The endpoint and client contract now
exist, but this is not by itself a production-availability promise: the matching Hosted migration,
API, and SDK pair still have to be promoted together. See the package-level
`THIRD_PARTY_NOTICES.md` for provenance and licensing notices.
