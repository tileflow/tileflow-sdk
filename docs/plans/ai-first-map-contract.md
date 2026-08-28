# AI-first map contract cutover

This ExecPlan is a living implementation record for the coordinated Tileflow SDK cutover. Update
progress, discoveries, decisions, and validation evidence as work proceeds. Durable behavior moves
to the owning contracts and package READMEs when the plan completes.

## Goal

Make one tileflow.config.ts export one strict TileflowMap whose result is mechanically predictable
from ordinary object, array, and extends semantics. Remove legacy aliases and hidden provider
graphs. Every official map is standalone; no official map imports or extends another.
Streets owns coordinated light and dark themes, while application maps retain ordinary `extends`
semantics over any imported map.

The public authoring contract must be optimized for agents:

- one canonical syntax per operation;
- no ambiguous string shorthands, registries, compatibility aliases, or silent fallbacks;
- exact TypeScript and runtime schemas from the same source;
- deterministic merge rules and content-addressed outputs;
- stable structured diagnostics and resolved-config inspection.

## Final decisions

- Identity is leaf-owned. A standalone map omits `extends`; an inherited map declares exactly one
  imported parent with `extends`.
- Modules replace by domain. Replacing or disabling a domain removes every contribution owned by
  that domain.
- Data, projection, terrain, icons, and the text-asset provider are atomic.
- `themes` replaces atomically as one complete collection, `defaultTheme` selects one concrete
  member, and `systemThemes` replaces the complete browser light/dark mapping. Only `view`
  deep-merges. `defineTheme(base, definition)` materializes a complete document and leaves no theme
  inheritance edge in the resolved map.
- Scenes and delivery are leaf-only tooling metadata.
- Raw physical layer overrides leave the public API. Reusable and official editorial behavior both
  use typed modules, owner-local public render stacks, and the same closed semantic expressions.
- icons is a readonly array of icon directories. Omission inherits, declaration replaces, an empty
  array means none, and later directories win by canonical icon ID.
- fonts is a readonly array of font directories. Local font files are discovered from OpenType
  metadata and must ship with a license. Local fonts and glyph providers are mutually exclusive.
- `font` and every `fallbacks` entry are exact OpenType full names or glyph stack IDs. There is no
  weight field and no family-plus-weight synthesis. A glyph provider is one complete URL plus its
  exact `fontStacks`; after resolution, any map with text has exactly one text provider.
- A config is Node/build input. Browsers consume only an immutable manifest/style and prepared
  assets.
- validate, build, deploy, preview, capture, and framework integrations consume one release plan.

## Baseline

The work starts from the existing large uncommitted migration on branch current in tileflow-sdk.
Those changes are in scope and must not be reset. Focused inheritance, official-map, schema, and
icon tests passed at plan creation. The full suite is not the baseline until each breaking phase
has migrated its tests.

## Implementation phases

1. Freeze every audited P1/P2 as a focused regression test.
2. Close the singular-map contract: shared identity schema, exact defineMap types, normalized parse
   output, leaf scenes/delivery, exhaustive merge classification, and build-only workspaces.
3. Introduce semantic contribution ownership, data layer/field references, capability dependencies,
   and mandatory pre/post MapLibre validation.
4. Migrate the eight independent Streets, Ferraris, Härad, Siegfried, Soundings, Verdant,
   Cyberpunk, and Matrix maps away from public/raw physical overrides and captured data bindings
   into typed modules and owner-local public render stacks. Materialize Streets light and dark as
   two appearances over its one shared structure.
5. Replace icon providers with atomic icon-directory arrays and package-owned directory exports.
   Remove builtin/source/sprite/icon-level extends/mapping/registries and validate every final
   image/pattern.
6. Replace hardcoded package fonts with generic font-directory preparation and explicit glyph
   providers. Official maps declare their complete canonical URL provider; exact-byte promotion
   changes that URL explicitly to a separately published immutable global base-asset set. Validate
   every final font stack and never invent fallback URLs from World data.
7. Introduce one no-write/no-network release planner and make every producer consume it.
8. Cut runtime/frameworks to manifest-first prepared styles; remove browser config compilation.
9. Canonicalize manifest generations, owner-relative URLs, capture receipts, and Hosted preflight.
10. Separate filesystem paths, route bases, and public URLs; harden output roots and centralize
    dev routing for Vite, Webpack, and Next.
11. Publish machine-readable schema/reference/diagnostics and JSON validate/inspect commands.
12. Restore official scenes and visual evidence in tileflow-tiles, then validate packed consumers,
    peers, real browsers, capture, reproducibility, and publication dry-runs.

## Required test matrices

- Eight official parents x 13 domains x omitted/exact/custom/disabled: at least 416 inheritance
  cases.
- All eight official maps under canonical, fully remapped, missing-optional, and missing-required
  data schemas.
- Icon arrays: inherit, replace, empty, ordered collision, case-fold collision, watch fallback,
  package install, missing reference, aggregate limits, and reproducibility across absolute paths.
- Fonts: inherited provider, glyph-to-local and local-to-glyph replacement, custom TTF/OTF/WOFF2,
  missing face/license, corrupt file, duplicate face, Hosted fail-closed, and browser load ordering.
- Relative/root/absolute public bases and filesystem traversal/symlink/junction cases across all
  bundlers.
- Manifest to style to sprite/font closure, exact capture receipt verification, and duplicate
  metadata rejection.

## Release gates

- No map contract or official map exposes raw overrides, physical generated layer IDs, or captured
  physical data bindings. Every map uses the same public semantic modules and render-stack language.
- Disabling a domain produces zero contributions owned by that domain.
- A complete schema remap leaves no canonical source-layer or field strings behind.
- No missing icon, pattern, local font, capability, or invalid expression is silently accepted.
- Browser bundles contain no config loader, compiler, filesystem, Jiti, Sharp, or official maps.
- validate reports every local build/deploy failure before writes or network requests.
- Two clean builds from different absolute paths produce byte-identical files and generation.
- Core/dev/CLI/framework/integration checks, package builds, packed consumer, peer smoke, real
  capture, tileflow-tiles visual suite, and publication dry-run all pass.

## Progress

- [x] Architecture audit and P1/P2 inventory completed.
- [x] AI-first icon-array contract selected.
- [x] Regression tests frozen for map identity/inheritance, semantic ownership, assets, manifests,
      routing, and filesystem containment.
- [x] Singular map contract complete.
- [x] Semantic compiler and official maps migrated.
- [x] Icon and font directory contracts complete.
- [x] Unified release plan and manifest-first runtime complete.
- [x] Integrations and security implementation complete.
- [x] AI discovery and command interfaces complete.
- [x] Packed consumers and visual evidence complete.
- [x] Full release gates green.

## Semantic Compiler V1 closure (2026-08-28)

The earlier cutover removed public physical overrides but retained a second, compiler-private
authoring path for the eight official maps. V1 closes that gap. The official maps and application
maps must use the same public semantic language, and the compiler must preserve semantic intent
until the final MapLibre lowering instead of reconstructing it from generated Style JSON.

### V1 decisions

- The pipeline is `Authoring AST -> resolved semantic plan -> Domain IR -> assembly -> owner-local
render stacks -> physical planner -> MapLibre lowering -> style + compilation report`.
- A closed domain registry owns module names, defaults, dependency order, services, and compiler
  orchestration. The strict resolved Zod schema owns value validation. Generated authoring/options/
  patch/resolved JSON Schema aliases and exhaustive drift tests keep both authorities in lockstep.
- Expressions use one typed IR and one visitor. Fields and source layers remain typed semantic
  references until lowering; raw MapLibre expression arrays are not a V1 authoring surface.
- Advanced rendering is owner-local and semantic. A domain may expose named render passes with a
  closed selector vocabulary, compatible renderer style, and finite phase. A pass cannot provide a
  physical ID, source, source-layer, filter, or before/after anchor.
- Ordering is deterministic by band, domain, phase, and local pass order. Physical layer IDs and
  provenance are generated only at lowering.
- The physical planner may combine only explicitly disjoint members of one `LayerFamilyIR` when
  exact compositing and expression equivalence are guaranteed. Otherwise it emits separate layers.
- Compilation returns structured diagnostics and a report covering origins, emitted and suppressed
  targets, requirements, planner decisions, and opt-in physical-layer provenance. That provenance
  is a read-only output diagnostic; its IDs are neither stable nor addressable authoring targets.
- This is a breaking development cutover. There is no cartographic-authoring compatibility adapter,
  alternate compiler, or raw-style escape hatch in the V1 package.

### Execution order

1. Freeze fresh before screenshots and receipt pairs for every official map/theme in the sibling
   `tileflow-tiles` laboratory using its exact regional data products and pinned browser.
2. Add the typed authoring AST, refinement operations, semantic IR, diagnostics/report, registry,
   and exact lowering/planner foundations alongside the current compiler.
3. Add the missing closed semantic capabilities discovered by the official-map audit: road
   variants, owner-local render passes, marker/ring/icon representations, flat/shadow/extrusion
   building modes, place eligibility, business area, pier, ferry labels, trail emphasis, landscape
   labels, elevation formatting, one-way representation, and finish overlays.
4. Migrate Ferraris and Harad, then Streets, Cyberpunk and Matrix, Siegfried, Soundings, and Verdant.
   Every migrated map must retain its visual identity while importing only public semantic APIs.
5. Remove `@tileflow/core/recipe`, module effects, raw semantic-field/layer authoring helpers, the
   legacy optimizer, target parsing, and the redundant public compiler selector.
6. Generate the V1 authoring manifest and JSON Schema, and provide JSON validate, inspect, explain,
   and semantic-diff surfaces with machine-applicable diagnostics.
7. Capture the same matrix after migration, run authenticated visual diffs, inspect every changed
   scene, correct regressions, and retain the before/after evidence for review.
8. Run focused tests during each slice, then the complete structural, browser, packed-consumer,
   capture, reproducibility, performance, build, and publication dry-run gates.

### V1 progress

- [x] Architecture, module-language, and 182-effect capability audits complete.
- [x] Before capture matrix and receipts frozen (10 deterministic scenes: all eight maps,
      including both Streets and Siegfried appearances).
- [x] Typed authoring and semantic IR foundations integrated.
- [x] Closed registry, planner, diagnostics, and AI manifest integrated.
- [x] All 182 private effects migrated to public semantic capabilities.
- [x] Eight official maps use only the V1 public language.
- [x] Legacy public compiler-selector/effects/optimizer surfaces removed.
- [x] After captures reviewed and visual regressions closed.
- [x] Full V1 release gates green.

## Validation log

- `pnpm run publish:alpha:dry-run` passes the complete repository check, all 13 package builds,
  packed-consumer smoke, pinned-browser public capture smoke, and public package dry-run for all 13
  tarballs. A subsequent `pnpm build` also passes.
- Complete package suites pass: Core 346/346, Maps 486/486, Dev 104/104, Interactions 74/74, CLI
  124 passing with 9 browser-dependent skips, Capture 63 passing with 11 browser-dependent skips,
  React 30/30, Vue 19/19, Svelte 14/14, Static 22/22, Next 9/9, Vite 14/14, and Webpack 10/10.
- Machine-readable reference version 3, the generated V1 authoring manifest and schema, local
  reference closure, AJV false-positive checks, schema/runtime drift checks, public-type checks,
  legal checks, formatting, lint, and type checking all pass.
- The sibling `tileflow-tiles` laboratory passes `pnpm local:check` (72/72). Its World,
  bathymetry, nautical, and DEM products were verified without rebuilding against their frozen byte
  sizes and SHA-256 identities before capture.
- Ten frozen before scenes and ten after scenes use the same 1200 x 800, DPR 1, MapLibre 5.24.0,
  Playwright 1.62.1, and Chromium 151.0.7922.34 renderer identity. The authenticated visual diff
  reports every scene `unchanged`, with matching dimensions, renderer, and scene identity and 0 of
  9,600,000 pixels changed. Network-dependent scenes retain explicit remote-resource warnings.
- A deliberate warm-cache diagnostic rerender of Soundings exposed six isolated, single-channel
  +/-1 GPU-compositing pixels in its DEM relief and no perceptual changes. No comparator tolerance
  was relaxed: the final exact gate was rerun from a fresh local server, matching the frozen-baseline
  procedure, and passed at 0 pixels changed.

## Constraints and coordination

- The SDK repository must not implement Hosted platform infrastructure. SDK support may define and
  consume a reviewed API; until it exists, unsupported asset delivery fails before any request.
- Third-party licenses remain next to the bytes they cover.
- No intermediate package is published. Core, dev, CLI/capture/static, integrations, frameworks,
  Hosted contracts, and tileflow-tiles cut over together.
- Examples stay removed from tileflow-sdk. Playground scenes and baselines belong to tileflow-tiles.
