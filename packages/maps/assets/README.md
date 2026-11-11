# Official map assets

These directories contain the package-owned sources for Streets, Soundings and Terrain.
Streets' icons, fonts and models are shared by Terrain; Terrain adds its own summit symbols.
Use the exported `streetsIcons`, `streetsFonts`, `streetsModels`, `soundingsIcons` and `terrainIcons`
descriptors to compose resources. Streets includes a pinned CC0 subset of Maki pictograms inside
Tileflow-authored circular POI markers; provenance is in `../THIRD_PARTY_NOTICES.md` and the
upstream license is kept at `streets/LICENSE-MAKI.txt`.

Baedeker, 1777, Siegfried and Blueprint resources now belong to
[Community Maps](https://github.com/tileflow/community-maps/tree/main/maps), with their licenses.

The seven `road-shield-*` SVGs are original Tileflow artwork: a deliberately generic neutral,
colored-rectangle, and neutral-circle vocabulary. They do not reproduce a national sign template
or third-party sprite; normalized source metadata selects among them and falls back to the neutral
rectangle when no supported network classification is available.

Official maps use the same public asset contract as application maps. Streets declares
`icons: [streetsIcons]`; its light, dark, and monochrome themes select semantic image IDs from that
shared atlas. Faded themes retain the category-colored POI artwork; monochrome themes use matching
grayscale markers. Every official map is an independent root and declares only its own asset
descriptors.

Streets also declares `models: [streetsModels]`. Its seven original tree models live in
`streets/models/`, each with a lighter `.far.glb` companion. The `streets-tree-*.pattern.svg`
files are light/dark top views of those same meshes. The pattern suffix preserves their 64px
atlas size; the vegetation module uses them as individual symbols, not repeating fills.
`streets/build-trees.mjs` generates the meshes and crowns deterministically from original
geometry; no third-party model or texture is included. From the SDK root:

```sh
node packages/maps/assets/streets/build-trees.mjs
node packages/maps/assets/streets/build-trees.mjs --check
```

The generator caps near models at 700 triangles and far models at 100. Current forms use
120–386 and 44–96 respectively. Broadleaf companions retain all five crown clusters and their
supporting branches, reducing tessellation at distance instead of dropping limbs.
Package tests prepare and decode the real models, verify finite
geometry and normals, and check the committed assets against the generator.

The Soundings directory contains twenty-seven original nautical symbols and intrinsic-size patterns:
`soundings-harbor`, `soundings-marina`, `soundings-lighthouse`, `soundings-light-flare`,
`soundings-buoy-port`, `soundings-buoy-starboard`, `soundings-buoy-cardinal`,
`soundings-buoy-pillar`, `soundings-wreck`, `soundings-rock-awash`, six notice boards
(`soundings-notice` and its `-prohibition`, `-regulation`, `-restriction`, `-recommendation`, and
`-information` variants), `soundings-distance-mark`, eight small-craft facilities
(`soundings-facility`, `soundings-fuel-station`, `soundings-water-tap`, `soundings-slipway`,
`soundings-pump-out`, `soundings-visitor-berth`, `soundings-boat-hoist`, and `soundings-boatyard`),
`soundings-paper-grain`, and `soundings-water-dots`. They express familiar paper-chart and inland
waterway concepts without bundling a historical chart, specification artwork, sign artwork, or
navigation data. Official Soundings draws its paper and water patterns and, through theme
`nautical.*` image tokens, its point symbols for Nautical marks. `tileflow.icons.json` declares those
twenty-four point symbols as SDF icons, drawn in the central 12 of 24 pixels, so each mark takes its
own colour; `soundings-rock-awash` remains
fixed-colour artwork and is unused because rocks are drawn as chart crosses. A generic World POI is
deliberately not relabelled as a harbour. Soundings uses GEBCO-derived depth bands only as broad
cartographic context, and neither it nor its Nautical marks is a navigation product.

Terrain adds two original circular summit badges, one for light ground and one for dark ground.
It shares Streets’ packaged lettering and POI resources. No elevation tiles are bundled.

`@tileflow/dev` resolves each package descriptor, verifies that its real path remains inside the
installed package, and compiles the complete ordered directory composition into deterministic
MapLibre sprite atlases. `<id>.<ext>` publishes an icon as `<id>` and
`<id>.pattern.<ext>` publishes an intrinsic-size pattern as `<id>`. Published IDs are canonical
lower-kebab, and a later directory wins on an exact duplicate ID.

Font preparation is generic: it reads any map's declared `fonts` directories, derives IDs from
OpenType full names, includes only used faces, and publishes content-addressed font and license
assets. Streets and Terrain materialize their selected DINish and Noto Sans faces and licenses.
Their manifest and Style carry the strict `tileflow:fontFaces` public-asset contract;
Style font values are exact OpenType full names. Soundings declares the canonical Tileflow
glyph URL with exact `Noto Sans Regular` and `Noto Sans Bold` stacks. The compiler never
manufactures a face ID by adding a weight. The compatibility URL
is canonical but not content-addressed; responses
revalidate and do not provide an exact-byte receipt. Reproducible official PBF delivery will use the
separate `/base/<assetSetSha256>/glyphs/...` contract once Hosted has verified and published that
immutable global base-asset set. In that URL, the name belongs to the global base-asset manifest;
its hash does not use the per-map
`tileflow-map-asset-set-v1` output domain recorded as `assetSetSha256` in `build-manifest.json`. It
is independent of managed font-bundle IDs and World descriptors. No compiler fallback invents
either provider.

The sources are shipped so local preview, capture, and self-hosted framework builds compile the same
pixels. Hosted deploy currently rejects these package-owned fonts before authentication. See the
package-level `THIRD_PARTY_NOTICES.md` for provenance and licensing notices.
