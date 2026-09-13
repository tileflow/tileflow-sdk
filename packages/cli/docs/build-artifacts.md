# Build artifacts

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

`tileflow build` resolves the exported map lineage, validates executable config and MapLibre
semantics, compiles its ordered package/local icon directories and selected text provider, and
writes `manifest.json`, one `styles/<map>/<theme>.json` per concrete appearance, and every referenced
sprite/font asset. The manifest records `defaultTheme`, optional `systemThemes`, and the exact theme
catalog; it never flattens a default into a second style alias. A
map with text has exactly one provider: local/package `fonts` directories or a `glyphs` descriptor
whose `fontStacks` are explicit. The default output is `dist/tileflow`; choose another directory
explicitly with `--out`:

```sh
npx tileflow build --out public/tileflow
```

Named hosted sources with `local` archives are for account-free validation, development, preview,
and capture. `tileflow build` rejects them instead of copying, publishing, or taking ownership of
user data. For production, either publish managed data explicitly with `tileset publish` or serve
it from infrastructure owned by the application. A local declaration never selects either path
implicitly.

Preview, capture, and the React/Vue/Svelte adapters register Tileflow's local PMTiles protocol
before MapLibre reads the compiled Style. Its URL is stable by logical tileset ID; physical local
snapshot generations do not change Style identity. Standalone Capture retains one snapshot for the
render. Application Capture uses the application's server; Tileflow's local handler provides
immutable, ETag-guarded PMTiles reads, but does not freeze every local dataset for the complete
screenshot window.

Build is local and credential-free. Hosted compatibility is a separate
`tileflow validate --target hosted` preflight. Primary map data must remain Tileflow World; named
Team sources are validated and resolved independently.
