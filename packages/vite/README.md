# @tileflow/vite

Vite plugin for local Tileflow style development and static build artifacts.

```ts
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';

export default defineConfig({
  plugins: [react(), tileflow()],
});
```

Omitting a component's `manifestUrl` is valid only when the public URL is exactly
`/tileflow/manifest.json`. With a Vite or Tileflow base, pass the resulting public URL explicitly;
the browser runtime deliberately does not guess bundler configuration:

```ts
export default defineConfig({
  base: '/app/',
  plugins: [react(), tileflow({base: '/maps'})],
});

// React; Vue and Svelte use the same source value.
const source = {
  kind: 'tileflow' as const,
  map: 'main',
  manifestUrl: '/app/maps/manifest.json',
};
```

Development and production expose that same prefixed URL.

Development snapshots local `hostedTileset()` archives for coherent preview requests. Production
builds reject unresolved local PMTiles before emitting Tileflow assets; they never copy, hash, or
deduplicate user datasets. Publish a managed tileset explicitly or provide an application-owned
production source. Development Style URLs remain stable by logical tileset ID while the served
snapshot changes by generation.

The Vite process is the only application server needed. It watches config, transitive imports, and
local icon/font files, serves the Tileflow manifest, styles, sprites, and prepared fonts, and reloads
from the latest valid generation. To capture an application scene, keep `vite` running and point the
short-lived headless command at that same loopback origin; do not start `tileflow dev`:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:5173 npm exec --no -- tileflow capture app-desktop
```

## Compatibility

The supported peer window is Vite 5-8 on Node.js 22 or newer. CI installs the exact first release
of each accepted Vite major with packed Tileflow tarballs, typechecks the plugin contract, and runs
a production Vite build. Future majors remain excluded until the same smoke passes.

Docs: https://tileflow.dev/docs
