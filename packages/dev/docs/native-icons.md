# Author recolorable and adaptable icons

Use SDF for a monochrome silhouette whose fill and halo vary by map. Keep multicolor artwork as
fixed-color RGBA. Ordinary filenames and icon IDs stay unchanged.

In an icon directory already selected by your map, place `tileflow.icons.json` beside `health.svg`:

```json
{
  "schemaVersion": 1,
  "icons": {
    "health": {
      "representation": "sdf",
      "defaults": {"color": "#c43d35", "haloColor": "#ffffff", "haloWidth": 1, "haloBlur": 0}
    }
  }
}
```

Only explicitly declared SDF assets are converted. Omitted entries, or `representation: "rgba"`,
preserve fixed-color rendering. SDF uses the source alpha silhouette; source RGB does not define its
default color. `defaults.color` is required. Omitted halo fields become transparent, zero width and
zero blur. Unknown IDs, duplicate JSON keys, unknown fields and invalid colors fail preparation.

The generated cell remains 24 × 24 logical pixels at both densities. Within that cell, the source
silhouette needs six fully transparent pixels on every side. Tileflow rejects edge-touching,
empty, or insufficiently defined silhouettes instead of adding padding or shrinking artwork.
Author opaque silhouettes with antialiased edges; gradients and translucent artwork should remain
RGBA. Thin shapes without a resolved interior fail verification. Generation rasterizes 1x and 2x
independently and encodes distance in white-RGB alpha. SDF is for symbol icons, not patterns.

For existing artwork, expand the source canvas explicitly before declaring SDF. A drawing bounded
by `viewBox="0 0 15 15"` fits the profile when its outer SVG uses `width="24" height="24"`
and `viewBox="-7.5 -7.5 30 30"`: the drawing occupies at most the central 12px. Review fine details
at the intended map size; use `icon.size` to choose the displayed size. Keep the original source for
fixed-color use. A transparent margin does not make an excessively thin silhouette suitable.

## Keep each symbol layer homogeneous

One package may contain RGBA and SDF icons. Every icon selectable by one symbol layer, including
fallbacks, must use the same representation. Tileflow checks the effective composition after all
local overrides. It does not split layers or alter collision priority, coupled labels or IDs.

An unbounded selection such as a POI icon read from feature data can select any effective icon ID.
It therefore requires a homogeneous inventory. To use a mixed package, select one fixed icon or
an explicit `expr.match`/`expr.case` expression whose possible outputs and fallback are homogeneous.
Sampling the current feature data does not prove this condition.

`tileflow validate`, `tileflow dev`, `tileflow build`, framework preparation and Capture use the
same check. `TF_ICON_REPRESENTATION_MIXED` identifies the layer and image-selection path. Replace
the conflicting override, align all selectable representations, or bound the selection explicitly.
Compiled SDF admission rejects legacy token templates and function objects with
`TF_ICON_SELECTION_UNPROVEN`; rebuild using expression-based image selection.
Development reports an invalid generation and retains its last valid artifact until recovery.

## Style each map independently

Use the existing `styles.<category>.icon` fields: `color`, `haloColor`, `haloWidth`, and `haloBlur`.
Theme tokens, explicit `fixed(...)` values and supported data, zoom and feature-state expressions
compile to native MapLibre paint. Feature state is supported in paint, not image selection.
Keep halo width within 0–2 logical pixels and blur within 0–1. Dynamic halo expressions must prove
these bounds; use `expr.min`/`expr.max` around unconstrained feature values. Otherwise compilation
reports `TF_ICON_HALO_BOUNDS`.

An omitted paint property uses that selected icon's declared default, including missing-ID
fallbacks. An override replaces only its property. It does not edit the shared revision or another
map. Image IDs remain stable; recoloring does not generate image variants. Existing size, opacity,
rotation and anchor controls retain their native semantics.

## Fit a background around text

Declare optional `layout` beside the representation. It applies to RGBA and SDF independently.
For a 24px background whose central region can stretch, use this sidecar entry:

```json
{
  "schemaVersion": 1,
  "icons": {
    "price": {
      "representation": "rgba",
      "layout": {
        "stretchX": [[9, 15]],
        "stretchY": [[9, 15]],
        "content": [7, 7, 17, 17]
      }
    }
  }
}
```

Coordinates use the generated logical cell, not the original SVG viewBox. Each stretch interval
is `[start, end]`; `content` is `[left, top, right, bottom]`. Use positive, ordered, non-overlapping
integer ranges inside the cell. Each configured axis must overlap its content area. Put corners,
borders and pointers outside stretch regions. Tileflow scales metadata for the 2x index, verifies
both densities and rejects layout on patterns. SDF backgrounds still need the six-pixel guard.

Enable the existing map `icon.textFit` control (`width`, `height` or `both`) and set
`icon.textFitPadding` in top/right/bottom/left order. For centered price labels, also set
`text.anchor: 'center'` and `text.offset: [0, 0]`; the POI defaults place labels beside icons.
This style fragment belongs inside the selected category's `styles` entry:

```ts
{
  icon: {image: fixed('price', {reason: 'Price background'}), textFit: 'both', textFitPadding: [4, 6, 4, 6]},
  text: {anchor: 'center', offset: [0, 0]},
}
```

Import `fixed` from `@tileflow/core`. The same layer retains label coupling, collision priority and
interaction identity. Text fitting does not happen merely because an asset has metadata. Explicit
new local artwork replaces the shared asset's layout; omitted metadata never inherits stale bounds.

## Inspect and distribute the result

Packages with SDF appearance or layout use `tileflow-icon-package-v2`; composition receipts use
`tileflow-icon-composition-v2` when an effective winner has either capability. Paired sprite JSON entries contain
`sdf: true` and verified `tileflow` appearance metadata. Defaults and layout participate in revision identity
and diffs even when pixel hashes match. Metadata-free RGBA packages and receipts keep their v1 identity.
Old readers reject v2; upgrade every producing and consuming package together.

`tileflow icons list --json` includes `appearances` and `layouts` for effective icons. Diff reports show default appearance;
downloadable PNGs remain the original distance fields. Bare MapLibre consumes the standard sprite
and compiled paint without a recoloring adapter. Capture uses the same prepared assets.

Hosted admission, Dashboard and Static Maps require coordinated Platform adoption. Additional
Static Maps symbols use asset defaults and retain adjacent icon/label layout; base-map symbols use
compiled map paint and text fitting. Device support
requires separate Native qualification. This contract does not provide independently parameterized
multicolor SVG, COLRv1, `textFitWidth`/`textFitHeight` metadata or an icon editor.
