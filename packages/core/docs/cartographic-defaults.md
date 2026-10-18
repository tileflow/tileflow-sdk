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
Use `roadPlacement: 'ground'` to draw them below buildings, with text aligned to the map surface.
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

Use a refinement on `labels.roads.<class>` to move an individual class after this default has been
applied. Symbol size, zoom range, spacing, priority, fonts and halos remain available in
`styles.roads`. The same names, language fallbacks and class selectors are used in both modes.

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
