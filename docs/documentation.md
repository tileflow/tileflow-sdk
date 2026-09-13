# Maintain the package documentation

Package READMEs are product documentation: they ship to npm, appear on GitHub, and are read directly
by both people and coding agents. Keep package behavior in the owning README and focused guides
under that package's `docs/` directory. Shared lifecycle and ownership rules belong in `docs/contracts`.

## Make the first task complete

Start with what the package does and when to choose it. State what it does not do when the boundary
is easy to confuse: schemas versus execution, preparation versus browser rendering, or displaying
an image versus creating a paid static render.

Use one package-name title, an installation section, and descriptive sentence-case headings.
Put prerequisites before the example: runtime and peer versions, imports, config and output paths,
worker/CSS setup, an existing application server, a deployed map, or an enabled service. Examples
that depend on an existing project must say so. Install direct imports explicitly and use the
current documented release channel; do not assume that `latest` is the current alpha.

A first example should contain every import and value it needs. Explain the observable result,
coordinate order, and significant failure states. Mark placeholders and explain where their values
come from. Never use a non-null assertion to hide a missing credential or show a privileged key in
browser code. Distinguish a normal empty result from an operational error.

Keep advanced recipes available, but move them out of oversized landing pages. Preserve technical
constraints, provenance, security boundaries, and third-party notices when reorganizing text.
Reference fragments are acceptable when their surrounding text identifies the required context;
do not present a partial object or an undefined helper as a runnable program.

## Write for people and agents

Prefer direct verbs, short paragraphs, consistent terms, and ordinary English. Keep API identifiers
exact, even when prose uses a simpler term. Use sentence case for headings, label every code fence,
and avoid unexplained abbreviations, marketing claims, and words such as “simply” that conceal work.
Do not equate successful validation with service availability, geodetic correctness, or identical
pixels across platforms.

Use the [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)
for task-first structure, scannability, concise wording, and capitalization. Its UI-specific advice
is not a reason to remove API constraints or replace technical terms with vague language.

Apply the relevant [AFDocs checks](https://www.afdocs.dev/checks/): discoverable Markdown, bounded
pages, descriptive headings, valid fences, and working links. The root `llms.txt` indexes the public
package catalog and points directly to raw Markdown. Keep it synchronized when adding a package.
Link to that index near the top of every package README so readers arriving from npm can find it.
Do not build a second, hand-written API schema for agents; the CLI already emits generated language
contracts.

AFDocs primarily audits documentation websites. This repository does not control npm's HTML,
HTTP headers, redirects, or root `llms.txt` route. Installing its website checker here would not fix
those platform concerns. The repository checks below cover the files and examples we own; they are
not an AFDocs score or certification. A separate hosted documentation site can run the full checker
against its own origin.

## Keep links useful outside the checkout

Package READMEs should use absolute GitHub URLs for cross-package and repository references; a
relative `../../docs` link is not a reliable npm entry point. Use descriptive link text rather than
“here.” Prefer original documentation and source contracts over generic landing pages.

Include a package's deeper guides in its `files` allowlist so they remain available after
installation. The installed README, declarations, and guides describe that release; links to `main`
may describe newer code. Never assume that all packages share one version number. In a checkout,
check claims against public exports, package manifests, implementation, and focused tests.

## Validate changes

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm run docs:check
pnpm check
```

`docs:check` checks the public package catalog, README titles and installation sections, page-size
budgets, Markdown fence structure, repository-link paths, index coverage, and README/guide inclusion
in npm's dry-run pack lists. It does not publish anything or change release versions. The current
budgets are 20,000 characters per package README and 50,000 per reference page; split by task when a
page exceeds them, rather than hiding content.

Place `<!-- docs:check -->` immediately before a standalone `ts`, `tsx`, or `js` fence to include it
in the example check. The checker writes isolated temporary modules and typechecks them against
built public exports. It never executes config or hosted requests. Public examples must not rely
on private `src` imports or stubs that hide missing package exports.

Vue and Svelte README components are also compiled with their installed framework compiler, and
their script blocks are typechecked. This catches syntax and script/API drift, not every template
prop error, browser behavior, live service response, or peer-version combination. Keep the existing
package, packed-consumer, framework, and capture tests authoritative for those boundaries.

For a quick pass without built declarations:

```sh
node scripts/check-docs.mjs --structure-only
```

That mode checks files and pack lists only, not example types or framework compilation. Record
which checks actually ran in a PR; do not describe manual reading or a fixture as a live integration
test. New or changed behavior still needs its owning package tests.

## Publish through the normal release process

A README change is part of a package's published artifact. Update source docs in the PR, include any
new guide files in the package, and let the protected release process prepare the next eligible
alpha. Do not edit versions or publish merely to refresh the website. Merging a PR alone does not
update npm. Follow [PUBLISHING.md](https://github.com/tileflow/tileflow-sdk/blob/main/PUBLISHING.md).

npm documents that its [package README](https://docs.npmjs.com/about-package-readme-files/) updates
when a new package version is published. The repository's release approval remains a separate action.
