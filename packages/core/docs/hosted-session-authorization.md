# Hosted session authorization

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

The framework adapters use `createTileflowSessionController` to obtain one short-lived session
grant before eligible hosted style, tile, font, or sprite requests. Concurrent resources share the
same preflight, grants are attached only to reviewed HTTP(S) origins, and an expired unused session
rotates once when the server requests it. A controller also rotates after six hours or 10,000
eligible requests. The preflight has a 10-second client timeout by default; direct controller users
can set `grantTimeoutMs` from 1 to 120,000 milliseconds.

`analytics.enabled: false` disables only the optional analytics beacon. It does not disable this
server-owned commercial authorization. User `transformRequest` callbacks still run first; Tileflow
then decorates only the resulting eligible URL and preserves the other request options.

Set `analytics.surfaceId` to a stable product location when the same Map appears in several places:

```ts
const analytics = {surfaceId: 'store-locator'};
```

A Surface ID is 1–64 lowercase ASCII letters, digits, `.`, `_`, or `-`; it starts and ends with a
letter or digit. Missing or invalid values become `default`. Use a durable integration name such as
`checkout` or `dealer-search`, not a URL, branch, preview, random component instance, or user ID.
Surface labels do not change authorization, entitlement, or Session identity.

For exact Tileflow World release tiles, framework adapters also use the browser request bridge to
observe the response's safe fair-use state without adding identity, query parameters, credentials,
or user headers to the public World URL. The bridge requires the immutable release path and exactly
one lowercase descriptor digest; the retired mutable World template is never intercepted. Early
`GRACE` stays silent; signed late `GRACE` creates a compact
accessible owner-action pill, and `MANAGED_REQUIRED` creates a stronger in-map banner. A missing
header, absent tile, MapLibre error, or failed response cannot erase an existing manage action; a
later successful `OPEN` response can clear it. Shaped empty tiles remain render-safe while the owner
action stays available. Successful World tile bodies are streamed with a 16 MiB maximum: an
oversized `Content-Length` is rejected before reading, and chunked responses are cancelled as soon
as their accumulated bytes cross the same bound. Abort signals cancel an active reader; errors do
not include the remote response body.

Other subpaths under `src/`, `themes/`, `templates/`, and `modules/` are internal implementation
details and can change during alpha releases.

Official map definitions and the source assets they own ship together in `@tileflow/maps`, not in
Core. That package exports the maps and their reusable directory descriptors:

```ts
import {
  baedeker,
  baedekerFonts,
  baedekerIcons,
  cyberpunk,
  cyberpunkFonts,
  cyberpunkIcons,
  ferraris,
  ferrarisIcons,
  harad,
  haradIcons,
  matrix,
  matrixFonts,
  matrixIcons,
  sanFrancisto,
  sanFrancistoIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  soundings,
  soundingsIcons,
  streets,
  streetsIcons,
  streetsThemes,
  verdant,
  verdantIcons,
} from '@tileflow/maps';
```

All ten official maps are complete standalone maps. The sole semantic compiler is implicit; none
imports or extends another official map, and each declares its own icon directory.
Streets declares `[streetsIcons]` and exposes its complete coordinated appearances as
`streetsThemes.light` and `streetsThemes.dark`; image tokens select the matching sidewalk pattern
without changing the asset collection. Baedeker declares `[baedekerIcons]`, whose eight original
patterns support its travel-atlas design, and `[baedekerFonts]`, its own Cormorant Garamond
directory; it derives contours in the browser from unpackaged Mapterhorn terrain tiles. Cyberpunk
declares `[cyberpunkIcons]` and `[cyberpunkFonts]`; Matrix
independently declares `[matrixIcons]` and `[matrixFonts]`. San Francisto declares
`[sanFrancistoIcons]` for its four technical hatches and schematic POI node, derives contours from
unpackaged Mapterhorn tiles, and uses the canonical Noto Sans glyph provider. The same asset
operation is available to applications:

```ts
export default defineMap({
  id: 'brand-map',
  version: 1,
  extends: streets,
  icons: [...streets.icons, './icons'],
});
```

`icons` is a `readonly TileflowIconDirectory[]`. Omission inherits the parent's exact array,
declaration replaces it atomically, and `[]` means no icons. Directories apply left to right.
`<id>.<ext>` publishes an icon as `<id>`; `<id>.pattern.<ext>` publishes an intrinsic-size pattern
as `<id>`. The published ID must already be canonical lower-kebab; a later exact ID wins and a
case-only collision fails. There is no built-in selector, source object, external
sprite selector, icon mapping, icon-specific inheritance, additive command, or compatibility alias.

`@tileflow/dev` resolves local and package directory descriptors, verifies real-path containment,
and prepares ordinary public artifacts without serializing installation paths. It compiles one
deterministic sprite from the final icon composition and validates every literal `icon-image`,
`fill-pattern`, and `line-pattern` in the final style against it. It also prepares any declared font
directories generically; `baedekerFonts`, `cyberpunkFonts`, `matrixFonts`, and `siegfriedFonts` are
ordinary package descriptors rather than pipeline special cases. Calling the pure compiler for a map whose style needs unprepared
assets fails instead of emitting broken runtime references.
