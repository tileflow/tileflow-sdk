import {statusContext} from './contract.mjs';
import {readEvidenceJson, writeEvidence} from './evidence.mjs';
import {createGitHub} from './github.mjs';
import {repositoryPath} from './report.mjs';

/**
 * Runs when a pull request closes. A merged, approved pull request moves exactly the approved image
 * and receipt blobs into the baseline directory: the bytes the reviewer saw, nothing rendered anew.
 */
export async function runPromote(env = process.env) {
  const github = createGitHub(env);
  const branch = env.TILEFLOW_REVIEW_EVIDENCE_BRANCH;
  const pullNumber = Number(env.TILEFLOW_REVIEW_PULL_REQUEST);
  const approvalPath = `approvals/pr-${pullNumber}.json`;
  const approval = await readEvidenceJson(github, branch, approvalPath);
  if (approval && env.TILEFLOW_REVIEW_MERGED === 'true') {
    const pullRequest = await github.get(`/pulls/${pullNumber}`);
    if (pullRequest.head.sha === approval.headSha) {
      await promote(github, env, pullRequest, approval);
    } else {
      await github.post(`/issues/${pullNumber}/comments`, {
        body: `Baselines were not updated: the approval covered ${approval.headSha.slice(0, 12)}, but ${pullRequest.head.sha.slice(0, 12)} merged.`,
      });
    }
  }
  await writeEvidence(github, branch, [], `Close visual review for #${pullNumber}`, [
    `pr-${pullNumber}/`,
    approvalPath,
  ]);
}

async function promote(github, env, pullRequest, approval) {
  const baseBranch = pullRequest.base.ref;
  const directory = repositoryPath(env);
  const entries = approval.scenes.flatMap(({scene, png, receipt}) => [
    {path: `${directory}/${scene}.png`, mode: '100644', type: 'blob', sha: png},
    {path: `${directory}/${scene}.receipt.json`, mode: '100644', type: 'blob', sha: receipt},
  ]);
  const message = `Update visual baselines for #${pullRequest.number}\n\nApproved-by: ${approval.approvedBy}`;

  for (let attempt = 1; ; attempt += 1) {
    const reference = await github.get(`/git/ref/heads/${baseBranch}`);
    const parent = reference.object.sha;
    const parentCommit = await github.get(`/git/commits/${parent}`);
    const tree = await github.post('/git/trees', {base_tree: parentCommit.tree.sha, tree: entries});
    const commit = await github.post('/git/commits', {message, tree: tree.sha, parents: [parent]});
    try {
      await github.patch(`/git/refs/heads/${baseBranch}`, {sha: commit.sha});
      await github.post(`/issues/${pullRequest.number}/comments`, {
        body: `Baselines updated in ${commit.sha.slice(0, 12)}.`,
      });
      return;
    } catch (error) {
      if (error.status === 403 || /protected/i.test(error.message)) {
        await proposeBaselines(github, pullRequest, baseBranch, commit.sha);
        return;
      }
      if (attempt >= 4 || ![409, 422].includes(error.status)) throw error;
    }
  }
}

/**
 * A protected base branch rejects the workflow token, so the same commit goes up for merge instead.
 * Pull requests opened by that token start no workflows, so the proposal carries its status here.
 */
async function proposeBaselines(github, pullRequest, baseBranch, commitSha) {
  const head = `tileflow-visual-review-baselines/pr-${pullRequest.number}`;
  await github.post('/git/refs', {ref: `refs/heads/${head}`, sha: commitSha});
  const proposal = await github.post('/pulls', {
    base: baseBranch,
    body: `Baselines approved in #${pullRequest.number}.`,
    head,
    title: `Update visual baselines for #${pullRequest.number}`,
  });
  await github.post(`/statuses/${commitSha}`, {
    context: statusContext,
    description: 'Baselines approved in the source pull request',
    state: 'success',
  });
  await github.post(`/issues/${pullRequest.number}/comments`, {
    body: `${baseBranch} is protected, so the approved baselines are waiting in #${proposal.number}.`,
  });
}
