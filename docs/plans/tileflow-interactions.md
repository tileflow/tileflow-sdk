# Tileflow Interactions

This ExecPlan is the living implementation record for Tileflow's declarative interaction layer.
Update progress, discoveries, decisions, and validation evidence as work proceeds. Durable behavior
moves to the owning contracts and package READMEs when the plan completes.

This plan records a product and architecture decision. It does not by itself make the proposed API
public, authorize a package release, or replace the compatibility commitments in the current
browser-runtime contract.

## Goal

Allow an application to associate a marker, tooltip, popup, or action with a semantic map target
without knowing the physical MapLibre layers that implement it.

The intended product sentence is:

> Attach a tooltip, popup, or action to any semantic map element without knowing its physical
> MapLibre layers.

Tileflow Interactions is not a branded popup component and not a complete MapLibre wrapper. It is a
declarative interaction system in which markers, tooltips, and popups are views over one shared
target, state, event, and lifecycle model.

The system must be:

- AI-friendly: one canonical, typed, serializable model with stable discriminants and diagnostics;
- framework-native: custom React nodes, Vue scoped slots, and Svelte snippets;
- framework-neutral below the view bridge: target resolution, MapLibre lifecycle, state, events,
  hit testing, and cleanup are implemented once;
- semantic: applications target a POI or building rather than a compiler-generated layer ID;
- flexible: safe defaults, arbitrary framework views, and an explicit native MapLibre escape;
- scale-aware: DOM overlays for small rich sets and MapLibre layers for large feature sets;
- SSR-, image-, and capture-safe;
- independent of hosted platform implementation.

## Product decision

The capability is named **Tileflow Interactions**. An annotation is one kind of interaction target,
not the name of the whole capability.

The public model has two inputs:

1. **Annotations** are application-supplied map items such as property markers.
2. **Interaction bindings** attach behavior to existing semantic map features such as POIs.

Both inputs use the same tooltip, popup, rendering, state, and event infrastructure.

Tileflow owns target resolution, interaction state, anchoring, lifecycle, hit testing, default
accessibility behavior, framework view boundaries, and cleanup. The application owns content,
visual design, and business behavior. MapLibre continues to own the map, camera, projection,
feature rendering, and low-level overlay primitives.

## Final decisions

- Create a focused `@tileflow/interactions` package rather than expanding `@tileflow/core` into
  a DOM runtime or creating a general-purpose `@tileflow/maplibre` wrapper.
- Keep the package root pure and serializable. Evaluating it must not touch browser globals,
  MapLibre, or a framework.
- Put the shared interactive adapter behind `@tileflow/interactions/maplibre`. MapLibre remains a
  peer and is loaded only after mount for an interactive map.
- Keep framework packages responsible only for mounting and unmounting their native views.
- Use one discriminated target model across annotations, semantic features, advanced style-layer
  bindings, and map coordinates.
- Keep annotation definitions JSON-safe. Per-item functions, framework nodes, and raw HTML strings
  are not part of the data model.
- Expose three stable view outlets: marker, tooltip, and popup.
- Keep tooltip and popup as different behavioral contracts, not two aliases for one DOM box.
- Provide safe, minimal, unbranded defaults. Do not create a Tileflow card design system.
- Provide one controlled/uncontrolled interaction-state model and one discriminated event stream.
- Make one active interactive popup per map the simple v1 policy. Persistent multi-callout UI is a
  separate composition problem and remains possible through custom annotations or the native
  escape.
- Keep transient hover and focus internal. A controlled popup or durable selection requires a
  serializable target reference and a stable feature identity.
- Add a post-optimization semantic interaction manifest. Public applications never receive or
  depend on compiler-generated physical layer IDs.
- Deliver semantic interactions for POIs first. Buildings, transit, roads, and polygons follow
  only after the POI contract is proven.
- Keep high-volume POIs in WebGL and mount only the active tooltip or popup in DOM.
- Do not auto-convert between DOM markers and WebGL layers. The representation is explicit and
  predictable.
- Treat static callouts as a separate concept. Interactive tooltip or popup props may not be
  silently ignored in image mode.
- Never use unsanitized HTML as a convenience path. Plain text and application-owned framework
  nodes are the supported content paths.
- Preserve direct MapLibre access as an explicit advanced escape hatch.

## Baseline

This plan begins during the existing AI-first map-contract cutover. The worktree contains a large
owner-directed migration which is in scope for that plan and must not be reset or rewritten by this
work.

The current interaction baseline is deliberately small:

- `TileflowAnnotation` is the single application-owned marker input across React, Vue, and Svelte.
- The shared interaction runtime reconciles MapLibre Marker instances by annotation ID.
- React, Vue, and Svelte construct MapLibre Marker instances and use the required annotation
  `ariaLabel` for accessible marker titles.
- The browser runtime contract explicitly lists entities, selection, feature state, clustering,
  popups, business events, framework-independent DOM, and a new runtime package as non-goals
  pending a separate product decision.
- Interactive MapLibre loading is already dynamic and SSR-safe.
- Image rendering is a separate path and does not provide interactive overlays.
- Core's physical planner is free to combine or split physical style layers; those IDs are not a stable
  public semantic interface.

The first implementation phase must update the relevant contracts before any new public runtime
surface is treated as supported.

## Scope

### Included

- application annotations;
- default and custom markers;
- first-class tooltips;
- rich popups;
- controlled and uncontrolled popup state;
- a common event stream;
- React, Vue, and Svelte view bridges;
- MapLibre native options and map access;
- keyed annotation reconciliation;
- capture readiness for DOM interaction views;
- semantic feature bindings;
- post-planning semantic target metadata;
- POI hit testing, normalization, prioritization, anchoring, and deduplication;
- explicit diagnostics for incompatible image/static use.

### Not included

- a hosted API, dashboard, database, credential, or deployment service;
- a full MapLibre component wrapper;
- a framework-independent rich UI toolkit;
- a large JSON UI or card-description DSL;
- arbitrary application business actions encoded inside Tileflow data;
- raw HTML rendering;
- physical generated layer IDs as the normal public target API;
- automatic DOM-to-WebGL representation changes;
- clustering in the first interaction release;
- semantic support for every cartographic domain before POIs are stable;
- pretending canvas-rendered features are keyboard accessible before a tested navigation strategy
  exists;
- interactive behavior in a raster static image.

## Terminology

| Term                          | Meaning                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Annotation                    | An application-owned map item with a stable ID and geographic coordinate.                 |
| Semantic feature              | A rendered feature known by domain and normalized properties, such as a POI.              |
| Target                        | The annotation, semantic feature, advanced style feature, or map location being acted on. |
| Binding                       | A declarative rule that associates behavior with a class of targets.                      |
| Tooltip                       | Brief, non-interactive information opened by pointer hover or keyboard focus.             |
| Popup                         | Rich, interactive content opened by activation or application state.                      |
| Callout                       | Persistent visible content; in static output it is visual only, never interactive.        |
| View outlet                   | The framework boundary used to render a marker, tooltip, or popup.                        |
| Semantic interaction manifest | Private runtime metadata connecting semantic domains to final style layers.               |

## Architecture

```text
@tileflow/core
  semantic authoring + compiler + physical planner
                    |
                    | semantic interaction manifest
                    v
@tileflow/interactions
  pure model + schema + state reducer + diagnostics
                    |
                    v
@tileflow/interactions/maplibre
  keyed annotations + hit testing + anchoring + popup/tooltip lifecycle
                    |
          +---------+---------+
          |         |         |
          v         v         v
 @tileflow/react  @tileflow/vue  @tileflow/svelte
 render props     scoped slots   snippets
```

### Package responsibilities

| Owner                             | Responsibilities                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `@tileflow/core`                  | Semantic domain ownership and post-planning interaction metadata.                     |
| `@tileflow/interactions`          | JSON-safe types, schemas, target refs, reducer, events, and diagnostics.              |
| `@tileflow/interactions/maplibre` | Projection, hit testing, DOM overlay lifecycle, anchors, and keyed registry.          |
| Framework adapters                | Mount native custom views and forward state/events without duplicating runtime logic. |
| Application                       | Content, design system, business actions, and controlled state when needed.           |

The new package requires an explicit update to the SDK responsibility contract, workspace package
list, export-boundary tests, peer checks, package README, and public smoke matrix. It must not be
re-exported through the pure `@tileflow/core` root.

## Public model

Phase 1 froze the following serializable shape. The exact exported names, executable schemas,
limits, and diagnostics live in the durable interaction contract and package README.

```ts
type TileflowInteractionJsonValue =
  | null
  | boolean
  | number
  | string
  | TileflowInteractionJsonValue[]
  | {[key: string]: TileflowInteractionJsonValue};

type TileflowInteractionCoordinate = readonly [longitude: number, latitude: number];

type TileflowInteractionContent =
  | {kind: 'text'; text: string}
  | {kind: 'field'; field: string}
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
    tooltip?: {
      content: TileflowInteractionContent;
    };
    popup?: {
      content: TileflowInteractionContent;
    };
  };

type TileflowInteractionTarget =
  | {kind: 'annotation'; id: string}
  | {
      kind: 'semantic-feature';
      domain: string;
      categories?: readonly string[];
    }
  | {
      kind: 'style-layer';
      layerId: string;
    }
  | {
      kind: 'map';
    };

type TileflowInteractionBinding = {
  id: string;
  target: TileflowInteractionTarget;
  tooltip?: {
    content: TileflowInteractionContent;
  };
  popup?: {
    content: TileflowInteractionContent;
  };
};
```

The serialized target above is a selector. Renderers receive a separate resolved-target union
containing the matched annotation or normalized feature, geographic coordinate, effective content
descriptor, and binding ID. The exact generic surface frozen in Phase 1 must support both ergonomic
annotation contexts such as `{annotation, close}` and discriminated semantic contexts such as
`{target: {kind: "semantic-feature", feature}, close}` without casts.

The normal API uses `annotation` and `semantic-feature`. `style-layer` is an explicitly native,
less portable escape for application-owned MapLibre styles; it is not how Tileflow-authored
domains are exposed.

In v1, annotation surfaces live inline on `TileflowAnnotation`. The `annotation` selector branch is
valid for forward compatibility and target references, but an annotation-target entry inside
`interactions` is reserved until precedence with inline surfaces has a separate decision.

### React target

```tsx
const annotations = [
  {
    kind: 'marker',
    id: 'property-42',
    coordinate: [-3.7, 40.4],
    ariaLabel: 'Apartment in Madrid',
    data: property,
    tooltip: {
      content: {kind: 'text', text: 'EUR 320,000'},
    },
    popup: {
      content: {kind: 'view', name: 'property-card'},
    },
  },
] satisfies readonly TileflowAnnotation<Property>[];

<TileflowMap
  annotations={annotations}
  renderMarker={({annotation}) => <PriceMarker price={annotation.data.price} />}
  renderTooltip={({annotation}) => <PriceTooltip property={annotation.data} />}
  renderPopup={({annotation, close}) => <PropertyCard property={annotation.data} onClose={close} />}
/>;
```

The same map may bind a view to existing semantic POIs:

```tsx
<TileflowMap
  interactions={[
    {
      id: 'poi-details',
      target: {
        kind: 'semantic-feature',
        domain: 'poi',
        categories: ['food-drink', 'retail'],
      },
      tooltip: {
        content: {kind: 'field', field: 'name'},
      },
      popup: {
        content: {kind: 'view', name: 'poi-card'},
      },
    },
  ]}
  renderPopup={({target, close}) => <PoiCard poi={target.feature} onClose={close} />}
/>
```

Exact generic narrowing must make `annotation.data` and normalized semantic feature properties
useful without casts. Named custom views remain small dispatch keys; Tileflow does not describe a
component tree in JSON.

### Framework parity

The public capability is the same in all three adapters:

| Capability   | React           | Vue                   | Svelte            |
| ------------ | --------------- | --------------------- | ----------------- |
| Marker view  | `renderMarker`  | scoped `marker` slot  | `marker` snippet  |
| Tooltip view | `renderTooltip` | scoped `tooltip` slot | `tooltip` snippet |
| Popup view   | `renderPopup`   | scoped `popup` slot   | `popup` snippet   |
| State change | callback        | emit                  | callback/event    |
| Event stream | callback        | emit                  | callback/event    |

The framework adapters may differ syntactically, but their render context, target narrowing,
state transitions, event order, errors, and cleanup must be contract-tested as equivalent.

An arbitrary React tree cannot become a Vue component or Svelte snippet. Portability applies to
the data, target, state, event, and lifecycle contracts. The small native view definition is the
only intentionally framework-specific part.

## State and events

The map supports either controlled or uncontrolled interaction state:

```tsx
<TileflowMap
  interactionState={state}
  onInteractionStateChange={setState}
  onInteractionEvent={handleInteractionEvent}
/>
```

`defaultInteractionState` provides the uncontrolled alternative. A caller may not partially mix
controlled and uncontrolled ownership.

The initial serializable state needs only one open popup target. Hover and focus remain transient
runtime state so pointer movement does not force application renders.

```ts
type InteractionTargetRef =
  | {kind: 'annotation'; id: string}
  | {
      kind: 'semantic-feature';
      domain: string;
      featureId: string | number;
    }
  | {
      kind: 'style-feature';
      layerId: string;
      featureId: string | number;
    }
  | {
      kind: 'map';
      coordinate: Coordinate;
    };

type TileflowInteractionState = {
  popup: InteractionTargetRef | null;
};
```

Selection may extend this model only after feature identity and feature-state behavior receive a
separate contract decision.

One discriminated event stream avoids per-item callbacks and domain-specific event proliferation.
The initial event types are:

- `target:enter`;
- `target:leave`;
- `target:focus`;
- `target:blur`;
- `target:activate`;
- `popup:open`;
- `popup:close`.

Every event contains its target, geographic anchor, original input modality when available, and
the normalized annotation or feature data. Event order is deterministic and documented.

## Tooltip and popup behavior

### Tooltip

- contains brief, non-interactive information;
- opens on pointer hover and equivalent DOM focus;
- remains open while the pointer is over the target or target retains focus;
- closes on pointer leave, blur, Escape, target removal, or mode change;
- uses an ID and `aria-describedby` relationship for DOM targets;
- uses the tooltip role;
- never contains focusable controls;
- does not become a popup merely because custom content was supplied.

### Popup

- contains rich interactive application UI;
- opens on click, tap, Enter, Space, controlled state, or an explicit API action;
- has an accessible name and close action;
- closes on Escape and returns focus to the activating DOM target when it still exists;
- documents map-click and map-move closing policies explicitly;
- is non-modal by default;
- survives a keyed target update when its identity has not changed;
- closes deterministically when the target disappears or becomes invalid.

Canvas-rendered features are not automatically reachable by keyboard. POI launch documentation
must state this limitation until Tileflow has a tested DOM proxy or external feature-navigation
strategy.

## Personalization model

Tileflow provides three levels of customization:

1. **Safe defaults.** A default marker, text tooltip, and minimal unbranded popup shell work from
   serializable descriptors.
2. **Native framework views.** Render props, slots, and snippets can return arbitrary application
   components, including buttons, forms, animation, and design-system primitives.
3. **Native escape.** Advanced users can access reviewed MapLibre options and the map instance.

Default shells expose stable classes, data attributes, and CSS custom properties. The exact names
are frozen in the interaction contract before publication. Shadow DOM is not used because it would
make application styling and framework composition unnecessarily difficult.

Maximum flexibility does not mean universal serialization. Custom framework UI is intentionally
not portable as executable code, and interactive UI cannot be represented in a static raster.

## Semantic interaction manifest

Core must emit versioned post-optimization metadata that allows the runtime to resolve a semantic
target without exposing physical implementation details to the application.

For each supported domain the manifest records:

- final interactive style layer IDs;
- source and source-layer identity where required;
- semantic category mapping;
- geometry and representation kind;
- normalized public property mapping;
- stable feature identity strategy, including `promoteId` where applicable;
- hit-test and overlap priority;
- anchor hints;
- deduplication identity across icon, marker, and text representations.

The manifest is an internal artifact between Core and the interaction runtime. A final validation
pass rejects references to missing layers, sources, source layers, fields, or identity
configuration. Public callbacks receive normalized semantic features, not the physical manifest.

The semantic manifest depends on the AI-first map-contract work establishing one finalized,
manifest-first style output. POI implementation may not build a second competing pre-optimization
mapping.

## POI-first delivery

POIs are the first semantic target because they demonstrate the main product distinction:
application code asks for a POI rather than a style layer.

The POI runtime:

1. resolves the final interactive layers for the binding;
2. limits hit testing to those layers;
3. performs pointer hit testing at most once per animation frame;
4. normalizes feature properties into one POI shape;
5. deduplicates multiple visual representations of the same POI;
6. resolves overlap by documented semantic and render priority;
7. anchors a tooltip or popup to the point feature;
8. mounts only the active DOM overlay;
9. emits the same target events used by annotations.

A transient POI tooltip may work without a durable feature ID. Controlled popup state, selection,
deep linking, and reopening after style changes require a stable feature ID and fail closed when
that identity is unavailable.

The v1 public target reference is `(domain, featureId)`, so one POI artifact is limited to a single
source/source-layer namespace. Its identity strategy is explicitly conditional on a MapLibre
feature ID being present; the compiler does not claim that every upstream feature has one.

Later line and polygon targets use the activation coordinate or a documented nearest-geometry
anchor. They are not silently reduced to an arbitrary centroid.

## Scale and performance

- DOM markers are intended for small, rich, application-owned sets.
- Large datasets remain MapLibre sources and layers.
- A semantic feature interaction mounts one active tooltip or popup, not one DOM node per feature.
- Annotation updates reconcile by ID and update compatible instances in place.
- Reordering an annotation array alone does not recreate markers.
- Hit testing is restricted to declared semantic layers and coalesced per animation frame.
- Overlap resolution is deterministic.
- Cleanup, mode changes, and failed construction are rollback-safe and idempotent.
- The API never silently switches an annotation from DOM to WebGL based on item count.
- Documentation gives practical DOM-marker guidance without encoding an unstable hard limit into
  runtime behavior.

Collision-aware multi-marker layout is not part of the first release. MapTiler already offers a
strong logic-only Marker Layout; Tileflow should add a competing abstraction only when a concrete
product need cannot be met by WebGL symbols or a compatible adapter.

## SSR, image, static, and capture behavior

- Importing `@tileflow/interactions` is safe in Node and SSR.
- Importing framework packages during SSR does not evaluate MapLibre.
- `mode="image"` never loads the interactive runtime.
- Interactive annotations or bindings passed to image mode produce an explicit type or runtime
  diagnostic; they are never silently discarded.
- If static visible content is introduced later, it uses a separate `callout` model and has no
  hover, focus, click, or close semantics. The annotation MVP does not add that model.
- Application capture may include mounted DOM markers, tooltips, and popups.
- Opening or replacing a custom interaction view moves capture readiness to loading until the view
  has mounted and two stable animation frames have completed.
- A failed custom view or MapLibre overlay moves readiness to error rather than capturing partial
  UI.

## Security and accessibility

- Plain text is inserted as text, never HTML.
- The framework view boundary accepts only application-owned nodes.
- Internal code may not use `setHTML`, `dangerouslySetInnerHTML`, `v-html`, or Svelte
  `{@html}` for interaction content.
- IDs, coordinates, colors, class tokens, URLs, property counts, and content sizes are validated
  and bounded.
- Original input events are not serialized or echoed into diagnostics.
- Default markers that activate a popup are keyboard-operable controls with accessible names.
- Tooltip and popup semantics are tested independently.
- Escape, focus return, teardown, target removal, and mode changes have explicit tests.
- Canvas feature accessibility limitations remain visible in documentation and release notes.

## Comparison with MapTiler

This comparison was checked against MapTiler's official documentation on 2026-08-25. It compares
MapTiler's available SDK with Tileflow's implemented alpha interaction architecture.

| Aspect                | MapTiler SDK                                                       | Tileflow Interactions                                | Product reading                                      |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| Marker                | Imperative Marker instance                                         | Declarative annotations reconciled by ID             | Tileflow owns UI lifecycle.                          |
| Popup                 | Imperative Popup with text, HTML, or DOM content                   | Descriptor or native framework view                  | Same visual ceiling; simpler Tileflow composition.   |
| Tooltip               | Commonly composed from Popup and pointer events                    | Separate accessible behavior contract                | Tileflow makes intent explicit.                      |
| Custom UI             | Arbitrary DOM and CSS                                              | React/Vue/Svelte views plus native escape            | Raw flexibility is equivalent.                       |
| Feature interaction   | Map events and rendered-feature queries, normally using layer IDs  | Semantic targets resolved through a private manifest | Tileflow hides compiled style structure.             |
| POIs                  | Supported through data, layers, queries, and examples              | `domain: "poi"` binding                              | Capability exists in both; abstraction differs.      |
| Framework integration | SDK JS lifecycle is integrated by application code and tutorials   | First-party equivalent view bridges                  | Tileflow shares behavior across frameworks.          |
| State                 | Primarily instance and application owned                           | Controlled/uncontrolled serializable state           | Tileflow makes application synchronization explicit. |
| Events                | Low-level map, layer, Marker, and Popup events                     | One normalized target event stream                   | Tileflow expresses domain intent.                    |
| Marker collision      | Mature logic-only Marker Layout                                    | Deferred; prefer WebGL for large sets                | MapTiler has the current advantage.                  |
| Static maps           | Mature hosted Static Maps API with visual markers                  | Separate static contract; no interactive raster UI   | MapTiler has the current platform advantage.         |
| Services              | Tiles, styles, geocoding, terrain, static, and Cloud APIs          | No hosted platform in this repository                | Tileflow does not compete on infrastructure.         |
| AI authoring          | Requires procedural instances, listeners, DOM, and style knowledge | Small serializable schema and discriminated contexts | Tileflow's intended differentiator.                  |
| Maturity              | Shipped SDK with extensive documentation and examples              | Implemented alpha; local release gates green         | MapTiler has the current delivery advantage.         |

Relevant MapTiler sources:

- [Markers and popups](https://docs.maptiler.com/sdk-js/api/markers/)
- [Map events and layer-specific interaction](https://docs.maptiler.com/sdk-js/api/map/)
- [POI information on click](https://docs.maptiler.com/sdk-js/examples/pois-info/)
- [Marker Layout](https://docs.maptiler.com/sdk-js/modules/marker-layout/)
- [React integration tutorial](https://docs.maptiler.com/react/)
- [Static Maps API](https://docs.maptiler.com/cloud/api/static-maps/)

Tileflow must not claim that MapTiler lacks popup customization or POI interaction. The defensible
position is:

> MapTiler provides the primitives and mapping platform used to build an interaction. Tileflow
> lets an application declare which semantic elements are interactive and render their UI in the
> application's framework.

Tileflow may consume MapTiler tiles or services through MapLibre-compatible sources. The products
are not necessarily mutually exclusive.

## Implementation phases

### Phase 1: contract and package boundary

- Approve this product direction.
- Add a durable interaction contract describing accepted public behavior.
- Update the browser-runtime non-goals and SDK responsibility contract.
- Freeze package ownership, exports, peer direction, terminology, target union, content
  descriptors, render contexts, state, events, diagnostics, and CSS surface.
- Add dependency-boundary and SSR-evaluation tests before runtime implementation.

Exit condition: public names and ownership are reviewable without framework or MapLibre code.

### Phase 2: pure model and reducer

- Create `packages/interactions`.
- Implement exact runtime schemas and matching TypeScript types.
- Publish machine-readable schema/reference data for agents.
- Implement target references, controlled/uncontrolled state transitions, event ordering, and
  structured diagnostics.
- Add limits and security validation.

Exit condition: the complete serializable model and reducer pass in Node without DOM or MapLibre.

### Phase 3: keyed annotation runtime

- Implement the shared MapLibre annotation registry.
- Reconcile create, update, remove, and reorder by stable ID.
- Preserve focus, open popup identity, and compatible Marker instances across updates.
- Roll back partial construction and make clear/dispose idempotent.
- Expose only `annotations`, with singular `coordinate`, required `ariaLabel`, and separate tooltip
  content.

Exit condition: keyed updates no longer replace unchanged instances and every framework exposes the
same annotation-only input.

### Phase 4: tooltip, popup, and framework views

- Implement safe default marker, tooltip, and popup shells.
- Implement shared tooltip and popup lifecycle.
- Add React render props, Vue scoped slots, and Svelte snippets.
- Add controlled and uncontrolled popup state.
- Add the normalized event stream.
- Add CSS customization and native MapLibre escape surfaces.
- Ship one equivalent property-card example for each framework.

Exit condition: the same annotation data and state model powers native custom UI in all three
frameworks with equivalent behavior.

### Phase 5: readiness, static boundaries, documentation, and annotation MVP

- Integrate view mount/unmount with capture readiness.
- Diagnose incompatible image/static use.
- Document accessibility, security, scale, SSR, and native escape behavior.
- Add framework package, packed-consumer, peer, browser, and capture tests.
- Complete public-package README and migration documentation.

Exit condition: the annotation MVP satisfies its release gates and can be evaluated independently
of semantic POI work.

### Phase 6: post-planning semantic manifest

- Extend the compiler's finalized manifest with versioned interaction metadata.
- Define normalized POI properties and categories.
- Establish stable POI identity and deduplication rules.
- Validate every semantic-to-physical reference after physical planning.
- Keep physical IDs private to the runtime artifact.

Exit condition: fixtures can resolve POI semantic targets across physical-planner layer splitting,
combining, reordering, and style inheritance without application-visible layer IDs.

### Phase 7: semantic POI interactions

- Implement scoped hit testing and pointer coalescing.
- Normalize and deduplicate POI features.
- Implement priority and anchor resolution.
- Feed POIs through the same tooltip, popup, state, event, and renderer contracts as annotations.
- Add real-style browser, capture, overlap, missing-ID, and performance tests.

Exit condition: an application renders a custom POI popup using only `domain: "poi"` and normalized
feature data.

### Phase 8: validated expansion

- Evaluate buildings, transit, roads, lines, and polygons in that order of demonstrated demand.
- Design canvas feature keyboard navigation before claiming semantic-feature accessibility.
- Add selection and feature-state only after stable identity is proven.
- Evaluate application-owned style-layer bindings.
- Evaluate collision layout, clustering, and persistent callouts as separate capabilities.

Exit condition: each new capability has a distinct product contract and does not broaden the
interaction package into a complete MapLibre wrapper.

## Required test matrices

### Pure contract

- every target discriminant and invalid combination;
- text, field, and named-view content;
- duplicate and malformed IDs;
- coordinate, size, string, property, class, and URL limits;
- controlled versus uncontrolled ownership;
- deterministic transition and event ordering;
- Node import with throwing browser-global getters.

### Annotation runtime

- empty, add, update, remove, reorder, and replace;
- unchanged identity preserves Marker instance;
- open popup survives compatible data and coordinate updates;
- removal closes overlays and returns focus safely;
- partial create, attach, view-mount, and update failure rollback;
- clear/dispose idempotence;
- mode changes and late dynamic imports.

### Framework parity

- equivalent render contexts and target narrowing;
- default and custom marker, tooltip, and popup;
- latest callback/slot/snippet values without unintended map recreation;
- controlled and uncontrolled state;
- event order;
- SSR, hydration, unmount, and error behavior;
- built package exports and declaration tests.

### Accessibility and security

- pointer, click, tap, Enter, Space, focus, blur, and Escape;
- tooltip relationship and absence of focusable tooltip children;
- popup accessible name, close action, focus entry, and focus return;
- no unsafe HTML path in built packages;
- hostile text and property fixtures;
- canvas-feature limitation documented and not misrepresented.

### Semantic POI

- inherited, split, combined, reordered, hidden, and absent POI layers;
- icon, text, and marker representation deduplication;
- overlapping categories and deterministic priority;
- stable, missing, duplicate, and remapped feature IDs;
- normalized required and optional properties;
- point anchors and world-wrap behavior;
- at-most-once-per-frame hit testing;
- style replacement and manifest generation changes.

### Delivery and capture

- interactive dynamic import and supported MapLibre peer matrix;
- image mode with no MapLibre evaluation;
- explicit diagnostics for interactive props in image/static mode;
- default and custom view readiness;
- local element and viewport capture;
- packed React, Vue, and Svelte consumers;
- public tarball and publication dry-run when release work begins.

## Release gates

### Annotation MVP

- A property-card example contains no MapLibre import, listener, layer ID, manual DOM mount, or
  cleanup.
- React, Vue, and Svelte produce equivalent target data, event order, and visible behavior.
- Keyed updates preserve compatible Marker instances, focus, and an open popup.
- Tooltip and popup accessibility tests are green.
- No unsafe HTML convenience exists.
- SSR and image imports do not evaluate MapLibre.
- Image/static incompatibilities fail visibly.
- Capture waits for custom views and never records partial UI as idle.
- `pnpm check` and `pnpm build` pass.

### Semantic POI

- Application code uses no physical Tileflow layer ID.
- The post-planning manifest has no dangling layer, source, field, or identity reference.
- POI properties and identity behavior are documented and typed.
- Multiple render representations deduplicate deterministically.
- Transient behavior without a stable ID and durable behavior with one are explicitly separated.
- Large POI sets do not produce one DOM node per feature.
- Real browser, physical-planner equivalence, performance, capture, and framework parity tests pass.
- `pnpm check` and `pnpm build` pass.

Publication work additionally runs `pnpm run smoke:capture-public` and the public dry-run required
by `PUBLISHING.md`.

## Success criteria

- A human or coding agent can add a custom property popup from one local example without learning
  MapLibre Marker or Popup lifecycle.
- Changing the compiled physical layer structure does not require an application code change.
- One annotation or semantic POI definition feeds all framework adapters.
- Custom UI has no meaningful visual ceiling relative to direct DOM composition.
- Advanced users can reach MapLibre without making native MapLibre knowledge part of the normal
  path.
- Tileflow documentation can explain tooltip, popup, and POI interaction from one coherent mental
  model.

## Risks and mitigations

| Risk                               | Mitigation                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Becoming a full MapLibre wrapper   | Limit the package to targets, views, state, events, and lifecycle.              |
| Duplicating framework logic        | Contract-test one shared MapLibre runtime and keep adapters view-only.          |
| Leaking planner details            | Emit a private, validated post-planning semantic manifest.                      |
| DOM performance regression         | Keep large feature sets in WebGL and mount only active overlays.                |
| Unstable POI identity              | Gate controlled popup, selection, and deep links on explicit stable IDs.        |
| Unsafe rich content                | Support text and application-owned nodes; omit raw HTML APIs.                   |
| Overstated accessibility           | Separate DOM and canvas guarantees and fail release claims honestly.            |
| Static behavior ambiguity          | Use a separate callout model and diagnose interactive image props.              |
| Competing with active cutover work | Build on the finalized manifest; do not create a parallel compiler path.        |
| Weak competitive claim             | Position semantic authoring and framework lifecycle, not raw popup flexibility. |

## Progress

- [x] Product model analyzed.
- [x] Repository architecture and current marker implementation analyzed.
- [x] MapLibre and MapTiler interaction capabilities compared.
- [x] Package boundary, semantic POI direction, and phased delivery selected.
- [x] ExecPlan captured.
- [x] Durable interaction contract implemented and aligned with package documentation.
- [x] Package and schema implemented.
- [x] Keyed annotation runtime and marker compatibility implemented.
- [x] Framework views and annotation MVP complete.
- [x] Semantic manifest complete.
- [x] POI interactions complete.
- [ ] Expansion decisions reviewed from evidence.
- [x] Local interaction release gates green; public npm publication remains interlocked.

## Validation evidence

Validation completed locally on 2026-08-25:

| Evidence                                                                                                                                          | Result                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm --filter @tileflow/interactions verify`                                                                                                     | 75/75 interaction tests passed.                                                                   |
| `pnpm --filter @tileflow/react verify`                                                                                                            | 30/30 React tests passed.                                                                         |
| `pnpm --filter @tileflow/vue verify`                                                                                                              | 19/19 Vue tests passed.                                                                           |
| `pnpm --filter @tileflow/svelte verify`                                                                                                           | 13/13 Svelte tests passed.                                                                        |
| `TILEFLOW_RUN_BROWSER_TESTS=1 pnpm --filter @tileflow/capture exec tsx --test --test-concurrency=1 test/react-semantic-interactions-vite.test.ts` | 1/1 real MapLibre semantic POI browser test passed.                                               |
| `pnpm check`                                                                                                                                      | Passed release, architecture, type, lint, format, and all package verification gates.             |
| `pnpm build`                                                                                                                                      | 12/12 workspace package builds passed.                                                            |
| `pnpm run smoke:capture-public`                                                                                                                   | Passed packed-consumer capture with all 12 public tarballs, including `@tileflow/interactions`.   |
| `pnpm run publish:alpha:dry-run`                                                                                                                  | Passed source validation, package build, full check, and public capture smoke without publishing. |

No package was published. `PUBLIC_RELEASE_BLOCKERS.json` and the repository publication interlock
remain in place.

## Decision log

- **2026-08-25:** Choose Tileflow Interactions rather than a standalone Tileflow Popup API.
- **2026-08-25:** Treat annotations and semantic features as two inputs to one interaction system.
- **2026-08-25:** Choose a pure `@tileflow/interactions` package with a MapLibre subpath and thin
  framework view bridges.
- **2026-08-25:** Choose POIs as the first semantic domain and keep their base rendering in WebGL.
- **2026-08-25:** Define Tileflow's differentiation as semantic, declarative, framework-native, and
  AI-friendly authoring, not greater raw DOM flexibility than MapTiler.
- **2026-08-25:** Embed the bounded semantic lookup in private metadata on the exact finalized Style
  JSON instead of introducing a second resource or changing runtime manifest version 3.
- **2026-08-25:** Coordinate annotation and semantic runtimes below the framework bridges so popup
  replacement always closes the previous owner before opening the next one.
- **2026-08-25:** Keep annotation tooltip and popup surfaces inline for v1; reserve annotation
  selectors inside `interactions` until precedence is explicit.
- **2026-08-25:** Use the conditional `maplibre-feature-id-if-present` POI identity strategy and
  constrain v1 public POI references to one source/source-layer namespace.
- **2026-08-25:** Allow a missing source-layer only for exact-match GeoJSON runtime manifests;
  Core's vector artifact continues to require one.
- **2026-08-25:** Make cross-runtime popup replacement transactional and rollback-safe so the
  public state cannot claim an overlay transition that failed to commit.

## Constraints and coordination

- Do not reset, discard, or rewrite the existing owner-directed worktree migration.
- Coordinate this plan with `ai-first-map-contract.md`; the semantic manifest consumes its
  finalized runtime artifact.
- Do not add hosted platform implementation or deployment infrastructure to this repository.
- Keep third-party licenses and notices with the package or source they cover.
- Do not infer a project-level source license.
- Update focused tests while iterating.
- Before completing a substantial implementation phase, run `pnpm check` and `pnpm build`.
- For publication changes, also run the public capture smoke and publication dry-run.
- Move stable behavior into the browser-runtime contract, SDK-responsibility contract, the new
  package README, and framework READMEs before marking this plan complete.
