# Third-party notices

This file records the optional native image-toolchain boundary used while compiling local icon
sprites. These dependencies are installed as separate npm packages; their code and native binaries
are not copied into the `@tileflow/dev` package.

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
