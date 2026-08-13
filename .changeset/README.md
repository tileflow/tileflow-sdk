# Changesets

Add a changeset for every change that should publish one or more packages:

    pnpm changeset

Select only the packages whose own public artifact or contract changed. Documentation, tests,
examples, and repository tooling do not need a release changeset unless they alter published
package contents or behavior.

Tileflow uses Changesets files as reviewed release intent, but applies them with
`pnpm release:version`. Do not run `changeset version`: its dependent propagation is deliberately
not Tileflow's release policy. Each selected package advances independently to the next numeric
alpha version, and unselected packages keep their versions.

After a source pull request with pending changesets reaches `main`, the Release PR is created or
updated automatically. Do not edit its generated release plan, versions, or changelogs by hand.
Merging that Release PR is the final publication approval: the full `main` CI matrix runs first and,
if it passes, the selected packages are published automatically through npm Trusted Publishing.
No release tag or long-lived npm automation token is required.
