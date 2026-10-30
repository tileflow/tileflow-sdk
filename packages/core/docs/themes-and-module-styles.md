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

## Start with one appearance

A map can have one appearance for its entire lifetime. Neither `systemThemes` nor `timeOfDay` is
required. This complete theme supplies the twelve base color roles the semantic compiler needs;
copy it and change its colors to start an independent design without inheriting an official map:

<!-- docs:check -->

```ts
import {defineTheme} from '@tileflow/core';

export const paper = defineTheme({
  id: 'paper',
  version: 1,
  colorScheme: 'light',
  tokens: {
    color: {
      'surface.background': '#F6F7F3',
      'surface.land': '#F1F3ED',
      'surface.water': '#A9D3F5',
      'surface.park': '#CDE8B5',
      'surface.building': '#E6E3DA',
      'roads.default': '#FFFFFF',
      'roads.major': '#F4C95D',
      'roads.casing': '#D9DEE2',
      'boundaries.default': '#C9D1D9',
      'labels.primary': '#3C4043',
      'labels.muted': '#727B84',
      'labels.halo': '#FFFFFF',
    },
  },
});
```

An existing map definition can select this appearance with `themes: {paper}` and
`defaultTheme: 'paper'`. Supply that map's data and font assets separately; the default typography
uses `Noto Sans Regular`. A theme without these base roles is a valid appearance document but cannot
compile a semantic map. Colors above are an editable starting point, including for monochrome,
historical, dark-only, or imagined worlds; `colorScheme` describes the appearance for consumers and
does not generate a palette or choose a time of day.

The compiler derives more specific roles when they are absent. For example, primary and motorway
roads initially use `roads.major`; declaring `roads.motorway` replaces only that derived color.
Land-use fills, road casings, and label colors have their own semantic roles, so an explicit role
always wins over its fallback. Use `color.mix()` and `token.color()` in a theme when the relationship
itself should be authored and inspectable. Derivations resolve during compilation, without a clock
or a per-frame palette calculation.

Add named appearances when the map needs them. A day/night pair does not need dawn or dusk, and a
theme named `paper` or `fantasy` does not need a temporal family. Declare `timeOfDay` only when the
application should offer those artistic moments; see
[time-of-day selection](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/theme-transitions-and-blends.md#time-of-day).

## Compose and replace appearance values

Some optional tokens are for the application rather than the map's own layers. Route inks
(`route.line`, `route.casing`, `route.core`, `route.glow`, `route.alternative`,
`route.glow.opacity` and `route.core.opacity`) set how an application draws its routes; a theme
without them uses its colour scheme's defaults. The compiler publishes them in the style's metadata
and the theme controller returns them; see
[route drawing](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/route-drawing.md).

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

Theme lighting also supports explicit removal during `defineTheme` composition. Use
`lighting: reset()` to remove the entire inherited lighting configuration, or
`lighting: {sun: reset(), ambient: reset()}` to remove those presets while retaining other light
properties. The same operation can remove a direct property such as `position` or `color`.
Omitting a property, or supplying an empty object, continues to inherit it. Reset operations are
materialized immediately and never enter the resolved theme or Style JSON. Removing a lighting
preset restores the renderer's fallback; it does not disable 3D shadows or occlusion. Those remain
explicit building settings. See
[sun and light](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/sun-and-light.md#replace-inherited-lighting)
for a complete example.

There is no physical-layer override for the Tileflow basemap or separate official-map authoring
surface. Basemap behavior belongs to a typed control or owner-local render stack. Every
official and application map therefore follows the same schema, inheritance rules, diagnostics,
and lowering path. `createStyle()` validates the final planned Style JSON with the MapLibre style
spec and never returns an invalid style.
