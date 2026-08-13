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

Before submitting a package or release change, also exercise the packed consumer:

```sh
pnpm run smoke:capture-public
pnpm run publish:alpha:dry-run
```

The first capture may install Playwright's exact pinned Chromium headless shell. Use
`pnpm --filter @tileflow/capture exec playwright install --only-shell chromium` to provision it
explicitly.

## Public contracts

Keep package exports and README examples aligned. Update
`docs/contracts/local-visual-capture.md` when scene, readiness, receipt, capture, or visual-baseline
behavior changes. Changes to hosted API or icon-package wire contracts require coordinated
validation with the Tileflow platform before release.

Do not commit generated `dist` files, browser binaries, captures, credentials, `.env` files, or
machine-specific paths.
