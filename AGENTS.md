# Tileflow SDK agent guidance

## Scope

- Public package source lives under `packages/`.
- Package behavior belongs in the owning package README.
- Durable capture and visual-testing behavior belongs in
  `docs/contracts/local-visual-capture.md`.
- Package release procedure belongs in `PUBLISHING.md`.

## Validation

- Run focused package checks while iterating.
- Before completing a substantial change, run `pnpm check` and `pnpm build`.
- For publication changes, also run `pnpm run smoke:capture-public` and the public dry-run.

## Boundaries

- Do not add hosted platform, API implementation, dashboard, database, credentials, or deployment
  infrastructure to this repository.
- Keep third-party license and notice files with the package or source they cover.
- Do not infer or add a project-level source license without an explicit owner decision.
