# Cartographic authoring contract

## Purpose and ownership

The SDK owns the cartographic authoring loop because config, semantic modules, compilation, and
visual evidence must change atomically. The canonical workbench is
`examples/cartography-lab/tileflow.config.ts`.

`editorial-city` is a named example map: OSM basemap + editorial theme + semantic modules. It is
not a separate basemap, an implicit preset, or a public business API. The separate
`tileflow-demos` repository consumes exact packages from npm and validates stable public behavior
after publication; it is not the primary place to invent SDK controls. Hosted platform, API, and
dashboard concerns remain outside this repository.

## Evidence-first loop

One map is reviewed through several committed scenes so a local improvement cannot optimize only
one camera. The initial scene set covers overview hierarchy, dense neighborhood detail, coastline,
and a narrow high-DPR viewport. Each scene names its map, camera, and viewport. The basemap archive
revision, renderer, and guaranteed glyph family/weights are explicit.

Work in this order:

1. Express the desired result with the existing theme and semantic modules.
2. Run `pnpm dev:cartography`, optionally selecting one scene with `--scene`.
3. Run `pnpm visual:cartography` and inspect the current PNG, diff, and report.
4. If config cannot express the result, retain the failing scene and add the smallest semantic SDK
   primitive that explains the visual intent across supported renderers.
5. Update approved baselines only with `pnpm visual:cartography:update`, after review.
6. Merge config, compiler/module behavior, tests, documentation, and visual evidence together.

The lab keeps appearance tokens in the theme, visibility/detail/hierarchy in modules, cameras in
scenes or `view`, and exact MapLibre layer overrides as a last resort. A discovered gap should be
phrased as cartographic intent (for example label hierarchy or boundary emphasis), not as a request
to expose one vendored layer ID.

## Preview semantics

`tileflow dev` accepts either `--map <name>` or `--scene <name>`. Without either option it previews
the first configured map. A map preview uses `maps.<name>.view`, with neutral MapLibre defaults for
missing fields. A scene preview uses its committed map camera and CSS viewport dimensions; exact
DPR remains a capture concern. Application-target scenes must be previewed through the
application's normal development server.

Unknown selections and simultaneous `--map`/`--scene` usage fail explicitly. Valid watched config
edits reload the same selection; invalid edits preserve the last valid artifacts and show
diagnostics.

## Baselines and promotion

Approved lab baselines and canonical receipts live under
`examples/cartography-lab/test/visual-baselines`. Current scenes use versioned remote Tileflow
resources, so receipts deliberately record `networkDependent: true`; byte equality is meaningful
for the recorded runtime and currently served revision, not a claim that the network can never
change. The lab's ordinary diff therefore reports changes for human review without making remote
pixel inequality a failing CI gate.

After an SDK change is published, `tileflow-demos` should receive it through its npm SDK-sync flow.
Only stable, user-facing recipes are promoted to demos. Never commit workspace links or unpublished
package substitutions to that consumer repository.
