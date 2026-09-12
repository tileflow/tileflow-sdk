# Agent icon composition

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

List the effective local catalog used by the exported map:

```sh
npx tileflow icons list --json
```

The successful stdout contract is one deterministic JSON document followed by exactly one newline.
Its top-level fields, in order, are `schemaVersion: 2`, `pathBase: "cwd"`, and `maps`.
Schema version 2 is a compatibility boundary: removing or renaming a field or changing an enum's
meaning requires a new schema version. Additive optional fields require corresponding documentation
and tests.

Each sorted map entry has one `id` and an `icons` value. `icons.kind` is `none` for `icons: []`, or
`directories` for a prepared ordered composition. A directory entry contains:

- `directories`, in the exact left-to-right authoring order, using config-relative paths or safe
  `npm:<package>/<path>` descriptors;
- `finalIds`, the sorted canonical lower-kebab IDs in the resulting sprite;
- `replacements`, with the replaced path and winning path for every later exact-ID replacement;
- `sources`, with the winning ID, cwd-relative path, format, byte length, and intrinsic dimensions;
- `insideWorkingTree`; and
- the deterministic generated `packageHash`.

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

The Tileflow command performs no authentication, network request, browser/server launch, or file
write. It removes an ambient `TILEFLOW_API_KEY` before importing config. As with every config-aware
command, loading `tileflow.config.ts` executes repository code and is not a sandbox; side effects in
that code remain the repository's responsibility. Success emits no ANSI or progress prose. Usage,
config, source, decode, and render failures exit 1, write diagnostics to stderr, and leave stdout
empty.

The output contains no source contents or source hash, rendered cells, atlas coordinates,
image/base64 payload, credential, timestamp, random value, or absolute path. Open a reported local
source path with normal repository tools only when the pixels themselves are needed.
