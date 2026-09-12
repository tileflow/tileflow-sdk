# Hosted authentication and deploy

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

Hosted writes have two independent authorization paths:

- Personal developer session: run `npx tileflow login` once for a
  Tileflow API origin. Login authenticates the account and selects no Map.
  Map commands exchange it for a brief Map capability; tileset commands use a separate Team data
  capability.
- CI key: create a dashboard `CI deploy` key, store it as
  `TILEFLOW_API_KEY`, and let the repository workflow deploy without a local login. The server
  binds that key to exactly one Map.

Hosted control-plane requests stay pinned to the configured HTTP(S) origin, apply a hard bounded
timeout, and stream at most 1 MiB of response data. CLI diagnostics never echo an untrusted remote
response body or bearer credential.

Inspect the account, then target the Map shown in the dashboard:

```sh
npx tileflow whoami --json
npx tileflow deploy --map-id map_AbCdEfGhIjKlMnOp
npx tileflow status --map-id map_AbCdEfGhIjKlMnOp
npx tileflow logout
```

Changing or resetting the hosted account password revokes saved personal CLI sessions. The next
account or hosted command stops with a clear message and asks you to run `tileflow login` again.
Project API and CI keys are independent project credentials and are not removed by a personal
password change.

The dashboard creates the Map and browser-access policy before repository setup. Keep that exact
Map ID in the deploy action. If the config contains several maps, select the authored map explicitly:

```sh
npx tileflow deploy \
  --map-id map_AbCdEfGhIjKlMnOp \
  --map store-locator
```

The Map ID is a public destination, not a credential. A successful server-confirmed deploy keeps
unrelated manifest entries and records that Map's stable ID, hosted theme URLs, World `v1`
generation, and fixed session usage mode. Browser access remains server-owned and is never read
from or written to repository configuration. Do not add an API key or payment authority to a copied
prompt.

Team tileset commands exchange the same account session for a separate Team-scoped data capability;
it carries no Map authority. Inspect and preview remain account-free:

```sh
npx tileflow tileset inspect ./data/stores.pmtiles --json
npx tileflow tileset inspect ./data/stores.pmtiles \
  --include-values category,status --json
npx tileflow tileset publish ./data/stores.pmtiles \
  --id stores --team @acme --attribution 'Store data © Example' --json
npx tileflow tileset list --team @acme --json
npx tileflow tileset status stores --team @acme --json
```

Inspection schema 1 separates authoritative PMTiles/TileJSON declarations from bounded MVT
observations. Sampled fields report present/missing feature counts, observed distinct-value counts,
numeric min/max, and truncation. Raw primitive values remain absent unless `--include-values`
explicitly selects their comma-separated field names; the command emits at most 16 values per field,
32 selected fields, and 256 characters per string. `--no-sample` returns only authoritative metadata
and cannot be combined with value inspection. Directory traversal recomputes addressed-tile and
tile-entry counts; the header's tile-content count is reported only as a nullable declaration and is
not treated as authority.

`publish --id` names a Team-local logical resource; Tileflow owns its opaque delivery ID. The
command validates the archive locally before authentication, hashes it in fixed 16 MiB parts, then
uploads at most four parts concurrently without buffering the complete file. Interrupted sessions
remain resumable for 24 hours: rerunning the same command reconciles server receipts and transfers
only missing parts. Normal Queue initialization is polled for at most two minutes before the command
returns a resumable availability error. Retryable transfer failures receive fresh short-lived authorization; a changed
local file stops before completion. Free accepts versions through exactly 2,000,000,000 bytes and
Starter through exactly 4,000,000,000 bytes, subject to the Team's hosted-storage capacity.

Publication completes only after server-side integrity and PMTiles validation. A compatible new
version becomes current at the same stable TileJSON and tile URLs, so newly resolved browser
requests see it without creating a Map deployment. Purge requires `--confirm <exact-id>` and fails
with bounded dependency context while any retained Map deployment uses the resource. Automation may set a Team data
`TILEFLOW_API_KEY`; that key selects its Team, so commands omit `--team` and never load account
state.

`tileset publish --json` emits schema version 2 with the Team selector when known, logical and
opaque tileset identities, immutable version ID and number, exact byte count, content-hash
algorithm/hash, final state, and `changed` or `unchanged` publication result. It never emits the
local path, upload session, storage key, signed URL, ETag, credential, or retry details.

An explicit key or `TILEFLOW_API_KEY` never uses the saved account session. The deploy API rejects a
`--map-id` that does not match the key. Read-only hosted icon comparison validates the same binding
before loading its baseline.

A deploy-only key grants `styles:write` and `status:read`. Without additional permissions it cannot upload
datasets or render images. Give it an expiration, rotate the repository secret
before it expires, and avoid non-expiring CI keys.

Detected CI never falls back to the credential saved by `tileflow login`: if
`TILEFLOW_API_KEY` is absent, deploy stops before loading config or making a
request. Once captured, the key is hidden from `process.env` and `--api-key` is removed from the
temporary `process.argv` view before the CLI imports executable `tileflow.config.ts`; both process
surfaces are restored after the protected operation. Every config-aware command uses the same
scope, including validate, build, dev/watch, capture, visual, inspect, icon inspection, and deploy.
This is defense in depth, not a sandbox; deploy only reviewed repository code on a trusted runner,
and do not pass keys through the `--api-key` command line in CI.

The [deploy documentation](https://tileflow.dev/docs/deploy) contains copyable
GitHub Actions and GitLab CI workflows. Both use `npm ci`, the committed
lockfile, and the repository-local CLI. GitHub exposes the key only to its deploy
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

A separate app-build step is absent from the minimal workflows. Self-hosted build and deploy emit the same
runtime manifest version 1 shape; Hosted fields are optional identity metadata on its map/theme
entries. Filesystem build writers refuse to replace a manifest carrying Hosted metadata by default,
and deploy refuses to replace a purely local manifest. Prefer `emitBuildArtifacts: false` or
separate output paths when the app deliberately packages a deploy manifest. The explicit
`overwriteHostedManifest: true` build option and
`tileflow deploy --overwrite-self-hosted-manifest` flag authorize that destination replacement. A
retry of the same compiled theme family reuses its deployment version and prints `Unchanged`;
changed cartography prints `Published` with a new version. Allowed websites is managed separately
in Tileflow and is never read from repository config. The
fingerprint binds resource references, not the changing bytes behind referenced
glyph or sprite URLs. Every theme of one logical map publishes atomically; separate maps can still
partially succeed when no remote batch release is used.

All config, theme-style, icon, and compatibility preflight happens before the first style write. After
that boundary the current Hosted API has no batch commit across repository-internal orchestration:
one singular config can publish before a later config fails. The orchestrator then leaves the
previous local manifest untouched, reports which publications succeeded, and tells the operator to
retry; idempotent publication converges on that retry. The local manifest
writer uses a durable same-directory temporary followed by direct rename and directory sync, so
readers see either the previous or next complete manifest. Multi-file artifact writers remain
rollback-capable sets. Neither mechanism is a remote transaction or can make several API writes
all-or-none.

Deploy treats the locally compiled MapLibre Style family as one logical-map artifact. The request
contains an exact `styles[theme]` collection, per-theme canonical SHA-256 identities in the build
manifest, only bounded hosting policy that does not belong in MapLibre itself, and the exact managed
icon-package identity when the family has one. Delivery
policy is not inherited with cartographic fields. Deploy does not serialize the module
configuration, send a public `tileset` selector, or ask the hosted API to compile the map again.
Hosted publication currently requires Tileflow World; `vectorTiles()` remains available for local
builds and previews but fails deploy before any remote write. The API binds recognized
Tileflow-owned world and terrain URLs to its generated map ID. A successful response must return
exactly the submitted theme names and a hosted Style URL for each. Deploy writes strict runtime
manifest version 1 with stable theme URLs, `colorScheme`, content revision, optional font faces and
style IDs, rather than duplicating dataset configuration. No older manifest is normalized.

For a map with `icons: ['./icons']`, hosted validation compiles the local SVG/PNG/JPEG/WebP files
without a key. Ordered directories apply left to right and later exact IDs replace earlier files.
Deploy uploads the four generated sprite files before its first style write and reuses
byte-identical packages by content hash. Source icons and absolute paths remain local; generated
atlas bytes and sorted icon names are public. Each hosted package is limited to 256 icons and 8 MiB
generated bytes as a processing envelope. There is no package-count quota; physically retained
generated packages share the organization's 5/10-GB hosted-storage pool with retained PMTiles,
remain protected by deployment/library references, and otherwise enter the technical orphan grace
before deletion. Upload success must confirm the submitted `contentHash`, exact icon count, exact
generated byte total, one opaque `icp_<id>`, and the corresponding query-free
`/sprites/<id>/sprite` URL. The CLI rejects any missing or divergent field before using that URL.

Hosted deploy currently rejects local or package-owned web fonts before authentication or remote
writes. Use self-hosted delivery or an explicit public glyph provider. Enabling managed font bundles
requires a separately deployed ownership, quota, retention, and immutable-delivery contract.

For both managed resource kinds, `assetSetSha256` remains a separate per-map output identity. It
hashes each generated file's exact portable name, media type, byte count, and SHA-256 using Core's
asset-set v1 contract; it does not hash only the icon-package manifest. Hosted must
confirm the immutable resource bytes, reconstruct those same per-file identities (including the
`icons/<mapId>/` prefix), and reject the Style when the submitted build-manifest hash diverges.
