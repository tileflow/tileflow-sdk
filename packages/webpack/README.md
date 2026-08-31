# @tileflow/webpack

Webpack plugin for local Tileflow style development and static build artifacts.

```js
import {TileflowWebpackPlugin} from '@tileflow/webpack';

export default {
  plugins: [new TileflowWebpackPlugin()],
};
```

Omitting a component's `manifestUrl` is valid only for exactly
`/tileflow/manifest.json`. When `output.publicPath`, the plugin `publicPath`, or the plugin `base`
changes the public location, pass the final URL explicitly:

```js
export default {
  output: {publicPath: '/app/'},
  plugins: [new TileflowWebpackPlugin({base: '/maps'})],
};

const source = {
  kind: 'tileflow',
  map: 'main',
  manifestUrl: '/app/maps/manifest.json',
};
```

The browser runtime does not inspect Webpack configuration at runtime.

When used with `webpack-dev-server`, the plugin serves `/tileflow/manifest.json`
and `/tileflow/styles/:mapName/:themeName.json` from `tileflow.config.ts`. Production builds emit
those files plus the same prepared sprites and package-owned content-addressed fonts. They reject
unresolved local PMTiles before emitting Tileflow assets; user datasets are never copied, hashed,
or deduplicated. Publish a managed tileset explicitly or provide an application-owned production
source. Development Style URLs remain stable by logical tileset ID while the served snapshot
changes by generation.

Before every artifact emission, including watch rebuilds, the plugin refuses to replace an
existing Hosted delivery manifest under `output.path`. Prefer `emitBuildArtifacts: false` or a
separate output path when the application deliberately packages a deploy manifest. The explicit
`overwriteHostedManifest: true` option is a migration escape hatch and defaults to `false`:

```js
new TileflowWebpackPlugin({overwriteHostedManifest: true});
```

Webpack Dev Server is the only server needed for application capture. Keep it running and point the
short-lived headless command at the same loopback origin; do not run `tileflow dev` beside it:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:8080 npx tileflow capture app-desktop
```

## Compatibility

The supported peer window is Webpack 5.61 or newer within major 5, on Node.js 22 or newer. Older
Webpack 5 releases depend on OpenSSL's disabled MD4 implementation and cannot complete this
package's minimum-Node build without a legacy-provider workaround. CI installs Webpack 5.61.0 with
packed Tileflow tarballs and runs a production compiler using the real plugin. Webpack 6 stays
outside the peer range until that smoke passes.

Docs: https://tileflow.dev/docs
