# CLI setup and defaults

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

CLI-only tools for Tileflow config, preview, validation, capture, and hosted deploy. The package
requires Node.js 22 or newer and intentionally exposes only the `tileflow` binary; importing
`tileflow` as a JavaScript library is not a supported surface.

Local config, validation, build, preview, and hosted-compatibility checks require
no Tileflow account or API key:

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact tileflow@alpha
npx tileflow init
npx tileflow validate
npx tileflow validate --target hosted
npx tileflow build
npx tileflow preview
```

The generated config imports `streets`, extends it, materializes a custom dark theme from
`streetsThemes.dark`, and declares the starter's theme family, modules, and view. Streets already
owns its complete icon and glyph providers, so the leaf does not repeat font stacks or know a
delivery URL.

Install the exact project dependency first; then `npx tileflow` runs its local executable. Other
package managers work; use the equivalent command for the lockfile already owned by the project.

`tileflow preview` previews the map exported by `tileflow.config.ts` and uses its configured `view`.
Select one of that map's committed standalone scenes explicitly:

```sh
npx tileflow preview --scene madrid-mobile
```

To work on another map, point `--config` at another singular config. Multi-map catalogs are internal
orchestration used by this repository's workbench and are not a second public config shape.

`tileflow dev` remains a compatibility alias. The `preview` name distinguishes this SDK preview
server from an application's own `npm run dev` process.

`--api-base-url` selects the origin used by official World, Bathymetry vector, Bathymetry DEM,
Nautical, and terrain TileJSON sources in the generated preview style. In particular, a hybrid
Bathymetry map resolves `/tiles/bathymetry/tiles.json` and `/tiles/bathymetry/dem/tiles.json` from
that one origin. `TILEFLOW_API_URL` supplies the same value when the flag is omitted, which lets a
local tiles stack serve all sidecars without changing map authoring.

The preview binds only `127.0.0.1` by default. Network exposure is never implicit. To bind another
interface, pass one explicit IP literal (or `localhost`) with `--host`, for example
`tileflow preview --host 192.0.2.10`. URL-, path-, and hostname-shaped values are rejected.

A map preview accepts `--theme <concrete-name>`; omission selects its declared default. A scene
preview applies its committed concrete theme, camera, and CSS viewport dimensions. Capture remains the
authority for exact DPR and pixels. Scenes whose target is an application must be viewed through
that application's normal development server.
