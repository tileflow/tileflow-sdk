# Framework browser runtime contract

Status: public alpha contract as of 2026-08-14.

This document owns the framework-neutral browser lifecycle shared by Tileflow's React, Vue, and
Svelte map adapters. The DOM attributes consumed by application capture remain owned by
[`local-visual-capture.md`](local-visual-capture.md). Package-specific props, events, and examples
remain in each adapter README.

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

Direct canonical Tileflow World tile URLs additionally pass through one MapLibre custom protocol
bridge. The bridge fetches only the original query-free HTTPS URL with omitted credentials and no
caller headers, then exposes bytes and bounded cache metadata back to MapLibre. It interprets only
the exact `Tileflow-Fair-Use: open | grace | claim-required` response, the exact optional
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

`createTileflowMarkerController` owns only the set of live marker instances. The adapter still
creates the MapLibre marker, assigns coordinates and title, and attaches it to its current map.

Replacement removes the entire previous set before constructing the next set, matching existing
adapter ordering. Each new marker is recorded immediately after construction and before attachment.
If construction or attachment fails, every recorded marker in that partial batch is removed and
the original error is rethrown. The controller is left empty and can be reused. `clear` and
`dispose` remove all tracked markers and are idempotent.

## Adapter-owned compatibility

The kernel does not normalize framework reactivity. The adapters preserve these alpha behaviors:

| Concern                   | React                  | Vue                   | Svelte              |
| ------------------------- | ---------------------- | --------------------- | ------------------- |
| `mapOptions` recreation   | Structural equivalence | Identity              | Assignment/identity |
| Analytics prop recreation | No                     | Yes, by identity      | No                  |
| Transform presence        | Always                 | Only when needed      | Always              |
| Async analytics lookup    | Promise resolution     | Map-creation snapshot | Request snapshot    |
| Public load surface       | `onLoad(map)`          | `load` emit           | `load` dispatch     |

All three retain direct-prop precedence over native camera/interactivity options, the compact
attribution default, navigation controls only for interactive maps, ResizeObserver-driven map
resize, identity-driven marker replacement, and their existing manifest/style/image behavior.

## Compatibility and verification

The browser subpath is a public alpha surface. Removing an export, weakening two-frame readiness,
changing invalidation or session-key meaning, normalizing the listed adapter divergences, or
allowing module-evaluation access to browser globals is a compatibility change that requires an
explicit contract update.

Core fake tests cover frame ordering, every invalidating event, detach/dispose, latest handlers,
session deduplication, request policies and timing, the accessible fair-use owner action, shaped
empty tiles, error retention, and marker rollback. Package tests import the
built subpath in Node with throwing browser-global getters. The public tarball smoke resolves the
installed `@tileflow/core/browser` export from a clean consumer before capture tests run.

## Non-goals

This kernel does not introduce entities, feature state, clustering, selection, popups, business
events, hosted platform calls beyond analytics and commercial session preflight,
framework-independent DOM, or a new runtime package. Those capabilities require separate product
and API decisions.
