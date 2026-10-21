# Official map assets

These directories contain the package-owned sources required by the official Streets, Baedeker,
1777, Siegfried, Soundings, Blueprint, and Cívica maps. Their SVG icons and
patterns live under each map's `icons/` directory. Streets includes a pinned CC0 subset of Maki
pictograms inside Tileflow-authored circular POI markers; its provenance is recorded in
`../THIRD_PARTY_NOTICES.md` and the upstream license is kept at `streets/LICENSE-MAKI.txt`. A map
refers to those directories through the exported `streetsIcons`, `baedekerIcons`, `map1777Icons`,
`siegfriedIcons`, `soundingsIcons`, `blueprintIcons`, and `civicaIcons` descriptors. Baedeker, Cívica, 1777, and Siegfried refer to their own
packaged font directories through `baedekerFonts`, `civicaFonts`, `map1777Fonts`, and `siegfriedFonts`; the files and their `LICENSE.txt` remain beside the map that owns them.

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

The 1777 directory contains eleven original intrinsic-size material patterns, each with
Day, Dawn, Dusk and Night pigments (44 SVG files). The Day IDs are
`map-1777-crop-cross`, `map-1777-crop-hatch`, `map-1777-crop-lines`, `map-1777-heath`, `map-1777-orchard`, `map-1777-paper-grain`,
`map-1777-residential`, `map-1777-sand`, `map-1777-water-ripples`, `map-1777-wetland`, and
`map-1777-woodland`. Woods and gardens use pigment grain, not repeated tree symbols.
1777 also owns three licensed Cormorant Garamond faces under `map-1777/fonts/`.

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

The Siegfried directory contains nine original intrinsic-size motifs, each drawn in coordinated
light and dark artwork: forest, glacier, gravel, orchard, paper grain, rock, scree, water lines, and
wetland. The 18 runtime IDs use `siegfried-<motif>` for the historical light treatment and
`siegfried-dark-<motif>` for the nocturnal engraver-proof treatment. It also owns the three locally
packaged Cormorant Garamond faces selected by both themes. See `siegfried/README.md` and the
package-level `THIRD_PARTY_NOTICES.md` for provenance and licensing.

The Soundings directory contains eleven original nautical symbols and intrinsic-size patterns:
`soundings-harbor`, `soundings-lighthouse`, `soundings-light-flare`, `soundings-buoy-port`,
`soundings-buoy-starboard`, `soundings-buoy-cardinal`, `soundings-buoy-pillar`,
`soundings-wreck`, `soundings-rock-awash`, `soundings-paper-grain`, and `soundings-water-dots`.
They express familiar paper-chart concepts without bundling a historical chart, specification
artwork, or navigation data. Official Soundings draws its paper and water patterns and, through
theme `nautical.*` image tokens, the buoy, light, lighthouse, wreck, and harbor symbols for its
Nautical marks. `tileflow.icons.json` declares those eight point symbols as SDF icons, drawn in the
central 12 of 24 pixels, so each mark takes its own colour; `soundings-rock-awash` remains
fixed-colour artwork and is unused because rocks are drawn as chart crosses. A generic World POI is
deliberately not relabelled as a harbour. Soundings uses GEBCO-derived depth bands only as broad
cartographic context, and neither it nor its Nautical marks is a navigation product.

The Blueprint directory contains four original intrinsic-size patterns and one original
technical symbol: `blueprint-grid`, `blueprint-building-hatch`,
`blueprint-landscape-hatch`, `blueprint-water-hatch`, and `blueprint-poi-node`.
Together they provide drawing-paper grid, building, landscape, and water notation plus a schematic
POI marker without importing another official map's sprite assets.

The Cívica directory contains five original transparent patterns: `civica-paper-grain`,
`civica-park-groves`, `civica-orchard`, `civica-water-lines`, and `civica-industrial-hatch`.
Eleven original `civica-poi-*` pictograms provide civic, cultural, garden, transport, and everyday
destination glyphs with fine ivory clearances and compact paper squares for transport symbols.
Small marks and a quiet secondary point preserve the map's label hierarchy. The map also owns its packaged fonts; artwork and font
provenance are recorded in `civica/README.md` and `civica/fonts/README.md`.

`@tileflow/dev` resolves each package descriptor, verifies that its real path remains inside the
installed package, and compiles the complete ordered directory composition into deterministic
MapLibre sprite atlases. `<id>.<ext>` publishes an icon as `<id>` and
`<id>.pattern.<ext>` publishes an intrinsic-size pattern as `<id>`. Published IDs are canonical
lower-kebab, and a later directory wins on an exact duplicate ID.

Font preparation is generic: it reads any map's declared `fonts` directories, derives IDs from
OpenType full names, includes only used faces, and publishes content-addressed font and license
assets. A self-hosted Baedeker build materializes its selected font files and license without
a map-name special case. Its manifest and Style carry the strict `tileflow:fontFaces`
public-asset contract; Style font values are exact OpenType full names.
The compiler never manufactures a face ID by adding a weight. Streets, Soundings,
and Blueprint each declare the canonical Tileflow glyph URL with exact
`Noto Sans Regular` and `Noto Sans Bold` stacks. Baedeker, 1777 and Siegfried each name `Cormorant Garamond Regular`,
`Cormorant Garamond SemiBold`, and `Cormorant Garamond Italic` from their respective packaged
directories. Cívica packages `DM Serif Text Regular` and `DM Serif Text Italic` for its place
and water lettering, `Barlow Semi Condensed Regular` and `Barlow Semi Condensed SemiBold` for
roads and destinations, and `Noto Sans Regular` as an explicit local fallback. It declares only local fonts because the public contract makes local
font directories and remote glyph providers mutually exclusive. The compatibility URL
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
