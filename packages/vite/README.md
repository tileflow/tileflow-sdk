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

The Vite process is the only application server needed. It watches config, transitive imports, and
local icons, serves the Tileflow manifest/styles/sprites, and reloads from the latest valid
generation. To capture an application scene, keep `vite` running and point the short-lived headless
command at that same loopback origin; do not start `tileflow dev`:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:5173 npm exec --no -- tileflow capture app-desktop
```

Docs: https://tileflow.dev/docs
