# Official map assets

These directories contain the package-owned sources required by the official Streets, Ferraris,
Härad, Siegfried, Soundings, Streets Dark, Cyberpunk, Matrix, and Verdant maps. Their original Tileflow SVG
icons and patterns live under each map's `icons/` directory. A map refers to those directories
through the exported `streetsIcons`, `ferrarisIcons`, `haradIcons`, `siegfriedIcons`,
`soundingsIcons`, `streetsDarkIcons`, `cyberpunkIcons`, `matrixIcons`, and `verdantIcons`
descriptors. Cyberpunk
and Siegfried refer to their packaged font directories through `cyberpunkFonts` and
`siegfriedFonts`; the files and their `LICENSE.txt` remain beside the map that owns them.

Official maps use the same public asset contract as application maps. Streets declares
`icons: [streetsIcons]`; Streets Dark and Cyberpunk extend Streets and append their own descriptors.
Matrix extends Cyberpunk but replaces its composition with `[streetsIcons, matrixIcons]`, where the
Matrix directory owns its full-screen CRT scanline mask, subtle data-grid pattern, and compact
green-screen POI node.
Ferraris, Härad, Siegfried, Soundings, and Verdant are separate roots that declare only their own
asset descriptors; none imports or inherits Streets assets. The Ferraris directory contains nine
original intrinsic-size SVG patterns:
`ferraris-crop-hatch`, `ferraris-heath`, `ferraris-orchard`, `ferraris-paper-grain`,
`ferraris-residential`, `ferraris-sand`, `ferraris-water-ripples`, `ferraris-wetland`, and
`ferraris-woodland`.

The Härad directory contains nine original intrinsic-size SVG patterns: `harad-arable`,
`harad-conifer`, `harad-deciduous`, `harad-orchard`, `harad-paper-grain`, `harad-sand`,
`harad-settlement`, `harad-water-lines`, and `harad-wetland`. Tileflow authored these vectors from
scratch using Lantmäteriet's CC0 Häradsekonomiska kartan series (1859–1934) and official legend
as visual references. No Lantmäteriet scan, raster pixel, legend artwork, font, or map data is
included or redistributed. See `harad/README.md` and the package-level `THIRD_PARTY_NOTICES.md`.

The Siegfried directory contains nine original intrinsic-size SVG patterns: `siegfried-forest`,
`siegfried-glacier`, `siegfried-gravel`, `siegfried-orchard`, `siegfried-paper-grain`,
`siegfried-rock`, `siegfried-scree`, `siegfried-water-lines`, and `siegfried-wetland`. It also owns
the three locally packaged Cormorant Garamond faces selected by the map. See `siegfried/README.md`
and the package-level `THIRD_PARTY_NOTICES.md` for provenance and licensing.

The Soundings directory contains ten original nautical symbols and intrinsic-size patterns:
`soundings-harbor`, `soundings-lighthouse`, `soundings-light-flare`, `soundings-buoy-port`,
`soundings-buoy-starboard`, `soundings-buoy-cardinal`, `soundings-wreck`,
`soundings-rock-awash`, `soundings-paper-grain`, and `soundings-water-dots`. They express familiar
paper-chart concepts without bundling a historical chart, specification artwork, or navigation
data. Soundings uses GEBCO-derived depth bands only as broad cartographic context and is not a
navigation product.

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
values are exact OpenType full names. Cyberpunk and Matrix select the same directory whose stacks
contain only its two packaged Oxanium faces, so the primary-face local pipeline never depends on an
unfixed system or remote fallback.
The compiler never manufactures a face ID by adding a weight. Streets, Ferraris, Härad, Soundings,
and Verdant each declare the canonical Tileflow glyph URL with exact `Noto Sans Regular` and
`Noto Sans Bold` stacks. Cyberpunk names `Oxanium Medium` and `Oxanium SemiBold`, while Siegfried
names `Cormorant Garamond Regular`, `Cormorant Garamond SemiBold`, and
`Cormorant Garamond Italic`, all from their respective packaged directories. The compatibility URL
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
