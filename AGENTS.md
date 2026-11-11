# Tileflow SDK agent guidance

## Scope

- Public package source lives under `packages/`.
- Keep package READMEs focused on purpose, installation, one working example, and next steps.
- Put detailed public contracts in the owning package's `REFERENCE.md` and link to the relevant
  guides at `https://tileflow.dev/docs`. Preserve version-specific behavior when shortening a README.
- Include `REFERENCE.md` in the package when present; its links and examples are checked alongside
  the README. Run `pnpm run docs:check` after building.
- Do not add documentation/planning directories, internal procedures or links to private repositories.
- Preview and capture maps through `tileflow preview` and `tileflow capture`; reuse their shared
  artifact preparation instead of introducing a separate viewer.

## Validation

- Run focused package checks while iterating.
- Before completing a substantial change, run `pnpm check` and `pnpm build`.
- For publication changes, also run `pnpm run smoke:capture-public` and the public dry-run.

## Boundaries

- Do not add hosted platform, API implementation, dashboard, database, credentials, or deployment
  infrastructure to this repository.
- Keep third-party license and notice files with the package or source they cover.
- Do not infer or add a project-level source license without an explicit owner decision.

## Pull requests

- Open pull requests as drafts while the change itself is unfinished, and say in a `## Draft until`
  section of the description what remains (work in its scope, or an open maintainer decision that
  would change the code). Mark one ready for review when it is complete and can be merged as it is,
  even if it waits for other work. A conflict with another open pull request, or a consequence
  maintainers should know (changed baselines, a slower default), never keeps it in draft; the
  description states the consequence.
- Do not push to a pull request after marking it ready; convert it back to draft first
  (`gh pr ready --undo`).
- Maintainers merge ready pull requests together in batches. Do not merge `main` into a ready pull
  request to keep it up to date, and do not enable auto-merge on it.
- A dependency never keeps a complete pull request in draft. State each in the description, one
  per line: `Depends on: tileflow/<repo>#<number>` (ready or draft, in any repository, including
  the pull request it is stacked on), or `Depends on: <release, deploy or data>`. Maintainers hold
  it until they land, and land a stack in order.
- When it edits the same code as another open pull request (check with
  `git merge-tree --write-tree --name-only HEAD <their head>`), list each in a `## Conflicts`
  section of the description, one per line: `tileflow/<repo>#<number>: <files>; <how to resolve>`.
  Maintainers resolve conflicts when they batch; do not merge `main` or the other branch to resolve
  them. Editing the description after ready is allowed; it is not a push.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
