# Native style artifact contract

A Tileflow map's native artifact is what MapLibre Native draws on iOS and Android: one style per
theme, prepared for the `native-v1` profile, and one family document per map that lets the mobile
SDKs change appearance (theme blends, emphasis, sun, route inks) without Tileflow's JavaScript
runtime. This document is the versioned contract between `@tileflow/core`, which defines and
computes the artifact, `@tileflow/dev` and the CLI, which prepare and publish it, and the Swift,
Kotlin and React Native SDKs, which read it. Source of truth: `packages/core/src/native-profile*.ts`,
`packages/core/src/native-capabilities.ts`, `packages/core/src/native-build-record.ts` and
`packages/dev/src/native-artifacts.ts`.

Current versions: profile `native-v1`, preparation `native-lowering-v2`, build record schema 3,
family document schema 1.

## Profile

`tileflowNativeProfile` pins the engines the mobile SDKs ship: MapLibre Native Android 13.7.1 and
iOS 7.0.0. Styles are parsed with Tileflow's compiler Style Spec (24.8.5). Native support comes
from that Style Spec's `sdk-support` tables, updated where they predate the pinned engines from
Style Spec 26.5.1 and the engines' release notes:

| Style feature                                       | Android | iOS    | Source                                                                                                                                            |
| --------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `state` and the `global-state` expression      | 13.7.1  | 7.0.0  | Style Spec 26.5.1; [maplibre-native#4516](https://github.com/maplibre/maplibre-native/pull/4516)                                                  |
| `split`                                             | 13.5.0  | 6.29.0 | Style Spec 26.5.1; [maplibre-native#4463](https://github.com/maplibre/maplibre-native/pull/4463)                                                  |
| `interpolate-hcl`, `interpolate-lab`                | 13.7.1  | 7.0.0  | [maplibre-native#4668](https://github.com/maplibre/maplibre-native/pull/4668) and both release notes; Style Spec 26.5.1 still links an open issue |
| `color-relief` layers, multidirectional `hillshade` | 13.0.0  | 6.24.0 | Style Spec 24.8.5                                                                                                                                 |
| `resampling` on `hillshade` and `color-relief`      | none    | none   | [maplibre-native#4117](https://github.com/maplibre/maplibre-native/issues/4117)                                                                   |
| `sky`, `terrain`, globe projection, overlap modes   | none    | none   | Style Spec 26.5.1                                                                                                                                 |
| Data-driven `line-cap`, `line-dasharray`            | none    | none   | Style Spec 26.5.1; preparation turns finite decisions into constant layers                                                                        |

A support entry of `supported` counts as support in every release. Raw compiler input may hold
320,000 JSON nodes (the largest official map, Map 1777, holds about 245,000); a prepared style may
hold 540,000. Both keep the 8 MiB, depth 64, 128 source and 4,096 layer limits.

## Native styles

Native preparation runs after the shared compiler and never edits the web style. For each theme it:

1. Leaves out or replaces what native maps cannot draw, and records each change as a degradation
   (below). Everything else that `native-v1` does not support still fails the build.
2. Lowers finite `line-cap` and `line-dasharray` decisions to constant layers, replaces constant
   `icon-overlap` and `text-overlap` modes with `*-allow-overlap`, and removes `sky` and a fixed
   `projection`.
3. Rebinds POI priorities and overlay anchors to the final layers, and validates the result.

A native style keeps the web style's `sprite`, `glyphs` and every source it still draws, unchanged.
It may only leave out a source that one of its degradations names (`deviceContours:<source>`).
It lists its degradations, ordered by ID, in `metadata['tileflow:nativeDegradations']`, and no
longer carries the browser 3D runtime's metadata (`tileflow:buildings`, `tileflow:vegetation`,
`tileflow:street-lights`, `tileflow:sky`). Building extrusions that stand in for the 3D scene carry
`metadata['tileflow:3d-toggle'] = 'building'`, so an SDK can switch them for a 2D view.

### Font faces

Each `font-faces` entry holds one prepared TTF or OTF file with the characters it draws:

```json
{
  "DINish Medium": [
    {"url": "fonts/dinish-medium-<sha256>.ttf", "unicode-range": ["U+0000-0000", "U+0020-007E"]}
  ]
}
```

MapLibre Native picks a font for each character among the faces whose ranges cover it and does not
fall back along a layer's `text-font` list on its own: a face without ranges claims every
character, so a Latin font listed first leaves Greek or Cyrillic undrawn. Preparation reads each
file's character map (cmap) and writes every code point that maps to a glyph as ascending
`U+start-end` runs, the only form the engines read (a single character repeats its code point).
Characters a file maps to its missing glyph are not claimed. A face holds at most 8 files and a
file at most 4,096 ranges.

`tileflowNativeCapabilities` is the stable vocabulary. Each degradation record is:

```json
{
  "id": "deviceContours:siegfried-contours",
  "feature": "deviceContours",
  "reason": "web-runtime",
  "fallback": "none",
  "layers": [
    "tileflow-terrain-contour-minor",
    "tileflow-terrain-contour-index",
    "tileflow-terrain-contour-labels"
  ]
}
```

`id` is the capability, followed by `:` and a subject when a map can hold several (here the
source). It is stable for the same map revision. `reason` is `engine-unsupported` (MapLibre Native
has no equivalent) or `web-runtime` (Tileflow's browser runtime draws it). `fallback` says what the
native map shows instead. `layers` lists the web style's layer IDs that the native style leaves out
or draws differently, in style order; capabilities drawn outside the style's layers list none.

| Capability            | Fallback         | What native maps show                                                    |
| --------------------- | ---------------- | ------------------------------------------------------------------------ |
| `scene3d`             | `extrusions`     | Plain building extrusions: the map's own pass, or one from its design.   |
| `models3d`            | `extrusions`     | No landmarks or building models; the extrusions under them remain.       |
| `trees3d`             | `flat` or `none` | The map's own vegetation fallback for maps without 3D.                   |
| `streetLights`        | `none`           | No street lights.                                                        |
| `terrain3d`           | `flat`           | A flat map; hillshading remains.                                         |
| `globe`               | `mercator`       | Web Mercator.                                                            |
| `sky`                 | `none`           | No sky, atmosphere or fog.                                               |
| `nauticalLightRhythm` | `steady`         | Nautical lights that shine steadily.                                     |
| `symbolOverlap`       | `allow-overlap`  | Cooperative symbols drawn with allowed overlap.                          |
| `reliefResampling`    | `engine-default` | Hillshade and colour relief with the engine's resampling.                |
| `deviceContours`      | `none`           | No contour lines or labels: they are generated in the browser.           |
| `pitchAbove60`        | `capped`         | Reported by the SDK at run time when the engine caps the camera's pitch. |

## Degradations are information

Every map that prepares opens in native apps. Degradations never block a map or mark it as web
only: the SDKs warn once per map and theme for each record, and Gallery, editor and the public
compatibility table list the records to say what native maps draw differently. A record whose
`fallback` is `none` names a feature native maps leave out. A theme that cannot be prepared at all
fails the build with its diagnostics and has no native artifact.

## Build record

`native-build.json` (and a Hosted deployment's `renderers.native.buildRecord`) uses schema 3 with
`preparationVersion: 'native-lowering-v2'` and `engines: {android: '13.7.1', ios: '7.0.0'}`. Each
style receipt adds:

- `removedLayers`: input layer indexes left out, ascending;
- `insertedLayers`: output layer indexes added (such as a generated extrusion), ascending;
- `degradations`: the IDs recorded in the style's metadata, ordered.

Layer spans name input and output indexes; the schema checks that removed, partitioned and inserted
layers account for every output layer. Older decoders must reject schema 3.

## Family document

One document per map, `kind: 'tileflow-native-family'`, `schemaVersion: 1`. Core computes it from
the prepared native styles with `createTileflowNativeFamily`, using the planners the browser uses,
and validates it with `tileflowNativeFamilySchema` (8 MiB at most).

| Field    | Content                                                                |
| -------- | ---------------------------------------------------------------------- |
| `map`    | The map's ID.                                                          |
| `themes` | Every theme in the map's declared order; other fields index this list. |
| `blend`  | `{options, groups}`: blend plans for the whole family.                 |

Each theme holds `name`, `colorScheme`, `sun` (a resolved preset; `sunPublished` says whether the
theme describes it), `routeInks`, `notices`, `degradations` and `emphasis`.

### Templates

A template is a JSON value in which a leaf `{"tileflow:leaf": [v0, v1, ...]}` stands for a number
or a CSS colour that varies; anything else is taken as is. To fill a template at a position, each
leaf's values are mixed `position` of the way along them, clamped to the ends: 1.5 is halfway from
the second value to the third. Numbers mix linearly. Colours (hex, `rgb(a)`, `hsl(a)`) mix in
OKLab and are written as `rgba(r, g, b, a)` with rounded channels and alpha to three decimals;
when either colour cannot be parsed, the nearer value is taken. Equal values pass through.

### Blend groups

Themes whose styles share layers, sources, sprite and glyphs form a group, planned once in
declared order. A theme that blends with no other is in no group. Each group holds:

- `themes`: family theme indexes, in declared order;
- `layers`: the planned layers, which replace the theme style's layers during a blend (data-driven
  values are split into filtered layers, or drawn once per theme and cross-faded);
- `paints`: `{layer, property, follows}` for every value that changes during a blend; its template
  is the planned layer's value;
- `switches`: values that change at once, one per group theme (`null` unsets the property);
- `images`: image names per group theme; `position` images are mixed in pixels into the name of
  the group's first theme, while icons switch with `switches`;
- `light`: a template for the root light, when themes differ;
- `metadata`: POI interaction and overlay entries that name the planned layers;
- `summary`: how many layers were split, copied or switched.

A blend selects two or more group themes in any order, as indexes into the group's `themes`, and
a position from 0 to one less than the number selected. Every leaf takes the selected values, in
that order. Symbol layers fill at the nearest selected theme (`Math.round(position)`), other
layers at the position; switches take the nearest selected theme's value. `tileflowNativeBlendLayers`
is the reference implementation. Planning the whole family means a value whose shape differs in
any group theme switches instead of mixing, even between themes where it could mix.

### Emphasis

Each theme's `emphasis` holds its ground colour and a target for every paint value any emphasis can
change: `{layer, property, kind, domain, featureData, value}`. `value` is a template whose leaves
hold the value as designed and fully retracted: colours mixed fully towards the ground colour,
opacities scaled to zero (an opacity expression `v` becomes `['*', v, 1]` and `['*', v, 0]`).
For an emphasis, `t` is the module's `recede` amount for `colour` and `fade` targets and
`1 - labels` for `label` targets, times the emphasis strength; fill `value` at `t`. With a keep
area, each filled leaf of a `label` target becomes `['case', ['within', area], design, filled]`,
and the value reads feature data. Values that read feature data (`featureData`) are set once at
their goal rather than eased. `emphasizeTileflowNativeValue` is the reference implementation.
Because OKLab mixing is linear, an emphasis during a blend can mix the blended themes' emphasised
values.

### Sun and route inks

`sun` and `routeInks` are the values the browser reads, already normalized. Between themes, suns
mix with `mixTileflowSunPresets` (the azimuth turns the short way round) and route inks with
`mixTileflowRouteInks`; colours mix in OKLab and numbers linearly.

## Where the artifact lives

- Local builds (`renderer: 'native'`) write `styles/<map>/<theme>.json`, `families/<map>.json`
  and `native-build.json`, and the same files under each `generations/<generation>/` directory.
  From a generation's style, the family document is `../../families/<map>.json`.
- A whole Hosted deployment (`parseTileflowRendererDeploymentArtifact`, schema 2) carries
  `renderers.native.family` beside `styles` and `buildRecord`. The parser recomputes the family
  from the native styles and rejects a document that differs. Native styles may leave out only
  sources their degradations name.
- It travels split (`splitTileflowRendererDeployment`): the request (schema 3) carries the web
  family plus the native build manifest, build record and `documents`, the SHA-256 and size of
  each native style and of the family document with its theme order; each document is then
  uploaded on its own as the exact canonical JSON the index names. Budgets are measured on those
  decoded bytes: 16 MiB for the request, 8 MiB for each document and 32 MiB for every native
  style plus the family document. `tileflowRendererDeploymentResponseSchema` (schema 3, with the
  family document's address and revision), `tileflowRendererDeploymentPendingSchema` (the
  documents still missing) and `tileflowNativeDocumentReceiptSchema` describe the answers.
- An offline style pack that holds a map's native theme styles also holds its family document.

## Evaluator fixtures

`packages/core/test/fixtures/native-evaluators.json` holds the cases native evaluators must
reproduce: colour mixes, leaves at positions and selections, blend layers, emphasis with and
without a keep area, theme selection (default, `system` and time of day), and sun and route-ink
mixes. `node scripts/native-golden-generate.mjs` computes it with Core from
`native-family-input.json`; `--check` runs in `@tileflow/core`'s `verify` and fails on drift.
Evaluators compare numbers within 1e-9 and strings exactly.

## Change this contract

Any change to the record, family or template shapes or the capability vocabulary increments the owning version (`schemaVersion`, `preparationVersion` or the
family `schemaVersion`), regenerates the evaluator fixtures, and updates this document.
