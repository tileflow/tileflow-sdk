# SDK responsibility and delivery contract

This document defines the ownership boundaries between Tileflow authoring, compilation, rendering,
local tooling, capture, and Hosted delivery. Package READMEs remain the source of truth for each
public API; this contract records the relationships between those APIs.

## Terms

- A **map** is the only public cartographic authoring unit. It has its own identity and version and
  is either a compiler root or extends another imported map.
- A **root map** owns a compiler lineage. Streets, Ferraris, Härad, Siegfried, Soundings, and Verdant
  are the first-party roots; Streets Dark and Cyberpunk are ordinary maps that extend Streets, and
  Matrix extends Cyberpunk. Ferraris, Härad, Siegfried, Soundings, and Verdant use the same semantic
  Streets compiler ABI without importing, extending, or reusing assets from the Streets map.
- A **module** is a semantic authoring input owned by a map domain, such as roads, buildings,
  water, or labels. Modules compile to MapLibre style contributions; they do not draw pixels.
- A **data source** supplies vector, raster, terrain, or other map data. Tileflow World is a data
  source, not a map definition.
- A **style** is the MapLibre Style JSON produced by the cartographic compiler. Node preparation,
  build, capture, and deploy additionally run MapLibre semantic validation before side effects.
- A **renderer** turns a style into pixels. The interactive SDK renderer is MapLibre GL JS.
- An **interaction** associates application or semantic map targets with normalized events,
  tooltips, popups, or application-owned framework views. It does not alter cartographic output.
- A **semantic interaction artifact** is bounded post-optimization runtime metadata that maps a
  stable semantic domain to final renderer details. It is not a public style-authoring surface.
- A **self-hosted build** writes styles and prepared assets for an application to serve itself.
- A **Hosted deploy** publishes prepared styles and policy through the Tileflow Hosted API.
- A **Static Map** is a remote render operation that produces an immutable image. It is separate
  from an interactive map and from a self-hosted build artifact.

## Pipeline ownership

```text
Source map exported by tileflow.config.ts
  -> map inheritance resolution
  -> Node preparation (config imports, package/local assets, input graph)
  -> Prepared map
  -> pure cartographic compilation
  -> MapLibre Style JSON + managed ArtifactPlan
       |-> application runtime -> MapLibre -> interactive pixels
       |-> local preview       -> MapLibre -> development pixels
       |-> capture             -> Playwright/MapLibre -> evidence files
       |-> self-hosted build   -> styles/sprites/fonts + self-hosted runtime manifest
       `-> Hosted deploy       -> Hosted API + Hosted runtime manifest

Static Map scene -> Static Maps client -> Hosted renderer -> immutable image
```

The semantic interaction artifact is versioned private metadata inside the exact finalized Style
JSON it describes. It does not make interaction state or framework views compiler inputs, and it
does not change runtime manifest version 3. The shared MapLibre interaction runtime validates the
metadata against the loaded style before using its opaque physical lookup.

The compiler must not perform network publication or instantiate a renderer. Render adapters must
not own config loading, icon preparation, build artifact generation, or deployment. Build adapters
bridge their host tool lifecycle to the Node preparation surface; they do not implement a second
compiler. The CLI is a user-facing composition root and may expose all workflows, but its internal
services preserve these boundaries.

## Package ownership

### `@tileflow/core`

Owns serializable map contracts, `defineMap()`/`defineRootMap()`, semantic modules, pure config
validation, and pure compilation to MapLibre Style JSON. Physical layer overrides are not public;
Core binds semantic contributions to one module owner and validates the final optimized output with
the MapLibre style spec. Browser-only runtime helpers are exposed through explicit browser/runtime
subpaths so authoring consumers do not implicitly opt into delivery behavior.

Core does not instantiate MapLibre, load executable config files, watch the filesystem, prepare
local icon directories, publish to Hosted, or implement the Hosted API.

Core also owns generation and final validation of a semantic interaction artifact after optimizer
output is final. It may record physical renderer IDs in that opaque artifact, but does not expose
those IDs as stable application targets or own the DOM runtime that consumes them.

The exported `@tileflow/core/recipe` subpath is Core's low-level semantic-effect ABI for packages
such as `@tileflow/maps`. It is public in the npm/export-map sense and therefore covered by Core's
compatibility policy, but it is not the normal `tileflow.config.ts` authoring surface and does not
select an official map. The serialized root value `compiler: 'streets'` likewise identifies the
current semantic compiler family; it does not import the Streets map or its assets.

Core owns the serializable ordered icon and font directory contracts. Dev tooling owns filesystem
resolution and preparation. Icon files publish their canonical ID directly (`<id>.<ext>` or the
reserved `<id>.pattern.<ext>` form), and neither package owns a provider registry or semantic icon
mapping.

Core owns the normalized meaning of compatible vector schemas, not just their raw layer names.
Tileflow World V1 declares `park` as `protected-only`; urban parks and gardens are typed grass
subclasses in `landcover`. Generic OpenMapTiles bindings remain `mixed` and use an internal legacy
compatibility branch. Data production owns whether `globallandcover` is physically present at a
zoom; the style only controls its visual handoff and must not claim a longer native range than the
PMTiles contract.

### `@tileflow/maps`

Owns the official Streets, Ferraris, Härad, Siegfried, Soundings, Streets Dark, Cyberpunk, Matrix,
and Verdant map objects, their package-directory descriptors, and the icon, pattern, font, and
notice files those maps require. Streets, Ferraris, Härad, Siegfried, Soundings, and Verdant are
complete root maps. Ferraris, Härad, Siegfried, Soundings, and Verdant declare only their own
`ferrarisIcons`, `haradIcons`, `siegfriedIcons`, `soundingsIcons`, and `verdantIcons` directories.
Härad's directory contains nine original Tileflow SVG patterns inspired by Lantmäteriet's CC0
Häradsekonomiska kartan series (1859–1934) and official legend; no Lantmäteriet scan, pixel, legend
artwork, font, or map data is redistributed. Soundings owns ten original nautical symbols and
patterns and exposes broad GEBCO-derived bathymetric context, not navigation-grade survey
soundings. These roots use the semantic Streets compiler ABI but do not import, extend, or inherit
assets from Streets. Streets Dark and Cyberpunk extend Streets through Core's public inheritance
contract. Matrix extends Cyberpunk, owns `matrixIcons`, and reuses `cyberpunkFonts`.

Maps has a peer dependency on Core because its exports are authored with Core's map language. Core
never depends on or re-exports Maps. A consumer that wants an official map installs both packages;
a consumer defining only its own root map may install Core alone.

### `@tileflow/dev`

Owns Node-side preparation and local development facilities. Its public surfaces are separated by
purpose: prepared artifacts, icon/font inputs, watched server sessions, feature inspection, and preview.
Build integrations consume only the preparation surface they need.

The preview may contain explicitly experimental renderers. Experimental preview output is not part
of the portable Style JSON contract unless the same behavior is implemented by the application and
capture renderers.

### Framework adapters

`@tileflow/react`, `@tileflow/vue`, and `@tileflow/svelte` own framework lifecycle bindings around
the shared browser runtime. Interactive mode loads MapLibre on demand. Image mode displays an
existing image and must not load MapLibre merely by importing the adapter.

When interactions ship, these adapters also own the framework-specific marker, tooltip, and popup
view bridges. They pass their existing mounted MapLibre instance into the shared interaction
adapter, compose interaction readiness with map readiness, and forward normalized state, events,
and diagnostics. They do not duplicate keyed reconciliation, hit testing, target resolution, or
overlay lifecycle.

### `@tileflow/interactions`

The approved future package owns JSON-safe annotation and binding schemas, target selectors and
references, the pure controlled/uncontrolled state reducer, normalized events, diagnostics, and
machine-readable interaction reference data. Its root remains safe in Node and SSR.

Its `@tileflow/interactions/maplibre` subpath attaches those contracts to an existing MapLibre map
and owns keyed annotation instances, feature hit testing, anchoring, and tooltip/popup lifecycle. It
does not create maps or controls, load a second renderer, compile styles, prepare or deliver assets,
or implement framework components. Core does not depend on or re-export it; framework adapters
depend on it. Full behavior and the rollout gates are owned by
[`map-interactions.md`](map-interactions.md).

### Build integrations

`@tileflow/vite`, `@tileflow/next`, and `@tileflow/webpack` translate host build/watch hooks into
Tileflow preparation and managed artifact writes. They must consume the same prepared map and
ArtifactPlan as CLI build, preview, capture, and deploy.

### `@tileflow/capture`

Owns deterministic local browser capture, receipts, comparison, and evidence. A capture scene may
point at an application DOM target, so it is intentionally distinct from a Static Map scene.

### `@tileflow/static`

Owns Static Maps scene contracts, overlay compilation, canonical request identity, and the bounded
HTTP client for remote render operations. It does not render locally and does not generate the
self-hosted files sometimes described as static build artifacts.

Static overlays are visual scene inputs, not interactive annotations. A future static callout
requires its own scene-contract change and does not acquire hover, focus, activation, or close
semantics from `@tileflow/interactions`.

### `@tileflow/cli`

Owns command presentation and composes the preparation, preview, capture, inspection, and Hosted
clients. Hosted authentication, bounded HTTP transport, deployment planning, and presentation are
internal services rather than cartographic concerns.

## Delivery selection

One prepared map selects one final runtime delivery mode for a given output manifest:

- `self-hosted`: the manifest points at application-served style and sprite artifacts;
- `hosted`: the manifest points at immutable or revisioned Hosted resources.

The two variants have an explicit discriminator and share strict runtime manifest version 3 with an
exact `maps`/`styles` closure. Older versions and compatibility aliases are rejected rather than
normalized. A build integration must not silently replace a manifest belonging to the other
delivery mode.

Runtime manifest version 3 remains unchanged: semantic interaction metadata travels atomically in
the referenced Style JSON, while annotation input remains application-owned. A future decision to
split that metadata into its own resource would require an explicit next wire version and
coordinated validation in self-hosted build, Hosted-client, browser runtime, and capture consumers.

Hosted policy such as allowed browser origins is delivery metadata. It is not inherited with map
design because it does not affect cartographic output.

## Transaction boundary

Local preparation validates the complete intended release before the first Hosted write. Hosted
publishes are idempotent and retryable, but repository-internal orchestration of several singular
map configs is not an all-or-nothing transaction. A remote batch/release API is required to provide
that guarantee. The local runtime manifest is
committed only after remote publication completes, but local filesystem recovery cannot roll back
an already accepted remote write.

This limitation belongs to Hosted delivery. It does not affect local development, map/module
compilation, MapLibre rendering, Tileflow World data, or local capture.

Package-owned browser fonts use a reviewed Hosted contract rather than a data URL or undocumented
upload. Preparation creates a canonical content-addressed bundle containing only selected font faces
and their licenses; the CLI uploads it before the dependent Style, and Hosted returns immutable
public URLs bound to the bundle hash. The transport and validation contract exist, but general
production enablement remains blocked until Hosted has DB-backed organization ownership, quota
accounting, durable deployment/library references, and safe garbage collection for those bundles.
