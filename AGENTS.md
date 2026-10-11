# Tileflow SDK agent guidance

## Scope

- Public package source lives under `packages/`.
- Package behavior belongs in the owning package README.
- Follow `docs/documentation.md` for documentation changes; run `pnpm run docs:check` after building.
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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
