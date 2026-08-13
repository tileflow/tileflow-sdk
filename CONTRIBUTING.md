# Contributing

Thank you for helping improve the Tileflow SDK.

## Development setup

Use Node.js 22 or newer and the pnpm version declared in `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Run a focused package check while iterating, for example:

```sh
pnpm --filter @tileflow/core verify
pnpm --filter @tileflow/core typecheck
```

Do not edit package versions, add changesets, create release tags, or run `npm publish`. Every
source package keeps `0.0.0-development`. Merging a normal PR to `main` is the entire release
action: after `CI / Required` succeeds, automation compares packed artifacts with npm and publishes
only the packages whose public contents changed, each at its next independent numeric alpha.

Repository-only changes publish nothing. A package README, export, runtime dependency, executable
mode, or built file is part of that package's public artifact and causes its release automatically.
Keep builds deterministic and review the source PR with the understanding that a green merge can
become public immediately.

Before submitting a package change, exercise the packed consumer:

```sh
pnpm run release:verify-source
pnpm run smoke:capture-public
pnpm run publish:alpha:dry-run
```

The first capture may install Playwright's exact pinned Chromium headless shell. Use
`pnpm --filter @tileflow/capture exec playwright install --only-shell chromium` to provision it
explicitly.

## Public contracts

Keep package exports and README examples aligned. Update
`docs/contracts/local-visual-capture.md` when scene, readiness, receipt, capture, or visual-baseline
behavior changes. Shared hosted API and rendering contracts must remain backward compatible because
npm and platform production cannot update atomically; deploy compatible server behavior before
merging the SDK client change.

Do not commit generated `dist` files, browser binaries, captures, credentials, `.env` files,
machine-specific paths, or temporary registry/release plans.
