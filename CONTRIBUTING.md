# Contributing

Thank you for helping improve the Tileflow SDK.

## Development setup

Use Node.js 22.14+ (22.x) or 24+ and the pnpm version declared in `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

Run a focused package check while iterating, for example:

```sh
pnpm --filter @tileflow/core verify
pnpm --filter @tileflow/core typecheck
```

CI runs Dev and CLI verification in separate jobs; the remaining packages run with static checks.
Every package still runs its full `verify` script, and `Required` joins every job. `pnpm check`
retains complete local verification. `pnpm check:static` runs only documentation, release, architecture,
types, lint and formatting checks.

Capture and CLI browser suites run independently on each Linux, macOS and Windows / Node 22 and 24
combination. This repeats runner preparation to reduce elapsed time while retaining every test.
CLI subprocess tests use the freshly built executable in CI (`TILEFLOW_TEST_CLI_MODE=built`),
avoiding a TypeScript loader in each child process. Local tests default to source mode. To exercise
the CI path locally, build first, then run `TILEFLOW_TEST_CLI_MODE=built pnpm --filter tileflow test`.
The built mode never falls back to source when its executable is missing.

CI shares a temporary Node compile cache between subprocesses in each job. It caches bytecode,
not test results, and is discarded with the runner. For a local comparison, set `NODE_COMPILE_CACHE`
to a temporary directory or use `NODE_DISABLE_COMPILE_CACHE=1` to disable it.

Tests own their subprocesses and loopback servers. Stop consumers before closing their servers and
removing fixtures. Use `requestStop()` to request shutdown over IPC and await the command's `stopped`
event within its existing test deadline. Use `stop()` for cleanup; it terminates the process tree
if the consumer does not stop. A timeout must fail the test without leaving its worker running.
JSON process fixtures propagate test cancellation, reject pending event waits when the child exits,
and dispose consumers before servers and directories. HTTP fixture shutdown closes unfinished
connections; cleanup continues through remaining resources if one disposer fails.
Restore the working directory before removing a temporary fixture; Windows keeps the current
directory locked. CLI tests assert structured output and preserve the test runner's binary events.
Next, Vue and Svelte capture failures include bounded browser console, page and network diagnostics.

Browser CI uses TAP so failure details appear before the final summary. With
`TILEFLOW_TEST_PROGRESS=1` and `NODE_OPTIONS=--require=/absolute/path/to/test-support/test-progress.cjs`,
both suites report active test files every 30 seconds. Workers report CPU time, memory and active
resource counts; these timers cannot keep a worker alive. Capture framework tests also stream bounded
browser launch, context, close, crash and network events. Ordinary local tests remain quiet.
The observer retains its stderr writer so command-level JSON captures exclude progress messages.

Do not edit package versions, add changesets, create release tags, or run `npm publish`. Every
source package keeps `0.0.0-development`. Merging to `main` creates a candidate; it does not
publish to npm. Publication requires an explicit workflow dispatch from `main`, verification of the
prepared release bundle, and approval of the protected `npm-publish` environment. See
[PUBLISHING.md](PUBLISHING.md) for the complete procedure.

A package README and its packaged guides are part of its public artifact. Documentation changes can
therefore make that package eligible for its next independent numeric alpha release, but do not
publish it automatically. Keep builds deterministic and review the packed files before approving a
release.

Before submitting a package change, exercise the packed consumer:

```sh
pnpm run release:verify-source
pnpm run smoke:capture-public
pnpm run publish:alpha:dry-run
```

The first capture may install Playwright's exact pinned Chromium headless shell. Use
`pnpm --filter @tileflow/capture exec playwright install --only-shell chromium` to provision it
explicitly.

## Opt-in packed mobile checks

The [packed mobile smoke guide](docs/mobile-packed-smoke.md) documents separate checks for Expo and
React Native Community consumers built from Core, Interactions and React Native tarballs:

```sh
pnpm run smoke:mobile:packed
pnpm run smoke:mobile:android
pnpm run smoke:mobile:ios
```

Read the guide's prerequisites first. Packed checks need Linux/macOS, Node, npm, the repository's
exact pnpm and `tar`; Android additionally needs JDK 21 and the specified Android SDK components;
iOS needs macOS, Xcode and CocoaPods. Missing or inapplicable prerequisites fail rather than skip.
These commands are not included in ordinary checks or publication. They verify public compilation,
autolinking and, only in the platform modes, Release/Hermes binaries. They do not launch an app,
render a map, qualify a physical device, contact Hosted, publish to a registry or establish availability.
Temporary consumers and artifacts are removed unless diagnostic preservation is explicitly requested
with `--keep`. No source package versions or application credentials are changed.

## Public contracts

Keep package exports and README examples aligned. Follow the
[documentation guide](docs/documentation.md) and run `pnpm run docs:check` after building the packages. Update
`docs/contracts/local-visual-capture.md` when scene, readiness, receipt, capture, or visual-baseline
behavior changes. Shared hosted API and rendering contracts must remain backward compatible because
npm and platform production cannot update atomically; deploy compatible server behavior before
merging the SDK client change.

Do not commit generated `dist` files, browser binaries, captures, credentials, `.env` files,
machine-specific paths, or temporary registry/release plans.

## License

The repository is licensed under the [Apache License, Version 2.0](LICENSE). Unless you state
otherwise in writing when submitting it, an intentional contribution is provided under the same
license as described by Apache-2.0 section 5. Third-party material must retain its own license and
notice files and must not be added unless its redistribution and generated-output boundary are
documented.
