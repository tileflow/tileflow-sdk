# Official map assets

These directories contain the package-owned sources required by the official Streets, Ferraris,
Streets Dark, Cyberpunk, and Verdant maps. Their original Tileflow SVG icons and patterns live under
each map's `icons/` directory. A map refers to those directories through the exported
`streetsIcons`, `ferrarisIcons`, `streetsDarkIcons`, `cyberpunkIcons`, and `verdantIcons`
descriptors. Cyberpunk refers to its packaged font directory through `cyberpunkFonts`; the files and
their `LICENSE.txt` remain beside the map that owns them.

Official maps use the same public asset contract as application maps. Streets declares
`icons: [streetsIcons]`; Streets Dark, Cyberpunk, and Verdant extend Streets and append their own
descriptors. Ferraris is a separate root and declares only `icons: [ferrarisIcons]`; it neither
imports nor inherits Streets assets. Its directory contains nine original intrinsic-size SVG patterns:
`ferraris-crop-hatch`, `ferraris-heath`, `ferraris-orchard`, `ferraris-paper-grain`,
`ferraris-residential`, `ferraris-sand`, `ferraris-water-ripples`, `ferraris-wetland`, and
`ferraris-woodland`.

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
values are exact OpenType full names. Cyberpunk's stacks contain only its two packaged Oxanium
faces, so the primary-face local pipeline never depends on an unfixed system or remote fallback.
The compiler never manufactures a face ID by adding a weight. Streets and Ferraris each declare the
canonical Tileflow glyph URL with exact `Noto Sans Regular` and `Noto Sans Bold` stacks, Verdant
inherits that complete provider, and Cyberpunk names `Oxanium Medium` and `Oxanium SemiBold` from
its packaged directory. The compatibility URL is canonical but not content-addressed; responses
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
