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

When a change should publish a package, add its release intent before opening the pull request:

```sh
pnpm changeset
```

Select only the packages whose own public artifact or compatibility contract changed. A normal
source pull request never publishes directly; after it reaches `main`, automation prepares the
separate Release PR that versions the selected packages.

Merging the Release PR is the final and irreversible publication approval. Its selected packages
publish automatically only after the complete `main` CI run succeeds. Do not create release tags,
run `npm publish`, or edit the generated versions, changelogs, and release plan by hand.

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
validation with the Tileflow platform before release. Run the private `SDK Candidate` workflow
against the exact, current Release PR head SHA before merging it, and repeat that gate whenever the
head changes.

Do not commit generated `dist` files, browser binaries, captures, credentials, `.env` files, or
machine-specific paths.
