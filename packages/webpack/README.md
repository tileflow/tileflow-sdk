# @tileflow/webpack

Webpack plugin for local Tileflow style development and static build artifacts.

```js
import {TileflowWebpackPlugin} from '@tileflow/webpack';

export default {
  plugins: [new TileflowWebpackPlugin()],
};
```

When used with `webpack-dev-server`, the plugin serves `/tileflow/manifest.json`
and `/tileflow/styles/:mapName.json` from `tileflow.config.ts`. Production builds
emit the same files as assets.

Webpack Dev Server is the only server needed for application capture. Keep it running and point the
short-lived headless command at the same loopback origin; do not run `tileflow dev` beside it:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:8080 npm exec --no -- tileflow capture app-desktop
```

Docs: https://tileflow.dev/docs
