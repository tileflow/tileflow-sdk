# @tileflow/cli

Command-line tools for Tileflow config, preview, validation, and hosted deploy.

Local config, validation, build, preview, and hosted-compatibility checks require
no Tileflow account or API key:

```sh
npm install --save-dev --save-exact @tileflow/cli@alpha
npm exec --no -- tileflow init
npm exec --no -- tileflow validate
npm exec --no -- tileflow validate --target hosted
npm exec --no -- tileflow dev
```

`npm exec --no --` runs the project-local CLI and fails instead of downloading
a missing package. Other package managers work; use the equivalent command for
the lockfile already owned by the project.

`tileflow dev` previews the first map by default and uses that map's configured `view`. Select a
different map or a committed standalone scene explicitly:

```sh
npm exec --no -- tileflow dev --map madrid
npm exec --no -- tileflow dev --scene madrid-mobile
```

A scene preview applies its committed camera and CSS viewport dimensions. Capture remains the
authority for exact DPR and pixels. `--map` and `--scene` are mutually exclusive, and scenes whose
target is an application must be viewed through that application's normal development server.

## Local visual feedback

Explore with capture itself. The first run may install Playwright's exact pinned Chromium headless
shell into its versioned per-user cache:

```sh
npm exec --no -- tileflow capture \
  --map madrid \
  --center=-3.69201,40.40871 \
  --zoom=16.15 \
  --width=1200 \
  --height=1200 \
  --json
```

The successful entry includes a normalized `definition` with only `map`, `camera`, `viewport`, and
the default map `target`. Copy it under a chosen `scenes.<name>` key; the CLI never rewrites
executable TypeScript config. Then commit the bounded scene so agents and CI render the same map,
camera, and viewport:

```ts
export default {
  maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}}},
  scenes: {
    'madrid-desktop': {
      map: 'madrid',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'madrid-product': {
      map: 'madrid',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 390, height: 844, dpr: 2},
      target: {
        kind: 'application',
        path: '/maps/madrid',
        captureId: 'product-map',
      },
    },
  },
};
```

Render one checkpoint, or recapture after every edit:

```sh
npm exec --no -- tileflow capture madrid-desktop --json
npm exec --no -- tileflow capture --all --json
npm exec --no -- tileflow capture madrid-desktop --watch --json
```

Use the first command when you want a single image and the last command while refining a map. Watch
mode stays open, follows changes to the config, its local imports, and its icons, and writes a new
PNG after each valid edit. Keeping the browser ready makes repeated renders faster. If an edit is
invalid, the last good image remains in place and capture resumes automatically after the fix. Stop
watch mode with `Ctrl+C`. It accepts named committed scenes or `--all`, not an exploratory `--map`
capture.

Standalone scenes need no app server, account, API key, MCP service, system Chrome, or visible
window. The first command—or the first capture—may provision Playwright's pinned Chromium headless
shell in its versioned per-user cache. `--no-browser-install` makes a prepared/offline environment
strict. Tileflow never falls back to a system browser or packages the browser in npm.

For prepared or offline CI, install ahead of time with
`npm exec --no -- tileflow setup capture --json`. Use `setup capture --no-browser-install` or
`capture --no-browser-install` as an enforcement check that the exact shell is already cached.

For an application scene, its route and component props must render the committed camera. Tileflow
uses the camera in scene identity but does not mutate arbitrary application map state.

One-shot success JSON is one deterministic schema-version-1 document plus one newline. It contains
sorted scene/map/target entries, relative output and receipt paths, image hash/dimensions/DPR,
renderer identity, remote-dependency state, and warnings; it contains no image bytes, credential,
origin, absolute path, user, or timestamp. Managed output is an atomic pair under
`.tileflow/captures/<scene>.png` and `<scene>.receipt.json`. `tileflow init` ignores managed captures
and `.tileflow/diffs` when creating a new `.gitignore`. Explicit output replacement requires
`--force`; symlinks and path escapes fail closed.

One-shot `--json` failures leave stdout empty and write exactly one deterministic failure document
to stderr with `code`, `phase`, bounded diagnostics, and optional origin-only resource metadata.

Watch JSON is NDJSON with monotonic `building`, `invalid`, `recovered`, `captured`, `failed`, and
`stopped` generation events. It watches config, transitive local imports, and effective icon files,
preserves the last good capture through invalid edits, cancels stale work, and reuses one headless
Browser. An orderly stop exits 0 only after a successful capture with no unresolved terminal
failure.

### Capture through the real application

Application scenes use the app's existing Vite, Next.js, Webpack, or custom loopback server. Start
only that normal server; Tileflow does not run a package script, scan ports, or start `tileflow dev`:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 \
  npm exec --no -- tileflow capture madrid-product --json
```

The React, Vue, and Svelte wrappers expose `data-tileflow-map`, optional
`data-tileflow-capture-id`, and `data-tileflow-state="loading|idle|error"`. The headless client
selects exactly one target and waits for idle. Use `--url` for one explicit full loopback URL,
`--selector` to override target selection, and `--frame map|viewport` to override framing. Origins
and URLs must be credential-free loopback HTTP(S) without fragments. Each navigation uses a fresh
context without a reused profile, cookies, local storage, or service workers.

### Match a reference and protect the result

While refining a style, compare the current scene with any reference screenshot:

```sh
npm exec --no -- tileflow visual analyze madrid-desktop \
  --reference ./design-reference.png --json
```

`visual analyze` renders exactly one committed scene and writes the current image and a JSON report
under `.tileflow/analysis` by default. The report includes both images' dimensions and dominant
colors. When their physical dimensions match, it also includes exact and perceptual pixel metrics,
mean channel difference, and a high-contrast `.diff.png`. Inspect those files, adjust the style,
and run the command again. The reference PNG is never modified or treated as a baseline.

Once the map is approved, save it as the expected baseline and use that image to catch later
regressions:

```sh
# Save the reviewed current render as the expected baseline.
npm exec --no -- tileflow visual update madrid-desktop \
  --baseline-dir test/visual-baselines --json

# Compare a fresh render without changing the baseline.
npm exec --no -- tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --json

# In CI, return exit 2 when the pixels have changed.
npm exec --no -- tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --fail-on changed --json
```

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
`--fail-on changed` exits 2 for CI; missing or incompatible baselines and operational failures exit

1. Run `visual update` again only after reviewing and accepting the new render. It is the only
   command that creates or changes baseline pairs, and it never stages, commits, or pushes. Remote
   tiles, glyphs, and sprites are reported because their pixels can change independently of the style.

## Inspect vector features

See which bounded source features the selected map sees near a camera before tuning taxonomy,
rank, or labels:

```sh
npm exec --no -- tileflow inspect features \
  --map madrid --center=-3.6927512,40.4086555 --zoom=16 \
  --layers=poi --properties=name,class,subclass,rank --json
```

The command supports HTTP(S) TileJSON/vector sources and returns only requested properties plus
geometry summaries in stable order. Viewport, tiles, bytes, scanned/returned features, names, and
timeouts are bounded. Safe provenance includes origins, a query-free TileJSON path, and configured
source revision or `null`; credentials, URL queries, hidden properties, response bodies, and
absolute paths are omitted. It is read-only apart from executable config's own possible side
effects and removes `TILEFLOW_API_KEY` before loading config.

Hosted writes require a project credential. These are two independent paths:

- Manual deploy: run `npm exec --no -- tileflow login` once on the developer
  machine, then validate and deploy from that machine.
- CI deploy: create a dashboard `CI deploy` key, store it as
  `TILEFLOW_API_KEY`, and let the repository workflow deploy without a local
  login.

The CI key grants only `styles:write` and `status:read`. It cannot upload
datasets or render images. Give it an expiration, rotate the repository secret
before it expires, and avoid non-expiring CI keys.

Detected CI never falls back to the credential saved by `tileflow login`: if
`TILEFLOW_API_KEY` is absent, deploy stops before loading config or making a
request. Once captured, the key is removed from `process.env` before the CLI
imports executable `tileflow.config.ts`, which prevents accidental config
access. This is defense in depth, not a sandbox; deploy only reviewed repository
code on a trusted runner, and do not pass keys through the `--api-key` command
line in CI.

The [deploy documentation](https://tileflow.dev/docs/deploy) contains copyable
GitHub Actions and GitLab CI workflows. Both use `npm ci`, the committed
lockfile, and the project-local CLI. GitHub exposes the key only to its deploy
step. GitLab variables are job-scoped, so its example validates in a keyless job
and deploys in a protected `production` job; the locked install and runner are
part of that trusted job boundary. Both serialize publications and intentionally
omit path filters because `tileflow.config.ts` can import arbitrary repository
files.

The CLI records bounded private provenance for GitHub Actions, GitLab CI,
generic CI, and local runs. These provider fields are descriptive client
reports, not OIDC attestations. Provider values can be overridden with:

```txt
TILEFLOW_DEPLOY_REPOSITORY
TILEFLOW_DEPLOY_REVISION
TILEFLOW_DEPLOY_REF
TILEFLOW_DEPLOY_RUN_ID
TILEFLOW_DEPLOY_RUN_URL
```

Invalid explicit values fail before a network write. Provider metadata that is
missing, malformed, or too long is omitted. Secrets and the complete
environment are never logged.

Application build is absent from the minimal workflows. Framework adapters emit
self-hosted assets by default and can overwrite the hosted manifest. Only build
after deploy when the app deliberately packages
`public/tileflow/manifest.json`; first set `emitBuildArtifacts: false`, or pass
the manifest as an explicit artifact between jobs. A retry of the same compiled
style and delivery policy reuses its deployment version and prints
`Unchanged`; changed desired state prints `Published` with a new version. The
fingerprint binds resource references, not the changing bytes behind external
URLs. Named maps still publish one at a time and may partially succeed.

For an icon set with `source: './icons'`, hosted validation compiles the local
SVG/PNG/JPEG/WebP files without a key. Deploy uploads the four generated sprite
files before its first style write and reuses byte-identical packages by content
hash. Source icons and absolute paths remain local; generated atlas bytes and
sorted icon names are public. External `sprite` URLs remain references and are
not snapshotted. Hosted packages are limited to 256 icons and 8 MiB generated
bytes, with 24 retained packages and 64 MiB per project.

## Agent icon catalog

List every effective local catalog used by configured maps, or select one exact map:

```sh
npm exec --no -- tileflow icons list --json
npm exec --no -- tileflow icons list --json --map madrid
```

The successful stdout contract is one deterministic JSON document followed by exactly one newline.
Its top-level fields, in order, are `schemaVersion: 1`, `pathBase: "cwd"`, `catalogs`, and `maps`.
Schema version 1 is a compatibility boundary: removing or renaming a field or changing an enum's
meaning requires a new schema version. Additive optional fields require corresponding documentation
and tests.

Each catalog is identified by its resolved source directory rather than its package hash. It has
`sourcePath`, `insideWorkingTree`, `packageHash`, `iconCount`, `generatedByteLength`, `atlas`, and
`icons`. Both `atlas.oneX` and `atlas.twoX` contain the density, dimensions, and `fileName`,
`byteLength`, and SHA-256 metadata for their generated index/image files. Every sorted icon record
contains:

- `id`;
- `source` with a cwd-relative forward-slash `path`, normalized `format`, byte length, and intrinsic
  dimensions;
- `rendered.oneX` and `rendered.twoX` with dimensions, the shared rendered-pixel digest, and exact
  atlas rectangle; and
- sorted `mappedFrom` map/semantic references.

Each sorted map has an `icons.kind` of `local`, `external`, or `none`. Local maps include their
label, catalog path, package hash, and fully resolved mappings. Mapping targets are `present` or
`missing` for a local catalog and `unknown` when no local inventory can prove the answer. External
sprite URLs are never emitted or fetched. Two maps can bind one catalog with different mappings;
two distinct source directories remain distinct catalogs even when they compile to the same
package hash.

All reported paths are relative to the invocation working directory. A source outside that tree
uses `../` and `insideWorkingTree: false`; no absolute path is emitted. Listing follows local
authoring semantics. Run `npm exec --no -- tileflow validate --target hosted` separately before a
hosted deploy to check containment, portable IDs, SVG safety, and hosted limits.

The Tileflow command performs no authentication, network request, browser/server launch, or file
write. It removes an ambient `TILEFLOW_API_KEY` before importing config. As with every config-aware
command, loading `tileflow.config.ts` executes repository code and is not a sandbox; side effects in
that code remain the repository's responsibility. Success emits no ANSI or progress prose. Usage,
config, source, decode, and render failures exit 1, write diagnostics to stderr, and leave stdout
empty. A missing local mapping target is successful metadata rather than an operational failure.

The output contains no source contents or source hash, image/base64 payload, remote sprite URL,
credential, timestamp, random value, or absolute path. Open a reported local source path with
normal repository tools only when the pixels themselves are needed.

## Read-only icon comparison

Compare one named local map with its active hosted revision before deciding whether to deploy:

```sh
npm exec --no -- tileflow icons diff --against production
npm exec --no -- tileflow icons diff --against production --json
npm exec --no -- tileflow icons diff --against production --report ./icon-diff.html
```

The command compiles only the selected map, performs one authenticated baseline `GET`, and never
uploads a package, creates a deployment, or writes the frontend manifest. Plain and JSON modes
create no files. A requested HTML report adds reads of the baseline's four public sprite files and
embeds verified old/new images in one self-contained file. The report groups exact-cell icon
previews under `Added`, `Modified`, and `Removed`. Added and removed cards show only the affected
icon; modified cards compare `Before` with `Next`. A script-free 1x/2x selector defaults to 2x,
switches the embedded density, and renders 1x at half the 2x preview size inside a stable frame so
the selected state is immediately visible. Package hashes, generated sizes, and icon counts stay in
collapsed `Details`. Dynamic icon references include an explicit pre-deploy action. A map badge is
shown only for a map-scoped report. It exposes no atlas implementation UI and contains no API key,
remote runtime dependency, original icon source, or local source path. Use `--force` to replace
different existing report bytes and `--open` only together with `--report`.

Visual modification means that normalized rendered RGBA pixels changed at 1x or 2x. Fully
transparent RGB is ignored. The manifest also hashes the four encoded artifacts, so an artifact can
change while its per-icon pixel list remains unchanged. The report and digest analysis operate on
generated sprite data; SVG, raster source files, and absolute paths stay on the local machine.

`--json` writes exactly one deterministic schema-version-1 document plus a trailing newline. Its
stable top-level fields, in order, are:

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "baseline": {"deploymentId": "dep_...", "package": null, "version": 7},
  "proposed": {"package": null},
  "icons": {"added": [], "removed": [], "modified": [], "unchangedCount": 0},
  "mapping": {"comparisonAvailable": true, "added": [], "removed": [], "changed": []},
  "generatedBytes": {"before": 0, "after": 0, "delta": 0},
  "references": {"analysisComplete": true, "dangling": [], "unanalyzable": []},
  "artifacts": {"report": null},
  "hasChanges": false
}
```

Package summaries, when present, contain `contentHash`, `iconCount`, `label`, and `totalBytes`.
Mapping changes contain `key` and the applicable `before`/`after` values. If historical mapping
metadata is unavailable, `comparisonAvailable` is false and the change arrays remain empty; this is
not equality. A missing hosted baseline is an initial comparison against an empty package/mapping.

Normal differences and warnings exit 0. Config, compilation, credential, network, response, and
report errors exit 1. Only `--fail-on dangling` changes a successful result to exit 2 when a
definite mapping or literal managed-icon reference is missing; dynamic expressions are reported as
unanalyzable and do not trigger that policy.

This workflow does not provide OIDC, automatic secret installation, an official
GitHub Action, an atomic multi-map deploy set, or a Tileflow-hosted remote
builder.

Docs: https://tileflow.dev/docs/deploy
