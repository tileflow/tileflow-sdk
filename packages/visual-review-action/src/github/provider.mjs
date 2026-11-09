import {appendFile} from 'node:fs/promises';
import {commentMarker, statusContext} from '../contract.mjs';
import {createGitHub} from './client.mjs';
import {listEvidenceBlobs, readEvidenceJson, writeEvidence} from './evidence.mjs';

const botLogin = 'github-actions[bot]';
const unsafeEvents = new Set(['issue_comment', 'pull_request_target', 'workflow_run']);
const writePermissions = new Set(['admin', 'maintain', 'write']);

export function assertGitHubCaptureAllowed(env) {
  if (unsafeEvents.has(env.GITHUB_EVENT_NAME)) {
    throw new Error(
      `Capture runs pull request code and must not run on ${env.GITHUB_EVENT_NAME}. Use pull_request.`,
    );
  }
}

export function parseApproval(body) {
  const match = /^\/tileflow approve ([0-9a-f]{7,40})[ \t]*(?:\r?\n|$)/.exec(body ?? '');
  return match?.[1] ?? null;
}

export function githubApprovalInstructions(headSha) {
  return [
    'If the renders above are intended, a maintainer can accept them for this commit:',
    '',
    '```',
    `/tileflow approve ${headSha.slice(0, 12)}`,
    '```',
  ];
}

export function createGitHubProvider(env) {
  const github = createGitHub(env);
  const branch = env.TILEFLOW_REVIEW_EVIDENCE_BRANCH;
  const reference = (number) => `#${number}`;
  const comment = (number, body) => github.post(`/issues/${number}/comments`, {body});
  const setStatus = (sha, state, description, targetUrl) =>
    github.post(`/statuses/${sha}`, {
      context: statusContext,
      description: description.slice(0, 140),
      state,
      target_url: targetUrl,
    });

  return {
    reference,
    comment,
    setStatus,
    changeRequestNoun: 'pull request',
    closedChangeRequests: async () => [
      {
        number: Number(env.TILEFLOW_REVIEW_PULL_REQUEST),
        merged: env.TILEFLOW_REVIEW_MERGED === 'true',
      },
    ],
    approvalInstructions: githubApprovalInstructions,
    isAutomationFile: (path) => path.startsWith('.github/workflows/'),
    captureCameFromChangeRequest: () => env.TILEFLOW_REVIEW_RUN_EVENT === 'pull_request',
    captureRunUrl: () =>
      `${env.GITHUB_SERVER_URL}/${github.repository}/actions/runs/${env.TILEFLOW_REVIEW_RUN_ID}`,

    approvalRequest() {
      const requestedSha = parseApproval(env.TILEFLOW_REVIEW_COMMENT_BODY);
      return requestedSha ? {author: env.TILEFLOW_REVIEW_COMMENT_AUTHOR, requestedSha} : null;
    },
    async acknowledgeApproval(accepted) {
      await github.post(`/issues/comments/${env.TILEFLOW_REVIEW_COMMENT_ID}/reactions`, {
        content: accepted ? '+1' : '-1',
      });
    },
    async canApprove(author) {
      const {permission} = await github.get(
        `/collaborators/${encodeURIComponent(author)}/permission`,
      );
      return writePermissions.has(permission);
    },

    async getChangeRequest(number) {
      const pullRequest = await github.get(`/pulls/${number}`);
      return {
        number,
        headSha: pullRequest.head.sha,
        baseBranch: pullRequest.base.ref,
        open: pullRequest.state === 'open',
      };
    },
    async listChangedFiles(number) {
      const files = await github.paginate(`/pulls/${number}/files`);
      return files.map(({filename}) => filename);
    },
    async upsertReport(number, body) {
      const comments = await github.paginate(`/issues/${number}/comments`);
      const existing = comments.find(
        (item) => item.user?.login === botLogin && item.body?.startsWith(commentMarker),
      );
      if (existing) await github.patch(`/issues/comments/${existing.id}`, {body});
      else await comment(number, body);
    },
    async writeRunOutput(body, verdict) {
      if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, body);
      if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `verdict=${verdict}\n`);
    },

    writeEvidence: (files, message, removePrefixes) =>
      writeEvidence(github, branch, files, message, removePrefixes),
    readEvidenceJson: (path) => readEvidenceJson(github, branch, path),
    listEvidence: (prefix) => listEvidenceBlobs(github, branch, prefix),
    evidenceUrl: (id, path) => `${env.GITHUB_SERVER_URL}/${github.repository}/raw/${id}/${path}`,

    async publishBaselines({baseBranch, files, message, number}) {
      const entries = files.map(({path, handle}) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha: handle,
      }));
      for (let attempt = 1; ; attempt += 1) {
        const {object} = await github.get(`/git/ref/heads/${baseBranch}`);
        const parentCommit = await github.get(`/git/commits/${object.sha}`);
        const tree = await github.post('/git/trees', {
          base_tree: parentCommit.tree.sha,
          tree: entries,
        });
        const commit = await github.post('/git/commits', {
          message,
          tree: tree.sha,
          parents: [object.sha],
        });
        try {
          await github.patch(`/git/refs/heads/${baseBranch}`, {sha: commit.sha});
          return {commit: commit.sha};
        } catch (error) {
          if (error.status === 403 || /protected/i.test(error.message)) {
            return {proposedIn: await proposeBaselines(baseBranch, number, commit.sha)};
          }
          if (attempt >= 4 || ![409, 422].includes(error.status)) throw error;
        }
      }
    },
  };

  /**
   * A protected base branch rejects the workflow token, so the same commit goes up for merge
   * instead. Pull requests opened by that token start no workflows, so the proposal carries its
   * status here.
   */
  async function proposeBaselines(baseBranch, number, commitSha) {
    const head = `tileflow-visual-review-baselines/pr-${number}`;
    await github.post('/git/refs', {ref: `refs/heads/${head}`, sha: commitSha});
    const proposal = await github.post('/pulls', {
      base: baseBranch,
      body: `Baselines approved in ${reference(number)}.`,
      head,
      title: `Update visual baselines for ${reference(number)}`,
    });
    await setStatus(commitSha, 'success', 'Baselines approved in the source pull request');
    return reference(proposal.number);
  }
}
