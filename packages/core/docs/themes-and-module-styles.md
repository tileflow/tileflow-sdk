# Themes and module styles

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

A map declares complete named appearances in `themes`, chooses one deterministic
`defaultTheme`, and may map the browser's light/dark preference through `systemThemes`. `system` is
never a compiled theme name: it is a runtime request that resolves immediately to one concrete
name. Disk builds write `styles/<map>/<theme>.json` beneath their output root. Public and
content-addressed Style URLs belong to the runtime manifest and may include a deployment prefix;
capture scenes and receipts store the concrete name rather than `system`.

Themes are flat, JSON-safe documents with `colorScheme`, identity, typography, lighting, and four
typed token catalogs: `color`, `font`, `image`, and `number`. Every theme on one map must expose the
same token keys, so changing a theme can never change map structure or silently lose a semantic
role. `defineTheme(base, definition)` is an authoring convenience that returns a fully materialized
document; it does not leave an inheritance edge in the resolved config.

The key in the `themes` record is its concrete runtime selector and output-path segment. The
theme's own `id` and `version` are its editorial identity and build provenance, so they need not
equal that key. Concrete keys may be names such as `day` and `night`; every `systemThemes.light` or
`systemThemes.dark` value must name an existing theme whose `colorScheme` matches that branch.

```ts
import {color, defineMap, defineTheme, fixed, roads, token} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

const dark = defineTheme(streetsThemes.dark, {
  id: 'company-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {
    color: {
      'surface.land': '#101722',
      'labels.primary': color.mix('#eef3fb', token.color('surface.background'), {amount: 0.08}),
    },
  },
});

export default defineMap({
  id: 'company',
  version: 1,
  extends: streets,
  themes: {light: streetsThemes.light, dark},
  defaultTheme: 'light',
  systemThemes: {light: 'light', dark: 'dark'},
  modules: {
    roads: roads({
      classes: {
        primary: {
          surface: {
            fill: {
              color: fixed('#ff2d78', {reason: 'Regulatory primary-road ink is invariant'}),
            },
          },
        },
        secondary: {
          surface: {
            fill: {
              color: token.color('roads.secondary'),
            },
          },
        },
      },
    }),
  },
});
```

Semantic modules own structure and behavior; visual fields accept typed token references.
Use a visual literal only inside a theme. If a module value intentionally must not vary, wrap it in
`fixed(value, {reason})`. `tileflow inspect --json` reports stable `THEME_IMPLICIT_FIXED`
diagnostics: implicit color, font, and image literals block Style compilation, while direct visual
number literals are warnings so an agent can document their invariance deliberately. Structural
numbers such as zoom bounds and ranks are not visual-theme diagnostics. `color.alpha()` and
deterministic OKLCH `color.mix()` keep derived palette logic inspectable. Unknown refs, cycles,
cross-category refs, token-schema drift, and unresolved visual nodes fail before Style JSON is
emitted.

There is no physical-layer override for the Tileflow basemap or separate official-map authoring
surface. Basemap behavior belongs to a typed control or owner-local render stack. Every
official and application map therefore follows the same schema, inheritance rules, diagnostics,
and lowering path. `createStyle()` validates the final planned Style JSON with the MapLibre style
spec and never returns an invalid style.
