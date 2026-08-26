# Map inheritance contract

Tileflow exposes one public cartographic unit: a map. Every `tileflow.config.ts` exports exactly one
map, and a map is either a compiler root or an ordinary map that imports another map object through
`extends`. Root and derived maps use the same design fields. Inheritance is resolved completely
before validation, asset preparation, compilation, capture, build, or deploy.

`streets` and `ferraris` are the two first-party root maps. `streetsDark`, `cyberpunk`, and
`verdant` are ordinary maps that extend Streets. Ferraris selects the same semantic Streets
compiler as its root contract but defines its complete design directly: it does not import or
extend the Streets map. They are exported from `@tileflow/maps`; there is no public basemap,
map-preset, map-catalog, `streets()` constructor, `editorial-city` alias, or compatibility
normalization.

## Resolution

Each public field has one explicit merge rule:

- The leaf owns `id`, `name`, `version`, `scenes`, and `delivery`; those fields never inherit.
- Omitted design fields inherit.
- `theme`, `light`, and `view` merge recursively. A theme is always an object, and it inherits only
  because the map itself extends another map. There are no named theme references, theme registry,
  or `theme.extends` field.
- `data`, `projection`, and `terrain` replace atomically when declared.
- `modules` merges by domain name. Declaring `roads(...)`, for example, replaces that inherited
  module request and every compiler-owned contribution belonging to roads. Omitted domains remain
  inherited; `enabled: false` removes a domain and all of its effects.
- `icons`, `fonts`, and `glyphs` follow the asset rules below.

Arrays inside ordinary design objects replace; MapLibre expressions and Tileflow zoom values are
atomic. Map identity remains the leaf identity, every lineage must terminate at one supported root,
and circular, malformed, or over-deep inheritance fails closed. There is no public physical-layer
override key.

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
`ferrarisIcons`, `cyberpunkIcons`, and `verdantIcons` let maps reuse package assets without exposing
installation paths. Ferraris declares only `[ferrarisIcons]`; its nine original SVG patterns do not
compose with Streets assets. There is no `builtin`, `source`, `sprite`, icon-level `extends`,
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

Streets and Ferraris each declare the canonical
`https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf` URL with `Noto Sans Regular` and
`Noto Sans Bold`, and Verdant inherits it from Streets. The URL is canonical rather than
content-addressed; responses revalidate and the URL is not an exact-byte identity. It is stated
directly in each root, not synthesized as a fallback. The reproducible replacement is an explicit
`/base/<assetSetSha256>/glyphs/...` URL backed by one validated immutable global base-asset
manifest.
Cyberpunk instead replaces the provider with its packaged font directory and uses the exact local
names `Oxanium Medium` and `Oxanium SemiBold`.

## Build and runtime

The resolved build output is a standalone MapLibre Style JSON plus the exact prepared sprite and
font assets it references. Final style validation rejects missing `icon-image`, `fill-pattern`, or
`line-pattern` IDs and missing primary local font faces.

The build manifest's `mapRevisionSha256` is a content identity for resolved cartography, not a
second editorial version. It hashes the effective design, compiler family, compiler-owned effective
contributions, and source icon/font identities. Leaf `id`, `name`, `version`, `view`, `scenes`, and
`delivery` remain on their owning manifest, Style, capture, or deployment contracts and do not
change the cartographic revision. `styleSha256` identifies compiled Style JSON and the per-map
`assetSetSha256` identifies that build's generated runtime resources. The latter uses the
`tileflow-map-asset-set-v1` hash domain; it is not the `assetSetSha256` from the global base-asset
manifest embedded in an official immutable glyph URL.

Browser clients never import `tileflow.config.ts`, resolve `extends`, or infer a development URL.
They consume runtime manifest version 3. A Tileflow runtime source resolves its named map through
that strict self-hosted or hosted manifest; a direct MapLibre source is the explicit escape hatch
for a style object or URL.
