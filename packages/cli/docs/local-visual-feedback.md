# Local visual feedback

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

Explore with capture itself. The first run may install Playwright's exact pinned Chromium headless
shell into its versioned per-user cache:

```sh
npx tileflow capture \
  --map madrid \
  --theme dark \
  --center=-3.69201,40.40871 \
  --zoom=16.15 \
  --width=1200 \
  --height=1200 \
  --json
```

The successful entry includes a normalized `definition` with its concrete `theme`, `camera`,
`viewport`, and default map `target`. Copy it under a chosen `scenes.<name>` key; the CLI never rewrites
executable TypeScript config. Then commit the bounded scene so agents and CI render the same map,
camera, and viewport:

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  scenes: {
    'madrid-desktop': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'madrid-product': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 390, height: 844, dpr: 2},
      target: {
        kind: 'application',
        path: '/maps/madrid',
        captureId: 'product-map',
      },
    },
  },
});
```

`scenes` is tooling metadata owned by this map. It is not inherited and does not enter the
cartographic compiler; tooling supplies the exported map ID when it normalizes a scene internally.
Every scene stores a concrete theme; omission and browser-only `system` are invalid.

### Live comparison workbench

Use the ordinary preview server with a right-hand selection to compare two maps or themes while
authoring:

```sh
# Two maps or themes from one config.
npx tileflow preview \
  --map harad --theme light \
  --against-map ferraris --against-theme light

# Or compare against another config.
npx tileflow preview \
  --config ./candidate.config.ts --map candidate \
  --against-config ./reference.config.ts --against-map reference
```

Any `--against-*` option opens the comparison workbench. Both previews remain same-origin and share
one synchronized camera. The toolbar switches between side-by-side, split, opacity overlay, and
blink modes; the selected mode, camera, split, opacity, and active interaction side survive in the
URL. Each config has its own watched, last-known-good session, so an invalid edit shows bounded
diagnostics without discarding the last valid map and recovers automatically after a fix.

Enable **Inspect** and click a rendered feature to see its bounded feature data, paint/layout values,
zoom-curve samples, and compiler contribution sidecar. The sprite gallery shows the compiled atlas,
not source directories. **Copy scene** produces a concrete-theme scene for the current camera and
viewport; **Copy command** produces the corresponding capture command. The inspector sidecar exists
only in memory in this local workbench and is not emitted by `tileflow build`.

### Reproducible two-style review

For shareable evidence with exact pixels, use headless capture instead of the live preview:

```sh
npx tileflow visual compare \
  --config ./candidate.config.ts --map candidate --theme light \
  --against-config ./reference.config.ts --against-map reference --against-theme light \
  --center=-3.7038,40.4168 --zooms=12,14,16 \
  --width=1200 --height=800 --dpr=1 --region=0,0,1200,760 \
  --diff --open --json
```

`--against-config` is explicit and may name the same config. Both sides use one camera, viewport,
DPR, ordered zoom matrix, pinned browser session, and concrete theme. At most 16 zooms and 64 MiB
of aggregate embedded PNG data are accepted; an earlier preflight also caps the matrix at
67,108,864 aggregate physical pixels. The default transaction writes
`.tileflow/comparisons/compare.html`, a machine-readable sibling JSON document, and PNG/receipt-v4
pairs below `compare.assets`; `--diff` adds a highlighted diff when identities are comparable. The
HTML embeds every image, uses a restrictive CSP, performs no network request, and offers the same
side-by-side, wipe, overlay, and blink review modes.

`--region=x,y,width,height` selects one shared physical-pixel rectangle for compact appearance
profiles. Review JSON uses the explicit signed direction `rightMinusLeft`; the region does not crop
captures, changed-pixel metrics, or diffs.

Stdout and the sibling JSON use the same schema-version-1 `visual.compare` document: concrete
left/right selections, shared camera and viewport, zoom-sorted rows with Review v1 documents and
relative artifact paths, report/document paths, and sorted warnings. This document and the watch
NDJSON described below are versioned compatibility boundaries.

The asset directory also contains a bounded schema-version-1
`.tileflow-visual-compare.json` inventory. It assigns ownership only to the listed sibling assets
and records each exact SHA-256. A later successful transaction removes stale generated rows or
diffs only when that valid prior inventory names them, preserves unrelated files, and refuses a
managed asset that has been modified, replaced by a symlink/non-file, or grown beyond its bound.
`--force` does not weaken those ownership checks. The inventory is capped at 64 KiB and the complete
report, JSON, inventory, PNGs, receipts, stale cleanup, and optional diffs commit or roll back as one
file transaction.

Different pixels are ordinary review evidence and exit 0. A frame, dimension, runtime, or exact
data mismatch exits 1 and suppresses pixel metrics because the images are not comparable.
`--allow-data-mismatch` keeps a data-mismatch report inspectable with exit 0, but does not invent
pixel metrics. `--watch` observes both configs, cancels stale renders, preserves the last complete
report through invalid edits, and emits deterministic NDJSON with `--json`. An explicit report path
requires `--force` in watch mode; the managed default path is safely replaceable.

Watch events are `watching`, `building`, `invalid`, `recovered`, `generation-complete`, `failed`,
and `stopped`, with monotonic comparison generations and source-side generations where applicable.
Without `--allow-data-mismatch`, an incompatible generation emits `failed`, does not replace the
last complete report, and remains an unresolved failure; an allowed data mismatch emits
`generation-complete` but still has no pixel metrics. An orderly stop exits 0 only after at least
one complete generation and no unresolved invalid or failed state; otherwise it exits 1.

Render one checkpoint, or recapture after every edit:

```sh
npx tileflow capture madrid-desktop --json
npx tileflow capture --all --json
npx tileflow capture madrid-desktop --watch --json
```

Use the first command when you want a single image and the last command while refining a map. Watch
mode stays open, follows changes to the config, its local imports, and its effective icons and fonts,
and writes a new PNG after each valid edit. Keeping the browser ready makes repeated renders faster.
If an edit is invalid, the last good image remains in place and capture resumes automatically after
the fix. Stop watch mode with `Ctrl+C`. It accepts named committed scenes or `--all`, not exploratory
camera options.

Standalone scenes need no app server, account, API key, MCP service, system Chrome, or visible
window. The first command—or the first capture—may provision Playwright's pinned Chromium headless
shell in its versioned per-user cache. `--no-browser-install` makes a prepared/offline environment
strict. Tileflow never falls back to a system browser or packages the browser in npm.

For prepared or offline CI, install ahead of time with
`npx tileflow setup capture --json`. Use `setup capture --no-browser-install` or
`capture --no-browser-install` as an enforcement check that the exact shell is already cached.

For an application scene, its route and component props must render the committed camera. Tileflow
uses the camera in scene identity but does not mutate arbitrary application map state.

One-shot success JSON is one deterministic schema-version-1 document plus one newline. It contains
sorted scene/map/theme/target entries, relative output and receipt paths, image hash/dimensions/DPR,
renderer identity, remote-dependency state, and warnings; it contains no image bytes, credential,
origin, absolute path, user, or timestamp. Managed output is an atomic pair under
`.tileflow/captures/<scene>.png` and `<scene>.receipt.json`. `tileflow init` ignores managed captures
and `.tileflow/diffs` when creating a new `.gitignore`. Explicit output replacement requires
`--force`; symlinks and path escapes fail closed.

Each written receipt uses capture schema v4 and records the concrete theme. A Tileflow World
capture resolves its TileJSON once for
the whole capture session and records the exact `world-v1` release plus descriptor, archive, data
contract, and product-contract hashes. All selected scenes and retries therefore use one immutable
World release even if `current` moves while the command is running.

One-shot `--json` failures leave stdout empty and write exactly one deterministic failure document
to stderr with `code`, `phase`, bounded diagnostics, and optional origin-only resource metadata.

Watch JSON is NDJSON with monotonic `building`, `invalid`, `recovered`, `captured`, `failed`, and
`stopped` generation events. It watches config, transitive local imports, and effective icon/font
files, preserves the last good capture through invalid edits, cancels stale work, and reuses one
headless Browser. An orderly stop exits 0 only after a successful capture with no unresolved
terminal failure.

### Capture through the real application

Application scenes use the app's existing Vite, Next.js, Webpack, or custom loopback server. Start
only that normal server; Tileflow does not run a package script, scan ports, or start
`tileflow preview`:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 \
  npx tileflow capture madrid-product --json
```

The React, Vue, and Svelte wrappers expose `data-tileflow-map`, the resolved concrete
`data-tileflow-theme`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. The headless client selects exactly one target, verifies
the theme, and waits for idle. Use `--url` for one explicit full loopback URL, `--selector` to
override target selection, and `--frame map|viewport` to override framing. Origins and URLs must be
credential-free loopback HTTP(S) without fragments. Each navigation uses a fresh context without a
reused profile, cookies, local storage, or service workers.

### Match a reference and protect the result

While refining a style, compare the current scene with any reference screenshot:

```sh
npx tileflow visual analyze madrid-desktop \
  --reference ./design-reference.png --region=0,0,1200,760 --json
```

`visual analyze` renders exactly one committed scene and writes the current image and a JSON report
under `.tileflow/analysis` by default. The report includes both images' dimensions and dominant
colors. When their physical dimensions match, it also includes exact and perceptual pixel metrics,
mean channel difference, a high-contrast `.diff.png`, and signed
`appearance.actualMinusReference` luminance, OKLab, edge-density, and local-contrast evidence. The
optional region affects only those appearance metrics. The reference PNG is never modified or
treated as a baseline.

Once the map is approved, save it as the expected baseline and use that image to catch later
regressions:

```sh
# Save the reviewed current render as the expected baseline.
npx tileflow visual update madrid-desktop \
  --baseline-dir test/visual-baselines --json

# Compare a fresh render without changing the baseline.
npx tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --json

# Or apply the operation to every committed scene.
npx tileflow visual diff --all \
  --baseline-dir test/visual-baselines --json

# In CI, return exit 2 when the pixels have changed.
npx tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --fail-on changed --json
```

`visual diff` and `visual update` require either one or more positional scene names or `--all`;
those forms are mutually exclusive. `visual analyze` always accepts exactly one scene.

The baseline directory holds the reviewed expected PNG and its receipt. The files generated by a
comparison are working evidence: the current `.actual.png`, a transparent high-contrast
`.diff.png` when comparable, and a `.visual.json` report under `.tileflow/diffs` by default.
`visual diff` may replace those working files on each run, but it never changes the baseline. This
separation prevents a check from silently accepting the change it was meant to reveal.

Before comparing, `visual diff` validates the baseline PNG and receipt, including their hashes,
dimensions, runtime, and scene identity, without executing or fetching baseline metadata.
Statuses are `unchanged`, `changed`, `missing-baseline`, `scene-mismatch`, and `runtime-mismatch`.
Same-size images report exact RGBA changed pixels and an informational fixed-threshold perceptual
metric; exact inequality determines changed.

Changed pixels exit 0 by default so a person or agent can inspect the working files.
`--fail-on changed` exits 2 for CI; missing or incompatible baselines and operational failures exit 1.

Run `visual update` again only after reviewing and accepting the new render. It is the only
command that creates or changes baseline pairs, and it never stages, commits, or pushes. Remote
tiles, glyphs, and sprites are reported because their pixels can change independently of the style.
