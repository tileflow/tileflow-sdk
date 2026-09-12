# Bounded vector-feature inspection

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

Custom Node tooling can inspect only the features visible near a configured camera without opening
a browser:

```ts
import {inspectTileflowFeatures} from '@tileflow/dev/inspect';

const internalCatalog = artifacts.project;
const inspection = await inspectTileflowFeatures(internalCatalog, 'madrid', {
  center: [-3.6927512, 40.4086555],
  zoom: 16,
  sourceLayers: ['poi'],
  properties: ['name', 'category', 'type', 'icon', 'filter_rank', 'size_rank'],
  width: 512,
  height: 512,
  limit: 100,
});
```

The inspector supports ordinary HTTP(S) vector sources and TileJSON. It bounds viewport, tile
count, individual/total bytes, scanned and returned features, property count/string lengths, and
request time; results are deduplicated and sorted deterministically. Output contains projected
properties, geometry summaries, safe origin/path metadata, and the configured source revision or
`null`. It never emits URL queries, credentials, hidden properties, response bodies, or absolute
paths. PMTiles and authenticated provider adapters are not currently supported by this primitive.

Deployment adapters can compile the same sources without writing them to disk:

```ts
import {compileTileflowIconPackages} from '@tileflow/dev/icons';

const internalCatalog = artifacts.project;
const result = await compileTileflowIconPackages(internalCatalog, {
  cwd: process.cwd(),
  target: 'hosted',
});
```

Streets declares `[streetsIcons]` and keeps light/dark image-token targets in that one closure;
Cyberpunk and Matrix independently declare `[cyberpunkIcons]` and `[matrixIcons]`. Baedeker,
Ferraris, Härad, Siegfried, Soundings, Verdant, and San Francisto declare only `[baedekerIcons]`,
`[ferrarisIcons]`, `[haradIcons]`, `[siegfriedIcons]`, `[soundingsIcons]`, `[verdantIcons]`, and
`[sanFrancistoIcons]`, respectively. No official root composes another map's assets even though all
use the semantic compiler ABI. Baedeker's directory contains eight original travel-atlas patterns;
its browser-derived Mapterhorn contours use runtime terrain tiles and are not part of the icon
package. Härad's directory contains nine original Tileflow patterns inspired by Lantmäteriet's CC0
Häradsekonomiska kartan series from 1859–1934. Soundings owns ten original nautical symbols and
patterns. San Francisto owns four technical blueprint patterns and one schematic POI node; its
unbundled Mapterhorn contours remain runtime terrain, and its text uses the canonical Noto Sans
glyph provider. An application map may inherit a root's exact array, replace it, clear it with `[]`,
or compose it explicitly with a spread.
`modules.poi.icons: false` or a disabled POI module suppresses POI icon layers without moving asset
ownership into dev. POI density is the numeric producer threshold 1–5; it is not an asset-provider
preset.

The hosted target enforces repository containment, portable icon IDs, safe SVG
references, deterministic ordering, and the public package limits. Package-owned directories are
trusted only inside their declared owning package and are exempt from config working-tree
containment. It returns deduplicated generated files plus a canonical manifest/content hash. Upload
only those generated files: source icons and absolute paths remain local.

The version-1 manifest includes `renderedIcons` in the exact sorted `iconNames` order. Each entry
contains SHA-256 digests for the normalized 1x and 2x RGBA cell. The digest framing includes its
density and dimensions, zeroes RGB only where alpha is zero, and excludes filenames/source bytes.
The package content hash still covers the complete canonical manifest, including all four encoded
file hashes. Consumers can therefore distinguish a visible per-icon change from an atlas-layout or
encoding-only package change without receiving the original SVG/raster file.

`compileTileflowIconPackages` retains the exact RGBA cells used to assemble each atlas, so its
pixel digests describe delivered pixels rather than a second render. Hosted upload services must
decode the submitted PNGs and reconstruct those digests independently; client-authored manifest
analysis is not authoritative.

Custom Node tooling can inspect the same local pipeline without walking or decoding source files a
second time:

```ts
import {inspectTileflowIconCatalogs} from '@tileflow/dev/icons';

const internalCatalog = artifacts.project;
const inspection = await inspectTileflowIconCatalogs(internalCatalog, {
  cwd: process.cwd(),
  mapNames: ['madrid'],
});
```

The result keeps one catalog per distinct ordered directory composition, the exact winning source
for every final ID, explicit same-ID replacements, config-relative source metadata, exact atlas rectangles,
both manifest pixel digests, and the shared compiled package. `icons: []` is represented as an
absent catalog. This is a local-authoring integration surface: use the hosted compilation target
separately for deployment compatibility, and project only the metadata needed by an external
protocol rather than serializing generated byte arrays accidentally.

This package is public, but it is an integration layer. Styling primitives live in
`@tileflow/core`, official maps and their source assets live in `@tileflow/maps`, and React
rendering lives in `@tileflow/react`.

Docs: https://tileflow.dev/docs
