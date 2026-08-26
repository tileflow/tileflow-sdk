# Tileflow SDK documentation

- [SDK execution plans](plans/README.md)
- [Local visual capture contract](contracts/local-visual-capture.md)
- [Cartographic authoring contract](contracts/cartographic-authoring.md)
- [Map inheritance and asset contract](contracts/map-inheritance.md)
- [Framework browser runtime contract](contracts/framework-browser-runtime.md)
- [Map interactions contract](contracts/map-interactions.md)
- [SDK responsibility and delivery contract](contracts/sdk-responsibilities.md)
- [Generated authoring/resolved map and modules JSON Schema](modules-api-reference.json)
- [SDK license inventory (2026-08-17)](licensing/2026-08-17-sdk-license-inventory.md)
- [Public SDK generation and licensing boundary (2026-08-18)](licensing/2026-08-18-public-sdk-generation-boundary.md)
- [Package release procedure](../PUBLISHING.md)
- [Contributor setup](../CONTRIBUTING.md)
- [Product documentation](https://tileflow.dev/docs)

Package-specific APIs live in each `packages/*/README.md`.

`modules-api-reference.json` is generated from the executable `@tileflow/core` resolved-map and
capture-scene Zod schemas. Its document root and `entrypoints.authoring` describe the singular map
written in `tileflow.config.ts`, including exclusive recursive `root`/`extends` branches and
leaf-owned `scenes`; `entrypoints.resolved` describes the standalone map after inheritance. Update
it with `pnpm reference:generate`; `pnpm reference:check` rejects drift instead of maintaining a
second handwritten field or module list.

[`tileflow.config.example.json`](tileflow.config.example.json) is an import-free root-map schema
example for tooling. Real authoring normally uses TypeScript: import `streets` from `@tileflow/maps`,
export one `defineMap({extends: streets, ...})`, and use imported package directory descriptors or
config-relative directory strings for assets.
