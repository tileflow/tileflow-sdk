# `@tileflow/interactions`

Portable annotations, tooltips, popups, state, and interaction bindings for Tileflow maps.

The package has two boundaries:

- `@tileflow/interactions` is pure, JSON-safe, and can be imported during SSR or by build tools.
- `@tileflow/interactions/maplibre` attaches the same model to an existing mounted MapLibre map.

Framework applications normally use `@tileflow/react`, `@tileflow/vue`, or `@tileflow/svelte`
instead of calling the MapLibre controller directly.

## Annotation model

```ts
import type {TileflowAnnotation} from '@tileflow/interactions';

const properties = [
  {
    kind: 'marker',
    id: 'property-42',
    coordinate: [-3.7038, 40.4168],
    ariaLabel: 'Apartment in Madrid',
    data: {price: 320_000, title: 'Sunny apartment'},
    marker: {content: {kind: 'field', field: 'price'}},
    tooltip: {content: {kind: 'field', field: 'title'}},
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies TileflowAnnotation[];
```

`text` and scalar `field` content are inserted as text. `view` is a small dispatch name for a
framework-native render outlet; it never serializes a component tree. Raw HTML is not supported.
Custom tooltip views must remain brief and non-focusable; put buttons, links, forms, and other
interactive content in a popup.

Every new annotation needs a stable `id`, singular `coordinate`, and non-empty `ariaLabel`.
Optional `data` must be recursively JSON-safe. Call `validateTileflowAnnotations` at an untrusted
boundary to receive atomic validation and structured JSON-Pointer diagnostics.

## Popup state

```ts
import {
  initialTileflowInteractionState,
  reduceTileflowInteractionState,
} from '@tileflow/interactions';

const open = reduceTileflowInteractionState(initialTileflowInteractionState, {
  type: 'open-popup',
  target: {kind: 'annotation', id: 'property-42'},
});
```

The first state version owns one popup. Tooltip hover/focus is transient runtime state. Framework
adapters expose controlled and uncontrolled ownership without changing this serializable shape.

## Semantic targets

The first semantic runtime target is `domain: 'poi'`:

```ts
import type {TileflowInteractionBinding} from '@tileflow/interactions';

const interactions = [
  {
    id: 'restaurant-card',
    target: {kind: 'semantic-feature', domain: 'poi', categories: ['food']},
    tooltip: {content: {kind: 'field', field: 'name'}},
    popup: {content: {kind: 'view', name: 'restaurant-card'}},
  },
] satisfies TileflowInteractionBinding[];
```

Tileflow Core embeds a bounded, versioned lookup in the exact finalized style. The MapLibre
runtime validates that lookup, queries only its declared POI layers, deduplicates repeated
representations, and exposes normalized properties instead of physical layer IDs. Stable POI IDs
are required for popup state; an identity-less POI may still show a transient tooltip.

Annotation tooltip and popup surfaces are declared inline on the annotation. Annotation-target
bindings, `style-layer`, and `map` remain reserved branches and currently fail closed with a
structured diagnostic. Keeping those selector discriminants reserved makes future additions
forward-compatible without pretending that an accepted JSON shape is already functional. Call
`validateTileflowInteractionBindings` at an untrusted boundary before attaching bindings.

Direct MapLibre consumers can use `createTileflowMapLibreDomRuntime` for annotations and
`createTileflowMapLibreSemanticDomRuntime` for semantic POIs from the `/maplibre` subpath. Browser
objects and schedulers are injected at attach time, so both subpath imports remain SSR-safe.
`createTileflowMapLibreInteractionCoordinator` joins them around one controlled or uncontrolled
popup state and commits the closing runtime before the opening runtime.

See [`docs/contracts/map-interactions.md`](../../docs/contracts/map-interactions.md) for lifecycle,
accessibility, security, capture, and framework parity requirements.
