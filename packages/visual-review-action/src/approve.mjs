import {evidenceFile, needsApproval, statusContext} from './contract.mjs';
import {listEvidenceBlobs, readEvidenceJson, writeEvidence} from './evidence.mjs';
import {createGitHub} from './github.mjs';

const allowedPermissions = new Set(['admin', 'maintain', 'write']);

export function parseApproval(body) {
  const match = /^\/tileflow approve ([0-9a-f]{7,40})[ \t]*(?:\r?\n|$)/.exec(body ?? '');
  return match?.[1] ?? null;
}

/**
 * Records a maintainer's decision for one exact commit. The commit in the command must be the
 * pull request's current head, so a push after review can never inherit the approval.
 */
export async function runApprove(env = process.env) {
  const requestedSha = parseApproval(env.TILEFLOW_REVIEW_COMMENT_BODY);
  if (!requestedSha) {
    console.log('This comment is not an approval command.');
    return;
  }
  const github = createGitHub(env);
  const branch = env.TILEFLOW_REVIEW_EVIDENCE_BRANCH;
  const pullNumber = Number(env.TILEFLOW_REVIEW_PULL_REQUEST);
  const author = env.TILEFLOW_REVIEW_COMMENT_AUTHOR;
  const react = (content) =>
    github.post(`/issues/comments/${env.TILEFLOW_REVIEW_COMMENT_ID}/reactions`, {content});
  const refuse = async (reason) => {
    console.error(reason);
    await react('-1');
    await github.post(`/issues/${pullNumber}/comments`, {body: `Approval not recorded: ${reason}`});
    process.exitCode = 1;
  };

  const {permission} = await github.get(`/collaborators/${encodeURIComponent(author)}/permission`);
  if (!allowedPermissions.has(permission)) {
    return refuse('only people with write access to this repository can approve.');
  }
  const pullRequest = await github.get(`/pulls/${pullNumber}`);
  const headSha = pullRequest.head.sha;
  if (pullRequest.state !== 'open') return refuse('this pull request is closed.');
  if (!headSha.startsWith(requestedSha)) {
    return refuse(
      `the command names ${requestedSha}, but the current commit is ${headSha.slice(0, 12)}. Review the latest report.`,
    );
  }
  const evidencePath = `pr-${pullNumber}/${headSha}`;
  const report = await readEvidenceJson(github, branch, `${evidencePath}/report.json`);
  if (!report) return refuse('there is no report for this commit yet.');
  if (!report.approvable) return refuse('this report cannot be approved. See its details.');
  const scenes = report.scenes.filter(needsApproval);
  if (scenes.length === 0) return refuse('this report has nothing to approve.');

  const blobs = await listEvidenceBlobs(github, branch, `${evidencePath}/`);
  const approval = {
    schemaVersion: 1,
    headSha,
    approvedBy: author,
    scenes: scenes.map(({scene, afterSha256}) => {
      const png = blobs.get(evidenceFile(scene, 'after'));
      const receipt = blobs.get(evidenceFile(scene, 'receipt'));
      if (!png || !receipt) throw new Error(`Evidence for ${scene} is incomplete.`);
      return {scene, sha256: afterSha256, png, receipt};
    }),
  };
  await writeEvidence(
    github,
    branch,
    [
      {
        path: `approvals/pr-${pullNumber}.json`,
        bytes: Buffer.from(`${JSON.stringify(approval, null, 2)}\n`),
      },
    ],
    `Approve visual baselines for #${pullNumber} at ${headSha.slice(0, 12)}`,
  );
  await github.post(`/statuses/${headSha}`, {
    context: statusContext,
    description: `Approved by ${author}`.slice(0, 140),
    state: 'success',
  });
  await react('+1');
  await github.post(`/issues/${pullNumber}/comments`, {
    body: `Approved ${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} at ${headSha.slice(0, 12)}. Baselines update when this pull request merges.`,
  });
}
