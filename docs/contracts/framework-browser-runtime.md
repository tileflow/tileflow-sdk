# Framework browser runtime contract

Status: public alpha contract as of 2026-08-27.

This document owns the framework-neutral browser lifecycle shared by Tileflow's React, Vue, and
Svelte map adapters. The DOM attributes consumed by application capture remain owned by
[`local-visual-capture.md`](local-visual-capture.md). Package-specific props, events, and examples
remain in each adapter README. The separately approved annotation, tooltip, popup, and semantic
target behavior is owned by [`map-interactions.md`](map-interactions.md); this document defines how
that capability composes with the existing map lifecycle.

## Scope and entrypoint

The shared kernel is published from `@tileflow/core/browser`. It is an explicit browser-oriented
subpath and is not re-exported from `@tileflow/core`. The split prevents Node-side users of the
compiler and config APIs from entering the framework runtime accidentally.

The subpath is safe to import during server rendering. Evaluating it does not read `window`,
`document`, `navigator`, `requestAnimationFrame`, or `ResizeObserver`. It has no MapLibre runtime or
type dependency. Callers inject an animation-frame scheduler, MapLibre event subscriptions,
session sending when tests need a fake, a commercial session controller when hosted delivery needs
authorization, and marker construction/attachment/removal adapters.
Browser globals may therefore be used only by an adapter after its framework has mounted.

The browser entry contains lifecycle mechanics, not map ownership. It does not create MapLibre
maps or controls, inspect DOM, create observers, load manifests, resolve styles or static images,
or choose when a framework should recreate a map.

## Delivery source boundary

React, Vue, and Svelte expose one required `source` prop with the same two branches as
`TileflowRuntimeSource`: `{kind: 'tileflow', map, manifestUrl?}` or
`{kind: 'maplibre', style}`. The Tileflow branch is manifest-first in every environment. The
MapLibre branch accepts a style object or URL and never loads a Tileflow manifest. Browser wrappers
do not accept config/theme compilation, a style-base URL, or a local-development preference; those
authoring and dev concerns must produce published artifacts before browser rendering.

The Tileflow branch accepts only runtime manifest version 1. One shape covers local and Hosted
delivery: each map declares `defaultTheme`, optional `systemThemes`, and an exact `themes` record of
concrete Style URLs. Adapters do not normalize an older manifest, follow authoring `extends`, or
invent asset URLs from a map or theme name.

Omitting `manifestUrl` means exactly `/tileflow/manifest.json` at the current origin. Adapters do
not infer a deployment prefix from `document.baseURI`, a bundler setting, a script URL, or the
current route: such discovery would differ between SSR and the browser and could silently select
the wrong map generation. Therefore `manifestUrl` is required whenever the public artifact URL is
anything else, including a custom Tileflow plugin `base`, Vite `base`, Webpack `publicPath`, or Next
`basePath`. For example, artifacts published under `/app/maps` require
`source={{kind: 'tileflow', map: 'main', manifestUrl: '/app/maps/manifest.json'}}`.

Manifest fetching has four explicit adapter states: `not-needed`, `loading`, `ready`, and `error`.
A missing manifest, a missing requested map, an interactive source without a resolvable style, or
image mode without a resolvable image URL enters the terminal public readiness state `error`.
Changing `source` immediately invalidates readiness, so an adapter cannot expose the previous
map's `idle` state while the replacement is being resolved. Application capture translates that
terminal state to `APPLICATION_ERROR` rather than waiting for its timeout.

## Theme selection and switching

React, Vue, and Svelte expose the same optional `theme` input for Tileflow sources. Omission selects
the manifest's `defaultTheme`; an explicit concrete name selects exactly that entry; `system`
requires `systemThemes` and resolves from the browser light/dark preference. Direct MapLibre
sources reject `theme` because Tileflow does not own their appearance catalog.

The browser color-scheme observer is a shared singleton rather than one media-query listener per
component. Its value is read only after mount, keeping server rendering deterministic. Every DOM
capture target exposes the resolved concrete name in `data-tileflow-theme`; `system` never appears
there, in a Style URL, or in a capture receipt.

Changing only the resolved theme is a transactional Style replacement on the existing MapLibre
instance. It preserves camera, controls, semantic interactions, annotations, and component
identity. Font preparation and Style loading complete before the transition becomes current;
overlapping requests are latest-wins, and an unknown or failed theme enters the public `error`
state without throwing during framework render. A successful later selection can recover.

## Renderer loading boundary

React, Vue, and Svelte import MapLibre declarations as types only. Their executable entrypoints
load `maplibre-gl` with a cached dynamic import after mounting and only when the resolved mode has
an interactive runtime style. Importing an adapter during SSR and rendering `mode="image"` must
not load or evaluate MapLibre. Changing from interactive mode or unmounting while the import is in
flight invalidates that map creation; a late import may not attach a map to the retired container.

An interactive import failure moves the framework-neutral readiness state to `error`. Successful
interactive loading retains the same MapLibre map, control, marker, World request bridge, fair-use
notice, lifecycle, and ResizeObserver ownership described below.

## Interactive readiness lifecycle

`attachTileflowMapLifecycle` attaches exactly five logical events: `load`, `dataloading`,
`styledataloading`, `idle`, and `error`. The caller supplies a subscribe function that returns one
unsubscribe function for each event.

Attachment reports `loading`. `dataloading` and `styledataloading` invalidate pending idle work and
report `loading`; `error` invalidates pending work and reports `error`. `idle` invalidates any older
idle run, requests one injected animation frame, then requests a second frame. Only the current,
still-attached run may report `idle` after that second frame. A later idle event may recover from an
earlier error, matching MapLibre's event stream.

Explicit invalidation cancels every scheduled frame and prevents its callbacks from changing
state. Disposal does the same and invokes all five unsubscribe functions exactly once. Disposal is
idempotent, does not change readiness, and does not call `map.remove()`; the owning adapter
unsubscribes before removing its MapLibre instance and separately disconnects its ResizeObserver.

On `load`, the adapter's public callback or event runs first. Only if it returns normally does the
kernel resolve current session context and ask the persistent session starter to start analytics.
Adapters use closures or latest-value refs so a load event observes the latest callback, analytics,
and map name without making callback identity a map-recreation input.

Static-image readiness is intentionally separate. Each adapter continues to own cached-image
checks, `decode()`, load/error fallbacks, resize measurement, and cancellation across mode changes.

## Package-owned web fonts

The optional `tileflow:fontFaces` style metadata and matching manifest entries describe only
prepared, public font artifacts; they never expose an installation path. The shared browser loader
strictly validates a bounded number of face descriptors, accepts only HTTP(S) or safe relative
sources, bounds both style-metadata and font response bodies, and constructs each `FontFace` from
bytes rather than injecting remote CSS. Content-addressed source URLs are cached by face identity.

React, Vue, and Svelte await font loading alongside their dynamic MapLibre import and create the
map only after both have completed. An explicit empty manifest entry avoids an extra Style request;
an explicit Style URL can still be inspected for metadata before MapLibre loads it. Relative
self-hosted manifest resources resolve against the fetched manifest URL, while relative font-face
sources resolve against their owning Style URL. Importing the browser subpath remains SSR-safe:
`document` and `FontFace` are read only when a non-empty face list is loaded after mount.

Standalone capture applies the same metadata before constructing its page-local MapLibre map and
bounds streamed font bytes. Native renderers do not use this browser contract and require a PBF
glyph provider. For package-owned web fonts, Hosted preparation uploads a canonical
content-addressed closure of the selected faces and their licenses before the dependent Style, then
uses the immutable public URLs bound to that bundle hash. That endpoint and validation path exist,
but they are not yet generally production-enabled: DB-backed organization ownership, quota
accounting, durable deployment/library references, and safe garbage collection remain required.

## Session starts

`createTileflowSessionStarter` deduplicates the exact key `sessionId:mapId:styleId`, with an empty
final field when the style id is absent. A different session or style id is a different start.
Missing analytics or map id does not reserve a key. A caller may provide a fixed identity or a
getter so an expired unused commercial reservation can rotate before the load event without
leaving the analytics beacon attached to the retired identity.

Tileflow's adapters create one commercial session controller and one starter for each MapLibre map
instance. A framework-driven map reconstruction therefore receives a fresh identity, as required
by the hosted map-view contract. The starter reads the controller's current identity at the load
event.

The key is reserved before the sender is called. The starter deliberately does not interpret
`analytics.enabled`: the default `startTileflowSession` sender owns that policy. This preserves the
existing behavior where a disabled analytics object with a map id still consumes its deduplication
key even though the real sender performs no network action.

The sender remains call-time browser code. `startTileflowSession` checks browser capability before
using beacon or fetch, so merely importing or constructing a starter is SSR-safe.

## Request transforms

`createTileflowTransformRequest` invokes the caller's transform first and forwards the original
resource type. Without a commercial controller it preserves synchronous results as synchronous
and retains the legacy analytics URL decoration. With a controller it awaits the server-owned
preflight and returns an asynchronous request, even when the user transform is synchronous.
Authorization operates on the user result's URL when present, otherwise the original URL. A
rewritten result preserves every other user request field. Rejections from either the user
transform or commercial preflight propagate to MapLibre.

The controller authorizes only reviewed Tileflow resource URLs. `analytics.enabled: false` remains
an optional telemetry choice and cannot remove the commercial transform when a hosted map id is
present.

Exact canonical Tileflow World release tile URLs additionally pass through one MapLibre custom
protocol bridge. The bridge requires a valid immutable release path, exactly one lowercase
`worldDescriptorSha256`, and only the delivery query keys owned by the contract. It fetches that
original HTTPS URL with omitted credentials and no caller headers, then exposes bytes and bounded
cache metadata back to MapLibre. The retired mutable World template is not intercepted. The bridge
interprets only the exact `Tileflow-Fair-Use: open | grace | claim-required` response, the exact optional
`Tileflow-Fair-Use-Notice: owner` activation signal, and a validated Tileflow-owned
`Link: ...; rel="help"`. Early `GRACE` remains silent. Late `GRACE` appears only with the signed
activation signal, except that a shaped `429` is a defensive activation fallback. `CLAIM_REQUIRED`
always appears. Unknown or failed responses cannot clear a prior owner notice. Concurrent responses
apply notice state in request order; successful `open` clears any notice, while silent `GRACE` clears
only an existing `GRACE` notice.

`attachTileflowFairUseNotice` owns one DOM status inside the map container. It uses `role="status"`,
`aria-live="polite"`, `aria-atomic="true"`, a visible HTTPS owner-action link, and no viewer or site
identity. `GRACE` renders as a compact bottom pill with a subtle yellow surface;
`CLAIM_REQUIRED` renders as a high-contrast top banner. The status sentence remains plain text and
only the owner action is the underlined link. `CLAIM_REQUIRED` cannot regress to `GRACE` within the
same controller. Disposal removes the protocol registration and notice; ordinary MapLibre errors and
shaped empty tiles do not.

Two policies are explicit compatibility inputs:

- `always: true` returns a transform even when analytics and a user transform are absent. React and
  Svelte use this policy.
- Without `always`, the helper returns `undefined` when no user transform exists and neither
  analytics nor a hosted commercial session requires it. Vue uses this policy.

Async analytics timing is also explicit. `request` snapshots analytics after the user transform is
invoked and before its promise settles; Svelte uses this behavior. `resolution` reads analytics
when the promise settles; React uses this behavior. Vue passes a getter over the analytics snapshot
captured for that map instance, so either phase resolves the same snapshot. Synchronous transforms
read analytics after invoking the user transform.

## Marker ownership and failure recovery

This section records the legacy `markers` compatibility behavior before the interaction package
migration ships.

`createTileflowMarkerController` owns only the set of live marker instances. The adapter still
creates the MapLibre marker, assigns coordinates and title, and attaches it to its current map.

Replacement removes the entire previous set before constructing the next set, matching existing
adapter ordering. Each new marker is recorded immediately after construction and before attachment.
If construction or attachment fails, every recorded marker in that partial batch is removed and
the original error is rethrown. The controller is left empty and can be reused. `clear` and
`dispose` remove all tracked markers and are idempotent.

## Interaction composition boundary

The approved `@tileflow/interactions/maplibre` adapter does not replace this kernel or widen
`@tileflow/core/browser`. React, Vue, and Svelte remain the owners of source resolution, the cached
post-mount MapLibre import, map and control creation, request transforms, fonts, fair-use notice,
ResizeObserver, and map teardown. Once a map exists, the framework adapter passes that same map and
renderer capability to the interaction controller. The interaction controller may not create a
second map or independently load a second renderer module.

The interaction package owns annotation reconciliation, semantic target resolution, hit testing,
anchors, and tooltip/popup lifecycle. Framework adapters own only the framework-specific view mount
for that capability and forward its normalized state, events, and diagnostics. Core's browser
kernel does not import or re-export `@tileflow/interactions`.

Map readiness continues to use exactly the five logical MapLibre events above. Framework adapters
compose it with a separate interaction-readiness contributor: effective state is `error` if either
contributor errors, `idle` only when both are idle, and otherwise `loading`. A custom interaction
view becomes idle after framework commit and two current animation frames; invalidation or removal
cancels pending frames. This does not infer readiness of application-owned asynchronous work.

After the interaction migration ships, image mode never attaches the interaction adapter.
Interactive annotations, bindings, or legacy markers in image mode produce the structured
incompatibility behavior in the interaction contract without evaluating MapLibre.

## Adapter-owned compatibility

The kernel does not normalize framework reactivity. The adapters preserve these alpha behaviors:

| Concern                   | React                  | Vue                   | Svelte              |
| ------------------------- | ---------------------- | --------------------- | ------------------- |
| `mapOptions` recreation   | Structural equivalence | Identity              | Assignment/identity |
| Analytics prop recreation | No                     | Yes, by identity      | No                  |
| Transform presence        | Always                 | Only when needed      | Always              |
| Async analytics lookup    | Promise resolution     | Map-creation snapshot | Request snapshot    |
| Public load surface       | `onLoad(map)`          | `load` emit           | `load` dispatch     |

All three resolve camera values in the same order: direct props, native `mapOptions`, the published
manifest view, then `defaultTileflowRuntimeView`. Image mode applies the same center/zoom order and
normalizes every MapLibre center shape without loading MapLibre. They retain the compact
attribution default, navigation controls only for interactive maps, ResizeObserver-driven map
resize, and their existing manifest/style/image behavior. Identity-driven whole-set replacement
remains the legacy marker behavior until the keyed migration in the interaction contract ships.

## Compatibility and verification

The browser subpath is a public alpha surface. Removing an export, weakening two-frame readiness,
changing invalidation or session-key meaning, normalizing the listed adapter divergences, or
allowing module-evaluation access to browser globals is a compatibility change that requires an
explicit contract update.

Core fake tests cover frame ordering, every invalidating event, detach/dispose, latest handlers,
session deduplication, request policies and timing, the accessible fair-use owner action, shaped
empty tiles, error retention, and marker rollback. Adapter package tests verify their built or
compiled entrypoint keeps MapLibre behind a dynamic import and that the interactive loader resolves
the real renderer. Package tests import the built browser subpath in Node with throwing
browser-global getters. The public tarball smoke resolves the installed `@tileflow/core/browser`
export from a clean consumer before capture tests run.

## Non-goals

This Core kernel does not itself introduce entities, feature state, clustering, selection, popups,
business events, framework-independent DOM, or a new runtime package. The separately approved
`@tileflow/interactions` package may add only the targets, normalized events, annotations, and
tooltip/popup behavior defined in [`map-interactions.md`](map-interactions.md); that decision does
not move those responsibilities into `@tileflow/core/browser`. Hosted platform calls beyond
analytics and commercial session preflight remain out of scope.
