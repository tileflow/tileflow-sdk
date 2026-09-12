# Local comparison workbench and compiler inspection

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

The CLI exposes the complete authoring surface through `tileflow preview --against-map ...` or
`--against-config ...`. Custom local servers can compose the same shell around two existing dev
handlers:

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

Each side handler retains ownership of its styles, fonts, sprites, events, diagnostics, and
last-known-good artifact generation. The comparison router only owns the root HTML and strict
dispatch to two disjoint same-origin route prefixes. Its synchronized camera, URL state,
side-by-side/split/overlay/blink modes, rendered-feature inspector, zoom-curve sampling, sprite
atlas, and scene/capture-command copying require no hosted service.

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

For Streets styles whose vegetation layer declares `tileflow:vegetation-mode = 3d`, the built-in
preview uses the same portable circle fallback as capture and the published framework adapters by
default. This makes an ordinary `tileflow preview` session WYSIWYG with production and visual
baselines. Append `?treeRenderer=simple` or `?treeRenderer=complex` to opt into the experimental,
preview-only instanced renderer described below; that explicit mode is not capture evidence.

The experimental renderer uses source height and crown diameter when present, distinguishes palms,
columnar cypresses, conifers, and three broadleaf silhouettes from the bound botanical fields, and
falls back to deterministic broadleaf variety and dimensions when tags are missing. Bark color,
crown palettes, height scale, and crown scale come from `vegetation.threeDimensional`; the preview
does not maintain a second hard-coded appearance contract. During camera
gestures the existing 3D batch remains visible while native circles cover newly arriving tiles; the
batch refreshes when movement ends without waiting for the whole map to become idle. Source-tile
events are rate-limited and unchanged instance selections do not upload new GPU buffers. The
preview caps one view at 3,000 trees and uses zoom-dependent density. Both detailed modes use thin,
tapered trunks, branches that enter the crown, softly shaded overlapping ellipsoids, and stable
per-tree scale and rotation. `simple` reduces lobe and segment counts; `complex` keeps the complete
round, open, avenue, pine, cypress, and palm silhouettes. Each archetype remains fused into one
reusable geometry and every complete tree remains
one GPU instance, so the additional detail introduces no extra draw calls. The experimental
renderer defaults to its WebGL2 backend, which
draws those instances directly without a Three.js scene traversal; append `&treeBackend=three` for
the compatibility backend. Use `?treeRenderer=circle`, `?treeRenderer=simple`, or
`?treeRenderer=complex&treeBenchmark=1` to compare identical scenes; the benchmark reports frame
p95, query, selection, build and render time, draw calls, and triangle count in the tree status badge.
Visible candidates come from MapLibre's worker-built tile index instead of a second copy of the
vector source. Terrain height is sampled on a fixed 5-by-5 viewport grid and interpolated per tree,
avoiding hundreds of synchronous terrain queries when a new batch first appears.
The separate `TREES ON/OFF` control sits below the building `3D ON/OFF` control and pauses tree
refresh work while disabled. Both choices survive reloads and shared links through the
`buildings3d=on|off` and `trees3d=on|off` URL parameters.

Detailed trees retain the compiler's scene order: they render above road and pedestrian surfaces,
ordinary building geometry, and detailed landmark models. Map labels and other annotations remain
above the physical scene, while road names and route references stay attached to the carriageway
below buildings and trees.

The same control toggles any compiled layer whose metadata contains
`tileflow:3d-toggle = building`. It switches the building volumes independently from the camera,
so enabling 3D never changes the pitch and users remain free to tilt the map with pointer controls.

### Detailed landmark models

A hidden style layer can opt the Streets preview into detailed GLB landmarks by setting
`tileflow:landmark-manifest-url` in its metadata. The bounded version-2 manifest indexes GLB entries
inside one or more PMTiles archives and is fetched only when the 3D building control is enabled near
the landmark runtime zoom. Archive URLs may be absolute or relative to the manifest URL.

```json
{
  "schemaVersion": 2,
  "id": "madrid-landmarks-2026-08-19",
  "minzoom": 16,
  "maximumVisibleModels": 8,
  "maximumCachedModels": 16,
  "archives": [
    {
      "id": "madrid-v1",
      "url": "./madrid-landmarks-v1.pmtiles",
      "bytes": 14832912,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "landmarks": [
    {
      "id": "palacio-cibeles",
      "center": [-3.6921, 40.4193],
      "bounds": [-3.693, 40.4186, -3.6912, 40.42],
      "priority": 100,
      "models": [
        {
          "minzoom": 16,
          "archiveId": "madrid-v1",
          "z": 0,
          "x": 0,
          "y": 0,
          "bytes": 481024,
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "axisConvention": "EUN_Y_UP"
        },
        {
          "minzoom": 18,
          "archiveId": "madrid-v1",
          "z": 1,
          "x": 0,
          "y": 0,
          "bytes": 1276416,
          "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          "axisConvention": "EUN_Y_UP"
        }
      ]
    }
  ]
}
```

`maximumVisibleModels` is bounded to 1–64. `maximumCachedModels` defaults to twice that value,
must be at least the visible limit, and is bounded to 128. Higher `priority` values win when more
landmarks intersect the viewport than can be shown. `models[0]` is the base LOD and must start at the
manifest `minzoom`; later entries replace it at their distinct `minzoom`. The parser bounds manifest,
archive, landmark, model and GLB-entry sizes, rejects credential-bearing or non-HTTP archive URLs,
and verifies each extracted entry's declared byte length and SHA-256 before parsing it.

The preview starts the Three.js runtime and manifest request together one zoom before the landmark
layer becomes visible. A landmark entering directly at a close zoom always displays its base LOD
first and upgrades in place. Nearby base LODs are warmed in the parsed-model cache. Style layers
marked with `tileflow:landmark-fallback = true` remain visible until the corresponding active GLB is
ready, so a cold request never leaves an empty building volume.

Embedded Streets previews also accept a same-origin parent command without reloading the document:

```js
iframe.contentWindow.postMessage(
  {
    type: 'tileflow:set-map-state',
    schemaVersion: 1,
    state: {
      center: [-3.688344, 40.453053],
      zoom: 17.75,
      bearing: -24,
      pitch: 58,
      buildings3d: true,
      trees3d: false,
      visibleLayerGroups: ['labels', 'roads', 'buildings', 'landuse', 'water'],
    },
  },
  location.origin,
);
```

The command is applied atomically only for the embedding parent, with exact same-origin and numeric
range checks. `visibleLayerGroups` is optional and accepts only `labels`, `pois`, `roads`, `transit`,
`buildings`, `landuse`, and `water`; omitted groups are hidden while base background and attribution
remain. Camera and toggle state continue to be written to the preview URL after application.

GLB base colors, textures, emissive values, metalness, and roughness are authoritative and are not
rewritten by the preview. Models outside the active selection remain hidden in a least-recently-used
cache; leaving the cache disposes their geometry, materials, and textures.

The vector building represented by a detailed model must carry `hide_3d = true`. The ordinary
building extrusion and both screen-space shadow passes filter on that field, preventing the coarse
volume from intersecting the GLB while retaining the flat footprint below it. This flag belongs in
the vector-tile dataset; the landmark endpoint cannot substitute for it. Version model and GLB URLs
so they can be served with immutable caching. Cross-origin endpoints must allow credentialed GETs
because the development renderer requests the manifest and models with credentials.

If a map uses `icons: ['./icons/brand']`, build artifacts include the generated MapLibre
`sprite.json`, `sprite.png`, `sprite@2x.json`, and `sprite@2x.png` beside its style. Ordinary sources
are normalized into 24 px icon cells. A source named `<id>.pattern.svg` (or another supported raster
format with the same marker) instead keeps its intrinsic dimensions and is published as `<id>`.
This provides calibrated, non-square textures for line and fill patterns while the runtime still
consumes only the generated PNG sprite. Pattern widths must be a power of two from 2 through 512
pixels, matching MapLibre's seamless line-pattern contract.

`icons` is one ordered array. Omitting it inherits the parent's exact array, declaring it replaces
the array atomically, and `[]` means no icons. Use a spread to preserve imported directories while
adding or replacing files:

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'brand-map',
  version: 1,
  extends: streets,
  icons: [...streets.icons, './icons/brand'],
});
```

Directories apply left to right. `<id>.<ext>` publishes an icon as `<id>`;
`<id>.pattern.<ext>` publishes the intrinsic-size pattern as `<id>`. The published ID must already
be canonical lower-kebab-case. A later file replaces an earlier file only for the same exact ID;
case-only collisions fail. Package maps export `streetsIcons`, `baedekerIcons`, `ferrarisIcons`,
`haradIcons`, `siegfriedIcons`, `soundingsIcons`, `cyberpunkIcons`, `matrixIcons`, and
`verdantIcons`, and `sanFrancistoIcons` directory descriptors from `@tileflow/maps`. Cyberpunk,
Matrix, Baedeker, and Siegfried also export `cyberpunkFonts`, `matrixFonts`, `baedekerFonts`, and
`siegfriedFonts`. Preparation
resolves package descriptors inside their owning package, checks real-path containment, and
compiles them through the same pipeline as a config-relative directory. There are no
built-in/source/sprite selectors, mappings, icon-specific inheritance, or compatibility aliases.

Local directories resolve from the directory containing the selected `tileflow.config.ts`, while
the workspace `cwd` remains their containment boundary. Canonical local syntax starts with `./` or
one or more leading `../` segments and then uses only non-empty segments other than `.` or `..`;
trailing or repeated slashes, backslashes, controls, and paths longer than 512 characters fail.
