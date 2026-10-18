# Map DevTools and compiler inspection

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

The CLI opens Map DevTools through `tileflow preview`. It uses one map and one watched artifact
session by default. A developer-tools panel groups Map, Layers, Tiles, Assets, Debug and Diagnostics. Camera controls
occupy a separate row below the navigation. Use the three-dot menu to dock left, right or below
the map and choose System, Light or Dark appearance. Drag the divider to resize it; focused dividers
also support arrow keys. Dock position and dimensions persist locally. Layer observations and highlights stay local to the preview. The map fills the remaining
workspace without brand headers or map-status badges. Closing the panel leaves a small **DevTools**
button to reopen it; capture and comparison controls are absent from the interface.

Add `--against-map ...` or `--against-config ...` for synchronized comparison. Custom local servers
can compose the same shell around existing dev handlers; omit `right` for a single-map session:

```ts
import {createTileflowComparisonRequestHandler} from '@tileflow/dev/server';

const fetch = createTileflowComparisonRequestHandler({
  left: {
    basePath: '/left',
    handler: leftHandler,
    label: 'candidate / light',
    previewUrl: '/left/',
    sidecarUrl: '/left/__inspection/candidate/light.json',
  },
  right: {
    basePath: '/right',
    handler: rightHandler,
    label: 'reference / light',
    previewUrl: '/right/',
    sidecarUrl: '/right/__inspection/reference/light.json',
  },
});
```

Set `fitViewport: true` on each dev handler embedded in a resizable Map DevTools pane. Scene previews
then fit their pane while captures retain the scene's declared frame. Standalone dev handlers keep
the fixed scene viewport by default.

Each side handler retains ownership of its styles, fonts, sprites, events, diagnostics, and
last-known-good artifact generation. The comparison router owns the shell, its bundled UI fonts and
strict dispatch to disjoint same-origin route prefixes. An optional `workbench: {url, handle}`
adapter enables theme selection and browser context. Existing CLI capture-record and comparison
APIs remain separate from this interface. Custom servers that omit the adapter retain inspection,
zoom-curve sampling and the sprite atlas. Explicit two-map server configurations retain synchronized
cameras and URL-driven side-by-side/split/overlay/blink layouts without comparison controls.

See the [human/agent workflow](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/map-authoring.md#work-with-a-person-and-an-agent)
for retained evidence, context bounds and `inspect session`. Browser context reports the observed
camera and viewport; capture commands render compiled source without temporary preview edits. The rendered feature summary shows available semantic paths and
keeps raw feature data in a disclosure. It does not infer exact source lines or token ownership.

Set `inspection: true` on `createTileflowBuildArtifacts` or
`createTileflowArtifactSession` to compute `artifacts.styleInspections[map][theme]`. A dev handler
serves an available sidecar at `/__inspection/<map>/<theme>.json`; otherwise that route is 404. The
option is deliberately off by default. Sidecars remain in memory, do not alter Style bytes or
manifest hashes, and are excluded from `getTileflowArtifactFiles()` and every stable build output.

When a resolved map declares `fonts`, preparation reads its ordered directories and uses OpenType
full names as the canonical IDs referenced by `text-font`. TTF, OTF, and WOFF2 inputs are supported;
every contributing directory must contain `LICENSE.txt`. Later directories replace earlier faces
with the same exact ID, case-only collisions fail, and every primary font in the final style must be
present. `font` is an exact face ID; local `fallbacks` entries are exact face names or explicit CSS
generic families such as `sans-serif`. Preparation never synthesizes a face name from a family and
weight. Only selected primary faces and licenses are emitted as
content-addressed managed artifacts.

`fonts` and `glyphs` are mutually exclusive map fields. Omission inherits the parent's current text
provider; declaring either one replaces an inherited provider of either kind atomically. The font
pipeline is driven only by directory metadata and final style usage—there are no hard-coded map or
family names, and a URL provider comes only from the resolved map instead of being invented by the
pipeline. After inheritance resolves, a map with any text layer must have exactly one provider. A
`glyphs: {kind: 'url', ...}` provider enumerates the exact comma-joined MapLibre request keys
produced by the style's `text-font` arrays.

The resulting style records strict `tileflow:fontFaces` metadata. Preview, capture, and browser
framework adapters load those definitions before constructing MapLibre. Hosted deploy rejects a
prepared local-font bundle before authentication until managed font storage is available. A derived
map that declares `glyphs` replaces the inherited local provider atomically; the URL-backed map is
complete as declared and independent of its World selection.

### Pick an element in Layers

Press **I** or the element-picker icon, hover for a layer/type/ID hint, then click the map.
The clicked element selects its physical layer in **Layers** and opens **Rules**, the first detail tab.
Expression values use that picked feature, rather than an arbitrary viewport sample. **Data** shows
its properties and additional viewport samples; **Use for rules** chooses a different sample.
There is no separate Inspect tab. Legacy `tab=inspect` links open Layers.

Selecting another layer clears the picked-feature context. Compiler and scene revisions invalidate
old feature snapshots. The renderer's layer ID remains selected across reloads through the `layer`
URL parameter; missing IDs are reported explicitly. Rules expose inline temporary paint/layout
editors for the entire physical layer, with per-rule reset and shared undo history. Preview edits do
not write config, source data or build artifacts. See [Layers inspection](./layers-inspection.md) for diagnostic limits,
map highlighting, provenance and agent context.

### Tiles

**Tiles** shows in-view resident tiles in a spatial grid and source-grouped list, with canonical
`z/x/y`, display zoom, state and raw tile bytes where available. Filter by source or coordinates.
Select a tile to outline its bounds and inspect **Source layers**, **Features** and **Info**.
Source-layer rows link to consuming style layers. Features are paginated in groups of 50 and can
be copied as real GeoJSON. Counts describe tile fragments, including buffer geometry, rather than
unique objects across tiles. **Show on map** fits the selected bounds.

Raster DEM tiles show decoded grid dimensions and elevation statistics. Raster imagery has no
vector features. Eviction, unavailable internals and unsupported MLT decoding are reported explicitly.
Inspection decodes resident MVT buffers on demand without requesting tiles.

The view reads the pinned MapLibre renderer's tile managers through an isolated adapter. A resident
tile can come from cache and need not have a new HTTP request. Unsupported renderer internals
produce an unavailable state. Network does not list application scripts, development-server
traffic or other HTTP resources. Sprite and font sources remain in **Assets**.

### Assets and debug overlays

**Assets** separates Icons, 3D models and Fonts. Icons lists registered images, including runtime
additions, with lazy thumbnails and searchable IDs. Theme and time-of-day filters load the actual
registered theme atlases; the selected icon's sidebar compares its day/night variants and links to
consuming layers. Missing variants are marked, never synthesized from a naming convention.

3D models previews bounded samples of the actual loaded building and vegetation meshes. Counts,
bytes, LODs and available instance counts describe controller data. The wire geometry preview is
not the map's lighting renderer. Fonts renders editable specimens from the actual font or glyph
provider and shows observed glyph ranges and consuming layers. Pending requests are cancelled
when leaving the panel; unavailable sources do not silently use a fallback font.

**Debug** offers collision boxes, overdraw with a color legend, tile boundaries and real pixel-ratio
controls. **Diagnostics** lists design findings and optional drawing-cost observations; see [Map design diagnostics](./map-design-diagnostics.md).
