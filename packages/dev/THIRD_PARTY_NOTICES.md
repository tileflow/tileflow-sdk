# Third-party notices

This file records third-party components used by Node preparation and preview. Official map artwork
and fonts are owned and published by `@tileflow/maps`; `@tileflow/dev` does not carry an `assets/`
directory. Runtime dependencies are installed as separate npm packages, and their code and native
binaries are not copied into the dev package.

## Package-owned map fonts

The generic font preparation pipeline reads map-owned TTF, OTF, and WOFF2 directories; it does not
embed fonts in `@tileflow/dev`. Each source directory must carry its own `LICENSE.txt`, which is
copied into the deterministic build artifacts whenever that directory contributes a selected face.

The Cyberpunk map in `@tileflow/maps` currently owns unmodified Oxanium Medium and SemiBold TTFs.
Oxanium is copyright 2019 The Oxanium Project Authors and is distributed under the SIL Open Font
License 1.1. The source and binaries are pinned to upstream commit
`a8f39e0c71186190027a093e9001459410192d1e`; the complete license accompanies the files at
`@tileflow/maps/assets/cyberpunk/fonts/LICENSE.txt`.

- Source: <https://github.com/sevmeyer/oxanium/tree/a8f39e0c71186190027a093e9001459410192d1e>
- Google Fonts specimen: <https://fonts.google.com/specimen/Oxanium>
- License: <https://github.com/sevmeyer/oxanium/blob/a8f39e0c71186190027a093e9001459410192d1e/OFL.txt>

## fontkit 2.0.4

Font metadata for TTF, OTF, and WOFF2 inputs is read with the separately installed `fontkit`
package. fontkit is copyright Devon Govett and contributors and is distributed under the MIT
License.

- Source: <https://github.com/foliojs/fontkit/tree/v2.0.4>
- License: <https://github.com/foliojs/fontkit/blob/v2.0.4/LICENSE>

## PMTiles JavaScript 4.5.0

The local Streets preview loads the separately installed `pmtiles` browser decoder to retrieve
individual landmark GLB entries with HTTP byte ranges. PMTiles is copyright Protomaps and
contributors and is distributed under the BSD 3-Clause License. Its `fflate` dependency is
copyright 2020 Arjun Barrett and is distributed under the MIT License.

- PMTiles source and license: <https://github.com/protomaps/PMTiles/tree/v4.5.0/js>
- fflate source and license: <https://github.com/101arrowz/fflate/tree/v0.8.2>

## sharp 0.35.3

`@tileflow/dev` declares `sharp` as an optional dependency and loads it dynamically only when local
SVG or raster icon sources must be inspected and packed. The Tileflow build externalizes `sharp`
rather than bundling it. `sharp` is copyright Lovell Fuller and contributors and is distributed under
the Apache License 2.0.

- Source: <https://github.com/lovell/sharp/tree/v0.35.3>
- License: <https://github.com/lovell/sharp/blob/v0.35.3/LICENSE>

## sharp libvips distributions 1.3.2

`sharp` selects a separate optional `@img/sharp-libvips-*` package for the current platform. The
installed platform-package manifest declares `LGPL-3.0-or-later`; the packaging scripts themselves
are distributed under Apache-2.0. The packages contain prebuilt libvips and separately licensed
runtime dependencies. For `sharp` 0.35.3 the selected libvips ABI is 8.18.3.

- Packaging source: <https://github.com/lovell/sharp-libvips/tree/v1.3.2>
- Packaging-script license: <https://github.com/lovell/sharp-libvips/blob/v1.3.2/LICENSE>
- libvips 8.18.3 source: <https://github.com/libvips/libvips/tree/v8.18.3>
- libvips 8.18.3 license (LGPL-2.1-or-later):
  <https://github.com/libvips/libvips/blob/v8.18.3/LICENSE>

Because `sharp` remains a separately installed optional package, users can install, update, remove,
or replace it independently of `@tileflow/dev`. Tileflow does not modify libvips and does not place a
libvips shared library or a `sharp` native addon inside any Tileflow package tarball. Release smoke
tests enforce that package boundary.
