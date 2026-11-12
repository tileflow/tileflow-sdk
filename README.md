<p align="center">
  <a href="https://tileflow.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/tileflow-logo-dark.svg">
      <img alt="Tileflow" src=".github/assets/tileflow-logo-light.svg" width="240">
    </picture>
  </a>
</p>

# Tileflow SDK

[![npm](https://img.shields.io/npm/v/%40tileflow%2Fcore/alpha?label=%40tileflow%2Fcore)](https://www.npmjs.com/package/@tileflow/core)
[![CI](https://github.com/tileflow/tileflow-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/tileflow/tileflow-sdk/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Create and customize maps in TypeScript. Preview them locally and use them in your application
with MapLibre. Start from an official map, adjust its themes, roads, and labels, and keep your
design in one `tileflow.config.ts`.

[Documentation](https://tileflow.dev/docs) · [Gallery](https://tileflow.dev/gallery) · [Quickstart](https://tileflow.dev/docs/get-started/quickstart)

[![Six maps made with the Tileflow SDK: clustered restaurants over Miami's streets, a popup on the Royal Palace of Madrid in 3D at dusk, a trail with its elevation profile around the Matterhorn, bike-station markers on a playful 3D map of Madrid, a nautical chart near the Golden Gate, and a numbered walking tour on an engraved-style map of Paris.](.github/assets/showcase.jpg)](https://tileflow.dev/gallery)

**Made with the Tileflow SDK** (left to right, top to bottom):
[clustered points](https://tileflow.dev/docs/examples/cluster-points) over [Streets](https://tileflow.dev/gallery?map=streets) in Miami;
a [popup](https://tileflow.dev/docs/examples/show-a-popup-on-click) on the Royal Palace of Madrid with [3D landmarks](https://tileflow.dev/docs/examples/show-3d-landmarks), at dusk;
a trail and its elevation profile, read from [3D terrain](https://tileflow.dev/docs/map-design/terrain-and-globe), on [Outdoors](https://tileflow.dev/docs/map-design/basemaps) around the Matterhorn;
[custom markers](https://tileflow.dev/docs/examples/use-custom-marker-content) for bike stations on the [Super Tile World](https://tileflow.dev/gallery?map=super-tile-world) community map in Madrid;
soundings, buoys, and lights near the Golden Gate;
a walking tour drawn as a [dashed line](https://tileflow.dev/docs/examples/draw-a-dashed-line) on the [Baedeker](https://tileflow.dev/gallery?map=baedeker) community map of Paris.
Map data © [OpenStreetMap contributors and other sources](https://tileflow.dev/copyright).

## Create your first map

Use Node.js 22.14+ (22.x) or 24+, npm, and a browser with WebGL support. The SDK is in alpha;
install the alpha channel explicitly and keep your lockfile.

```sh
mkdir my-map
cd my-map
npm init -y
npm install --save-exact @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact tileflow@alpha
```

Create `tileflow.config.ts`:

<!-- docs:check -->

```ts
import {defineMap, labels} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  modules: {
    labels: labels({roads: 'major'}),
  },
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

Coordinates are `[longitude, latitude]`. This map inherits Streets' design, themes, and assets.

Validate it and open the local preview:

```sh
npx tileflow validate
npx tileflow preview
```

Open the local URL printed in the terminal to explore Madrid. Change `zoom` to `14`, save,
and reload the preview to see a closer view. Stop the server with Ctrl+C.

Local authoring and preview need no Tileflow account or API key. Keep an internet connection
for the map's remote tiles and assets. See the [quickstart](https://tileflow.dev/docs/get-started/quickstart)
for a walkthrough and troubleshooting.

## Make it yours

- **Design your map:** choose a [basemap](https://tileflow.dev/docs/map-design/basemaps), edit
  [themes](https://tileflow.dev/docs/map-design/themes-and-tokens), and style
  [roads, buildings, and labels](https://tileflow.dev/docs/map-design/modules).
- **Add it to an app:** follow the [React](https://tileflow.dev/docs/integrations/react),
  [Vue](https://tileflow.dev/docs/integrations/vue) or [Svelte](https://tileflow.dev/docs/integrations/svelte)
  guide, or mount it in any element with [`@tileflow/dom`](packages/dom/README.md) (pre-release).
- **Create images:** capture maps and compare designs with the [Capture package](packages/capture/README.md).
- **Review map changes:** see before and after renders in pull requests with the [visual review action](packages/visual-review-action/README.md).
- **Ship your map:** [build production assets](https://tileflow.dev/docs/development-and-deployment/production-builds),
  then [self-host](https://tileflow.dev/docs/development-and-deployment/self-hosting) or
  [deploy to Tileflow](https://tileflow.dev/docs/development-and-deployment/deployment).
- **Automate your data:** build and publish tilesets from GitHub workflows with the [tileset action](packages/tileset-action/README.md).

## Packages

| Task                      | Packages                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define and customize maps | [`@tileflow/core`](packages/core/README.md), [`@tileflow/maps`](packages/maps/README.md)                                                                                                                |
| Work from the terminal    | [`tileflow`](packages/cli/README.md)                                                                                                                                                                    |
| Render web maps           | [React](packages/react/README.md), [Vue](packages/vue/README.md), [Svelte](packages/svelte/README.md), [DOM](packages/dom/README.md)                                                                    |
| Integrate with your build | [Vite](packages/vite/README.md), [Next.js](packages/next/README.md), [Webpack](packages/webpack/README.md)                                                                                              |
| Add markers and popups    | [`@tileflow/interactions`](packages/interactions/README.md)                                                                                                                                             |
| Capture and render images | [`@tileflow/capture`](packages/capture/README.md), [`@tileflow/static`](packages/static/README.md)                                                                                                      |
| Use location services     | [Search](packages/search/README.md), [Routing](packages/routing/README.md), [Elevation](packages/elevation/README.md), [GeoIP](packages/geoip/README.md), [Coordinates](packages/coordinates/README.md) |

Browse [all packages](packages) for custom integrations and native work. The
[React Native SDK](packages/react-native/README.md) is pre-release and is not yet published.
Each service package documents its access requirements.

## Documentation and support

Start with the [documentation](https://tileflow.dev/docs), explore
[community maps](https://github.com/tileflow/community-maps), or
[report an issue](https://github.com/tileflow/tileflow-sdk/issues).
Coding agents can use the [documentation index](llms.txt).

Package versions advance independently. GitHub `main` can be ahead of npm; use your installed
package's README, reference, and types for its supported behavior.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and contribution guidelines.

## License

[Apache-2.0](LICENSE). [Trademark rules](TRADEMARKS.md) and third-party notices apply separately.
Preserve the attribution supplied with maps, fonts, icons, and data sources.
