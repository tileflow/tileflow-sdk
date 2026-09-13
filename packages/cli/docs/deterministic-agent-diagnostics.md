# Deterministic agent diagnostics

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

Use JSON mode when an agent or CI job needs to validate or reason about the resolved config:

```sh
npx tileflow validate --json
npx tileflow inspect --json
npx tileflow inspect --map madrid --json
npx tileflow language manifest --json
npx tileflow language schema --json
npx tileflow explain --map madrid --theme dark --json
npx tileflow semantic-diff --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
npx tileflow semantic-diff --config maps.workspace.ts --from before --to after --json
```

`validate`, `inspect`, `explain`, and `semantic-diff` success writes exactly one
schema-version-1 command envelope to stdout. The two discovery commands intentionally return their
contracts raw instead of wrapping them: `language manifest --json` emits authoring-manifest version
2 and `language schema --json` emits config-reference version 4. Every JSON-mode failure, including
failure to load either raw discovery contract, leaves stdout empty and writes one schema-version-1
command failure to stderr. Command summaries and every failure diagnostic contain `phase`, `code`,
`path`, `severity`, `message`, and a bounded safe `suggestion`; diagnostics are sorted and
deduplicated deterministically.

Config inspection returns the resolved map, parent-to-leaf lineage, declared paths, leaf-level merge
provenance, and an explicit `themeContract`: default/system selection, shared token schema,
concrete values, typography, lighting, differences from the default, and stable audit diagnostics.
It omits the executable input-file graph and sanitizes credentials, URL queries,
secret-shaped values, data URLs, and absolute filesystem paths. The generated
[`modules-api-reference.json`](https://github.com/tileflow/tileflow-sdk/blob/main/docs/modules-api-reference.json) is the machine-readable
map/module schema; its default `authoring` entrypoint tells an agent how to write the singular
config with `extends` and `scenes`, while its named `resolved` entrypoint matches inspection and
compiler input. Both are produced from executable core schemas rather than a handwritten parallel
API list.

`tileflow language manifest --json` discovers the complete closed semantic language without loading
a project: compiler identity, domains and their dependencies, public operations, expression-builder
signatures and limits, render selectors, semantic fields/features, diagnostics, reports, commands,
and schema references. `tileflow language schema --json` returns the packaged generated JSON Schema
that those references address. Together they are the canonical bootstrap surface for an authoring
agent; neither command writes files or accesses the network.

Each manifest command entry declares its `outputKind`, `outputVersion`, and stable
`outputSchemaRef`. `raw-authoring-manifest` and `raw-config-reference` identify the two bootstrap
documents above; `command-envelope` identifies the ordinary version-1 CLI contract.
