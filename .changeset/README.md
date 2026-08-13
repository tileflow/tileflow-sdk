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
