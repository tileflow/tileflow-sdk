# Map inheritance contract

Tileflow exposes one public cartographic unit: a map. Every `tileflow.config.ts` exports exactly one
map. A map is either standalone or imports another map object through `extends`; both forms use the
single `defineMap()` constructor and the same design fields. The semantic compiler is implicit.
Inheritance is resolved completely
before validation, asset preparation, compilation, capture, build, or deploy.

`streets`, `cyberpunk`, `ferraris`, `harad`, `matrix`, `siegfried`, `soundings`, and `verdant` are
first-party standalone maps. Streets and Siegfried own coordinated light and dark themes. Every
official map defines its complete design directly: none imports or extends
another official map, and each declares only its own asset providers. They are exported from
`@tileflow/maps`; there is no public basemap,
map-preset, map-catalog, `streets()` constructor, `editorial-city` alias, or compatibility
normalization.

## Resolution

Each public field has one explicit merge rule:

- The leaf owns `id`, `name`, `version`, `scenes`, and `delivery`; those fields never inherit.
- Omitted design fields inherit.
- `view` merges recursively.
- `themes` replaces as one complete collection when declared; omission inherits it. Replacing the
  collection clears an inherited `systemThemes` mapping so it cannot point into an obsolete family.
  `defaultTheme` may independently select one inherited concrete theme, and an explicit
  `systemThemes` replaces the complete light/dark mapping. Every resolved selector must name a
  member of the final collection.
- `data`, `projection`, and `terrain` replace atomically when declared.
- `modules` merges by domain name. Declaring `roads(...)`, for example, replaces that inherited
  module request and every compiler-owned contribution belonging to roads. Omitted domains remain
  inherited; `disable()` removes a domain and its complete owner-local render stack.
- `icons`, `fonts`, and `glyphs` follow the asset rules below.

Arrays inside ordinary design objects replace; MapLibre expressions and Tileflow zoom values are
atomic. Map identity remains the leaf identity, every lineage must terminate at one standalone map,
and circular, malformed, or over-deep inheritance fails closed. There is no public physical-layer
override key.

## Themes

Every standalone map has at least one named `TileflowTheme` and one `defaultTheme`. A theme is a complete,
inheritance-free visual document with identity, `colorScheme`, typography, lighting, and flat
`color`, `font`, `image`, and `number` token catalogs. All themes in one resolved map must expose
the same category/key schema. The reserved name `system` is a browser selector, never a stored or
compiled theme.

Domain modules and owner-local render stacks retain map structure and refer to visual roles through
`token.color()`, `token.font()`, `token.image()`, or `token.number()`. `fixed(value, {reason})`
marks a deliberately invariant visual module value. Theme refs resolve recursively through module
objects, zoom stops, supported color operations, terrain, typography, lighting, and expressions
before final schema and MapLibre validation. Unknown refs, cycles, category mismatches,
token-schema drift, and unresolved nodes fail closed.

`defineTheme(base, definition)` is a construction helper, not runtime inheritance: its return value
is a fully materialized JSON-safe theme. Changing a theme therefore changes appearance only; data,
filters, module ownership, semantic interactions, layer ordering, and asset-directory ownership
remain map concerns.

## Icons

`icons` is one ordered array of `TileflowIconDirectory` values:

```ts
import {defineMap} from '@tileflow/core';
import {cyberpunkIcons, streets, streetsIcons} from '@tileflow/maps';

export default defineMap({
  id: 'brand-map',
  version: 1,
  extends: streets,
  icons: [streetsIcons, cyberpunkIcons, './icons'],
});
```

Omitting `icons` inherits the parent's exact array. Declaring `icons` replaces that array
atomically, and `icons: []` means no icons. To add to an imported map deliberately, compose the
array explicitly:

```ts
icons: [...streets.icons, './icons'];
```

Directories are read from left to right. `<id>.<ext>` publishes an ordinary icon as `<id>`;
`<id>.pattern.<ext>` publishes an intrinsic-size line/fill pattern as `<id>`. That published ID must
already be canonical lower-kebab-case. A later directory replaces an earlier file only when the ID
matches exactly; case-only collisions fail. The official directory descriptors `streetsIcons`,
`ferrarisIcons`, `haradIcons`, `siegfriedIcons`, `soundingsIcons`,
`cyberpunkIcons`, `matrixIcons`, and `verdantIcons` let maps reuse package assets without exposing
installation paths. Ferraris, Härad, Siegfried, Soundings, and Verdant declare only
`[ferrarisIcons]`, `[haradIcons]`, `[siegfriedIcons]`, `[soundingsIcons]`, and `[verdantIcons]`,
respectively; none of these standalone maps composes with Streets assets. Härad's nine original Tileflow SVG
patterns are inspired by Lantmäteriet's CC0 Häradsekonomiska kartan series (1859–1934) and official
legend, without redistributing source scans, pixels, legend artwork, fonts, or map data. Siegfried
owns nine light/dark engraving-motif pairs in one directory; both themes select the same semantic
image vocabulary without changing map structure. Soundings
owns ten original nautical symbols and patterns; GEBCO-derived depth bands are broad visual context,
not navigation-grade soundings. There is no `builtin`, `source`, `sprite`, icon-level `extends`,
`mapping`, or additive operator.

A local directory resolves from the directory containing the selected `tileflow.config.ts`. Its
only accepted spelling starts with `./` or one or more leading `../` segments; every remaining
segment is non-empty and is neither `.` nor `..`. Trailing or repeated slashes, backslashes,
controls, and paths longer than 512 characters are invalid. The workspace `cwd` remains the
containment boundary, so a config-relative directory may not escape it.

## Text assets

A map may declare either `fonts` or `glyphs`, never both. Omitting both inherits the current text
provider. Declaring either one atomically replaces an inherited provider of either kind.

`fonts` is an ordered array of local or package font directories. Node preparation derives exact
font IDs from each file's OpenType full name, applies directories left to right, requires
`LICENSE.txt` beside contributing fonts, and emits only the faces used by the final style. A later
directory replaces an earlier face with the same exact ID; case-only collisions fail. `font` names
an exact OpenType full name. Local `fallbacks` name exact faces or explicit CSS generic families.
Tileflow does not combine a family name with a weight or synthesize font IDs.

`glyphs` is one complete URL provider owned by the map. It enumerates the exact comma-joined
MapLibre request keys produced by `text-font` arrays in `fontStacks`:

```ts
const tileflowGlyphs = {
  kind: 'url',
  url: 'https://assets.tileflow.dev/base/<assetSetSha256>/glyphs/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
} as const;

const privateGlyphs = {
  kind: 'url',
  url: 'https://cdn.example.com/glyphs/v1/{fontstack}/{range}.pbf',
  fontStacks: ['Brand Sans Regular', 'Brand Sans Bold'],
} as const;
```

Browser font files and native/PBF glyphs are different delivery mechanisms, so a config cannot
combine them or fall back silently between them. After inheritance resolves, every map that emits
text has exactly one provider; only a text-free map may have neither.

Streets, Ferraris, Härad, Soundings, and Verdant each declare the canonical
`https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf` URL with `Noto Sans Regular` and
`Noto Sans Bold`. The URL is canonical rather than content-addressed; responses revalidate and the
URL is not an exact-byte identity. It is stated directly in each standalone map, not synthesized as a
fallback. The reproducible replacement is an explicit
`/base/<assetSetSha256>/glyphs/...` URL backed by one validated immutable global base-asset
manifest.
Siegfried instead declares `[siegfriedFonts]` and uses the packaged exact faces
`Cormorant Garamond Regular`, `Cormorant Garamond SemiBold`, and `Cormorant Garamond Italic`.
Cyberpunk and Matrix each declare their own packaged font directory and use the exact local names
`Oxanium Medium` and `Oxanium SemiBold`.

## Build and runtime

The resolved build output is one standalone MapLibre Style JSON per concrete map/theme pair plus
the exact prepared sprite and font assets the family references. Final style validation rejects
missing `icon-image`, `fill-pattern`, or `line-pattern` IDs and missing primary local font faces.

The build manifest's `mapRevisionSha256` is a content identity for resolved cartography, not a
second editorial version. It hashes the effective resolved semantic design, semantic language,
public module/render-stack design, and source icon/font identities. Leaf `id`, `name`, `version`, `view`, `scenes`, and
`delivery` remain on their owning manifest, Style, capture, or deployment contracts and do not
change the cartographic revision. Each theme has its own `styleSha256`; the per-map
`assetSetSha256` identifies that build's generated runtime resources. The latter uses the
`tileflow-map-asset-set-v1` hash domain; it is not the `assetSetSha256` from the global base-asset
manifest embedded in an official immutable glyph URL.

Browser clients never import `tileflow.config.ts`, resolve `extends`, or infer a development URL.
They consume the single runtime manifest version 1 shape. A Tileflow runtime source resolves its
named map and concrete theme through that manifest; `system` requires the declared light/dark
mapping and browser color scheme. A direct MapLibre source is the explicit escape hatch for a style
object or URL.
