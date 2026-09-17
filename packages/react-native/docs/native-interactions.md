# Native interaction contract

The React Native `Map` accepts portable annotations, semantic interaction bindings, controlled or
uncontrolled interaction state, interaction callbacks and an optional marker renderer. It exposes
normalized targets and bounded data so the application can present its own selected-place
experience. Tileflow does not render a popup, callout, tooltip, sheet, panel or modal.

The mounted implementation uses a private renderer-neutral foundation. It reuses schemas, target
types, diagnostics and state transitions from the ordinary `@tileflow/interactions` root without
importing its browser adapter, DOM implementation or `maplibre-gl`. Native map handles, style
proofs, query ports and owners are not exported by `@tileflow/react-native`.

## Public Map inputs

`Map` is generic over the supplied annotation type, so application data remains typed in
`renderMarker` and `onInteractionEvent`. `annotations` and `interactions` are complete portable
documents, not patches. `interactionState` selects controlled ownership;
`defaultInteractionState` selects uncontrolled ownership. They cannot be supplied together and the
mode cannot change for one mounted Map.

`renderMarker` composes marker content only. Tileflow retains the native marker host, coordinate,
stable key, activation and authoritative accessibility wrapper. Without a renderer, Tileflow shows
a bounded default marker. Each marker has the annotation label, a 44-by-44-point minimum touch
target, button semantics and selected or disabled accessibility state. Custom marker content does
not create another accessible target.

`onInteractionEvent` receives portable activation events for annotations and semantic POIs.
`onInteractionStateChange` requests or reports portable selection-state changes, while
`onInteractionDiagnostic` receives fixed structured diagnostics. Popup-named state remains the
cross-runtime state vocabulary; it does not create native presentation.

## Input ownership and validation

One owner receives complete annotation, interaction-binding and interaction-state inputs. Omitted
annotations and bindings mean empty collections. They are not partial document patches.

The owner uses the portable validators before planning any annotation changes. Invalid annotation
or binding replacements preserve the entire previous valid collection. The initial fallback is an
empty collection. A state replacement is validated independently and preserves its previous valid
value on failure. The initial state fallback is `{popup: null}`.

Inputs are copied and frozen before they become committed values. The portable JSON perimeter
rejects accessors, unsupported prototypes, non-finite numbers, unsafe keys, cycles, shared object
references and oversized documents. The native foundation uses the same portable bounds: at most
1,000 annotations, 100 bindings, 256,000 JSON bytes, depth 64, 20,000 nodes and 50,000 properties per
document. It does not expand large feature sets into annotation hosts.

Supplying `interactionState` establishes controlled ownership. Otherwise the owner is uncontrolled,
optionally seeded by `defaultInteractionState`. Ownership is fixed for that owner. Supplying both
states or changing modes produces `INVALID_DOCUMENT`, never a silent ownership switch. A declared
but invalid initial controlled value retains controlled ownership with the safe empty fallback.
Later default-state values do not reset uncontrolled state.

Diagnostics retain the portable code, level and a fixed bounded message. They do not include raw
validator paths, input values, physical layer identifiers, style JSON, URLs or native error causes.
Replacing callbacks alone does not change snapshots, annotation identities or interaction state.

## Annotation reconciliation

The private annotation plan contains `create`, `update`, `retain`, `remove` and final `order`.
Planning uses stable validated annotation IDs. An existing marker ID retains its future host when
coordinates, data or declarative surfaces change. Its update entry contains the old and new
validated definitions. New IDs create entries; absent IDs produce removals in previous order.
Unchanged IDs are retained, and final order follows the new document.

An invalid replacement produces no partial creates, updates or removals. The mounted adapter uses
the annotation ID as the React and native marker identity, so updates and reordering retain the
compatible host while removal retires it.

## One popup state, two ownership modes

An explicit touch activation can emit `target:activate`. Popup content is still the portable
text/field/view descriptor; the owner does not render it or choose its presentation.

An uncontrolled open or explicit close commits the portable reducer result and notifies the state
listener. In controlled mode it requests the new state through the listener and leaves the
committed state and popup unchanged until the application supplies that state. A requested target
is separate from the currently committed target, so a pending controlled replacement cannot hide
or replace an existing popup.

Removing the open annotation closes its target. Removing the active binding, removing its popup
content, changing its target/category selection or retiring the current semantic style invalidates
the resolved popup and reports `STALE_TARGET`. A syntactically invalid binding document retains the
last valid binding document; it is not treated as a partially applied removal.

For controlled stale state, the resolved popup is hidden immediately, but the application-owned
state is not rewritten. The owner requests a close once for that stale target. The stale reference
cannot resurrect a popup until the application acknowledges a closed or different state. A
semantic reference without a current resolved feature cannot invent an anchor or property set.

## Finalized-style query port

The semantic adapter receives a private lease for exactly one finalized style on one native Map.
The lease supplies its style description, an ownership check and a cancelable asynchronous query
operation. Its ownership check must establish the exact current native style and map, not merely
compare style JSON. Style replacement must invalidate the old lease before another query can use
it.

Each query receives an immutable request containing the touch point, the relevant declared layer
IDs and a result limit. A result envelope must echo the identical private request object. The
platform adapter may construct that envelope only after rechecking native map/style ownership.
Native handles never cross this neutral boundary. The adapter rejects a response associated with
another request or Map even when the physical URLs or layer names happen to match.

The mounted adapter uses the existing public query on the pinned MapLibre React Native Map. Because
its iOS and Android serializers omit physical provenance, Tileflow queries one verified semantic
layer at a time in finalized topmost order. The exact single-layer filter supplies the physical
layer, source and source-layer identity that the neutral adapter verifies again. Results preserve
their within-layer order and share one global 512-feature bound. This adds no Swift, Kotlin or
public query API.

A lease becomes current only after the private Tileflow native-surface owner accepts the matching
style token. A JavaScript style-loaded callback or equal style JSON is insufficient. A newer touch
rotates the query lease; style or source replacement, backgrounding and unmount permanently retire
the old proof. Upstream queries have no abort handle, so cancellation is logical: Tileflow settles
the old operation as stale immediately, stops issuing further layer queries and ignores late
results.

## Semantic POI rules

Only finalized `tileflow:interaction-manifest` metadata with exact version 2 is accepted. The
adapter checks the POI identity convention, deduplication tuple, representation-priority list,
field mapping, category vocabulary, rendered-topmost ordering and pointer-coordinate anchors.
The artifact's `animation-frame` frequency field is its existing version-2 vocabulary; it does not
introduce hover or JavaScript-frame scheduling into the native adapter.

Every declared semantic layer must exist exactly once in that same style and match its declared
source and source-layer. The source must exist. All declared POI representations share one
source/source-layer feature-ID namespace. The adapter bounds the physical style inventory at 4,096
layers and the semantic inventory at 256 declared layers. Missing or inconsistent metadata fails
closed with `SEMANTIC_MANIFEST_MISMATCH`.

Queries include only declared layers relevant to the current POI bindings and category filters.
The port must supply rendered-topmost results. Duplicate representations of one stable feature ID
use the manifest's representation priority, then layer priority, while retaining the earliest
rendered position of that identity. Numeric and string IDs are distinct. Features from undeclared
layers are excluded; an owned feature with a mismatched source or source-layer invalidates the
query rather than being relabeled.

A query processes at most 512 returned features. The port must report overflow rather than silently
truncate a result whose omitted features could change representation selection. The native
boundary emits only the existing semantic POI target shape, without physical layer identities.
Properties are restricted to category, filter rank, size rank, icon, name and type. Category and
rank ranges follow the portable contract; icon/type use bounded snake-case values and text uses the
portable 4,096-character limit. Unknown fields and unsafe property accessors are not forwarded.

Touch is the only activation modality in this adapter. There is no inferred hover, tooltip,
long-press or keyboard behavior. An activation without a stable feature ID may emit a target event,
but requesting popup state then fails with `UNSTABLE_FEATURE_IDENTITY`. Durable identities are safe
integers or nonempty strings of at most 128 characters; no property-based fallback ID is invented.

## Retirement and observation

Each mounted Map has independent inputs, annotation plans, portable selection state, style proofs,
query tickets and subscribers. No authority, Map identity or asynchronous operation is shared
between Maps. Marker and map delivery for one touch share one claim, so a marker activation cannot
also activate a semantic feature underneath it.

Ownership is checked again after asynchronous results and before state publication. Late results
from disposed owners or retired styles are inert. Reentrant cancellation, observer replacement,
exceptions and rejected observer promises cannot transfer ownership to another Map. Disposal is
idempotent and exposes a final safe empty snapshot plus the annotation removal plan.

Selection presentation remains outside this contract. The application owns its layout, focus,
dismissal and accessibility behavior. Device location is also separate and requires an explicit
application-owned permission and provider flow.

## Location composes as an ordinary application annotation

Foreground device location does not extend the interaction owner or semantic query port. An
application that chooses to display its latest validated fix can provide one stable-ID annotation
through the existing `annotations` input, and remove that annotation when permission is revoked or
the provider becomes unavailable. Tileflow does not request permission, start observation or
recenter the camera when that annotation changes.

See [Application-owned foreground location](./native-location.md) for the source-checkout recipe.
The application remains responsible for provider lifetime, privacy policy, recenter controls and
status/error UI, and the recipe does not alter the rule that all selection presentation remains
application-owned.
