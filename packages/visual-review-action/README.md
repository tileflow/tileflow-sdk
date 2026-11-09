# Tileflow visual review action

Shows map changes inside a GitHub pull request or a GitLab merge request: which committed scenes
changed, before and after images, a semantic diff from `tileflow semantic-diff`, and a pass or fail
status from `tileflow visual diff --fail-on changed`. Reviewers need no Tileflow account, and
neither does the repository.

## Set it up on GitHub

Your project needs committed scenes, a lockfile and an exact `tileflow` devDependency. Copy these
two workflows into `.github/workflows/` and replace `COMMIT_SHA` with a full commit of this action:

- [`tileflow-visual-review.yml`](./examples/tileflow-visual-review.yml) renders the pull request.
- [`tileflow-visual-review-publish.yml`](./examples/tileflow-visual-review-publish.yml) reports,
  approves and updates baselines.

In the repository settings, make `Tileflow visual review` a required status check. No baselines are
needed to start: the first pull request reports every scene as new, and approving it creates them.
Baselines render on GitHub-hosted Ubuntu, so renders from a laptop will not match them.

## Set it up on GitLab

The GitLab template reviews merge requests from the same project. It doesn't run on forks, because
a parent pipeline for a fork exposes the parent project's variables.

With CI configuration in the project, use this template only if you trust everyone with the
Developer role or higher. Merge request pipelines use the source branch's configuration, so anyone
who can push a branch to the project can access the publishing token.

For stricter control, keep the CI configuration and its includes in a separate project writable
only by CI maintainers. In **Settings > CI/CD > General pipelines > CI/CD configuration file**,
select `.gitlab-ci.yml@group/project`.

1. Create a dedicated project access token with the Developer role, the `api` scope and a short
   expiry. Rotate it before it expires and when a member leaves the project.
2. Add it as a masked CI/CD variable named `TILEFLOW_REVIEW_TOKEN`, with the environment scope
   `tileflow-visual-review`. Update the variable when you rotate the token.
3. Add the [template](./gitlab/tileflow-visual-review.yml) to `.gitlab-ci.yml`, and replace both
   `COMMIT_SHA` values with the same full commit of this action:

   ```yaml
   include:
     - remote: https://raw.githubusercontent.com/tileflow/tileflow-sdk/COMMIT_SHA/packages/visual-review-action/gitlab/tileflow-visual-review.yml
       inputs:
         action_ref: COMMIT_SHA
   ```

   GitLab requires a merge request rule in the root CI configuration. Projects that already run
   merge request pipelines can keep that rule. Also allow pushes to the default branch so merged
   baselines update. For a new workflow, use the example below. For an existing workflow, add
   only the missing rules and retain its other triggers.

   ```yaml
   workflow:
     rules:
       - if: $CI_PIPELINE_SOURCE == "merge_request_event"
       - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
   ```

4. In the merge request settings, turn on **Pipelines must succeed**.

Runners must allow the unprivileged user namespaces that the Chromium sandbox needs. The review
works as described in the next section, with these differences:

- To approve, someone with at least the Developer role runs the manual
  `tileflow-visual-review-approve` job in the latest pipeline of the merge request.
- Merging starts a pipeline on the default branch, which updates the baselines. The token can't
  push to a protected branch, so the baselines arrive as a merge request instead.
- Baselines render in the `image` input of the template, so renders from a laptop won't match them.

The other inputs are listed at the top of the template.

## How a review works

1. A pull request renders each scene and compares it with the baselines on the base branch.
2. The bot comments with the result and sets the status. A changed scene fails the status.
3. If the change is intended, someone with write access comments the command from the report:
   `/tileflow approve <commit>`. The status passes for that exact commit, and a new push needs a
   new approval.
4. When the pull request merges, the approved images and receipts become the baselines. On a
   protected base branch they arrive as a pull request instead, which needs **Allow GitHub Actions
   to create and approve pull requests** enabled.

Editing baseline files in a pull request fails the status. They change only through step 4.

Images live on the `tileflow-visual-review` branch, because comments need a URL and no hosted
service is involved. On a private repository they display only for people who can read it. Merged
and closed pull requests drop their files from that branch, but history keeps them; delete the
branch to reclaim the space, which also breaks images in old comments.

A few pixels often differ between identical renders. A scene counts as renderer noise, and passes,
only when no pixel changed perceptually and the exact change is within `noise-ratio`, 0.0001 by
default. The report always lists it. Set `noise-ratio: 0` to fail on any exact difference.

## Security

Tileflow configs are executable, so pull request code is treated as hostile:

- The capture job runs `pull_request` with a read-only token and no secrets, and refuses privileged
  events.
- The publish workflow never checks out pull request code. It validates the evidence as data,
  escapes all text it displays, and takes approvals only from people with write access.
- Baselines come from the base commit, never from the pull request.
- In the supplied GitLab template, the environment scope keeps the token out of capture. Trust
  whoever can edit the pipeline configuration that selects the environment.

A malicious pull request controls its own capture job, so it can forge what its report shows. The
status catches honest mistakes, not attackers: always read the config diff of an untrusted pull
request, and keep GitHub's approval requirement for first-time contributors.

## Inputs

See [`action.yml`](./action.yml). The ones you are most likely to set are `working-directory`,
`config`, `baseline-dir` and `install-command`. `dry-run: true` writes the report to the job summary
without touching a pull request or a commit status.

## Next steps

Read about [scenes and baselines](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md)
and the [documentation](https://tileflow.dev/docs).
