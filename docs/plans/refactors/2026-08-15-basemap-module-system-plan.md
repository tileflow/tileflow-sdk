# Build Tileflow Streets from universal cartographic modules

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision
Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows Tileflow's ExecPlan standard. It repeats the required context and decisions so a
contributor can execute it from this repository without access to prior conversations.

## Purpose / Big Picture

Build Tileflow Streets as the first complete proof of Tileflow's cartographic language. Normal
authoring should be this small:

```ts
export default defineTileflow({
  maps: {
    madrid: {
      basemap: streets(),
      modules: {
        roads: roads({hierarchy: 'strong'}),
        labels: labels({language: 'es'}),
      },
    },
  },
});
```

`streets()` supplies a complete default recipe made from semantic modules. Map modules are typed,
partial overlays on that recipe. A domain compiler creates complete MapLibre layers or symbol
intents; it does not search for or patch layers from an external style. Shared symbol composition
and a common layer graph assemble every domain deterministically into the final Style JSON.

Streets starts as a Tileflow-owned root style assembled entirely from resolved modules. It does not
inherit, bundle, or ship another style, reference inventory, notice, or default sprite. External
reference images may inform human review, but they are not compiler or package inputs.

The normal config does not declare data. Omitted `data` resolves offline and deterministically to a
revision of Tileflow's official world dataset pinned by the installed SDK. Advanced authors may
select another official revision or one external OpenMapTiles-compatible vector source with a single
explicit `data` field.

Only `streets()` is public in this plan. Do not add compatibility basemaps, seek upstream pixel
parity, or build a generic interpreter for arbitrary Style JSON. Future basemaps will be different
complete recipes over the same proven modules.

## How the system works

```mermaid
flowchart LR
    A["Data<br/>Tileflow World or another vector dataset"]
    B["Base design<br/>streets()"]
    C["Design controls<br/>roads(), water(), labels(), buildings()"]

    A --> D["Tileflow compiler"]
    B --> D
    C --> D

    D --> E["MapLibre Style JSON<br/>layers, colors, labels, and order"]
    E --> F["Interactive map"]
```

- **Data** says what exists: roads, water, buildings, names, and other geographic features.
- **Streets** supplies Tileflow's complete default cartographic design.
- **Modules** express a human or AI request to change that design without naming MapLibre layer IDs.
- The **compiler** turns the resolved design and data contract into the real ordered MapLibre layers.

This plan does not add entities, clustering, selection, popups, business APIs, hosted API
implementation, satellite basemaps, or a public third-party module plugin protocol. Existing terrain
uses a secondary raster source; preserve it and integrate its ordering, but do not redesign it as
part of the primary vector-data API.

## Progress

- [x] (2026-08-15 08:48Z) Audited the compiler, schema, renderer split, modules, OSM Bright template,
      generated layers, data precedence, Streets workbench, CLI deploy, manifests, capture receipts,
      packaging, and documentation.
- [x] (2026-08-15 08:48Z) Created and indexed an initial three-basemap/profile-based ExecPlan.
- [x] (2026-08-15 09:10Z) Replaced that architecture after the owner chose to build Streets directly
      from modules, retain OSM Bright only as reference evidence, and defer other public basemaps.
- [x] (2026-08-15 09:51Z) Froze the vendored OSM Bright bytes, 128 exact layer IDs/order, one-owner
      domain ledger, legacy 23-layer inventory, asset/license evidence, baseline tests, and current
      cartography diffs. The importing commit did not preserve an upstream commit hash, so the
      vendored SHA-256 is the byte-exact reference.
- [x] (2026-08-15) Implemented deterministic implicit/explicit primary `data`, Streets identity,
      typed style values, exact semantic styles, module factories, direct compilers for all nine
      domains, deterministic graph assembly, strict raw overrides, and a direct-only root style.
- [x] (2026-08-15) Switched the public core API/schema to required `streets()` and keyed modules;
      removed public `osm()`, `styleOverride()`, renderer fallback, modules arrays, and old data
      paths. The generated default is MapLibre-valid and contains no inherited layer IDs.
- [x] (2026-08-15) Implemented coordinated road-label eligibility and POI rank/icon/text/coupling
      policy before graph assembly. Kept the OSM Bright-derived default sprite explicitly
      attributed and licensed; local/hosted icon packages replace it with validated generated
      sprites and never leak source paths.
- [x] (2026-08-15) Migrated dev, CLI, capture receipt 2, manifest 2, build packages, wrappers, the
      initializer, icon tooling, the nine-scene Streets workbench, and durable contracts/READMEs.
- [x] (2026-08-15) Deleted the legacy compiler, schema, OSM basemap, generated renderer, template
      controls, and style-override module from the executable source graph.
- [x] (2026-08-15) Ran focused typechecks/tests, full workspace `verify` (194 pass, 13 intentional
      integration skips), and reviewed/accepted nine schema-2 visual baselines. Visual review found
      and fixed ignored POI detail modes plus overlapping service/main rail filters.
- [x] (2026-08-15 11:34Z) Ran final `pnpm check`, `pnpm build`, packaged public capture smoke, and
      alpha publication dry-run successfully. Migrated the packaged-smoke fixture from the rejected
      legacy renderer/data/module shape to the public Streets + receipt-2 contract. Reviewed the
      final diff/status without publishing. `git diff --check` passes; repository-wide Prettier
      reports only the two unchanged files already unformatted on the clean base:
      `scripts/reconcile-release.mjs` and `scripts/reconcile-release.test.mjs`.
- [x] (2026-08-15 12:10Z) Removed the remaining vendored reference JSON, coverage ledger/test, packaged
      notice, default sprite, and provenance metadata. Streets now defaults to POI text with icons
      disabled until an explicit local or hosted icon set is provided; all nine visual baselines
      were reviewed and regenerated without that dependency. Re-ran `pnpm check`, `pnpm build`,
      packaged public smoke, and the alpha publication dry-run successfully after the removal.
- [x] (2026-08-15) Documented the accepted values beside the active Streets recipe and made
      the built-in dev preview persist validated longitude, latitude, zoom, bearing, and pitch in
      the URL. Config-triggered and manual reloads now preserve the current camera, while missing or
      invalid camera parameters fall back to the configured map or scene camera. Focused dev and lab
      tests cover URL round-tripping, bounds replacement, query preservation, and invalid fallback.
- [x] (2026-08-15) Replaced the coarse public `path` road target with disjoint semantic targets for
      `pedestrian`, `footway`, `cycleway`, `steps`, and residual `pathway`; apply the same taxonomy to
      road labels and all surface/tunnel/bridge phases; remove the Streets workbench's raw
      `class`/`subclass` expressions; validate the output and review the close-street scene. Focused
      core tests pass 67/67, the lab config validates, its tests pass 3/3, the Atocha zoom-17 preview
      was reviewed, and the complete workspace/build/public-smoke/alpha-dry-run gates pass.
- [x] (2026-08-15) Inspected the Atocha source features after comparing the close-street map with a
      reference and found that a prominent pedestrian plaza is a `Polygon`, not a missing line.
      Added `roads.areas.pedestrian` as a remapping-aware semantic fill target, kept
      `classes.pedestrian` for line-like ways, strengthened the lab's path hierarchy, and covered
      area compilation when no line class is enabled. Removed MapLibre's unavailable default
      Open Sans glyph fallback from one-way markers by binding them to resolved road typography.
      Focused tests, full Style JSON validation, and two reviewed close-street captures pass. The
      nine-scene diff still reports the previously documented user palette drift against older
      baselines, so those baselines were not implicitly replaced; the local watch preview remains
      blocked in this worktree by the host `EMFILE` limit. Final evidence: 69/69 core tests and 3/3
      lab tests pass, followed by `pnpm check`, `pnpm build`, packaged public smoke, and the alpha
      publication dry-run without publishing.
- [x] (2026-08-15) Audited Tileflow World road fields and completed the road-intelligence follow-up:
      bind ramp/access/surface/mode/service/stacking fields, compile semantic road modifiers,
      restrictions, service subtypes, and construction classes as data-driven paint within stable
      class layers, then refine the Streets recipe and review the close-street/motorway
      evidence. Focused core tests pass 71/71, the lab tests pass 3/3, and the generated Style JSON
      is MapLibre-valid. The close-street and motorway captures were reviewed. The nine-scene diff
      correctly reports the deliberate road/palette changes plus the already changed close-street
      camera, so no baseline was replaced implicitly. `pnpm check`, `pnpm build`, packaged public
      smoke, and the alpha publication dry-run all pass without publishing.
- [x] (2026-08-15) Consolidated the public visual language before adding more domain-specific knobs:
      split reusable layer range, paint, layout, and compound styles; complete background, fill,
      line, text, icon, symbol, circle, and extrusion primitives; remove module-specific copies of
      the same paint vocabulary; and migrate every module and the Streets workbench. Focused primitive
      tests cover constant/expression mapping, compound emission, priority inversion, coupled symbol
      range conflicts, and valid output. Deliberate visual changes were reviewed in all nine scenes
      and accepted as new baselines rather than hidden behind byte-parity claims.
- [x] (2026-08-15) Finished the Roads language on top of those primitives. Preserved the implemented
      class × structure × phase × treatment model, then consume the remaining useful fields already
      present in Tileflow World, added route shields and junction semantics after bounded source
      audits, refined the Streets road recipe across the committed scene matrix, and kept signals,
      crossings, sidewalks, and lane geometry outside SDK scope until a selected dataset exposes
      them. Raised junction labels to zoom 15 after the first visual pass exposed overview clutter.
      Final focused evidence is 76/76 core tests, 3/3 lab tests, 54 CLI tests with 6 intentional
      skips, and a MapLibre-valid 155-layer Editorial City style on Streets contract version 2.
- [x] (2026-08-15) Renamed the cartographic workbench from `cartography-lab` to
      `tileflow-streets`, renamed its root commands and package identity, and migrated the separate
      Uber-inspired React/Vite example to the same shared visual primitives and Streets v2 road,
      transit, shield, and data contracts. Both examples pass typecheck/tests; all Streets scenes and
      both application scenes were captured and reviewed. Uber baselines and receipts were updated
      deliberately; later comparisons retain only the documented remote-resource nondeterminism.
      Re-ran `pnpm check`, `pnpm build`, packaged public capture smoke, and the alpha publication
      dry-run successfully with both examples in the workspace.
- [x] (2026-08-15) Retuned Tileflow Streets against close and intermediate Puerta del Sol
      references: strengthened the road hierarchy and casing, limited place labels by scale,
      replaced dense/full POI output with category/rank-aware landmarks, refined pedestrian plazas,
      and added `madrid-sol-close` plus `madrid-center` review scenes. Fixed POI category ranges so
      one semantic `minZoom` governs both label and marker layers, documented the compound range
      contract, reviewed and regenerated all eleven Streets baselines, and passed 77/77 core tests,
      3/3 Streets tests, `pnpm check`, and `pnpm build`.
- [x] (2026-08-15) Audited the overscaled Tileflow World POI candidates around Puerta del Sol and
      fixed the next street-scale quality gap. Calibrated `balanced` beyond the old rank-24 cliff,
      added exact per-category `maxRank`, expanded the workbench's semantic class buckets, and
      balanced shopping, food, lodging, services, culture, and transit independently. Added a
      dedicated `transport-areas` graph slot after proving that road-area polygons in the old
      surface-fill tail covered their own pedestrian line axes. Focused schema/compiler/style tests
      pass; regenerated and reviewed all eleven Streets baselines; and passed 79/79 core tests, 3/3
      Streets tests, `pnpm check`, `pnpm build`, `pnpm run smoke:capture-public`, and
      `pnpm run publish:alpha:dry-run`.
- [x] (2026-08-16) Replaced capsule-shaped tunnel segments with continuous, square-ended road
      stacks. Removed the broad dash pattern from the default and Streets recipe, kept tunnels
      legible through width, tint, and opacity, and added a dedicated Plaza de Castilla tunnel
      scene so the failure remains part of the reviewed visual suite. Regenerated and reviewed all
      twelve Streets baselines; the exact recheck passed apart from seven non-perceptual pixels in
      the remote-dependent Barcelona scene. Final evidence is 79/79 core tests, 3/3 Streets tests,
      `pnpm check`, `pnpm build`, `pnpm run smoke:capture-public`, and
      `pnpm run publish:alpha:dry-run` without publishing.
- [x] (2026-08-16) Replaced the low-contrast tunnel stack with a semantic hatch phase: a
      translucent pale deck, thin casing, and optional repeated diagonal marks that inherit the resolved road
      width without entering MapLibre collision placement. Added the reusable `LineHatchStyle`
      vocabulary to road structures, updated Streets and Uber receipts/baselines, and raised the
      durable Streets contract to version 3 because the generated hatch layer adds a stable public
      layer ID and ordering phase. The direct default now emits 119 layers and Editorial City emits 164. The accepted Streets recipe uses `0.2` tunnel fill opacity, `0.32` casing opacity, and
      `0.18` hatch opacity. All twelve Streets baselines and both Uber baselines were regenerated
      and reviewed; the final Streets comparison kept the tunnel scene exact and reported only two
      exact, zero-perceptual remote pixels in each of three other scenes. Final `pnpm check`,
      `pnpm build`, packaged public smoke, and alpha publication dry-run all pass without publishing.
- [x] (2026-08-16) Moved the complete tunnel stack below buildings, pedestrian areas, surface and
      bridge transport, and shared symbols so underground roads cannot cover monument geometry or
      POIs. Added an explicit graph-order invariant; the focused cartography and Streets tests pass
      8/8, and all twelve reviewed Streets visual scenes compare unchanged after accepting the new
      baselines, including the Plaza de Castilla tunnel scene. Final `pnpm check`, `pnpm build`,
      packaged public smoke, and alpha publication dry-run pass without publishing.

## Surprises & Discoveries

- Observation: `basemap: osm()` does not currently select one visual system. `renderer: 'auto'`
  chooses the 128-layer OSM Bright template only while a syntax predicate passes. Adding colors,
  density, buildings, source-layer overrides, or unsupported modules can silently select a generated
  23-layer style.
  Evidence: `isOsmBrightTemplateCompatible()` and renderer branches in
  `packages/core/src/compiler.ts`, plus `packages/core/test/compiler.test.ts`.

- Observation: module array semantics are inconsistent. `.find()` makes the first roads/labels/POI
  duplicate win while `styleOverride` modules are ordered.
  Evidence: module collection at the beginning of `createStyle()`.

- Observation: removing the old tunnel dash did not by itself produce a readable tunnel. At dense
  interchanges, similarly colored surface roads crossed the translucent tunnel deck and made the
  remaining segments read as alternating rounded blocks.
  Evidence: the Plaza de Castilla `madrid-tunnels` baseline before the semantic hatch phase. An
  opaque pale fill separated the levels; a thin casing plus diagonal hatch then communicated the
  tunnel without changing the underlying line geometry.

- Observation: existing roads, labels, and POI code contains useful semantic knowledge but is split
  between generated factories and OSM Bright control passes. Preserve the knowledge, not two
  renderers.
  Evidence: `packages/core/src/modules`, `packages/core/src/basemaps/osm/layers.ts`, and
  `packages/core/src/templates/osm-bright`.

- Observation: seven abbreviated modules cannot cover all 128 reference layers. Aeroways and transit have
  independent geometry and behavior. Some frozen reference symbol layers also combine eligibility,
  icon, and text, so the coverage ledger must assign each whole reference layer to one owner.
  Evidence: the OSM Bright inventory includes aeroway/aerodrome, rail/transit/ferry, station, and
  compound symbol layers.

- Observation: zero inherited layers does not prove independence. Sprites, glyph choices, filters,
  expressions, source assumptions, and copied metrics may remain derived.
  Evidence: OSM Bright assets/provenance are supplied separately from the layer array.

- Observation: primary data currently has project `tilesets`, map `tileset`, map `tiles`, fields on
  `osm()`, and another deploy precedence pass.
  Evidence: `TileflowProjectConfig`, `TileflowConfig`, `TileflowOsmBasemapConfig`,
  `createStyleFromProject()`, `resolveMapTileset()`, and `createHostedDeployMapConfig()`.

- Observation: tileset-specific config/metadata is cross-package. Core runtime, dev inspection,
  capture receipts, CLI, build plugins, and framework inline config consume `tileBaseUrl`,
  `tilesetVersion`, or related fields.
  Evidence: references under `packages/core/src/runtime.ts`, `packages/dev`, `packages/capture`,
  `packages/cli`, and framework/build packages.

- Observation: deploy currently JSON-serializes rewritten config plus mandatory `tilesetId` for the
  server to compile again. This conflicts with removed fields and future repository-local recipes.
  Evidence: CLI deploy preparation and POST `/v1/styles`; hosted API code is outside this repo.

- Observation: the branch already has a user-owned palette diff in
  `examples/tileflow-streets/tileflow.config.ts`. Do not overwrite or misattribute it.
  Evidence: `git diff -- examples/tileflow-streets/tileflow.config.ts` on `basemap-system`.

- Observation: OpenMapTiles can encode a pedestrian plaza as a `Polygon` in `transportation` with
  `class=path` and `subclass=pedestrian`. A line-only semantic target renders merely its ring and
  cannot give the surface its own fill hierarchy.
  Evidence: `tileflow inspect features` at the Atocha close-street camera returned polygon feature
  `487614492`; the new `streets-road-pedestrian-area` layer targets that geometry explicitly.

- Observation: the repository records the official OSM Bright repository and license but not the
  upstream commit/tag used by the initial import. The local vendored style is therefore the only
  provable byte-exact source snapshot.
  Evidence: the template first appears in SDK commit `32927e3`; its SHA-256 is
  `b8c4d676640b105e089f2606f2bbc5558932c5efcb9527401d8b31a43cfbddc7` and the official upstream is
  `https://github.com/openmaptiles/osm-bright-gl-style`.

- Observation: the four existing visual baselines differ from the current lab because the
  user-owned palette changed after those baselines were accepted. Capture completes successfully
  outside the browser sandbox and records all four diffs; do not update the baselines implicitly.
  Evidence: the Streets visual-diff command and `.tileflow/diffs` at the Milestone 0 checkpoint.

- Observation: the first direct visual pass exposed two semantic bugs that structural style tests
  could not reveal. POI `minimal`/`balanced`/`full` and `essential`/`full` collapsed to the same
  output, and service rail rendered on top of every main rail.
  Evidence: the nine lab captures. POI now compiles independent/coupled rank policies and transit
  filters main/service rail through the versioned `service` field binding.

- Observation: a category-level POI zoom range originally conflicted with the text default and did
  not reach a separately materialized circle marker. That made later-zoom food and shopping markers
  appear across the intermediate city view. The category range is now the symbol-layer range and
  the inherited default for its marker; a marker-specific range may still refine it.
  Evidence: the Puerta del Sol visual pass and the per-category label/marker range regression in
  `packages/core/test/domain-compilers.test.ts`.

- Observation: the packaged public smoke was the final executable consumer of the removed legacy
  authoring shape. It correctly failed schema validation until its fixture used `streets()`, keyed
  modules, `vectorTiles(openMapTiles())`, and capture receipt schema 2.
  Evidence: the first `pnpm run smoke:capture-public` final-gate run and the migrated fixture in
  `scripts/capture-public-smoke.mjs`.

- Observation: the first Streets road API collapses every OpenMapTiles path into one public `path`
  target, even though the data contract exposes `subclass`. This forced the Streets workbench to use
  raw MapLibre expressions to make pedestrian streets road-like, footways narrow, and pedestrian
  labels eligible. Tile inspection around Atocha confirms named and unnamed `pedestrian`, `footway`,
  and `steps` features, including bridge and tunnel variants; the official schema also defines
  `cycleway`, `path`, `bridleway`, `corridor`, and `platform` subclasses.
  Evidence: `packages/core/src/modules/roads/compiler.ts`,
  `packages/core/src/modules/labels/compiler.ts`, the raw filters in
  `examples/tileflow-streets/tileflow.config.ts`, Tileflow World feature inspection at zoom 17, and
  the OpenMapTiles transportation/transportation_name schema.

- Observation: Tileflow World revision `2026-06-07` declares OpenMapTiles `3.16.0`, sixteen vector
  layers, and maximum source zoom 14. Its transportation layer already carries `access`, `bicycle`,
  `brunnel`, `expressway`, `foot`, `horse`, `indoor`, `layer`, `level`, `mtb_scale`, `network`,
  `official`, `oneway`, `ramp`, `service`, `subclass`, `surface`, and `toll`; the SDK contract exposed
  only a subset. Atocha and motorway samples confirm real ramps, access restrictions, paved/unpaved
  surfaces, service subtypes, mode restrictions, bridge/tunnel levels, and construction encoded as
  classes such as `minor_construction`. No source layer declares crossings or traffic signals.
  Evidence: public TileJSON and bounded `tileflow inspect features` samples at the committed Madrid
  close-street and motorway cameras.

- Observation: Tileflow World's TileJSON attribution includes OpenFreeMap in addition to
  OpenMapTiles and OpenStreetMap, while the SDK's explicit source attribution omitted OpenFreeMap.
  Evidence: the public TileJSON and `defaultAttribution` in `packages/core/src/data/index.ts`.

- Observation: OpenMapTiles POI rank is useful for importance but is not distributed equally by
  semantic category. At the zoom-17 Sol sample, the 256-pixel viewport contained 28 POIs while the
  source z14 tile contained 11,210; only a rank-14 attraction and rank-1 railway survived the old
  balanced ceiling of 24, while valid shops occupied roughly 31-118 and lodging/food often ranked
  much higher. A single global ceiling therefore alternated between an empty map and category
  domination.
  Evidence: bounded `tileflow inspect features` output at Sol plus the before/after
  `madrid-sol-close` captures.

- Observation: road-area contributions shared `transport-surface-fill` with line fills but used a
  local order after every class line. A polygon pedestrian plaza consequently covered the
  pedestrian, footway, and crossing axes that were present in Tileflow World, making a data-rich
  area look empty until the fill moved to a dedicated earlier graph slot.
  Evidence: inspected `transportation`/`transportation_name` features for Montera, Preciados, and
  Carmen; the graph-order regression in `packages/core/test/domain-compilers.test.ts`; and the Sol
  visual capture.

## Decision Log

- Decision: Make a clean break; do not normalize old and new authoring models together.
  Rationale: the owner confirmed there are no consumers to protect. Compatibility would preserve
  ambiguous defaults and renderer fallback.
  Date/Author: 2026-08-15, owner and Codex.

- Superseded decision: Launch public `osmBright()`, `streets()`, and `minimal()`, require initial OSM
  Bright/Streets parity, and use per-basemap profiles/bindings to translate modules.
  Rationale for supersession: Streets is now the single product and modules are its renderer. OSM
  Bright is migration/reference evidence; the 23-layer generated style is research input only.
  Date/Author: 2026-08-15, owner and Codex.

- Superseded decision: Export generic custom basemap/profile authoring in this plan.
  Rationale for supersession: first prove that modules can produce direct-only Streets. Future custom
  basemaps are recipes, not arbitrary Style JSON interpreters, bindings, or custom translators.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Keep TypeScript config canonical and Style JSON compiled.
  Rationale: factories, types, reuse, and diagnostics give humans and agents a stable language while
  retaining a deliberate raw escape hatch.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Require `basemap` and initially export only `streets()`.
  Rationale: one callable grammar is explicit. OSM Bright and Minimal are not user choices.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Model Streets as a complete module recipe and merge keyed map requests over it.
  Rationale: `modules: {}` must yield a complete map. A partial request inherits unmentioned Streets
  values; `enabled: false` explicitly removes a domain or target.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Compile each resolved domain directly to complete owned layers.
  Rationale: there is no adapter, inherited layer, or Style JSON translator. The data schema maps
  OpenMapTiles fields; compilers own IDs, filters, paint, layout, assets, and ordering for generated
  output. The first implementation emits final owned layers directly; cross-domain coordinators
  resolve eligibility before those compilers run rather than exposing a generic symbol-intent IR.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Resolve shared symbol/visibility policy before generation and assemble contributions
  with one constraint graph.
  Rationale: labels, POI, transit, aeroways, and roads interact. Neither module object order nor
  compiler invocation order may decide collisions, ownership, or z-order.
  Date/Author: 2026-08-15, Codex.

- Decision: Treat POI presets as candidate ceilings and allow an exact inclusive category
  `maxRank` to replace them.
  Rationale: source rank remains the deterministic importance signal, but food, lodging, shopping,
  culture, and transit need different ceilings before collision placement. This preserves an
  agent-friendly semantic API and avoids raw MapLibre filters or thousands of unconditional
  candidates.
  Date/Author: 2026-08-15, Codex.

- Decision: Give every frozen reference layer exactly one domain owner as test evidence.
  Rationale: exhaustive ownership prevents forgotten feature families. Compound symbol layers receive
  one whole-layer owner while generated shared-symbol policy remains coordinated separately.
  Date/Author: 2026-08-15, owner and Codex.

- Superseded decision: Use the frozen OSM Bright template as a temporary hybrid seed and migrate
  whole domains across releaseable checkpoints.
  Rationale for supersession: the owner chose a simpler direct-only architecture. The 128-layer
  ledger remains coverage evidence, but no seed layer enters the Streets compiler or an artifact.
  This removes the long-lived hybrid, source remapping, partial-release/versioning problem, and any
  need to inherit before drawing Streets with modules.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Ship this as one atomic SDK cutover, not a sequence of hybrid renderer releases.
  Rationale: domain atomicity is a correctness rule, while releasing an internally consistent
  hybrid would have been a product choice. The owner explicitly rejected inheritance, and there are
  no SDK consumers to migrate, so all nine generated domains and every package contract change land
  together. The external hosted compiled-artifact endpoint remains a release-integration blocker;
  it is not a reason to restore seed layers or legacy config serialization.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Use nine named domains: land, water, roads, transit, aeroways, buildings, boundaries,
  labels, and POI. Export all nine together with the atomic Streets cutover after their semantics,
  direct compilers, validation, and scenes are coherent.
  Rationale: exhaustive coverage cannot be claimed through an unnamed `other` bucket.
  Date/Author: 2026-08-15, Codex.

- Superseded decision: Keep the audited upstream style as a frozen reference, not a parent or pixel
  target.
  Rationale for supersession: after direct compilation and multi-scene coverage were complete, the
  owner required removal of the remaining reference files from core. External comparisons can be
  performed without bundling another style in the SDK.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Use Google Maps only as a human reference for clarity, road hierarchy, density,
  legibility, and zoom behavior.
  Rationale: do not copy its exact design, screenshots, branding, or assets.
  Date/Author: 2026-08-15, owner and Codex.

- Superseded decision: Retain the prior notice and provenance while the inherited default sprite
  remained.
  Rationale for supersession: the sprite and every vendored reference file were removed. Streets
  ships no default sprite; icon rendering is explicit through Tileflow's icon-package pipeline.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Omitted `data` means `tileflowWorld()` with initial SDK revision `2026-06-07`, unless
  verification proves that archive unavailable.
  Rationale: normal config should omit hosted plumbing, but builds/receipts cannot use moving latest.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Make `data` the only primary vector dataset field; support
  `tileflowWorld({revision})` and `vectorTiles({url, schema, attribution})`.
  Rationale: data states what is drawn and where it comes from; Streets states how it is drawn.
  Delete project/map/basemap tileset/source precedence.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Use `tileflow` as the stable primary source ID and require every direct compiler to read
  resolved OpenMapTiles layer/field bindings from the data contract.
  Rationale: there is no legacy source bridge. Canonical and explicitly remapped compatible schemas
  use the same direct compiler path from the first Streets artifact.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Emit durable Streets identity as `tileflow:basemap = 'streets'`,
  `tileflow:basemapVersion = 3`, `tileflow:variant = 'light'`, and the separate `tileflow:data`
  object. Any breaking generated-layer ID or structural-order change increments basemap version.
  Rationale: raw overrides make generated IDs and placement observable even though semantic modules
  are canonical. No internal migration metadata appears in a Streets artifact.
  Date/Author: 2026-08-15, Codex.

- Decision: Use keyed module factories and combine qualitative presets with exact
  class/category/structure/zoom/filter/expression controls.
  Rationale: keys give stable AST paths and prevent duplicates; serious design needs more than a
  simplified preset config.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Preserve named themes for reusable palette/typography defaults, with exact module values
  winning afterward.
  Rationale: one design instruction should be expressible in one domain subtree without raw IDs.
  Date/Author: 2026-08-15, Codex.

- Decision: Raw MapLibre operations are ordered, final, and fail closed. Built-in Streets may not
  use OSM-ID raw patches.
  Rationale: raw access is a user escape hatch and a signal of missing module capability, not the
  built-in rendering architecture.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Compile hosted artifacts locally and deploy Style JSON plus a non-secret receipt instead
  of serialized config.
  Rationale: repository-local factories are code and the deployable artifact is the validated style.
  The required hosted endpoint change is an external release dependency.
  Date/Author: 2026-08-15, Codex.

- Decision: Generate local manifest schema 2 and capture receipt schema 2 after removing
  tileset-specific fields.
  Rationale: changing version 1 semantics would make stored artifacts ambiguous.
  Date/Author: 2026-08-15, Codex.

- Decision: `vectorTiles().url` is public; require schema/non-empty attribution, reject URL user
  information, and document query strings as public.
  Rationale: protected provider credentials belong in runtime `transformRequest`.
  Date/Author: 2026-08-15, Codex.

- Decision: Public road targets are cartographic semantics, not raw OpenMapTiles `class` values.
  Replace ambiguous `path` with disjoint `pedestrian`, `footway`, `cycleway`, `steps`, and
  `pathway` targets. The OpenMapTiles contract maps each target to `class=path` plus a non-overlapping
  `subclass` set; `pathway` owns residual outdoor path subclasses and does not catch the four named
  targets. Road geometry and road labels share this selector contract, while labels remain owned by
  the labels module. Existing structure controls automatically apply to every target, so each can
  independently style surface, tunnel, bridge, casing, fill, and shadow without raw layer IDs.
  Rationale: agents and humans should ask for a pedestrian street or cycleway directly. A generic
  path layer overlaps the more precise targets, makes ordering determine appearance, and leaks data
  schema details into author config.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Model road conditions as keyed semantic treatments over the existing class × structure
  model. Use `modifiers` for construction/ramp/unpaved, `restrictions` for general and mode-specific
  access, and `serviceTypes` for road-service subtypes. Reuse existing paint vocabulary plus
  relative width scaling, compile fixed-precedence feature expressions inside stable class layers,
  and resolve all selectors through the data contract.
  Rationale: these fields describe orthogonal characteristics, not new road classes. Data-driven
  paint lets a feature combine, for example, a ramp width and unpaved dash without a combinatorial
  layer explosion or raw OpenMapTiles filters in author config.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Define appearance once as module-independent visual primitives, then compose geographic
  targets from those primitives. The canonical primitive families are background, fill, line, text,
  icon, symbol placement, circle, and extrusion. Polygon, linear, and symbol compositions are
  reusable structures rather than new MapLibre layer types.
  Rationale: land, water, roads, buildings, labels, POI, transit, and aeroways currently repeat the
  same concepts with small incompatible shapes. A single vocabulary makes `tileflow.config.ts`
  predictable for both agents and people and allows property validation/compiler behavior to be
  tested once.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Keep semantic selection out of ordinary appearance primitives. Modules own which
  features belong to `primary`, `park`, `city`, `food`, and other semantic targets through the
  versioned data contract. Common styles own visibility/range and appearance. Arbitrary MapLibre
  filters remain an explicit advanced/raw operation rather than a property repeated on every
  normal style object.
  Rationale: a reusable `FillStyle` or `TextStyle` should not be able to contradict the module's
  ownership filter silently. This also separates the two questions an agent must answer: what the
  feature means, and how that target should look.
  Date/Author: 2026-08-15, owner and Codex.

- Decision: Roads remains one semantic module with four orthogonal axes: class, structure, drawing
  phase, and feature treatment. Road text and shields are emitted by the shared label/symbol policy;
  roads supplies eligibility and geometry but does not create a second collision system.
  Rationale: this preserves deterministic z-order and prevents combinations such as a restricted
  unpaved ramp in a tunnel from being painted by duplicate independent modules.
  Date/Author: 2026-08-15, owner and Codex.

## Outcomes & Retrospective

The initial SDK implementation completed the Streets-first cutover. `streets()` now compiles a
119-layer default map directly from nine keyed module domains and one resolved OpenMapTiles data
contract. There is no runtime template, fallback renderer, layer translator, or hidden data
precedence. After the disjoint path-family and pedestrian-area work, the lab's explicit Editorial
City overlays compile 164 layers and have twelve reviewed schema-2 baselines spanning urban, road,
rail, airport, coast, rural, and mobile views.

The visual loop materially improved the design language: it exposed POI modes that were type-level
choices but did not yet change pixels, and it exposed a duplicated rail filter that structural
validity could not catch. Both are now deterministic module behavior with focused tests. This is why
the lab and receipt contract are part of the compiler change rather than follow-up demo work.

The Tileflow Streets config is also a readable control surface: its active properties name their
accepted values inline. The dev preview writes its live camera to the URL without adding browser
history entries, so an author can edit module code and continue reviewing the same location and zoom
after the watcher reloads the style.

Durable behavior is recorded in `docs/contracts/cartographic-authoring.md`,
`docs/contracts/local-visual-capture.md`, `packages/core/README.md`, `packages/cli/README.md`, and
owning package READMEs. All repository, build, packaged-smoke, and publication dry-run gates pass.
The only cross-repository release dependency is the hosted API accepting the new compiled-style
artifact; this repository deliberately does not implement that service or restore legacy serialized
config.

The visual refinement loop subsequently reopened Milestone 5: the coarse `path` target is not a
sufficient semantic road language. The active follow-up above makes path families disjoint before
calling the road module complete again. MapTiler's layer inventory is design evidence only; traffic
signals and zebra crossings still require upstream data, while junction symbols and shields retain
source evidence but need their own semantic authoring contracts. Access restrictions, ramps,
unpaved surfaces, construction, and service subtypes are covered by the road-intelligence follow-up
because the audited versioned data contract already supplies them.

That follow-up is now complete. The lab no longer reads OpenMapTiles `subclass` to distinguish its
paths: it styles the five public road targets directly. Geometry and road-label compilers share one
selector implementation, exact class requests participate in label eligibility, disabled classes
are removed from both domains, and remapped `class`/`subclass` field names are covered by tests. The
current Editorial City recipe emits 164 layers because each enabled path semantic owns its complete
structure phases rather than sharing one overlapping `path` layer, the lab gives path casings their
own layers, pedestrian polygons have a dedicated semantic fill, and enabled road structures may own
a separate semantic hatch phase.

The road-intelligence pass then made orthogonal source properties part of the same road language
rather than adding parallel domains. Streets now has data-driven defaults for ramps, unpaved and
construction geometry, restricted access, and service subtypes. Authors can override those
treatments semantically for surface/tunnel/bridge phases, and remapped `layer`/`level` fields control
stable intra-layer ordering. The compiler keeps zoom interpolation at the expression root, composes
matching treatments by fixed per-property precedence, and does not multiply the 150-layer lab
inventory for combinations such as an unpaved ramp. Tileflow World's public attribution now matches
its TileJSON by retaining OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.

The final visual-language pass removed module-specific styling dialects. Background, fill, line,
text, icon, symbol placement, circle, and extrusion now share one typed vocabulary, while area,
line-stack, and symbol compounds reuse those primitives. Module compilers retain ownership of
semantic feature selection, so ordinary appearance objects cannot contradict domain filters.

Roads now consumes the useful audited transport fields through one class × structure × phase ×
treatment model, including expressway, indoor, toll, construction, service, access, mode, and MTB
difficulty semantics. Route shields and motorway-junction labels participate in the shared symbol
policy instead of creating a second collision system. The first complete visual run revealed that
junction numbers were too dense at overview zooms; the Streets lab now introduces them at zoom 15.
All nine scenes were reviewed and regenerated intentionally. A subsequent visual comparison passed;
two remote-resource scenes reported allowed nondeterministic resource drift rather than SDK errors.

The workbench now ships under the product-facing `examples/tileflow-streets` name with matching
`dev:streets`, `capture:streets`, and `visual:streets` commands. The second workspace example is a
React/Vite ride application under `examples/uber`; its basemap config uses the same common area,
symbol, transit-structure, and Roads treatment contracts, while routes and vehicles remain
application-owned MapLibre overlays. Its LA and NYC captures were reviewed and accepted with
Streets v2 style receipts.

## Context and Orientation

MapLibre renders ordered Style JSON layers. A layer has a unique ID, type, source/source-layer where
applicable, filter, layout, and paint. One road may need shadow, casing, fill, tunnel, bridge, and
label layers. Final layer-array order controls drawing; Tileflow module order must not.

`packages/core/src/project.ts` is the canonical project/style entry. It parses through
`packages/core/src/schema-v2.ts` and delegates to `packages/core/src/cartography/streets.ts`.
`packages/core/src/basemaps/streets.ts` owns the complete default recipe; `packages/core/src/data`
owns the primary dataset contract; `packages/core/src/modules/*/compiler.ts` creates all MapLibre
layers; and `packages/core/src/cartography/graph.ts` assembles them. The deleted legacy compiler,
OSM basemap, renderer split, and template control passes are not executable recovery paths.

The visual workbench is `examples/tileflow-streets/tileflow.config.ts`, owned by
`docs/contracts/cartographic-authoring.md`. It has `editorial-city` and nine scenes: Madrid overview,
neighborhood, close street, motorway, airport, transit, rural edge, Barcelona waterfront, and Madrid
mobile.

`packages/dev` compiles/watches artifacts. `packages/cli` validates, builds, previews, captures,
compares, deploys compiled styles, and manages generated icon packages. `packages/capture` stores
resolved data identity and pixel evidence. Framework/build packages compile inline config. The
repository migrates atomically.

Terms:

- A **data descriptor** resolves primary vector URL, attribution, source ID, revision, and semantic
  schema.
- A **module request** is the serializable partial returned by a module factory. Presence of a field
  records explicit author intent; omitted fields inherit the Streets recipe.
- A **basemap recipe** is ID/version plus default theme, complete module requests, assets, order, and
  provenance. Streets is the only public recipe.
- **Resolved cartography** is the complete design after Streets, theme, and user overlays merge.
- A **domain compiler** turns one resolved domain into complete layer contributions; it never
  searches OSM IDs.
- A **layer contribution** has one owner, stable target/ID, semantic graph slot/local order,
  requirements, and diagnostics.
- A **symbol policy** coordinates cross-domain eligibility before final symbol layers are emitted;
  roads constrain road labels, and POI density/icon/text/coupling resolve together.
- A **raw override** is an ordered exact-ID operation applied after semantic assembly.

Canonical authoring:

```ts
import {defineTileflow, labels, roads, streets} from '@tileflow/core';

export default defineTileflow({
  maps: {
    madrid: {
      basemap: streets(),
      modules: {
        roads: roads({hierarchy: 'strong'}),
        labels: labels({language: 'es'}),
      },
    },
  },
});
```

Advanced data:

```ts
data: tileflowWorld({revision: '2026-06-07'});
```

```ts
data: vectorTiles({
  url: 'https://tiles.example.com/tiles.json',
  schema: openMapTiles(),
  attribution: '© Example © OpenStreetMap contributors',
});
```

`vectorTiles().url` is serialized and must be publish-safe. Ordinary compilation is offline.
Protected-provider credentials belong in application `transformRequest`; Tileflow analytics must not
append sessions to foreign origins.

The internal Streets recipe is a plain frozen value:

```ts
const tileflowStreetsRecipe = Object.freeze({
  id: 'streets',
  version: 2,
  modules: Object.freeze({
    land: land(),
    water: water(),
    roads: roads(),
    transit: transit(),
    aeroways: aeroways(),
    buildings: buildings(),
    boundaries: boundaries(),
    labels: labels(),
    poi: poi(),
  }),
});
```

Advanced road control remains semantic:

```ts
roads({
  detail: 'all',
  hierarchy: 'strong',
  classes: {
    primary: {
      surface: {
        fill: {
          color: '#E4B75D',
          width: zoom.linear([
            [7, 0.6],
            [12, 2.4],
            [16, 8],
          ]),
        },
        casing: {color: '#C7933C'},
        shadow: {color: '#7F6948', opacity: 0.2},
      },
      tunnel: {fill: {opacity: 0.55, dash: [2, 1]}},
      bridge: {fill: {width: 9}, casing: {width: 11}},
    },
  },
});
```

Merge order: engine safety invariants, Streets variant recipe, named theme defaults, user qualitative
controls, user exact values, then raw overrides. `undefined` inherits, `enabled: false` removes,
objects merge by typed key, arrays replace, and wrapped expressions are atomic. Factories retain
explicitness so partial requests cannot erase Streets defaults.

### Final reusable visual language

The authoring path is always:

```text
semantic module -> semantic target -> reusable visual primitive(s) -> generated MapLibre layers
```

For example, `land.landcover.park` selects park features; its area style decides how their fill and
outline look. `roads.classes.primary` selects primary roads; its line stack controls
shadow/casing/fill. `poi.styles.food` selects a POI category; its symbol style controls icon, text,
and collision. A visual primitive never decides what a park, primary road, or food POI is.

All primitive properties that MapLibre permits to be data- or zoom-driven use
`TileflowStyleValue<T> = T | TileflowZoomValue<T> | TileflowExpression<T>`. Constant-only layout
properties stay constants. `zoom.step`, `zoom.linear`, `zoom.exponential`, and `expression<T>` remain
the only wrappers; raw expression arrays are not guessed. Values are JSON-clean, expressions are
atomic during merge, and the final MapLibre validator remains authoritative after Tileflow's
property-specific validation.

The common layer range is deliberately small:

```ts
type LayerRange = {
  visible?: boolean;
  minZoom?: number;
  maxZoom?: number;
};
```

It does not contain a normal `filter`. Semantic selection belongs to the module/data contract. An
advanced author can still use a final fail-closed raw override with `filter(...)` and exact generated
IDs when a semantic target does not exist.

The final primitive matrix is:

| Primitive              | Canonical properties                                                                                                                                                                                                                                                                                                                     | Notes                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `BackgroundStyle`      | range, `color`, `opacity`, `pattern`                                                                                                                                                                                                                                                                                                     | Root canvas only; no source/filter/outline.                                                                         |
| `FillStyle`            | range, `color`, `opacity`, `pattern`, `antialias`                                                                                                                                                                                                                                                                                        | One polygon fill layer. An outline is a separate `LineStyle`, not a fake width-less fill property.                  |
| `LineStyle`            | range, `color`, `opacity`, `width`, `dash`, `blur`, `gapWidth`, `offset`, `pattern`, `cap`, `join`, `miterLimit`, `roundLimit`                                                                                                                                                                                                           | One line layer. Paint and layout are separately reusable internally.                                                |
| `TextStyle`            | range, `field`, `font`, `weight`, `fallbacks`, `size`, `color`, `opacity`, `haloColor`, `haloWidth`, `haloBlur`, `letterSpacing`, `lineHeight`, `maxWidth`, `transform`, `anchor`, `offset`, `rotate`, `justify`, `variableAnchors`, `radialOffset`, `padding`, `allowOverlap`, `ignorePlacement`, `optional`, `keepUpright`, `maxAngle` | Text half of a symbol. Typography resolves semantic family/weight to the installed glyph stack.                     |
| `IconStyle`            | range, `image`, `size`, `opacity`, `color`, `haloColor`, `haloWidth`, `haloBlur`, `rotate`, `offset`, `anchor`, `padding`, `allowOverlap`, `ignorePlacement`, `optional`, `keepUpright`, `rotationAlignment`, `pitchAlignment`                                                                                                           | Color/halo require a compatible SDF icon; missing assets fail before style output.                                  |
| `SymbolPlacementStyle` | `placement`, `spacing`, `priority`, `zOrder`                                                                                                                                                                                                                                                                                             | Shared text/icon placement. Public `priority` means “higher wins”; the compiler translates MapLibre sort direction. |
| `CircleStyle`          | range, `radius`, `color`, `opacity`, `blur`, `strokeColor`, `strokeWidth`, `strokeOpacity`, `pitchScale`, `pitchAlignment`                                                                                                                                                                                                               | Sprite-free point marker and future data overlays.                                                                  |
| `ExtrusionStyle`       | range, `color`, `opacity`, `height`, `base`, `pattern`, `verticalGradient`                                                                                                                                                                                                                                                               | A real fill-extrusion primitive; no longer modeled as `FillStyle & {height, base}`.                                 |

Do not expose every MapLibre property merely because it exists. Add a property to a primitive when
at least one semantic module needs it, its merge/validation behavior is defined, and it has a
focused output test. Rare renderer-specific properties remain raw overrides until that evidence
exists. Raster, hillshade, heatmap, and model styling are specialized source/domain contracts, not
part of this initial basemap primitive set.

The reusable compound styles are compositions, not additional renderer primitives:

```ts
type AreaStyle = {
  fill?: FillStyle;
  outline?: LineStyle;
};

type LineStackStyle = {
  shadow?: LineStyle;
  casing?: LineStyle;
  fill?: LineStyle;
};

type SymbolStyle = {
  // SymbolPlacementStyle fields are flattened here.
  placement?: 'line' | 'line-center' | 'point';
  spacing?: StyleValue<number>;
  priority?: StyleValue<number>;
  zOrder?: 'auto' | 'source' | 'viewport-y';
  text?: TextStyle;
  icon?: IconStyle;
  marker?: CircleStyle;
};
```

Coupled text and icon share one MapLibre symbol layer and therefore one layer range; contradictory
ranges fail instead of being guessed. A module such as POI may deliberately emit separate icon and
text layers when its placement policy says they are independent. A marker is always a separate
circle layer. The graph, not object-key order, places the resulting layers. Area targets such as
parks and buildings use `AreaStyle`; linear targets such as roads, waterways, boundaries, runways,
and rail use `LineStackStyle` or the relevant subset; label and POI targets use `SymbolStyle`.

Internally split each primitive into range, layout, and paint contracts. This lets a road treatment
reuse `Partial<LinePaint>` directly instead of maintaining the current duplicate
`TileflowRoadTreatmentLineStyle`. Per-feature treatments may change data-driven paint and relative
width, but cannot change layer range, semantic filter, cap/join, or graph placement. If a condition
needs a different layout or layer range, it receives an explicit semantic target/layer rather than
being accepted and ignored.

Canonical module examples after the migration:

```ts
land({
  landcover: {
    park: {
      fill: {color: '#AFEAC5', opacity: 1},
      outline: {color: '#7FCBA8', width: 1},
    },
  },
});

labels({
  styles: {
    places: {
      city: {
        priority: 80,
        text: {
          color: '#455564',
          size: zoom.linear([
            [5, 12],
            [12, 18],
          ]),
          haloColor: '#FFFFFF',
          haloWidth: 1.5,
        },
      },
    },
  },
});

poi({
  styles: {
    food: {
      priority: 50,
      icon: {image: 'restaurant', size: 0.9},
      text: {color: '#A8612D', size: 12},
    },
  },
});
```

This is a clean break while there are no consumers. Remove deprecated aliases rather than
supporting both shapes. The primitive migration itself is byte/pixel preserving: first normalize
the vocabulary and compilers, then deliberately retune Streets in separately reviewed commits.

### Final Roads language

`roads()` is the most complex module because it composes four independent axes:

```text
class       motorway | trunk | primary | secondary | tertiary | minor | service |
            track | pathway | footway | cycleway | steps | pedestrian
structure   tunnel | surface | bridge
phase       shadow | casing | fill
treatment   construction | ramp | unpaved | access/mode restriction | service subtype |
            expressway | toll | indoor | official | mountain-bike scale
```

The base public shape remains agent-friendly and exact:

```ts
roads({
  detail: 'all',
  hierarchy: 'strong',
  weight: 'regular',
  outline: 'strong',
  classes: {
    primary: {
      surface: {
        shadow: {
          color: '#607080',
          opacity: 0.15,
          width: zoom.linear([
            [8, 2],
            [18, 24],
          ]),
        },
        casing: {
          color: '#9AA8B6',
          width: zoom.linear([
            [8, 1.5],
            [18, 20],
          ]),
        },
        fill: {
          color: '#AEBCCA',
          width: zoom.linear([
            [8, 1],
            [18, 18],
          ]),
        },
      },
      tunnel: {
        casing: {color: '#B9C3CC', dash: [2, 1]},
        fill: {color: '#DCE2E7', opacity: 0.75},
      },
      bridge: {
        casing: {color: '#8E9EAD'},
        fill: {color: '#AEBCCA'},
      },
    },
  },
  modifiers: {
    construction: {surface: {fill: {dash: [2, 1], opacity: 0.7}}},
    expressway: {widthScale: 1.06},
    indoor: {surface: {fill: {dash: [1, 1], opacity: 0.4}}},
    ramp: {widthScale: 0.7},
    unpaved: {surface: {fill: {dash: [2, 1]}}},
  },
  restrictions: {
    access: {surface: {fill: {opacity: 0.55}}},
    toll: {surface: {casing: {color: '#C5B7D8'}}},
  },
  serviceTypes: {
    driveway: {widthScale: 0.75},
    parkingAisle: {widthScale: 0.6},
  },
  mountainBike: {
    '4': {surface: {fill: {dash: [2, 1], opacity: 0.7}}},
  },
});
```

Qualitative controls choose coherent Streets defaults; exact class styles override them. Resolution
order is engine invariants, Streets recipe, theme tokens, qualitative road controls, global
structure styles, exact class styles, then feature treatments per property. Raw overrides remain
last. A missing field inherits; `enabled: false` deliberately removes the target; object key order
never controls z-order or treatment precedence.

Treatments stay data-driven inside the stable class × structure × phase layer whenever they only
change paint or relative width. Multiple conditions compose by documented per-property precedence,
so `primary + tunnel + ramp + restricted` is still one owned primary-tunnel layer stack. The same
feature must never be emitted once per matching condition. Class/structure/phase graph order and
`layer`/`level` intra-layer sorting are independent of treatment precedence.

Finish Roads in this order:

1. Migrate road class, area, and treatment shapes onto shared `LineStackStyle`, `AreaStyle`, and
   `Partial<LinePaint>` without changing pixels or generated IDs.
2. Lock the current supported Tileflow World fields: class/subclass, bridge/tunnel, ramp,
   paved/unpaved, access/bicycle/foot/horse restriction, construction, service subtype, one-way,
   and layer/level. Cover every field remapping and multi-condition composition.
3. Add treatments for `expressway`, `toll`, and `indoor` only after recording their real bounded
   values. Keep the simple “any restriction” shorthand, and add per-value restriction styling only
   if the audit proves stable useful states such as private/destination/customers.
4. Audit `transportation_name` `ref`, `network`, `route_*`, and junction values. Then add road shields
   and junction/roundabout semantics through the shared symbol coordinator. `labels()` owns text,
   shield assets, priority, and collision; `roads()` supplies eligible classes and geometry.
5. Treat `mtb_scale` and other path-specific metadata as opt-in outdoor semantics, not default
   Streets noise. Do not expose a key until a committed scene demonstrates its use.
6. Tune the Streets recipe, not compiler invariants: widths by class/zoom, casing contrast,
   tunnel attenuation/dashes, bridge separation, ramp scaling, service-road hierarchy, and label
   density. Review overview, motorway, neighborhood, close-street, bridge/tunnel, rural, and mobile
   scenes before accepting a visual baseline.
7. Record dataset gaps explicitly. The current OpenFreeMap/OpenMapTiles archive does not expose
   traffic signals, zebra crossings, lane counts, or sidewalk geometry. Those require another
   provider, an upstream change, a Tileflow-built dataset, or an additional overlay tileset before
   an SDK API can render them. They do not block a professional Tileflow Streets basemap.

Road names, shields, and POI/station symbols must share collision policy with the rest of labels.
One-way arrows may remain road-owned geometry annotations but must use the resolved road typography
or icon assets. Transit rail/ferry/cableway remains in `transit()`, never in `roads()`.

## Plan of Work

### Milestone 0: freeze reference evidence and domain ownership

Snapshot the current OSM Bright Style JSON, 128 unique IDs/order, source assumptions, assets, lab
captures, hashes, and receipts. Record exact upstream reference/content hash and audit
`packages/core/OSM_BRIGHT_LICENSE.md`, sprite, and glyph provenance. Audit the generated 23-layer
path for reusable semantic knowledge only; it is not a product golden.

Create a private exhaustive ledger. The audited initial ownership by legacy index is:

```text
land        0-11, 23-24                         14 layers
water       12-22                              11 layers
buildings   25-26                               2 layers
roads       27-43, 51-70, 77-91, 104-105       54 layers
transit     44-45, 71-76, 92-95                12 layers
aeroways    46-50                               5 layers
boundaries  96-99                               4 layers
labels      100-103, 110-127                   22 layers
poi         106-109                             4 layers
total                                           128 layers
```

Verify these ranges against exact IDs before recording them as fixtures. Ferry belongs to transit,
airport labels to labels, `poi-railway` to POI, one-way layers to roads, and railway landuse to land.
Every entry stores ID, original index, owner, graph slot, and replacement target(s) or a documented
intentional omission. Validation requires every reference ID exactly once, no unknown ID, no final
`other`, and ledger reassembly equal to original order.

Inventory reference assets separately. Preserve the existing owner-selected lab palette while
recording it as the initial Streets visual recipe.

### Milestone 1: establish one primary data contract

Add `packages/core/src/data` with `tileflowWorld()`, `vectorTiles()`, and versioned
`openMapTiles()`. The schema describes source layers, properties, class values, names, ranks,
height/base, and filters; layer remapping replaces current `sourceLayers`.

Omitted data resolves to initial revision `2026-06-07` at
`{apiBaseUrl}/tiles/world/tiles.json?archiveVersion=2026-06-07`. Build through `URL`, preserve query
parameters, and never fetch in `createStyle()`. Release smoke proves default archive availability.
Use `tileflow` as the stable internal primary source ID. External data requires schema and non-empty
attribution, rejects URL user information, and treats query strings as public.

The final data contract supports source-layer and field remapping for external
OpenMapTiles-compatible data. Every compiler reads these resolved bindings directly.

Delete project `tilesets`, map `tileset`, map `tiles`, source fields on basemaps,
`TileflowStyleOptions.tileset`, and precedence code. Replace environment/build `tileBaseUrl` naming
with compile-context `apiBaseUrl`; it resolves official data/fonts/sprites but never selects author
data. Emit one non-secret `tileflow:data` identity. Remove tileset metadata. Generate local manifest
schema 2 and capture receipt schema 2.

### Milestone 2: build direct compilation foundations

Implemented layout:

```text
packages/core/src/cartography/{values,merge,context,contributions,graph,layer-style,overrides,streets}.ts
packages/core/src/basemaps/streets.ts
packages/core/src/data/
packages/core/src/modules/<domain>/{index,compiler}.ts
```

Define contracts equivalent to:

```ts
type DomainCompiler<T> = (config: T, context: DomainCompileContext) => CartographicContribution[];

type CartographicContribution = {
  kind: 'layer';
  owner: LayerDomain;
  target: string;
  slot: LayerSlot;
  localOrder: number;
  layer: MapLibreStyleLayer;
};
```

Implement typed constants, `zoom.linear()`, `zoom.step()`, and validated expression/filter wrappers.
Validate finite values, monotonic stops, result/property types. Expressions are atomic during merge.

Consolidate the reusable visual language before adding more module-specific fields. Split range,
paint, and layout internally; implement the background/fill/line/text/icon/symbol/circle/extrusion
matrix above; add `AreaStyle`, `LineStackStyle`, and `SymbolStyle` compositions; remove ordinary
appearance-level filters; and migrate every module off one-off lookalike shapes. In particular,
replace the road treatment line copy with `Partial<LinePaint>`, replace building's fill-plus-height
intersection with `ExtrusionStyle`, and stop using fill styles for the background layer. This
normalization is byte/pixel preserving and covered property-by-property before Streets is retuned.

Implement serializable module requests and canonical keyed merge whose own-field presence preserves
explicitness. Resolve road-label eligibility and POI density/icon/text/coupling policy before final
layers. Every generated layer has one owner and stable unique ID; reject conflicting ownership
rather than using invocation order.

Implement a slot DAG at least covering background, land, hydro, buildings, transport tunnels,
aeroways, surface transport, bridge transport, boundaries, and symbols, with shadow/casing/fill
subphases. Every contribution has deterministic local ordering; reject cycles/ties. Terrain/hillshade
becomes a graph contribution rather than inserting after concrete layer ID `water`.

Integrate the icon/sprite pipeline. Local package sources are validated and compiled before style
output; hosted deploy substitutes the returned sprite URL before compiling the uploaded style.
Literal/mapped icon references are inspected, while dynamic raw expressions are reported as
unanalyzable instead of being guessed.

Build the final style shell in Tileflow code and validate all resolved config, data/assets,
contributions, graph, and metadata before returning output. Fail atomically.

Keep exact-ID raw patch/add/remove/move operations final and ordered. Added/moved layers require
explicit placement; unknown IDs/incomplete layers fail. Built-in Streets cannot use OSM-ID raw
operations.

### Milestone 3: introduce direct-only Streets

Add the complete internal Streets recipe and public `streets()`. Make `basemap` required. Remove
public `osm()`, OSM basemap types, `renderer`, `TileflowRenderer`, fallback, renderer metadata, and
generated-renderer selection; reject old fields with exact paths.

The first Streets style is complete and generated only by the nine direct domain compilers. No OSM
Bright layer, ID, source remapping bridge, or `internalMigration` state may enter compilation. The
reference ledger instead drives coverage tests and later visual comparisons. Switch the lab to
`streets()` immediately. Emit durable metadata `tileflow:basemap = 'streets'`,
`tileflow:basemapVersion = 3`, `tileflow:variant`, and the resolved `tileflow:data` identity.

### Milestone 4: complete land and water

Implement land background/landuse/landcover/parks/protected/residential/commercial/industrial/civic/
cemetery/wood/grass/sand/ice, opacity, patterns, filters, and zoom. Implement water polygons,
waterways, intermittent behavior, lines, patterns, filters, and zoom. Water text is coordinated with
labels. Add city/coast/rural multi-zoom evidence and compare coverage against the reference ledger.

### Milestone 5: complete roads

Implement class visibility, zoom, source filters, surface/tunnel/bridge, fill/casing/shadow, color,
opacity, width curves, line cap/join, dash/pattern, one-way, semantic pedestrian/footway/cycleway/
steps/pathway targets, areas/piers, construction/ramp/unpaved treatments, access/mode restrictions,
service subtypes, and level-aware intra-layer ordering. Use shared `LineStackStyle`, `AreaStyle`, and
`Partial<LinePaint>` contracts; do not retain a road-only copy of visual properties. The five
path-family filters must be pairwise disjoint and use
the resolved OpenMapTiles `class` and `subclass` bindings for both geometry and labels. Structure
phases apply uniformly to every road target. Move rail, ferry, and cableways to transit rather than
retaining `roads.extras.rail/ferry`. Road labels remain labels.

After locking the already implemented fields, audit and consume expressway/toll/indoor values where
they have a stable Streets use. Audit route ref/network and junction features before adding shields
or junction/roundabout semantics through the shared symbol policy. Treat mountain-bike scale as an
opt-in outdoor capability. Never add signals/crossings/lanes/sidewalk authoring keys while the
selected versioned dataset cannot supply them.

Add overview, motorway, neighborhood, close-street, bridge/tunnel, and mobile evidence. Use OSM
Bright and Google Maps manually for coverage/hierarchy, not pixel copying.

### Milestone 6: complete labels and coordinated symbols

Implement place/road/water/aerodrome text and shared symbol policy: language/field, font/weight, size
curves, color, halo, spacing, line height, max width, transform, placement, padding, overlap,
optional, priority, and sort keys. Road visibility constrains road-label eligibility.

Coordinate road-label eligibility and POI/icon/text policy before emitting final symbol layers. Add
dense-center, multilingual, waterfront, low/high zoom, and mobile collision evidence.

### Milestone 7: complete buildings and boundaries

Implement flat/extruded buildings, fill/outline, height/base, class/threshold, zoom/opacity. Implement
admin levels, disputed/maritime boundaries, filters, width, dash, opacity, and zoom. Cover dense
buildings, city edge, country/region/disputed boundaries, and 3D validity.

### Milestone 8: complete POI, aeroways, and transit

Implement POI class/category mapping, icons, visibility, zoom, priority, density, and coordinated
symbols, including station POIs. Implement aeroway runway/taxiway/area geometry and feed aerodrome
eligibility into the label policy whose generated airport-label layers are owned by labels. Implement
transit rail, ferry, and cableway geometry supported by the audited data contract. POI owns
station/stop feature and icon eligibility; POI and label compilers emit the final owned symbols
after applying the shared eligibility policies.
Do not promise transit routes until the OpenMapTiles schema audit proves suitable route data.
Export `aeroways()` and `transit()` when their public semantics and tests are coherent.

Add airport, transit hub, station, ferry, POI/icon, and collision scenes. Every reference feature
family receives generated coverage or a reviewed intentional omission; never hide it in `other`.

### Milestone 9: audit independence and provenance

Delete the unused legacy compiler, template-control, OSM basemap, and generated-renderer branches.
Delete vendored reference fixtures, notices, and provenance after the direct compiler and reviewed
scene coverage replace their temporary audit purpose; prove the package contains none of them.

Audit root style, filters, expressions, source assumptions, glyphs, sprites, icon names, metrics,
notices, and provenance. Streets ships without a default sprite. The default POI recipe emits text
and disables icons; an explicit local or hosted icon set supplies Tileflow-generated sprite assets.
Final Streets is recipe + modules + data contract + compilers + graph + explicit assets + root
builder, with no inherited ID lookups or patches.

### Milestone 10: migrate tooling, deploy, evidence, and docs

Migrate the lab to Streets with no `data`; retain existing scenes and add rural, close-street,
motorway, airport, and transit coverage. Store reviewed visual evidence and update schema-2
baselines after inspecting all nine captures.

Update dev inspection; capture receipt/data identity; CLI validate/build/dev/capture/visual; core
runtime; static/Vite/Webpack/Next; React/Vue/Svelte types/tests; manifest 2; initializer; package
smokes; contracts and READMEs. Preserve framework lifecycle behavior.

Change deploy to compile locally and POST validated Style JSON plus environment, SDK/compiler
version, hash, non-secret data identity, icon binding, and provenance. Do not serialize config or
send `tilesetId`. The coordinated hosted endpoint must validate/store/reload the artifact. This is
required even for default world data; keep branch unmerged/unpublished until integration passes.
Do not implement hosted code here.

Docs show only Streets, implicit/advanced data, module merge/exact controls, raw overrides, and OSM
Bright migration/reference provenance.

## Concrete Steps

Work from repository root on `basemap-system`. Preserve user/unrelated changes and update this plan
at each stopping point.

1.  Establish baselines:

    git status --short --branch
    pnpm --filter @tileflow/core verify
    pnpm run visual:streets

2.  Iterate with focused checks:

        pnpm --filter @tileflow/core typecheck
        pnpm --filter @tileflow/core verify
        pnpm --filter @tileflow/dev verify
        pnpm --filter @tileflow/cli verify
        pnpm --filter @tileflow/capture verify

    Record commands/counts, generated layer inventory, visual findings, and decisions.

3.  Exercise the real authoring loop after each domain switch:

        pnpm dev:streets --scene madrid-neighborhood
        pnpm run visual:streets

    Inspect preview, Style JSON, diffs, and feature coverage. Update baselines only after approval.

4.  Before final handoff:

        pnpm check
        pnpm build
        pnpm run smoke:capture-public
        pnpm run publish:alpha:dry-run
        pnpm format:check
        git diff --check
        git status --short --branch

    Do not publish, commit, push, or open a PR unless requested.

## Validation and Acceptance

### Public authoring and data

- `basemap: streets()` with no `data` and `modules: {}` compiles a complete deterministic valid map
  using the pinned world revision.
- Only Streets is public. `osm()`, public OSM Bright/Minimal names, `renderer`, `generated`, old data
  fields, and duplicate map appearance fields fail with exact validation paths.
- Explicit official/external data changes data identity, not Streets identity. External URLs are
  publish-safe, schema/attribution-required, offline at compile, and foreign to analytics sessions.
- Conformance tests prove every direct compiler honors resolved source-layer and field mappings;
  there is no temporary canonical-only mode.
- Manifest 2 references maps/styles without data-base duplication; receipt 2 records data identity.
- Final style metadata contains Streets ID `streets`, basemap version `2`, variant `light`, and the
  resolved data identity. It contains no `tileflow:internalMigration` key.

### Module language and direct compilation

- Empty modules yields complete Streets; partial overlays preserve defaults; disabling is explicit.
- Module-key permutations produce identical resolved design, graph, metadata, layers, and style hash.
- Every explicit field affects a target or returns stable code/path; none is ignored.
- Background, fill, line, text, icon, symbol placement, circle, and extrusion have one shared public
  contract each. All modules use those contracts or documented compound styles; no module carries a
  second incompatible copy of the same paint/layout vocabulary.
- Every primitive property has a constant test, a supported zoom/expression test where applicable,
  a strict invalid-value/path test, and a MapLibre-valid output test. Deliberate compiler/recipe
  changes are reviewed across the scene matrix and accepted through explicit baseline updates.
- Semantic feature eligibility is owned by module/data bindings rather than ordinary appearance
  styles. Raw filters remain explicit, final, exact-ID operations and cannot enter the built-in
  Streets recipe.
- Path-family geometry and labels expose `pedestrian`, `footway`, `cycleway`, `steps`, and residual
  `pathway` without raw filters. Their generated selectors are pairwise disjoint, honor remapped
  `class`/`subclass` fields, and work independently for surface, tunnel, and bridge layers.
- Road modifiers, restrictions, and service subtypes honor remapped data fields, compose by fixed
  per-property precedence, and remain data-driven inside stable semantic class layers. Explicit
  treatment keys affect output or fail schema validation; object order cannot alter precedence.
- A road matching multiple treatments is emitted once for its class × structure × phase. Treatment
  compilation may change only data-driven paint/relative width; any requested range/layout/order
  change requires an explicit target or fails rather than being silently ignored.
- Expressway/toll/indoor, shield, junction, and path-difficulty keys are exported only after bounded
  source-value evidence and committed scene tests. Signals/crossings/lanes/sidewalk keys remain
  absent while the versioned data contract cannot fulfill them.
- Generated layers have one owner and stable unique IDs. No compiler searches/patches OSM IDs.
- Generated IDs and structural ordering are covered by basemap version; a breaking change bumps
  `tileflow:basemapVersion` and updates fixtures, receipts, and migration notes together.
- Shared visibility/symbol policy resolves before generation; compiler invocation order cannot alter
  filters, ownership, collision, priority, or output.
- Graph/data/assets/expressions validate before output. Any failure returns no partial style.
- Raw overrides are final/fail-closed; built-in Streets uses no OSM-ID overrides.

### Migration and visual quality

- Streets contains zero inherited IDs or bundled upstream style/reference files.
- The public/runtime import graph has no reference/template-control/legacy-renderer branch, and the
  packed package has no inherited notice or default sprite.
- Reviewed scenes cover overview, dense urban, close street, motorway, bridge/tunnel, coast, rural,
  buildings, boundaries, airport, transit, POI/icons, multilingual labels, and mobile/high-DPR.
- OSM Bright is coverage reference, not pixel target; Google is manual inspiration only; Streets is
  original.

### Tooling, deploy, packaging, regression

- Dev watch preserves last valid output and reloads selected Streets scene.
- CLI normal flows do not ask for tileset. Deploy uploads compiled style/receipt without config or
  `tilesetId`; platform integration stores/reloads default-world and external-data styles.
- Core, dev, capture, CLI, build packages, wrappers, SSR/readiness/lifecycle tests, package exports,
  notices, and smokes pass.
- Final repository/publication gates pass; no publication occurs.

## Idempotence and Recovery

Data resolution, merge, domain compilation, symbol composition, graph assembly, style/manifest/
receipt generation are pure for equal inputs. Default data is an SDK constant, not a network lookup.
Never mutate reference evidence, requests, recipe, or shared assets. Validate complete output before
returning it.

Re-running compilation is deterministic. If a domain fails visual review, change its module
recipe/compiler atomically; never restore inherited layers or introduce a second renderer. Delete
old public/runtime and bundled-reference paths before final acceptance.

Baseline updates are explicit/reviewable. Revert only newly generated evidence without destructive
repository-wide Git commands or losing user changes.

Hosted deploy cannot be implemented here. Keep branch unmerged/unpublished until compiled-style
integration passes; do not restore legacy serialization to bypass it.

## Artifacts and Notes

Initial evidence:

```text
Branch: basemap-system
HEAD: 8377e12 Build cartography CLI before local commands (#14)
Temporary audit reference: removed from core after direct-domain and visual coverage completed
Generated path: 23 layers under defaults, research only
Generated IDs: background, landuse, landcover, parks, water, buildings-soft,
  roads-tunnels-casing, roads-tunnels, roads-casing, roads-ferry, roads-paths, roads-rail,
  roads-minor, roads-major, roads-bridges, boundaries, place-labels, road-labels-major,
  road-shields, water-labels, water-line-labels, waterway-labels, poi-labels
Initial world revision: 2026-06-07
Lab: examples/tileflow-streets/tileflow.config.ts
Application example: examples/uber/tileflow.config.ts with LA and NYC application scenes
Scenes: madrid-overview, madrid-neighborhood, madrid-close-street, madrid-motorway,
  madrid-airport, madrid-transit, madrid-tunnels, madrid-rural-edge, barcelona-waterfront,
  madrid-mobile
User-owned diff: editorial palette adjustments in lab config
Baseline core: build passes; 46 tests pass via node --import tsx --test before ledger test
Ledger checkpoint: 47 core tests pass after adding the frozen ownership test
Direct Streets: 119 default layers; current Editorial City: 164 layers; no inherited IDs or default
  sprite
Workspace verify: 194 pass, 13 intentional integration skips
Visual checkpoint: nine reviewed schema-2 baselines with resolved Tileflow World data identity
Default icons: text-only POI recipe; local/hosted icon packages are explicit
Hosted contract: CLI sends validated Style JSON + receipt and hosted sprite URL; platform endpoint
  coordination remains external to this repository
Final gates: pnpm check PASS; pnpm build PASS; pnpm run smoke:capture-public PASS;
  pnpm run publish:alpha:dry-run PASS (no publication)
Path semantics checkpoint: 67 core tests PASS; 3 Streets tests PASS; config validation PASS;
  zoom-17 Atocha preview reviewed; packaged public smoke and alpha dry-run PASS
Pedestrian-area checkpoint: 69 core tests PASS; 3 Streets tests PASS; close-street and
  zoom-18 Atocha captures reviewed; full Style JSON validation, workspace check/build, packaged
  public smoke, and alpha dry-run PASS; older visual baselines intentionally unchanged
Road-intelligence checkpoint: 71 core tests PASS; 3 Streets tests PASS; close-street and
  motorway captures reviewed; nine-scene diff recorded intentional output/camera drift without
  updating baselines; workspace check/build, packaged public smoke, and alpha dry-run PASS
Shared-primitives and final Roads checkpoint: 76 core tests PASS; 3 Streets tests PASS;
  54 CLI tests PASS with 6 intentional skips; all nine scenes reviewed and baselines regenerated;
  junction labels adjusted to zoom 15 after visual review; Editorial City compiles 155 valid layers
  on Streets basemap version 2
Tunnel-hatch checkpoint: Streets basemap version 3; 79 core tests PASS; 3 Streets tests PASS;
  all twelve Streets scenes and both Uber application scenes regenerated and reviewed; exact
  comparison preserved the accepted tunnel result and reported two exact, zero-perceptual remote
  pixels in each of three other scenes; workspace check/build, packaged public smoke, and alpha
  dry-run PASS without publishing
Examples checkpoint: `@tileflow/example-streets` 3/3 PASS; `@tileflow/example-uber` 3/3 PASS;
  Streets nine-scene comparison completes; Uber LA/NYC baselines reviewed and regenerated with
  Streets v2 receipts; follow-up comparison preserves only remote-resource warnings
Formatting: all changed files pass Prettier and git diff --check; the repository-wide command still
  reports the two unchanged reconcile-release files that also fail on the clean base
```

Add ownership fixture path, generated layer counts, upstream hash, asset provenance, style hashes, capture
reports, module gaps, hosted contract reference, tests, and final gates here. Never paste secrets,
credential-bearing URLs, large styles, or verbose logs.

## Interfaces and Dependencies

Intended public core:

```ts
function streets(options?: StreetsOptions): TileflowBasemap;

function tileflowWorld(options?: {revision?: string}): TileflowWorldData;
function vectorTiles(options: {
  url: string;
  schema: TileflowDataSchema;
  attribution: string;
  revision?: string;
}): VectorTilesData;
function openMapTiles(options?: OpenMapTilesSchemaOptions): OpenMapTilesSchema;

function land(options?: LandOptions): LandModuleRequest;
function water(options?: WaterOptions): WaterModuleRequest;
function roads(options?: RoadsOptions): RoadsModuleRequest;
function buildings(options?: BuildingsOptions): BuildingsModuleRequest;
function boundaries(options?: BoundariesOptions): BoundariesModuleRequest;
function labels(options?: LabelsOptions): LabelsModuleRequest;
function poi(options?: PoiOptions): PoiModuleRequest;
function aeroways(options?: AerowaysOptions): AerowaysModuleRequest;
function transit(options?: TransitOptions): TransitModuleRequest;

const zoom: {
  linear<T>(stops: readonly (readonly [number, T])[]): ZoomLinear<T>;
  step<T>(stops: readonly (readonly [number, T])[]): ZoomStep<T>;
};
function expression<T>(value: unknown): MapLibreExpression<T>;
function filter(value: unknown): MapLibreFilterExpression;

function patchLayer(id: string, patch: MapLibreLayerPatch): TileflowRawOverride;
function addLayer(
  layer: MapLibreStyleLayer,
  placement: {before: string} | {after: string},
): TileflowRawOverride;
function removeLayer(id: string): TileflowRawOverride;
function moveLayer(id: string, placement: {before: string} | {after: string}): TileflowRawOverride;
```

`aeroways()` and `transit()` become public only when their milestone locks semantics/tests. Do not
export generic `defineBasemap()` or profile/adapter contracts here.

Compile environment, separate from author config:

```ts
type TileflowCompileOptions = {apiBaseUrl?: string; styleBaseUrl?: string};
```

Internal contracts: `BasemapRecipe`, `ResolvedCartography`, `DomainCompiler`,
`CartographicContribution`, `LayerOrderGraph`, and `SharedSymbolPolicy`. The frozen reference ledger
is test-only evidence. Changing direct-compilation architecture requires a Decision Log update.

Dependencies: MapLibre Style Spec semantics, versioned OpenMapTiles schema, themes/icons/terrain,
Zod, dev artifacts, capture receipts, CLI deploy. Core
produces plain JSON and must not add `maplibre-gl` runtime dependency.

External boundaries: pinned Tileflow world route, hosted compiled-style upload contract,
OpenMapTiles/OpenStreetMap licenses/attribution and external providers whose schema is not fetched
during ordinary compilation.
