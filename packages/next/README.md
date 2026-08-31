# @tileflow/next

Next.js adapter for local Tileflow style development and static build artifacts.

```ts
// next.config.ts
import {withTileflow} from '@tileflow/next';
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {};

export default withTileflow(nextConfig);
```

Omitting a component's `manifestUrl` is valid only for exactly
`/tileflow/manifest.json`. A Next `basePath` and/or custom Tileflow `base` changes the public URL,
so declare the same final URL in the component source:

```ts
const nextConfig: NextConfig = {basePath: '/app'};

export default withTileflow(nextConfig, {base: '/maps'});

const source = {
  kind: 'tileflow' as const,
  map: 'main',
  manifestUrl: '/app/maps/manifest.json',
};
```

The browser runtime does not discover `basePath`; the explicit URL keeps SSR and hydration on the
same manifest generation.

Add a catch-all App Router handler so `next dev` can serve fresh local styles from
`tileflow.config.ts`. `withTileflow()` rewrites `/tileflow/*` to this internal route only during
development; production uses the static files written to `public/tileflow`.

```ts
// app/api/tileflow/[[...tileflow]]/route.ts
import {createTileflowRouteHandlers} from '@tileflow/next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const {GET, HEAD} = createTileflowRouteHandlers({
  routeBase: '/api/tileflow',
});
```

During `next build`, `withTileflow()` writes static artifacts to
`public/tileflow`. During development, the route handler serves the same manifest,
styles, icon sprites, package-owned fonts, and immutable generation-local PMTiles snapshots without a
separate `tileflow dev` process. Repeated route-module evaluation reuses one process-wide watched
generation instead of rebuilding PMTiles per request. Production rejects unresolved local PMTiles
before writing Tileflow assets; publish managed data explicitly or provide an application-owned
production source. Development Style URLs remain stable by logical tileset ID while the served
snapshot changes by generation. Custom test/server harnesses that
own the returned handlers should call `await handlers.close()` during shutdown; the documented App
Router module intentionally keeps its shared handler for the server process lifetime.
Artifact generation works with both the default Turbopack build and `next build --webpack`.

`next dev` (or the production server used by a test fixture) remains the only server for
application capture. Run the short-lived headless command against it; never add a second standalone
Tileflow listener:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 npx tileflow capture app-desktop
```

## Compatibility

The supported peer window is Next.js 14-16 on Node.js 22 or newer. CI installs the exact first
release of every accepted Next.js major with packed Tileflow tarballs and compiles a minimal App
Router production build. Future majors remain excluded until that smoke passes.

Docs: https://tileflow.dev/docs
