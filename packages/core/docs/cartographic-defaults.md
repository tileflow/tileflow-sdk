# Cartographic defaults

Start with the [Core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
for installation and a complete map. Semantic modules supply a coordinated starting appearance;
module styles and owner-local render targets can replace those decisions.

## Roads and roundabouts

`roads({rampOrder: 'below-roads'})` draws ramp fills before receiving carriageways in the same
surface, bridge or tunnel band. This prevents a rounded ramp endpoint covering the receiving
road. Choose `'by-class'` to retain class-based fill order instead. Explicit render-stack moves
remain available; ramp fills have targets `roads.classes.<class>.<structure>.rampFill` when the
separate ramp order is active. A selector refinement replaces that target's complete filter, so
retain its ramp eligibility when writing a custom selector. Module class fill styles apply to
both passes; a refinement of a specific `fill` or `rampFill` target changes only that pass.

Core owns circular-road geometry. Physical inner and outer radii take precedence when provided
by the source. Otherwise the ring follows the enabled class's effective surface width, including
width treatments. The default border follows the actual casing width and gap. Hidden classes and
surface fills do not leave orphan rings. Ring colors remain semantic palette choices, independently
replaceable through `roundabouts.fill.strokeColor` and `roundabouts.casing.strokeColor`; they do
not copy arbitrary per-class color curves.

Metric scaling and base-2 width curves retain their native interpolation. Other width curves are
sampled into the shared geometry curve: numeric widths target 0.1-pixel error, stopping refinement
once intervals reach 1/32 zoom; very large widths can exceed that target. Feature-dependent width
expressions retain authored and integer zoom stops without adaptive refinement, keeping expression
size bounded. Their interpolation between stops is approximate, with no universal pixel-error bound.
Step changes complete at the authored zoom, with the transition confined to the preceding 0.000001
zoom interval. Explicit circle radius and stroke-width expressions bypass this sampling when exact
independent behavior is required.

`roundabouts.fallbackWidth` replaces only the fallback carriageway width in pixels;
`roundabouts.borderWidth` replaces the total extra width around the ring. Existing circle styles
can independently replace radius, stroke width, color, opacity and zoom range. For example, this
module fragment retains geometric defaults but gives rings a deliberate fixed border:

<!-- docs:check -->

```ts
import {roads} from '@tileflow/core';

export const customRoads = roads({
  rampOrder: 'by-class',
  roundabouts: {borderWidth: 0},
});
```

## Ground surfaces

The land module draws broad cover and park surfaces before mapped grass, meadow, scrub and
flowerbed details. Parking, sports pitches, tracks, playgrounds and zoos follow those details so
they remain visible inside broad green polygons. Both Tileflow World and OpenMapTiles' combined
park source follow this order. These defaults do not change the map's colors, opacity or textures.

A thematic map can give a park tint more prominence through the existing render stack. This
module fragment is ready to use as `modules.land` in a map:

<!-- docs:check -->

```ts
import {land, refineRenderTarget, withRenderStack} from '@tileflow/core';

export const thematicLand = withRenderStack(land(), {
  parkTint: refineRenderTarget({
    target: 'land.landcover.urbanPark.fill',
    placement: 'above-land',
  }),
});
```

Refinements target contributions that the map actually draws. Disabling a target and retaining
a refinement for it is an authoring error. Disabling the whole module removes its contributions
and its render stack. The built-in surface order needs no target anchors and works when individual
surfaces are hidden.

## Street names on the ground or in the foreground

`labels({roadPlacement: 'foreground'})` is the default. Names draw above buildings and vegetation.
Use `roadPlacement: 'ground'` to draw them above flat building footprints and below raised
buildings, with text aligned to the map surface. Flat footprints must not clip the glyphs.
Shields and junction numbers remain in the foreground. Ground placement does not require the
buildings module: street names still draw when buildings are disabled.

This module fragment keeps the normal language selection and road-class filters while opting
into ground names. Individual symbol styles can override the default text alignment:

<!-- docs:check -->

```ts
import {labels} from '@tileflow/core';

export const groundLabels = labels({
  roadPlacement: 'ground',
  collisionPriority: 'navigation',
  language: 'local',
  roads: 'all',
  styles: {
    roads: {
      primary: {text: {pitchAlignment: 'viewport'}},
    },
  },
});
```

MapLibre offers foreground symbols first when resolving collisions. Ground names therefore yield
to POIs and other foreground symbols, even with `collisionPriority: 'navigation'`. Navigation
priority still orders the ground road classes relative to one another; it does not make their
collision priority independent of drawing order. Foreground placement retains the existing
navigation priority over ordinary POIs. Neither mode turns collision detection off.

When compatible road-name layers share a physical bucket, their top-to-bottom collision priority
and each class's authored feature priority are retained. Overlap-enabled names retain drawing order.

`labels({roadGrouping: 'network'})` instead shares placement and repeated-name suppression across
compatible classes, in source feature order (or their common authored priority). It retains each
class's zoom thresholds and size curve. Different fonts, spacing, colors or priorities stay separate,
as do explicit ordered passes and fractional zoom thresholds. Streets uses this for its ordinary
roads and a separate pedestrian/path group. The default `'class'` retains road-class priority.

Use a refinement on `labels.roads.<class>` to move an individual class after this default has been
applied. Symbol size, zoom range, spacing, priority, fonts and halos remain available in
`styles.roads`. The same names, language fallbacks and class selectors are used in both modes.

## Compact road names

`labels({roadNameFormat: 'compact'})` abbreviates recognized Spanish and French road-type
prefixes and English suffixes after language selection: `Calle de Alcalá` becomes `C. de Alcalá`,
`Avenue Paul Doumer` becomes `Av. Paul Doumer`, and `West 34th Street` becomes `W 34th St`.
The default, `full`, preserves source names. Proper names, unknown types and route shields stay
unchanged. An explicit `styles.roads.<class>.text.field` takes precedence over this formatting.

## Label density and perspective

The SDK starts with local street names (`labels.roads: 'streets'`), POI density 2 and a
3-pixel text collision margin. Street names follow enabled road geometry and their zoom thresholds;
set `roads: 'major'` to retain a map with only arterial names, and `density: 3` for more POIs.

`poi({density: 2, densityByCategory: {landmark: 3, lodging: 1}})` changes category eligibility
while retaining one importance order across categories. Unspecified categories inherit `density`.
Each value is 1–5; eligible rank increases by one at z16 and two at `detailZoom` (default 17;
Streets uses 18). `detailZoom` must exceed 16 and cannot exceed 24. Source rank meanings
and category coverage differ between datasets, so equal settings need not produce equal counts.

`poi({maxRankByType: {garden: 1}})` adds a fixed rank ceiling for selected World POI types.
Values are 0–5; unspecified types retain their usual eligibility. The ceiling applies to markers,
icons and labels in both placement orders and does not increase with zoom or category density.

MapLibre owns perspective scaling, distant-symbol rejection, collision placement and fading.
These native behaviors apply without a module switch. The SDK does not change feature filters
when panning, rotating, tilting or ending a gesture. Category and zoom eligibility remain compiled
into the style; explicit application filter edits remain application-owned. The experimental
`perspective` module option and `attachTileflowLabelPerspective` helper have been removed.

Default POIs place their pictogram and name together, with four alternative text anchors and
native collision detection. Parking and public toilets retain their icon-only representation.
Set `placement.coupleIconAndLabel: false` to place pictograms and names independently. Maps refining
separate `poi.icon` or `poi.label` targets should set this explicitly; coupled POIs use `poi`.
Explicit anchors, offsets and variable anchors replace the SDK's automatic text clearance.

Balanced foreground priority offers place names and route references first, followed by major
road names, ordinary POIs, minor road names and house numbers. `collisionPriority: 'navigation'`
also promotes minor road names above ordinary POIs. `placement.prominentRank` can promote selected
POI ranks above the orientation labels. Eligibility still depends on zoom, enabled classes and
source data. Feature priority sorts within a layer; it does not override the order between layers.
Explicit render-stack placements take precedence over these defaults.

With `roadPlacement: 'ground'`, the browser keeps road names above the 3D scene below 30° pitch,
so roofs cannot cut letters in narrow streets viewed from above. At 30° and above, names return
below solid raised geometry. Tileflow trees mount below these names so foliage cannot cut
individual letters. This policy follows `roadPlacement` alone and does not affect camera tilt.
Explicit render-stack moves opt a target out of automatic ordering; explicit tree `beforeId`
placement remains application-owned.

React, Vue, Svelte, preview and standalone capture attach the shared placement controller.
Applications constructing MapLibre maps directly call `attachTileflowLabelPlacement(map)` from
`@tileflow/core/browser` once after map construction. The returned function detaches its listeners
and restores ground ordering; map removal detaches without further map writes. Replacement styles
and late-mounted 3D layers are discovered automatically. Static style JSON and native renderers
retain compiled eligibility and hierarchy, but do not execute this browser scene-order controller.

Native perspective rejection is not a configurable per-category distance curve. The SDK does not
emulate Mapbox's `pitch` or `distance-from-center` symbol filters, which the supported MapLibre
style specification does not provide. Runtime fade duration and cross-source collisions continue
to use MapLibre defaults unless overridden through the adapter's `mapOptions`.

## Discover and override decisions

`tileflow describe labels --json` exposes the installed options, and `tileflow inspect --json`
shows resolved inheritance and merge provenance. `tileflow explain --inspection --json` adds
compiled semantic targets and physical provenance. These commands describe the authored map;
they do not rewrite explicit style choices.

`tileflow describe themes --json` lists the twelve required base color roles and composition
rules. A [single independent theme](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/themes-and-module-styles.md)
needs no time-of-day catalog. Optional color roles derive from that theme and accept explicit
replacements. Removing inherited lighting uses `reset()` inside `defineTheme`; it restores the
SDK fallback, while building shadows and occlusion have separate on/off controls.

`createStyleResult()` and `tileflow inspect compiled --json` include `report.decisions`: actual
color roles and selected road, label and 3D-building policies, each with its value, source,
reason and override guidance. Query `--path /report/decisions --limit 80` to bound this output.
`default` means an SDK fallback, `map` a value in the resolved map, `theme` a role defined by the
selected theme and `derived` an optional role computed by Core. Use config inspection's merge
provenance to distinguish inherited map values from leaf overrides. These decisions describe
module policies and the theme's color context; later module styles and render-stack refinements
can override them. They are not a trace of every final paint property or a visual-quality score.
Simple `createStyle()` and browser drawing do not collect this report.

Replace an inherited module with its constructor, patch it with `refine()`, restore an inherited
value with `reset()`, or remove the whole domain with `disable()`. See the
[authoring model](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/authoring-model.md)
for these composition rules. Capture contrasting designs and compare them at matching cameras to
check both the default result and intentional departures from it.
