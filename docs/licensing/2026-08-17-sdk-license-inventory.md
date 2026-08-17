# Public SDK license inventory — 2026-08-17

Status: dated inventory input. This document is not a license grant, not qualified legal advice, and
not approval to label any package Apache-2.0. It records the observed licensing state of this
repository so that the intended public release can be reviewed before it is published.

Observed by: Codex, 2026-08-17. Repository revision: `4223da576c23a8bd08f6c83114edb25720e4ec9f`
(`main`, clean working tree). Dependency facts were read from the installed `node_modules` at that
revision, not from a registry query.

The intended public release is owned by the platform launch plan
`docs/plans/features/agent-first-public-launch/2026-08-17-public-world-stateless-launch-plan.md` in
the `tileflow/tileflow` repository. That plan's approved intent is:

- Apache-2.0 for the CLI, core, and public SDK packages;
- a proprietary hosted cloud service, which this repository does not contain; and
- an explicit grant for generated Tileflow output to be used, modified, deployed, and redistributed
  in personal and commercial work, while every third-party license and attribution obligation
  survives generation.

This inventory establishes what that grant can and cannot currently cover. One asset blocks it; the
blocker is recorded in [Blockers](#blockers) and remains fail-closed.

## Method

```sh
git rev-parse HEAD
# per-package manifest fields
for f in packages/*/package.json; do node -e "…name,version,license,files,dependencies…"; done
# license files and bundled non-source assets
find . -path ./node_modules -prune -o -iname 'LICENSE*' -print -o -iname 'NOTICE*' -print
find packages -type f \( -iname '*.svg' -o -iname '*.ttf' -o -iname '*.woff*' -o -iname '*.png' \)
# first-party source and header state
find packages/*/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.svelte' \) | wc -l
grep -rl 'SPDX\|Copyright (c)' packages/*/src | wc -l
# installed dependency licenses, read from node_modules
node -e "…read package.json license + LICENSE/NOTICE files for each runtime dependency…"
```

Reproducing these commands at a later revision may produce different results. Re-run the inventory
before accepting it as a release input.

## 1. Current license state

| Fact                                            | Observed value                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Root `LICENSE` file                             | Absent                                                                                                   |
| Root `NOTICE` file                              | Absent                                                                                                   |
| Per-package `LICENSE` files                     | Absent in all 11 packages                                                                                |
| Per-package `license` manifest field            | Absent in all 11 packages and in the private root manifest                                               |
| Per-package `THIRD_PARTY_NOTICES.md`            | Present in `@tileflow/capture` and `@tileflow/dev` only                                                  |
| Release-time notice enforcement                 | `scripts/capture-public-smoke.mjs` asserts `package/THIRD_PARTY_NOTICES.md` for `@tileflow/capture` only |
| License gate in `PUBLISHING.md`                 | Absent; the procedure contains no license, notice, or attribution step                                   |
| Copyright or SPDX headers in first-party source | None; 0 of 85 files under `packages/*/src` carry one                                                     |

The Apache-2.0 label has not been started. That matches the launch plan, which forbids adding it
before this inventory is accepted. Adding the label is Milestone 4 work in that plan and must not be
treated as a metadata-only change: it also requires the notice, dependency, generated-output, and
asset facts below.

## 2. Tileflow-owned first-party source

All 11 published packages are workspace packages whose source was authored in this repository. No
vendored, copied, or forked upstream source file was found at this revision: `grep` for `derived
from`, `adapted from`, `vendored`, `Portions`, and `based on Mapbox` matched only the two
`THIRD_PARTY_NOTICES.md` files, not source.

One historical fact needs an author confirmation rather than a grep. The current revision's own
commit, `4223da5` ("Basemap system"), deleted a previously vendored OSM Bright style together with
its notices: `packages/core/src/templates/osm-bright/style.json`,
`packages/core/src/templates/osm-bright/LICENSE.md`, `packages/core/OSM_BRIGHT_LICENSE.md`, and the
adjacent `controls.ts`, `index.ts`, and `theme.ts`. OSM Bright carries a BSD-3-Clause code license
with a retained-notice obligation and MapTiler/OpenMapTiles/Mapbox copyright lines. Two observations
support independent authorship of the replacement: no OSM Bright identifier, layer name, or
distinctive palette value survives anywhere in `packages/*/src`, and `.prettierignore` still lists
the deleted paths, which reads as an incomplete cleanup rather than a relocation. That is evidence,
not proof, so [open question 8](#open-questions-for-qualified-review) asks the author to confirm that
no part of the current basemap compiler is derived from the removed style. The platform repository
separately serves its own vendored copy at `apps/web/public/openmaptiles-osm-bright-style/` with its
`LICENSE.md` intact; that copy is outside this inventory's scope and is correctly noticed.

| Package             | `src` files | `test` files | Published `files`                          |
| ------------------- | ----------: | -----------: | ------------------------------------------ |
| `@tileflow/capture` |           9 |            9 | `dist`, `THIRD_PARTY_NOTICES.md`           |
| `@tileflow/cli`     |          11 |           10 | `dist`                                     |
| `@tileflow/core`    |          45 |           14 | `dist`                                     |
| `@tileflow/dev`     |           6 |            5 | `assets`, `dist`, `THIRD_PARTY_NOTICES.md` |
| `@tileflow/next`    |           2 |            1 | `dist`                                     |
| `@tileflow/react`   |           5 |            2 | `dist`                                     |
| `@tileflow/static`  |           1 |            1 | `dist`                                     |
| `@tileflow/svelte`  |           3 |            0 | `src`                                      |
| `@tileflow/vite`    |           1 |            0 | `dist`                                     |
| `@tileflow/vue`     |           1 |            2 | `dist`                                     |
| `@tileflow/webpack` |           1 |            0 | `dist`                                     |

Notes that affect a license label:

- `@tileflow/svelte` publishes `src` rather than `dist`, so its first-party source is distributed
  verbatim. A per-file or per-package license statement is more visible there than in a bundle.
- Every package publishes `README.md` by npm default and the release smoke test asserts it. Neither
  a `LICENSE` file nor a license field is currently asserted.
- `examples/*` are `private: true` and are not published. `scripts/*` are repository tooling and are
  not published, but they are part of the repository and would fall under a root license file.
- The copyright owner to be named in a root `LICENSE`/`NOTICE` and in each `license` field has not
  been recorded anywhere in this repository. The platform launch plan and the prepared legal drafts
  both still carry an unresolved legal-entity question. That identity is an input to Milestone 4, not
  something this inventory can supply.

## 3. Bundled non-source assets

Exactly one directory of non-source assets is published: `packages/dev/assets/streets-poi/`, nine
SVG files (`cafe`, `hospital`, `hotel`, `museum`, `restaurant`, `school`, `services`, `shopping`,
`train`). No fonts, glyph ranges, sprite sheets, rasters, or other binary assets are published from
any package.

`packages/dev/THIRD_PARTY_NOTICES.md` states, as Tileflow's own record, that this artwork is
**adapted from Google Places icons**, copyright Google LLC, relying on the Creative Commons
Attribution 4.0 license that Google applies to its developer documentation content, and that
Tileflow resized, recolored, and composed the glyphs inside circular category markers.

These are not an optional extra. `packages/dev/src/icons.ts` selects them as the **default** icon
set whenever a map uses the `streets` basemap with POI icons enabled and declares no icon source of
its own (`usesBuiltInStreetsPoiIcons`, and the `builtIn: true` request that names
`@tileflow/dev/assets/streets-poi`). They are therefore compiled into the generated sprite of a
default application and redistributed by that application. See [Blockers](#blockers).

## 4. Generated output

`writeTileflowBuildArtifacts` in `packages/dev/src/index.ts` writes, into the application's output
directory:

- `styles/<mapName>.json` per configured map;
- each compiled asset returned by the build, including the icon sprite image and index; and
- `manifest.json`.

Two facts matter for the intended generated-output grant:

1. **No notice or attribution file is emitted.** The only attribution that reaches the output is the
   `attribution` string carried by the data-source descriptor and copied into the style. There is no
   NOTICE, license, or third-party-attribution artifact in generated output, and no test requires
   one. The launch plan's requirement that "NOTICE/license emission preserves third-party
   requirements" is unimplemented.
2. **The generated sprite can contain third-party artwork.** By default it contains the
   Google-derived POI glyphs above. Tileflow cannot grant broader redistribution rights over that
   artwork than it holds itself, and the CC BY attribution and modification-indication obligations
   currently do not travel with the output.

The current default data attribution constant in `packages/core/src/data/index.ts` is
`© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors`. For the public World launch this
string must come from the audited release descriptor in `tileflow.lock` rather than a library
default; that replacement is Milestone 4 work in the platform plan. Recording it here only notes
that today's default names three upstream parties whose obligations the platform-side audit owns.

## 5. Runtime dependency licenses

Read from the installed packages at this revision. Every entry is a separately installed npm
dependency; none of their code is bundled into a Tileflow tarball.

| Dependency                         | Version | Declared license  | License/notice files in the package          |
| ---------------------------------- | ------- | ----------------- | -------------------------------------------- |
| `maplibre-gl`                      | 5.24.0  | BSD-3-Clause      | `LICENSE.txt`                                |
| `@maplibre/maplibre-gl-style-spec` | 24.8.5  | ISC               | `LICENSE.txt`                                |
| `@mapbox/vector-tile`              | 2.0.5   | BSD-3-Clause      | `LICENSE.txt`                                |
| `pbf`                              | 4.0.2   | BSD-3-Clause      | `LICENSE`                                    |
| `pixelmatch`                       | 7.2.0   | ISC               | `LICENSE`                                    |
| `pngjs`                            | 7.0.0   | MIT               | `LICENSE`                                    |
| `playwright`                       | 1.60.0  | Apache-2.0        | `LICENSE`, `NOTICE`, `ThirdPartyNotices.txt` |
| `playwright-core`                  | 1.60.0  | Apache-2.0        | `LICENSE`, `NOTICE`, `ThirdPartyNotices.txt` |
| `hono`                             | 4.12.34 | MIT               | `LICENSE`                                    |
| `@hono/node-server`                | 2.0.10  | MIT               | `LICENSE`                                    |
| `commander`                        | 15.0.0  | MIT               | `LICENSE`                                    |
| `picocolors`                       | 1.1.1   | ISC               | `LICENSE`                                    |
| `zod`                              | 4.4.3   | MIT               | `LICENSE`                                    |
| `chokidar`                         | 4.0.3   | MIT               | `LICENSE`                                    |
| `jiti`                             | 2.7.0   | MIT               | `LICENSE`                                    |
| `saxes`                            | 6.0.0   | ISC               | none in the package                          |
| `sharp`                            | 0.35.3  | Apache-2.0        | `LICENSE`                                    |
| `@img/sharp-libvips-<platform>`    | 1.3.2   | LGPL-3.0-or-later | none in the package                          |

All declared licenses except one are permissive and compatible with an Apache-2.0 first-party
release. Two entries need explicit treatment:

- **`@img/sharp-libvips-*` is LGPL-3.0-or-later.** It is an optional platform dependency of `sharp`,
  which is itself an optional dependency of `@tileflow/dev`, and its prebuilt tarball ships no
  license file. It is not theoretical: `packages/dev/src/icons.ts` dynamically imports `sharp` to
  measure, rasterize, and pack local icon sprites, which is the default build path for the `streets`
  basemap, and it fails with an explicit "Local icon sprites require the optional `sharp` package"
  error otherwise. The library is separately installed, unmodified, and dynamically loaded, and the
  user can replace it, so the obligations are satisfiable, but they are notice obligations that no
  current Tileflow artifact states. Qualified review should decide whether to (a) document it,
  (b) make `sharp` an opt-in peer dependency, or (c) remove the dependency.
- **`saxes` declares ISC but ships no license text**, so the full text must be obtained from its
  source repository if a notice file reproduces it.

## 6. Notice coverage

| Package                           | Notices present                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `@tileflow/capture`               | Complete for its five runtime dependencies plus provisioned Chromium              |
| `@tileflow/dev`                   | Google Places icons only; its nine runtime and optional dependencies are unlisted |
| The other nine published packages | None                                                                              |

`@tileflow/capture`'s notices file states the working policy explicitly: dependency distributions
carry their own complete license texts, and the Tileflow file exists to keep the attribution and the
browser-provisioning boundary visible in the package itself. That is a defensible policy for
separately installed dependencies, so the gaps above are mostly a consistency and completeness
question rather than a compliance failure — with one exception. `@tileflow/dev` **bundles**
third-party-derived artwork, so its notice obligation is not discharged by any dependency's own
distribution.

## 7. Obligations that must be preserved

1. **Bundled artwork.** Attribution to the copyright holder, indication that the work was modified,
   and license identification must accompany `packages/dev/assets/streets-poi/*` wherever it is
   distributed — including the sprite inside a generated application, not only the npm tarball.
2. **LGPL-3.0-or-later native library.** Notice, license availability, and the user's ability to
   relink or replace `@img/sharp-libvips-*` must be preserved; it must not be bundled or statically
   combined into a Tileflow artifact.
3. **Permissive dependency notices.** BSD-3-Clause, ISC, MIT, and Apache-2.0 dependencies require
   their copyright notice and license text to be retained wherever their code is redistributed.
   Today Tileflow redistributes none of them, so the obligation attaches only if bundling begins.
4. **Apache-2.0 mechanics for the first-party release.** A root `LICENSE`, a `NOTICE` for
   attribution that must be reproduced, per-package `license` fields, and inclusion of both in every
   tarball.
5. **Non-relicensing boundary.** The Apache-2.0 software license must not be presented as a license
   to World data, the operated service, or the Tileflow trademark, and generated output must not be
   described as unencumbered when it carries upstream data attribution and third-party artwork
   obligations.

## Blockers

One blocker prevents the intended license grant as designed. It is recorded fail-closed and this
licensing subtask stops here rather than weakening the approved product decision.

### B1 — Google-derived default POI artwork blocks the Apache-2.0 and generated-output grants

Blocked scope: labeling `@tileflow/dev` Apache-2.0 as published today, and publishing the
generated-output grant while the default sprite contains this artwork.

Exact facts:

- `packages/dev/assets/streets-poi/*.svg` (9 files) are, per Tileflow's own
  `packages/dev/THIRD_PARTY_NOTICES.md`, adapted from Google Places icons, copyright Google LLC,
  under Creative Commons Attribution 4.0.
- The files are published inside the `@tileflow/dev` tarball via its `files` array.
- They are the default POI icon set for the `streets` basemap and are therefore compiled into the
  generated sprite of a default application.
- Generated output emits no notice, attribution, or license artifact of any kind.

Why it blocks:

1. CC BY 4.0 is not Apache-2.0. A package labeled Apache-2.0 that ships CC BY 4.0 assets needs an
   explicit carve-out; a bare `license` field would misstate the terms of those files.
2. CC BY 4.0 requires attribution and an indication of modifications to travel with every
   redistribution. The npm tarball satisfies this through its notices file; the generated
   application sprite does not.
3. The intended generated-output grant — use, modification, deployment, and redistribution in
   personal and commercial work — would be broader than the rights Tileflow holds over this artwork.
4. It is an open qualified-review question whether the Creative Commons grant that Google applies to
   its developer documentation content extends to the Places icon artwork itself, as distinct from
   the documentation prose, and how Google's brand and Maps Platform terms bear on derived artwork
   used as the default iconography of an independent basemap product.

Recorded remediation (product-owner decision, 2026-08-17): keep the blocker recorded here and
replace the nine icons with Tileflow-original artwork or a public-domain set before the Apache-2.0
label and the generated-output grant are published. The replacement is Milestone 4 work in the
platform launch plan. This inventory does not select the replacement artwork and does not weaken the
product decision that the default `streets` basemap ships useful POI iconography.

Until the replacement lands, Milestone 4 must not: add a `license` field or `LICENSE` file that
covers `packages/dev/assets/streets-poi/*` under Apache-2.0, or publish a generated-output grant
that would extend to that artwork.

## Open questions for qualified review

These are inputs for review, not conclusions:

1. The copyright owner and legal entity to be named in `LICENSE`, `NOTICE`, and each `license`
   field, which is still unresolved in the platform legal drafts.
2. Whether the CC BY 4.0 grant covers the Google Places icon artwork, and whether derived artwork of
   this kind may be used as a default basemap icon set at all — the question that makes B1 a blocker
   rather than a carve-out.
3. How to discharge the LGPL-3.0-or-later `@img/sharp-libvips-*` notice obligation, and whether
   `sharp` should stay an implicit optional dependency of the default build path.
4. The exact wording of the generated-output grant: what Tileflow grants over its own compiled
   output, and how it states that upstream data licenses, third-party asset licenses, and required
   attribution survive generation.
5. Whether Tileflow adopts per-package `THIRD_PARTY_NOTICES.md` files for all published packages, or
   documents the current policy that separately installed dependencies carry their own texts.
6. Whether the repository's checked-in visual baselines under `examples/*/test/visual-baselines/`,
   which are rendered from OpenStreetMap-derived data, need an attribution or notice statement in a
   publicly licensed repository. They are not published to npm.
7. Whether the trademark boundary needs explicit wording, since Apache-2.0 §6 grants no trademark
   rights while the launch intends `Map by Tileflow` branding to be a condition of the free operated
   service.
8. Author confirmation that no part of the current basemap compiler is derived from the OSM Bright
   style that `4223da5` deleted along with its BSD-3-Clause notices, as described in
   [section 2](#2-tileflow-owned-first-party-source). If any part is derived, the notice must be
   restored before the Apache-2.0 label. Independently of the answer, `.prettierignore` should stop
   naming the two deleted license paths.

## What this inventory does not do

It does not grant a license, label a package, approve a notice file, resolve the legal entity,
approve the generated-output wording, or clear B1. It records the observed state at
`4223da576c23a8bd08f6c83114edb25720e4ec9f` so that a reviewer and the platform launch plan can act
on facts.
