# AI-first map contract cutover

This ExecPlan is a living implementation record for the coordinated Tileflow SDK cutover. Update
progress, discoveries, decisions, and validation evidence as work proceeds. Durable behavior moves
to the owning contracts and package READMEs when the plan completes.

## Goal

Make one tileflow.config.ts export one strict TileflowMap whose result is mechanically predictable
from ordinary object, array, and extends semantics. Remove legacy aliases and hidden provider
graphs. Every official map is an independent root; no official map imports or extends another.
Streets owns coordinated light and dark themes, while application maps retain ordinary `extends`
semantics over any imported root.

The public authoring contract must be optimized for agents:

- one canonical syntax per operation;
- no ambiguous string shorthands, registries, compatibility aliases, or silent fallbacks;
- exact TypeScript and runtime schemas from the same source;
- deterministic merge rules and content-addressed outputs;
- stable structured diagnostics and resolved-config inspection.

## Final decisions

- Identity is leaf-owned. Root and extends are exclusive.
- Modules replace by domain. Replacing or disabling a domain removes every contribution owned by
  that domain.
- Data, projection, terrain, icons, and the text-asset provider are atomic.
- `themes` replaces atomically as one complete collection, `defaultTheme` selects one concrete
  member, and `systemThemes` replaces the complete browser light/dark mapping. Only `view`
  deep-merges. `defineTheme(base, definition)` materializes a complete document and leaves no theme
  inheritance edge in the resolved map.
- Scenes and delivery are leaf-only tooling metadata.
- Raw physical layer overrides leave the public API. Reusable behavior lives in typed modules;
  editorial-only official refinements may remain compiler-private, owner-scoped semantic
  contributions. They are discarded atomically with their owning module and never expose source
  layers, fields, generated layer IDs, or patch operations to map authors.
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
   Cyberpunk, and Matrix roots away from public/raw physical overrides and captured data bindings
   into typed modules or owner-scoped compiler semantic contributions. Materialize Streets light and
   dark as two appearances over its one shared structure.
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

- Official parent x 12 domains x omitted/exact/custom/disabled: at least 144 inheritance cases.
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

- No public map contract exposes raw overrides, physical generated layer IDs, or captured physical
  data bindings. Official compiler-private contributions must address semantic targets, bind data
  through the schema, and declare one atomic module owner.
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
- [x] Integrations and security implementation complete; full consumer verification is in progress.
- [ ] AI interfaces, packed consumers, and visual evidence complete.
- [ ] Full release gates green.

## Validation log

- Core build, declaration generation, and complete test suite pass in the current workspace.
- Maps publication dry-run includes `@tileflow/maps`, all eight official icon directories,
  Cyberpunk's and Siegfried's exact font files, and their adjacent licenses.
- Official-map and road semantic regression tests: 12/12 passing.
- Migrated Core asset/compiler fixtures: 26/26 passing.
- Machine-readable reference version 2 exposes recursive authoring (`root`/`extends`, leaf scenes)
  and standalone resolved entrypoints from the same generated field/module schemas; its drift and
  local-reference checks pass.
- The sibling tileflow-tiles playground exercises all eight official maps and
  resolves only a local data replacement for each imported map; its local-preview contract suite
  passes when loopback is available.
- Remaining work: complete Dev/CLI/framework suites, run six independent final audits, close their
  findings, then run repository-wide check/build/packed-consumer/publication gates.

## Constraints and coordination

- The SDK repository must not implement Hosted platform infrastructure. SDK support may define and
  consume a reviewed API; until it exists, unsupported asset delivery fails before any request.
- Third-party licenses remain next to the bytes they cover.
- No intermediate package is published. Core, dev, CLI/capture/static, integrations, frameworks,
  Hosted contracts, and tileflow-tiles cut over together.
- Examples stay removed from tileflow-sdk. Playground scenes and baselines belong to tileflow-tiles.
