# Agent icon composition

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

List the effective local catalog used by the exported map:

```sh
npx tileflow icons list --json
```

The successful stdout contract is one deterministic JSON document followed by exactly one newline.
Its top-level fields, in order, are `schemaVersion: 3`, `pathBase: "cwd"`, and `maps`.
Schema version 3 is a compatibility boundary: removing or renaming a field or changing an enum's
meaning requires a new schema version. Additive optional fields require corresponding documentation
and tests. It replaces version 2's directory-only shape so a locked `iconSet('@team/set')`
contributor can be represented without inventing a local path.

Each sorted map entry has one `id` and an `icons` value. `icons.kind` is `none` for `icons: []`, or
`sources` for a prepared ordered composition. A `sources` entry contains:

- `contributors`, in the exact left-to-right authoring order. Each has a `kind` of `local`,
  `package` or `icon-set`, a `label` (a config-relative path, a safe `npm:<package>/<path>`
  descriptor, or the canonical `@team/set` reference) and the `iconIds` it declares. Filesystem
  contributors also report `insideWorkingTree`; shared contributors report their exact locked
  `reference` and integer `version`.
- `finalIds`, the sorted canonical lower-kebab IDs in the resulting sprite;
- `replacements`, naming the replaced and winning contributor export for every later exact-ID
  replacement, by authored file for filesystem contributors and by `@team/set` for shared ones;
- `sources`, one entry for each winning ID. A `file` entry carries the cwd-relative `path`, format,
  byte length and intrinsic dimensions; an `icon-set` entry carries the exact `reference` and
  `version` and deliberately has no path, because a shared revision publishes verified generated
  cells rather than original artwork. Both carry the winning `contributor` ordinal.
- `composition`, the exact ordered `tileflow-icon-composition-v1` receipt when the map declares a
  shared set, and `null` otherwise; and
- `insideWorkingTree` and the deterministic generated `packageHash`.

Listing reads the exact `tileflow.icons.lock.json` beside the selected config. It never resolves a
catalog head, so a newly published revision does not change this output until `tileflow icons
install`, `update` or `pin` changes the lock. `--cache-dir` selects the verified artifact cache root
and `--offline` fails a cache miss instead of hydrating it.

There is deliberately no parallel catalog registry, provider kind, semantic mapping, external
sprite branch, or arbitrary source-to-runtime renaming. `<id>.<ext>` publishes `<id>` and the
reserved pattern form `<id>.pattern.<ext>` also publishes `<id>`. This lets an
agent answer “which directory wins this icon?” directly from one map record without reconstructing
hidden provider state. Use `--map <id>` to select one exact map when internal orchestration supplies
more than one.

All reported paths are relative to the invocation working directory. A source outside that tree
uses `../` and `insideWorkingTree: false`; no absolute path is emitted. Listing follows local
authoring semantics. Run `npx tileflow validate --target hosted` separately before a
hosted deploy to check containment, portable IDs, SVG safety, and hosted limits.

The Tileflow command performs no authentication, browser/server launch, or file write. It performs
no network request when every locked artifact is already in the verified cache, and `--offline`
forbids hydration entirely. It removes an ambient `TILEFLOW_API_KEY` before importing config. As with every config-aware
command, loading `tileflow.config.ts` executes repository code and is not a sandbox; side effects in
that code remain the repository's responsibility. Success emits no ANSI or progress prose. Usage,
config, source, decode, and render failures exit 1, write diagnostics to stderr, and leave stdout
empty.

The output contains no source contents or source hash, rendered cells, atlas coordinates,
image/base64 payload, credential, timestamp, random value, or absolute path. Open a reported local
source path with normal repository tools only when the pixels themselves are needed.
