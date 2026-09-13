# Coordinates

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

These local commands require an explicitly provided compatible runtime distribution. No public
native runtime download is currently offered; package installation or the default setup URL does
not supply one. The verified production profile is Linux x64 on Debian 12, glibc 2.36 and Node 24.
The examples below use development artifacts and do not establish public platform support.

Coordinates commands use a locally provisioned execution release. They do not use Map
configuration, account state, or a Hosted fallback. Provision first from a distribution source, then
run the local commands against the active cache entry or an explicit runtime directory.

```sh
tileflow setup coordinates --source /path/to/distribution.json --cache-dir /path/to/coordinates-cache --development --json
tileflow coordinates search --query ETRS89 --runtime-dir /path/to/installed-release --development --json
tileflow coordinates describe --id EPSG:25830 --runtime-dir /path/to/installed-release --development --json
tileflow coordinates operations --from EPSG:4258 --to EPSG:25832 --runtime-dir /path/to/installed-release --development --json
tileflow coordinates transform --from EPSG:4258 --to EPSG:25832 --positions '[[12,55]]' --runtime-dir /path/to/installed-release --development --json
```

`setup coordinates --source` accepts a distribution URL, a local `distribution.json`, or a directory
that contains one. `--archive` is a local archive alias and rejects URLs. Setup verifies every asset
declared by the selected distribution before it records the active release. `--development` is
required for a development distribution.

Every execution command accepts `--runtime-dir`, `--release`, and `--development`. With no
`--runtime-dir`, it opens the cache entry selected by setup. `search` accepts `--query`, `describe`
accepts `--id`, `operations` accepts `--from` and `--to`, and `transform` also accepts JSON
`--positions`.

For a complete request, use exactly one of `--request '<json>'` or `--input <file|->`. These forms
cannot be combined with the command's convenience request flags. Input is limited to 32 KiB, must be
valid UTF-8 JSON, and `-` reads standard input. Success writes one JSON document to stdout. A
structured failure writes one JSON document to stderr and exits with status 1. Plain `--help` remains
human-readable; `--help --json` is a structured failure.

`tileflow explain` compiles exactly one map/theme selection through `createStyleResult()` and emits
its structured `report` and safe compiler `diagnostics`; it deliberately omits the usually large
MapLibre `style`. In a singular config, `--map` is optional; a multi-map workbench requires it.
`--theme` defaults to that map's declared default. `--inspection` adds opt-in, read-only
physical-output provenance to the report. Its physical layer IDs and indexes are diagnostic
observations only: they are not stable application or authoring targets, and no semantic operation
accepts them. The JSON document has this stable projection:

```json
{
  "schemaVersion": 1,
  "command": "explain",
  "ok": true,
  "selection": {"map": "madrid", "theme": "dark"},
  "authoringManifestSchemaVersion": 2,
  "compilation": {"ok": true, "diagnostics": [], "report": {}},
  "diagnostics": []
}
```

`tileflow semantic-diff --from-config <path> --to-config <path>` compares the sole map exported by
each ordinary config, which is the normal agent workflow for reviewing a change across two files or
checkouts. If either endpoint is a multi-map `*.workspace.ts`, select that endpoint explicitly with
`--from-map` or `--to-map`; selectors are rejected for singular configs. The existing
`--config <workspace> --from <map> --to <map>` form remains as the same-workspace shortcut. Paired
config options and workspace options cannot be mixed.

The successful document adds `diff`, whose exact core shape is `{schemaVersion, from, to, summary,
changes}`; each change is `add`, `remove`, or `change` at an RFC 6901 JSON Pointer. Differences are
informational, so a non-empty diff still exits successfully. Selection, load, validation, asset, or
compilation failures leave stdout empty and emit one safe structured document on stderr.
