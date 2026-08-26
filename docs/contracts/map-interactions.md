# Map interactions contract

Status: approved implementation contract for a forthcoming public alpha surface as of 2026-08-25.
The package and framework APIs described here are not available until their owning packages publish
them. Existing `markers` behavior remains governed by
[`framework-browser-runtime.md`](framework-browser-runtime.md) until that migration ships.

This document owns the durable product and package boundary for application annotations, markers,
tooltips, popups, normalized interaction state and events, and semantic feature targeting. Package
READMEs own framework syntax and examples once the packages implement this contract. The browser
map lifecycle remains governed by
[`framework-browser-runtime.md`](framework-browser-runtime.md), and capture target attributes remain
governed by [`local-visual-capture.md`](local-visual-capture.md).

## Scope and terminology

- An **annotation** is an application-owned item with a stable ID and geographic coordinate. The
  first annotation kind is a DOM marker.
- A **semantic feature** is a rendered feature addressed by a Tileflow domain and normalized public
  properties rather than by compiler-generated layer IDs.
- A **target selector** declares which annotations, semantic features, application-owned style
  features, or map locations a binding matches.
- A **target reference** identifies one resolved target in serializable state.
- A **tooltip** is brief, non-interactive information opened by hover or equivalent DOM focus.
- A **popup** is rich, interactive content opened by activation or application state.
- A **callout** is persistent visible content. A future static callout is visual only and is not an
  interactive tooltip or popup.
- A **view outlet** is the framework-owned boundary that renders custom marker, tooltip, or popup
  content.

This contract approves the annotation model, the common interaction vocabulary, and semantic POI
tooltip/popup support backed by the post-optimization artifact defined below. Other semantic
domains, selection, clustering, feature-state ownership, collision layout, persistent multi-callout
UI, and canvas keyboard navigation require separate contract changes.

## Package and dependency boundary

The approved package has exactly these public code entrypoints:

- `@tileflow/interactions` contains the serializable types, executable schemas, pure state reducer,
  event and diagnostic contracts, and machine-readable reference data;
- `@tileflow/interactions/maplibre` attaches annotations and feature interactions to an existing
  MapLibre map and owns keyed instances, hit testing, anchoring, and overlay lifecycle.

The root entrypoint is safe to evaluate in Node and during server rendering. It does not read
browser globals and has no executable import of MapLibre or a UI framework. The MapLibre subpath is
also safe to evaluate before mount; browser globals and renderer operations are used only when a
caller attaches it to a mounted map.

The dependency direction is:

```text
@tileflow/core <- @tileflow/interactions <- @tileflow/react | @tileflow/vue | @tileflow/svelte
                           |
                           `- /maplibre -> existing mounted MapLibre map
```

Core never imports or re-exports `@tileflow/interactions`. Interactions may consume pure Core
runtime-manifest and browser-kernel surfaces; this preserves an acyclic graph and leaves Core usable
without the interaction package. Framework adapters add a normal dependency on interactions.

`maplibre-gl` is an optional `>=5 <7` peer of `@tileflow/interactions`, matching the framework
packages' required peer range. This prevents a pure-model consumer from being required to install a
renderer. Direct users of `/maplibre` must provide the peer. Framework adapters retain their
required MapLibre peer, load one cached renderer module after mount, create the map, and pass that
map and renderer capability to the interaction controller. The interaction package does not create
a second map or a second renderer loader.

There is no `@tileflow/annotations` package and no general `@tileflow/maplibre` wrapper. The
interaction package does not own map creation, camera state, controls, config loading, compilation,
asset preparation, build output, deployment, or Hosted APIs.

## Serializable public model

The package root exports the following public type families with the `Tileflow` prefix. Executable
schemas accept the same shapes and reject unknown keys on contract records. Annotation `data`
objects may have application-defined keys but remain recursively JSON-safe. Schema validation also
rejects non-plain objects, prototype-mutating keys, cycles, non-finite numbers, and values outside
documented size limits.

```ts
type TileflowInteractionJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TileflowInteractionJsonValue[]
  | {readonly [key: string]: TileflowInteractionJsonValue};

type TileflowInteractionCoordinate = readonly [longitude: number, latitude: number];

type TileflowInteractionContent =
  | {kind: 'text'; text: string}
  | {kind: 'field'; field: string; fallback?: string}
  | {kind: 'view'; name: string};

type TileflowAnnotation<TData extends TileflowInteractionJsonValue = TileflowInteractionJsonValue> =
  {
    kind: 'marker';
    id: string;
    coordinate: TileflowInteractionCoordinate;
    ariaLabel: string;
    data?: TData;
    marker?: {
      color?: string;
      content?: TileflowInteractionContent;
    };
    tooltip?: {content: TileflowInteractionContent};
    popup?: {content: TileflowInteractionContent};
  };

type TileflowInteractionTarget =
  | {kind: 'annotation'; id: string}
  | {kind: 'semantic-feature'; domain: string; categories?: readonly string[]}
  | {kind: 'style-layer'; layerId: string}
  | {kind: 'map'};

type TileflowInteractionBinding = {
  id: string;
  target: TileflowInteractionTarget;
  tooltip?: {content: TileflowInteractionContent};
  popup?: {content: TileflowInteractionContent};
};
```

The remaining root names frozen for implementation are:

- types `TileflowInteractionCoordinate`, `TileflowAnnotationMarker`, `TileflowAnnotationSurface`,
  `TileflowResolvedInteractionTarget`, `TileflowAnnotationViewContext`,
  `TileflowInteractionViewContext`, `TileflowInteractionTargetRef`, `TileflowInteractionState`,
  `TileflowInteractionAction`, `TileflowInteractionEvent`, and `TileflowInteractionDiagnostic`;
- executable `tileflowInteractionJsonValueSchema`, `tileflowInteractionContentSchema`,
  `tileflowAnnotationSchema`, `tileflowAnnotationsSchema`, `tileflowInteractionTargetSchema`,
  `tileflowInteractionTargetRefSchema`, `tileflowInteractionBindingSchema`,
  `tileflowInteractionBindingsSchema`, `tileflowInteractionStateSchema`, and
  `tileflowInteractionActionSchema`;
- `tileflowInteractionSchemaVersion`, `tileflowInteractionLimits`,
  `initialTileflowInteractionState`, `tileflowInteractionTargetRefsEqual`,
  `validateTileflowAnnotations`, pure `reduceTileflowInteractionState(state, action)`, and
  machine-readable `tileflowInteractionReference`.

`TileflowInteractionAction` initially contains `open-popup` and `close-popup` discriminants. The
MapLibre subpath initially exports `createTileflowAnnotationRegistry` and
`createTileflowOverlayStateController` with types `TileflowAnnotationRegistryEntry`,
`TileflowAnnotationRegistryAdapter`, `TileflowAnnotationRegistry`, `TileflowOverlayState`,
`TileflowOverlayStateChangeReason`, `TileflowOverlayStateListener`, and
`TileflowOverlayStateController`. Higher-level hit-test and anchoring exports may be added only with
the matching semantic capability. No interaction export is re-exported through `@tileflow/core`.

`data` is JSON-safe by contract, not merely typed as `unknown`. `ariaLabel` is non-empty for a new
public annotation. Framework nodes, functions, class instances, native events, MapLibre objects,
DOM nodes, and raw HTML are not valid annotation or binding data. Custom framework UI belongs only
at a view outlet.

`text` is rendered as text. `field` is a bounded dotted selector over own properties of normalized
target data. Every segment is validated, and `__proto__`, `prototype`, and `constructor` are always
forbidden. A missing field or non-scalar value renders the bounded `fallback` when supplied;
otherwise it produces a structured diagnostic and no overlay. `view.name` is a bounded dispatch
key. The matching outlet receives the name and resolved context, and application code chooses its
native component. Tileflow does not serialize a component tree.

The four target branches are one forward-compatible vocabulary with gated availability:

- annotations and annotation target references are part of the first MVP through inline
  `marker`, `tooltip`, and `popup` surfaces; an annotation-target entry inside `interactions`
  remains reserved until precedence against those inline surfaces is contracted;
- semantic features support `domain: "poi"` through the validated semantic artifact;
- `style-layer` is an advanced escape only for application-owned MapLibre styles and must report an
  unsupported-target diagnostic until its separate release gate is approved;
- `map` selects an input occurring on the map; the resolved event or state reference supplies the
  activation coordinate.

Unsupported target branches fail closed. They are never treated as annotations or silently widened
to all rendered layers.

## Resolved targets and framework views

A selector is not a resolved target. Events and view outlets receive a discriminated
`TileflowResolvedInteractionTarget` containing the target kind, geographic anchor, effective
binding ID when present, and exactly one of:

- the matched annotation with its inferred JSON-safe data;
- a normalized semantic feature with domain, optional stable ID, category, and public properties;
- an application-owned style feature with layer ID, optional stable ID, and public properties;
- a map coordinate.

`TileflowAnnotationViewContext<TAnnotation>` exposes `annotation`, the resolved target, the named
view key when one selected the outlet, and `close()`. The general
`TileflowInteractionViewContext` is a discriminated union for annotation, semantic-feature,
style-feature, and map targets. Narrowing `target.kind` must expose the matching payload without a
cast. Heterogeneous annotations retain the application's own data discriminant; Tileflow does not
promise narrowing from an arbitrary annotation ID string.

`style-layer` is a selector because one binding may match several rendered features.
`style-feature` is the corresponding resolved target and durable reference for one matched feature.

The common data and ownership props are named `annotations`, `interactions`, `interactionState`, and
`defaultInteractionState`. Framework-native view and notification surfaces are:

| Capability   | React                      | Vue                            | Svelte                     |
| ------------ | -------------------------- | ------------------------------ | -------------------------- |
| Marker view  | `renderMarker`             | scoped `marker` slot           | `marker` snippet           |
| Tooltip view | `renderTooltip`            | scoped `tooltip` slot          | `tooltip` snippet          |
| Popup view   | `renderPopup`              | scoped `popup` slot            | `popup` snippet            |
| State change | `onInteractionStateChange` | `update:interactionState` emit | `onInteractionStateChange` |
| Event stream | `onInteractionEvent`       | `interactionEvent` emit        | `onInteractionEvent`       |
| Diagnostics  | `onInteractionDiagnostic`  | `interactionDiagnostic` emit   | `onInteractionDiagnostic`  |

Whitespace and template casing follow each framework's normal conventions. The portable contract
is the descriptor, target, context, state, event ordering, error, and lifecycle behavior. A React
tree is not portable executable input to Vue or Svelte.

Tileflow owns the outer marker, tooltip, popup, and close-control elements. Custom framework views
mount inside those elements, so application content cannot accidentally remove the runtime's
positioning, teardown, focus relationship, or default close action. Applications own all content
inside their view and may use buttons, forms, animation, and design-system components there.

## State, events, and diagnostics

Only one interactive popup may be open per map in the first version. Hover and focus are transient
runtime state and are not written to application state.

```ts
type TileflowInteractionTargetRef =
  | {kind: 'annotation'; id: string}
  | {kind: 'semantic-feature'; domain: string; featureId: string | number}
  | {kind: 'style-feature'; layerId: string; featureId: string | number}
  | {kind: 'map'; coordinate: TileflowInteractionCoordinate};

type TileflowInteractionState = {
  popup: TileflowInteractionTargetRef | null;
};
```

Supplying `interactionState` selects controlled ownership. Supplying
`defaultInteractionState` selects uncontrolled ownership. They may not be combined. In controlled
mode a requested transition is delivered through the framework's state-change surface and does not
become committed until the next controlled state is observed. In uncontrolled mode the same pure
reducer commits it internally before notifying the application.

The initial `TileflowInteractionEvent` discriminants are `target:enter`, `target:leave`,
`target:focus`, `target:blur`, `target:activate`, `popup:open`, and `popup:close`. Every event has a
resolved target, geographic anchor, optional binding ID, normalized JSON-safe data, and input
modality of `pointer`, `touch`, `keyboard`, or `programmatic` when known. It never contains the
native input event.

Event ordering is deterministic:

1. the target input event is emitted before a state-change request;
2. replacing a popup commits `popup:close` for the old target before `popup:open` for the new one;
3. popup open and close events describe committed overlay lifecycle, not an unacknowledged
   controlled-state request;
4. an idempotent state update emits no duplicate popup lifecycle event;
5. target removal closes its overlay before the target is discarded.

A `TileflowInteractionDiagnostic` contains a stable code, `error` or `warning` level, a bounded
message, and an RFC 6901 JSON Pointer path or target reference when available. Initial codes are
`INVALID_DOCUMENT`, `INVALID_ANNOTATION`, `DUPLICATE_ANNOTATION_ID`, `LIMIT_EXCEEDED`,
`UNSUPPORTED_MODE`, `UNSUPPORTED_TARGET`, `MISSING_VIEW`, `INVALID_FIELD`,
`UNSTABLE_FEATURE_IDENTITY`, `STALE_TARGET`, `SEMANTIC_MANIFEST_MISMATCH`, and `OVERLAY_FAILURE`.
Diagnostics never echo raw input values, HTML, URLs with credentials, native events, or framework
nodes. Invalid collection replacement is atomic: the previous valid set remains active unless mode
teardown requires it to be cleared.

## Marker reconciliation and migration

Annotations are reconciled by `id`. Add, update, remove, reorder, clear, and dispose are
deterministic. Reordering alone does not recreate a MapLibre Marker. A compatible update preserves
the Marker instance, focus, and an open popup while updating coordinates, safe default styling,
content, data, and framework view output. Construction, attachment, update, or view-mount failure
rolls back the incomplete operation. Clear and dispose are idempotent.

DOM markers are for small application-owned sets. The runtime does not silently convert them to a
WebGL layer or encode an unstable hard item limit. High-volume or data-owned features remain
MapLibre sources and layers, with only the active tooltip or popup mounted in DOM.

During the alpha migration, each framework adapter normalizes its legacy `markers` prop through an
internal compatibility record. A legacy marker keeps `coordinates`, `color`, and `label`; a
non-empty label retains its current element-title behavior and is not silently reinterpreted as
tooltip content. An unlabeled legacy marker retains the existing `title = id` fallback and remains
non-interactive; the fallback is not invented as tooltip or popup content. Passing both `markers`
and `annotations` is invalid. The new public model uses singular `coordinate`. Removing the legacy
prop or plural field requires a separately announced alpha cutover.

The compatibility layer intentionally changes one formerly silent case: legacy markers or new
interactions passed to image mode produce an unsupported-mode diagnostic and error readiness. They
still do not load MapLibre or an interaction runtime.

## Tooltip, popup, and accessibility behavior

A tooltip contains brief non-interactive content, has the tooltip role, and contains no focusable
controls. It opens for pointer hover and equivalent focus on a DOM target, remains while that target
is hovered or focused, and closes on leave, blur, Escape, target removal, or mode change. DOM targets
use a stable `aria-describedby` relationship. Custom content does not turn a tooltip into a popup.
Applications that provide a custom tooltip view are responsible for keeping its descendants
non-focusable; interactive content belongs in a popup.

A popup contains interactive application UI, is non-modal by default, has an accessible name and a
Tileflow-owned close control, and opens on click, tap, Enter, Space, committed state, or an explicit
controller action. Escape closes it. Focus enters the popup according to the documented framework
policy and returns to the activating DOM target when that target still exists. Map-click and
map-move closing policies are explicit options rather than incidental MapLibre defaults.

A default marker that activates a popup is a keyboard-operable control with the annotation's
`ariaLabel`. A tooltip-only marker has the appropriate focusable described target without claiming
button semantics. A custom marker view remains inside that semantic outer element. Canvas-rendered
features are not automatically keyboard reachable. Semantic POI documentation and release notes
must preserve that limitation until a tested DOM proxy or external feature-navigation strategy is
contracted.

## Stable DOM and CSS surface

Default outer elements expose these stable classes:

- `.tileflow-interaction-marker` and `.tileflow-interaction-marker-content`;
- `.tileflow-interaction-tooltip` and `.tileflow-interaction-tooltip-content`;
- `.tileflow-interaction-popup`, `.tileflow-interaction-popup-content`, and
  `.tileflow-interaction-popup-close`.

They also expose `data-tileflow-interaction="marker|tooltip|popup"` and
`data-tileflow-target-kind="annotation|semantic-feature|style-feature|map"`. Target IDs and feature
properties are not copied into DOM attributes. Named view keys may be exposed through the validated
`data-tileflow-view` attribute.

The default shells accept these inherited CSS custom properties:

- `--tileflow-interaction-marker-color`;
- `--tileflow-interaction-surface` and `--tileflow-interaction-foreground`;
- `--tileflow-interaction-border-color` and `--tileflow-interaction-border-radius`;
- `--tileflow-interaction-shadow` and `--tileflow-interaction-max-width`.

The shells provide safe unbranded fallback values. They do not use Shadow DOM. Classes, attributes,
and custom-property meanings above are compatibility surfaces; internal MapLibre classes and
generated element structure are not. Application-owned nodes keep their own classes and styles.

## SSR, modes, and capture readiness

Interactive runtime work begins only after a framework adapter has mounted and resolved an
interactive style. `mode="image"` never imports MapLibre or attaches `/maplibre`. Interactive props
are excluded from the typed image-mode branch; JavaScript or widened TypeScript input receives the
same structured unsupported-mode diagnostic and moves effective readiness to `error`.

Framework adapters compose two readiness contributors without changing Core's five-event MapLibre
lifecycle:

- effective readiness is `error` when either the map or interaction contributor is in error;
- it is `idle` only when both contributors are idle;
- otherwise it is `loading`.

Opening or replacing a custom view makes the interaction contributor loading until the framework
has committed the view and two current animation frames have completed. Removal invalidates pending
frames. An observable view-mount or overlay failure reports error. This readiness covers framework
commit and two-frame layout stability; it cannot infer completion of application-owned asynchronous
effects, network requests, media, or animation. Applications with those dependencies must retain
their own capture target in loading state until they are ready.

Application capture may therefore include mounted DOM annotations, tooltips, and popups. A raster
Static Map or `mode="image"` cannot contain interactive behavior. This contract does not add a
static callout model; introducing one later belongs to `@tileflow/static` and requires a separate
scene-contract decision.

## Semantic interaction artifact

Semantic targets never bind application code to Tileflow compiler-generated layer IDs. Core owns a
versioned, bounded, post-optimization interaction artifact containing final layer and source
references, source-layer identity, semantic categories, representation kind, normalized property
mapping, stable identity strategy, hit-test and overlap priority, anchor hints, and deduplication
identity. A final Core validation pass rejects every dangling layer, source, source-layer, field, or
identity reference.

The first POI artifact is embedded under versioned private Tileflow metadata in the finalized Style
JSON. That keeps the physical lookup atomic with the exact optimized style, works for direct style
objects and hosted style URLs, and avoids a second fetch or a race between generations. It is not
an application-facing style API: the MapLibre controller validates and consumes it internally.
Runtime manifest version 3 remains strict and unchanged. Moving the artifact to a separate resource
later would require an explicit manifest-version decision and coordinated self-hosted, Hosted,
runtime, and capture support.

Physical IDs in the artifact are opaque runtime implementation details. They are necessarily
inspectable by a browser that downloads the artifact, but applications do not author them, receive
them in public callbacks, or receive compatibility guarantees for them. Public callbacks expose
only normalized semantic features.

POIs are the first semantic domain. Its v1 artifact requires one physical source/source-layer
namespace, so the public `(domain, featureId)` reference cannot collide across sources. The
identity strategy is `maplibre-feature-id-if-present`: it describes how an observed feature ID is
used, not a guarantee that every source feature has one. Pointer hit testing is limited to
manifest-declared layers and
coalesced to at most once per animation frame. Duplicate icon, text, and marker representations are
resolved by manifest identity and deterministic priority. A transient tooltip may use a feature
without stable identity. Controlled popup state, reopening after style replacement, selection, and
deep links fail closed unless the artifact provides a stable string or numeric feature ID.

## Security, scale, and native escape

Plain text is inserted only as text. Tileflow interaction code may not expose `setHTML`, raw HTML,
or framework unsafe-HTML helpers. IDs, strings, coordinates, colors, view names, property counts,
content sizes, and any reviewed URL option are validated and bounded. Framework outlets accept only
nodes created by the consuming application.

Direct MapLibre access remains available through each framework adapter's existing load surface and
through reviewed `/maplibre` controller options. This is an advanced escape, not a second component
wrapper. Native access does not weaken the safe descriptor path or make application-managed
MapLibre instances part of Tileflow's declarative lifecycle guarantee.
