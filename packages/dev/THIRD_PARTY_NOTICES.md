# Third-party notices

This file records third-party components used by Node preparation and preview. Official map artwork
and fonts are owned and published by `@tileflow/maps`; `@tileflow/dev` does not carry an `assets/`
directory. Runtime dependencies are installed as separate npm packages, and their code and native
binaries are not copied into the dev package.

## Bitmap distance transform

`src/icon-distance.ts` adapts the alpha distance transform from bitmap-sdf 1.0.4 for bounded,
Node-only sprite preparation. The adaptation removes browser globals and adds input validation.
Source: <https://github.com/dy/bitmap-sdf>. License: MIT.

Copyright 2020 Dmitry Ivanov

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the “Software”), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Package-owned map fonts

The generic font preparation pipeline reads map-owned TTF, OTF, and WOFF2 directories; it does not
embed fonts in `@tileflow/dev`. Each source directory must carry its own `LICENSE.txt`, which is
copied into the deterministic build artifacts whenever that directory contributes a selected face.

The source repository's generic font tests retain pinned Oxanium fixtures and their complete
SIL Open Font License 1.1 notice under `test/fixtures/fonts/oxanium/`. These fixtures are not
included in the published package. Community map fonts are owned by
[Community Maps](https://github.com/tileflow/community-maps).

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
- fflate source and license: <https://github.com/101arrowz/fflate/tree/v0.8.3>

## sharp 0.35.4

`@tileflow/dev` declares `sharp` as an optional dependency and loads it dynamically only when local
SVG or raster icon sources must be inspected and packed. The Tileflow build externalizes `sharp`
rather than bundling it. `sharp` is copyright Lovell Fuller and contributors and is distributed under
the Apache License 2.0.

- Source: <https://github.com/lovell/sharp/tree/v0.35.4>
- License: <https://github.com/lovell/sharp/blob/v0.35.4/LICENSE>

## sharp libvips distributions 1.3.3

`sharp` selects a separate optional `@img/sharp-libvips-*` package for the current platform. The
installed platform-package manifest declares `LGPL-3.0-or-later`; the packaging scripts themselves
are distributed under Apache-2.0. The packages contain prebuilt libvips and separately licensed
runtime dependencies. For `sharp` 0.35.4 the selected libvips ABI is 8.18.6.

- Packaging source: <https://github.com/lovell/sharp-libvips/tree/v1.3.3>
- Packaging-script license: <https://github.com/lovell/sharp-libvips/blob/v1.3.3/LICENSE>
- libvips 8.18.6 source: <https://github.com/libvips/libvips/tree/v8.18.6>
- libvips 8.18.6 license (LGPL-2.1-or-later):
  <https://github.com/libvips/libvips/blob/v8.18.6/LICENSE>

Because `sharp` remains a separately installed optional package, users can install, update, remove,
or replace it independently of `@tileflow/dev`. Tileflow does not modify libvips and does not place a
libvips shared library or a `sharp` native addon inside any Tileflow package tarball. Release smoke
tests enforce that package boundary.
