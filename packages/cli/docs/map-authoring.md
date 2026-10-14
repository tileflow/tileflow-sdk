# Map authoring workflow

Install the CLI and your map's dependencies in your project as described in the
[CLI guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md).
Run these commands from that project directory, with a trusted `tileflow.config.ts`.
Discovery and saved-capture comparison also work without a config.

## Discover the language and inspect a change

Use four primary command groups for map development:

| Command    | Purpose                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `describe` | Discover the generated language and query one domain or schema fragment.                                      |
| `inspect`  | Read resolved configuration; `compiled`, `features`, `icons`, and `tileset` inspect compiler output and data. |
| `capture`  | Render reproducible evidence and return a reusable capture ID.                                                |
| `compare`  | Compare saved capture IDs; `configs`, `styles`, `reference`, and `baseline` cover other comparisons.          |

`preview` opens the visual Workbench. `init`, `validate`, and `build` remain project utilities;
`visual update` is the explicit operation that approves baselines. All these tools work from an
independent project with its own map and data; official maps are optional.

Start with bounded queries, then request more detail at the returned JSON Pointers:

```sh
npx tileflow describe --json
npx tileflow describe roads --path /properties/classes --json
npx tileflow inspect --domain roads --limit 80 --json
npx tileflow inspect compiled --domain roads --theme dark --json
npx tileflow compare configs --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
```

`describe` needs no project or network. It reads the generated schema and manifest, with `--ref`
for an exact local schema reference, `--path` for an RFC 6901 JSON Pointer, and `--limit`/`--depth`
for bounded tree projections. `projection.truncated` and `projection.omitted` explicitly identify
missing detail; omitted pointers are relative to the selected data. These fragments are discovery
results, not standalone validation schemas. Examples and expression syntax remain in the generated
contracts and package guides. Config inspection supports the same bounds; without projection
options it preserves the complete legacy result.

Legacy aliases remain available: `explain` → `inspect compiled`, `semantic-diff` → `compare configs`,
`icons list` → `inspect icons`, `tileset inspect` → `inspect tileset`, and `visual compare/analyze/diff`
→ `compare styles/reference/baseline`. Aliases share implementations and retain their established
versioned JSON document formats. `language manifest` returns
the raw authoring manifest (schema version 2); `language schema` returns the raw generated config
reference (version 4). Use their versions and schema references when consuming the output.

`validate`, `inspect`, `explain`, and `semantic-diff` return one version-1 command envelope on
stdout. JSON-mode failures leave stdout empty, write one structured failure to stderr, and exit
nonzero. Diagnostics include `phase`, `code`, `path`, `severity`, `message`, and `suggestion`.
A non-empty semantic diff is informational, not a command failure.

Inspection includes resolved inheritance, merge provenance, and the theme contract. `explain`
returns compilation diagnostics and a report, not the complete Style JSON. Add `--inspection` only
when physical output provenance is needed; those layer IDs are not stable authoring targets.

For a normal config, map selection is implicit. Paired `--from-config` and `--to-config` compare
two ordinary configs. Workspace comparisons use their documented explicit map selectors; do not
mix the paired-config and same-workspace forms.

## Reuse capture evidence

Every still capture saves an immutable record under `.tileflow/captures/records` and returns its
full `captureId` in JSON (or prints it in human output). Keep the ID before editing, capture again,
then compare the two IDs:

```sh
npx tileflow capture madrid --json
# Edit the map, then capture the same scene again.
npx tileflow capture madrid --json
npx tileflow compare --before <before-capture-id> --after <after-capture-id> --json
```

Replace the placeholders with the full IDs from the two capture results. This comparison loads
only saved evidence: no config evaluation, compilation, browser startup, or network access.
`--capture-dir` selects another record directory; `--diff <path>` writes a contextual PNG diff.
Records verify their JSON, PNG, receipt, and scene hashes. Different cameras, viewport dimensions,
renderers, or data identities produce a mismatch and nonzero exit instead of misleading pixel
metrics. A visual difference between comparable captures is informational. Records remain until
you remove their directory; moving only the mutable scene PNG does not move its saved record.

For repeated capture use `capture --watch`; it reuses the artifact session and browser. Config
inspection does not render; `compare configs` compares semantic authoring without rendering.
`compare styles --watch` reuses sessions for a camera/zoom matrix. Run standalone validation when
needed, rather than compiling the same map before every capture.
