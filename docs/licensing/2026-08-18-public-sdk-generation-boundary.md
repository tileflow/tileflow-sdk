# Public SDK generation and licensing boundary — 2026-08-18

Status: implementation evidence on branch `public-world-stateless-sdk`, updated 2026-08-26 after
the owner approved the public SDK license boundary. This document is not legal advice or release
approval. The root legal files are the operative grants; `PUBLIC_RELEASE_BLOCKERS.json` remains the
npm publication interlock for the unrelated open release requirements.

## Implemented technical boundary

- The official Streets, Ferraris, Härad, Siegfried, Soundings, Cyberpunk, Matrix, and Verdant SVG
  icon/pattern sources are package-owned map assets under `packages/maps/assets/<id>/icons/`.
  Streets and Siegfried own both light and dark pattern variants inside their respective single
  asset closures; dark is a theme, not another map or asset directory. Siegfried's nocturnal artwork
  is an original Tileflow interpretation, not a historical swisstopo colourway. The Streets POI
  files and the chart symbols retained in
  the Soundings asset directory are first-party geometric drawings; only the harbor and paper/water
  assets participate in official Soundings, while the remaining symbols support an experimental
  Nautical canary. Their source directories and
  `packages/maps/THIRD_PARTY_NOTICES.md` record provenance alongside the repository's
  generated-output grant.
- Cyberpunk's and Matrix's unmodified Oxanium fonts and OFL licenses live under their respective
  `packages/maps/assets/cyberpunk/fonts/` and `packages/maps/assets/matrix/fonts/` directories.
  Siegfried's unmodified Cormorant Garamond fonts and OFL license live under
  `packages/maps/assets/siegfried/fonts/`.
- `@tileflow/dev` no longer records or bundles map artwork or fonts. It resolves the fixed Maps
  assets during preparation and still carries notices for the separate tooling dependencies it
  executes.
- `sharp` remains an exact optional dependency, is loaded dynamically, and is externalized by the
  `@tileflow/dev` build. It can be installed, updated, removed, or replaced separately.
- `packages/dev/THIRD_PARTY_NOTICES.md` records `sharp` 0.35.3, the platform-specific
  `@img/sharp-libvips-*` 1.3.2 distribution, the packaging source/license, and libvips 8.18.3
  source/license.
- Package smoke rejects `node_modules`, `.node`, `.dylib`, `.dll`, and versioned or unversioned
  `.so` paths in every Tileflow tarball, requires the dev notice/provenance files, and checks that
  `sharp` remains an optional dependency.
- World config names `world-v1/current` for live discovery or an exact `releaseId` plus descriptor
  SHA-256 for reproducible work. Both use the public TileJSON resolver, which binds one immutable
  release per session or job; Core has no second compiler-owned World descriptor or asset set.
  Direct external tile lists and `pmtiles://` sources retain an optional fixture revision for exact
  visual evidence.
- The map contract makes every official map an independent root with explicit providers: Streets,
  Ferraris, Härad, Soundings, and Verdant declare the canonical Tileflow glyph URL directly;
  Cyberpunk, Matrix, and Siegfried each own packaged fonts.
  That URL is canonical rather than content-addressed; responses revalidate and do not provide an
  exact-byte identity. The immutable replacement is the separate
  `/base/<assetSetSha256>/glyphs/...` contract. No compiler fallback manufactures the URL.
- The deliberately dispatched npm workflow fails before registry reconciliation while
  `PUBLIC_RELEASE_BLOCKERS.json` exists. Local source/test validation remains available on the branch.
- The repository and all thirteen public package manifests now declare Apache-2.0. Byte-identical
  `LICENSE`, `NOTICE`, `GENERATED_OUTPUT_LICENSE.md`, and `TRADEMARKS.md` files ship in every npm
  tarball, and permanent source and packed-artifact assertions enforce that boundary.
- The project owner approved `Tileflow.dev contributors` as the public copyright-holder label and
  confirmed on 2026-08-26 that the current SDK does not use or derive from OSM Bright.
- At this dated checkpoint, before `@tileflow/interactions` joined the public release set, the branch
  working tree passed root check/build, all 121 enabled capture/CLI browser and framework tests, the
  then-complete 11-tarball clean-consumer smoke, and `pnpm publish:alpha:dry-run` without
  publication. These historical results are implementation evidence, not a substitute for rerunning
  the current thirteen-package set on the exact final commit.

## Deliberately unresolved

- The production World candidate remains blocked until its observed schema, bounds, zooms,
  encoding, complete upstream attribution, QA evidence and immutable handoff all pass their gates.
- The official glyph source is locked and produces asset set
  `33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3`; publishing and probing
  that exact set must complete before official maps replace the compatibility URL with its explicit
  immutable URL. World descriptors do not carry this identity.
- The `sharp`/libvips notice and separability implementation still requires qualified review before
  the release interlock may be removed.

## Required release evidence

Before removing the interlock, rerun the dated dependency inventory and complete descriptor checks,
pack every public package, inspect the `@tileflow/dev` tarball for native binaries, run the clean
packed consumer, execute browser/framework capture tests with exact fixtures, and perform the full
publication-free sequence in `PUBLISHING.md` on the exact candidate commit.
