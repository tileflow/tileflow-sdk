# Team Icon Sets and repository locks

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

A Team Icon Set is a named catalog resource such as `@acme/brand`. Publishing creates an immutable
integer revision of the four generated sprite files. Maps in different repositories consume
independently pinned revisions through `iconSet('@acme/brand')` without copying original artwork.

Two command families cover this, and the split is deliberate. `icon-set` is a networked Team
authority that changes the catalog. `icons` stays with repository-local work: `list` and `diff`
inspect prepared output without any credential, and `install`, `update` and `pin` maintain the exact
`tileflow.icons.lock.json` beside the selected config.

Availability depends on your deployment and your Team's enabled features. Check
`npx tileflow icon-set --help` for the installed command surface.

## Authorize a Team

Catalog commands need Team authority. Either sign in and let the CLI exchange your account session
for a short-lived Team capability, or pass a Team data key:

```sh
npx tileflow login
npx tileflow icon-set list --team @acme --json
```

Reads request `icons:read`; publication, archive state and purge request `icons:write`. A
Map-scoped deploy key never gains catalog authority, and `--team` is rejected together with
`--api-key` because a Team data key already selects its Team.

## Publish a revision

```sh
npx tileflow icon-set publish ./icons --id brand --team @acme --idempotency-key brand-2026-09-14 --json
```

`publish` compiles exactly one repository-relative directory into `sprite.json`, `sprite.png`,
`sprite@2x.json` and `sprite@2x.png`, then uploads those four files under one durable retry key.
The first successful publication creates the set. Republishing identical bytes reports
`"publication": "unchanged"` and returns the same revision rather than a new integer. Repeating an
uncertain request with the same `--idempotency-key` returns its original result instead of creating
extra history.

The JSON receipt reports the Team, the canonical reference, the immutable revision and version ID,
the package identity, the content hash, the byte count and whether the publication changed
anything. It contains no credential, source path, or original artwork.

## Inspect and manage the catalog

```sh
npx tileflow icon-set list --team @acme --json
npx tileflow icon-set status brand --team @acme --json
npx tileflow icon-set versions brand --team @acme --json
npx tileflow icon-set uses brand --team @acme --json
npx tileflow icon-set archive brand --team @acme --json
npx tileflow icon-set unarchive brand --team @acme --json
```

Reads follow bounded cursors and reject a repeated page, a duplicate row or an unsafe page count.
`uses` reports the known hosted deployments that retain a revision; its
`includesUndeployedRepositoryLocks` field is always `false`, because a repository lock that was
never deployed is not discoverable by the catalog. Archiving prevents new publication and implicit
discovery while retained consumers keep working.

## Purge an exact revision

```sh
npx tileflow icon-set purge brand --version 3 --team @acme \
  --idempotency-key purge-brand-3 --confirm '@acme/brand@3' --acknowledge-unknown-locks --json
```

Purge needs all four guards: an exact positive `--version`, a durable `--idempotency-key`, a
`--confirm` value repeating the exact `@team/set@version`, and `--acknowledge-unknown-locks`.
The acknowledgement is not a formality. Purge tombstones the publication hold and keeps retained
deployment holds, including fully shadowed dependencies; it cannot discover undeployed repository
locks and cannot revoke public bytes that were already downloaded.

## Maintain the repository lock

```sh
npx tileflow icons install --team @acme --json
npx tileflow icons update @acme/brand --team @acme --json
npx tileflow icons pin @acme/brand --version 3 --team @acme --json
```

These commands read the `iconSet()` references your config declares. `install` resolves the current
latest revision for every declared reference that has no pin yet and leaves existing pins alone.
`update` moves the selected references to their current latest revision; omit the references to
select every declared one. `pin` selects one exact revision and never resolves a head.

They are the only build-adjacent commands that resolve `latest` or write the lock. Every requested
reference is resolved before a single compare-and-swap write of the whole snapshot, so a partial
lock is never produced and a concurrent writer fails the command rather than losing its pins. An
undeclared reference is rejected before any request. No lock command rewrites `tileflow.config.ts`;
add `iconSet('@team/set')` to your config first.

The JSON receipt lists each locked reference with its revision, version ID, package identity and
content hash, plus any declared reference that is still missing a pin.

## Build, preview and deploy against the lock

`validate`, `build`, `preview`, `deploy`, `icons list` and `icons diff` read the lock and compose
one effective sprite. They never resolve a catalog head, so publishing a newer revision changes
nothing in a repository until an explicit lock command runs. `--cache-dir` chooses the verified
artifact cache root; `--offline` fails a cache miss instead of hydrating it.

Hydration downloads only the four public files of the exact pinned artifact, from the trusted
delivery origin, without credentials and without following redirects. Every file's length,
checksum, sprite index, PNG geometry and per-icon pixel hashes are verified before use.

Deploy uploads the effective composed package and sends the same ordered composition receipt in the
build manifest and the request body, bound to that package's content hash. A referenced source
revision is never re-uploaded by a deploy.

Offline composition is not an offline map. Remote tiles, glyphs and other external resources keep
their own requirements.
