# Structured config inspection and diagnostics

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

Custom Node tooling can use the same deterministic documents as `tileflow validate --json` and
`tileflow inspect --json`:

```ts
import {inspectTileflowConfig} from '@tileflow/dev/inspect';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';

try {
  const inspection = await inspectTileflowConfig({config: 'tileflow.config.ts'});
  process.stdout.write(serializeTileflowCommandDocument(inspection));
} catch (error) {
  const failure = createTileflowCommandFailureDocument('inspect', error, process.cwd(), {
    code: 'INSPECTION_FAILED',
    phase: 'config-inspection',
  });
  process.stderr.write(serializeTileflowCommandDocument(failure));
}
```

The inspection resolves one config load into sorted maps, root-to-leaf lineage, declared paths, and
leaf-level merge provenance. Its `themeContract` exposes the default/system mapping, shared token
schema, concrete resolved token values, typography and lighting, differences from the default, and
stable `THEME_IMPLICIT_FIXED` diagnostics across modules, render stacks, and terrain. Each
diagnostic carries a semantic scope and, for module values, its owner, plus machine-readable
severity and remediation. Colors, fonts, and images are followed through
expression outputs; numeric diagnostics intentionally cover only direct visual scalars, excluding
expression operands, zoom stops, tuples, placement, priority, and other structural numbers.
Agents can therefore edit semantic roles without
reverse-engineering compiler layers or parsing prose. It never returns `inputFiles`, absolute filesystem paths, credentials,
URL queries, data URLs, or recognized secret formats. Structured summaries and diagnostics use the
same required schema-version-1 fields and bounded safe suggestions so consumers do not need to
parse human prose.
