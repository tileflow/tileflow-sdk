# Public API and browser subpath

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

Config, data, modules, compilation, validation, runtime resolution, and capture-scene APIs remain
available from the package root. Capture scenes, manifests, and browser-runtime surfaces also have
explicit `@tileflow/core/capture`, `@tileflow/core/manifest`, and `@tileflow/core/runtime`
subpaths. Node build integrations import the small deterministic map-identity contract from
`@tileflow/core/build`: `collectTileflowMapBuildLineage`, `createTileflowMapBuildManifest`,
`hashTileflowMapRevision`, `hashTileflowAssetSet`, and `hashTileflowAssetSetIdentities`. The latter
reproduces the same asset-set v1 hash from exact per-file identities after another system has
independently confirmed the immutable bytes; package or bundle hashes are not substitutes. The
previous aggregate-wrapper and recipe-selector APIs, `renderer`, top-level `tiles`/`tileset`, module
arrays, and top-level raw `layers` are not part of this API. Raw MapLibre layers are accepted only
inside a named `maplibreOverlay()` bound to a named Team source.

Advanced cartography remains in the same public language: `withRenderStack()`, `renderPass()`, and
`refineRenderTarget()` address owner-local semantic targets without exposing physical layer IDs,
sources, source layers, raw filters, or before/after anchors. Typed `field()` references and
`expr.*` builders stay semantic until the compiler's single lowering boundary. There is no recipe
subpath or alternate compiler integration API.

`mapRevisionSha256` hashes only resolved cartography: the effective design after `extends`, the
semantic language, compiler-owned effective contributions, and exact source icon/font identities.
Leaf `id`, `name`, editorial `mapVersion`, default `view`, capture `scenes`, and `delivery` policy do
not change that content identity. They remain explicit on the map, manifest, Style, capture receipt,
or Hosted deployment fingerprint that owns them. Compiler ABI, package versions, generated assets,
and the concrete release selected by World `current` likewise have separate identities.

Runtime manifest version 1 has one shape for local and Hosted delivery. Every map entry owns
`defaultTheme`, optional `systemThemes`, and a `themes` record whose leaves contain
`colorScheme`, `styleUrl`, and optional font/deployment identity. Hosted-only identity is additive
metadata on the same map entry; there is no delivery discriminator or parallel `styles` alias.
`parseTileflowRuntimeManifest()` accepts only this canonical shape. The strict bounded schema uses
the same portable map and theme IDs as authoring, rejects `system` as a published name, duplicate
font identities, unsafe owner-relative URLs, prototype-bearing input, unknown fields, and JSON
larger than 1 MiB.

```json
{
  "version": 1,
  "maps": {
    "madrid": {
      "defaultTheme": "light",
      "systemThemes": {"light": "light", "dark": "dark"},
      "themes": {
        "light": {"colorScheme": "light", "styleUrl": "/styles/madrid/light.json"},
        "dark": {"colorScheme": "dark", "styleUrl": "/styles/madrid/dark.json"}
      }
    }
  }
}
```

Runtime fetches share a successful result for 30 seconds, never cache failures, use
`cache: 'no-store'`, enforce a 10-second timeout (configurable up to 60 seconds), compose an
external abort signal, and can be invalidated with `clearTileflowManifestCache()`.

Named map `view` values travel in the manifest. `resolveTileflowRuntimeTheme()` turns an omitted,
explicit, or browser `system` request into one concrete published entry; unknown names fail closed.
`resolveTileflowRuntimeView()` defines the shared
precedence as explicit runtime values, then the manifest view, then the single exported
`defaultTileflowRuntimeView` (`[0, 20]`, zoom 2, bearing/pitch 0). Browser delivery is one
discriminated `TileflowRuntimeSource`: `kind: 'tileflow'` resolves a named map only through its
published manifest, while `kind: 'maplibre'` accepts a direct style object or URL. The runtime
subpath does not import the config compiler, invent a localhost style URL, or change image mode by
environment.

Framework adapters import the browser-only lifecycle kernel explicitly:

```ts
import {
  attachTileflowFairUseNotice,
  attachTileflowMapLifecycle,
  createTileflowSessionStarter,
  createTileflowTransformRequest,
  registerTileflowWorldRequestBridge,
} from '@tileflow/core/browser';
```

The browser entry is not re-exported from the root. It is SSR-safe to import, has no MapLibre
runtime dependency, and reads no browser global during module evaluation. See the
[framework browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/framework-browser-runtime.md) and the
[cartographic authoring contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/cartographic-authoring.md). Exact field
resolution and asset rules live in the
[map inheritance contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/map-inheritance.md).
