# Public SDK generation and licensing boundary — 2026-08-18

Status: implementation evidence on branch `public-world-stateless-sdk`. This document is not a
license grant, legal advice, or release approval. `PUBLIC_RELEASE_BLOCKERS.md` is the operative npm
publication interlock until the owner and qualified reviewers close the remaining decisions.

## Implemented technical boundary

- The nine default Streets POI files are new first-party geometric SVG drawings. Their source
  directory records provenance without attempting to create the still-pending output grant.
- `@tileflow/dev` no longer records or bundles Google Places-derived artwork.
- `sharp` remains an exact optional dependency, is loaded dynamically, and is externalized by the
  `@tileflow/dev` build. It can be installed, updated, removed, or replaced separately.
- `packages/dev/THIRD_PARTY_NOTICES.md` records `sharp` 0.35.3, the platform-specific
  `@img/sharp-libvips-*` 1.3.2 distribution, the packaging source/license, and libvips 8.18.3
  source/license.
- Package smoke rejects `node_modules`, `.node`, `.dylib`, `.dll`, and versioned or unversioned
  `.so` paths in every Tileflow tarball, requires the dev notice/provenance files, and checks that
  `sharp` remains an optional dependency.
- The public World path is now generation-based and direct. World config and generated identity use
  `generation: "v1"`; no World revision, TileJSON, catalog, archive selector, or repository lock is
  created. Direct external tile lists and `pmtiles://` sources retain an optional fixture revision
  for exact visual evidence.
- A strict `WorldGenerationDescriptor` parser enforces the v1 URL, encoding, hash/ID grammars,
  bounds, zooms, bounded non-markup attribution, and content-identified glyph/sprite URL shapes.
  Tests exercise a development descriptor only; no development asset ID is a production default.
- The automatic npm workflow now fails before registry reconciliation while
  `PUBLIC_RELEASE_BLOCKERS.md` exists. Local source/test validation remains available on the branch.
- The branch working tree passed root check/build, all 121 enabled capture/CLI browser and framework
  tests, the 11-tarball clean-consumer smoke, and `pnpm publish:alpha:dry-run` without publication.
  These results are implementation evidence, not a substitute for rerunning the exact final commit.

## Deliberately unresolved

- Legal owner identity, root/package `LICENSE` and `NOTICE`, package `license` fields, the generated
  output grant, and trademark boundary remain absent pending owner decision and qualified review.
- The production World data descriptor is incomplete until its frozen schema hash, bounds, zooms,
  encoding, and complete upstream attribution are approved.
- The final content-identified asset-set ID and glyph/sprite URLs are not known. No placeholder is
  bundled as the public compiler default.
- The source author's factual confirmation that the current compiler is not derived from the
  removed OSM Bright style remains open. Repository-history and source searches are supporting
  evidence only and are not a substitute for that confirmation.
- The `sharp`/libvips notice and separability implementation still requires qualified review before
  the release interlock may be removed.

## Required release evidence

Before removing the interlock, rerun the dated dependency inventory and complete descriptor checks,
pack every public package, inspect the `@tileflow/dev` tarball for native binaries, run the clean
packed consumer, execute browser/framework capture tests with exact fixtures, and perform the full
publication-free sequence in `PUBLISHING.md` on the exact candidate commit.
