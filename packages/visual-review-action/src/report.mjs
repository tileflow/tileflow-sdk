import {appendFile} from 'node:fs/promises';
import {
  commentMarker,
  readUntrustedImages,
  readUntrustedReport,
  statusContext,
} from './contract.mjs';
import {writeEvidence} from './evidence.mjs';
import {createGitHub} from './github.mjs';
import {renderReport, summarize} from './render.mjs';

const botLogin = 'github-actions[bot]';

/**
 * Runs from the default branch with write access. It never checks out or executes pull request
 * code, and it treats the capture artifact purely as data to validate and display.
 */
export async function runReport(env = process.env) {
  const github = createGitHub(env);
  const dryRun = env.TILEFLOW_REVIEW_DRY_RUN === 'true';
  const branch = env.TILEFLOW_REVIEW_EVIDENCE_BRANCH;
  const headSha = env.TILEFLOW_REVIEW_HEAD_SHA;
  if (!dryRun && env.TILEFLOW_REVIEW_RUN_EVENT !== 'pull_request') {
    console.log('The capture run did not come from a pull request. Nothing to report.');
    return;
  }
  const runUrl = `${env.GITHUB_SERVER_URL}/${github.repository}/actions/runs/${env.TILEFLOW_REVIEW_RUN_ID}`;
  const setStatus = (state, description) =>
    dryRun
      ? undefined
      : github.post(`/statuses/${headSha}`, {
          context: statusContext,
          description: description.slice(0, 140),
          state,
          target_url: runUrl,
        });

  let report;
  let files;
  try {
    report = await readUntrustedReport(env.TILEFLOW_REVIEW_OUTPUT);
    files = report.failure ? [] : await readUntrustedImages(env.TILEFLOW_REVIEW_OUTPUT, report);
  } catch (error) {
    console.error(`Rejected capture evidence: ${error.message}`);
    await setStatus('error', 'The capture produced no usable evidence.');
    process.exitCode = 1;
    return;
  }
  if (report.headSha !== headSha) {
    await setStatus('error', 'The capture evidence is for another commit.');
    process.exitCode = 1;
    return;
  }

  let baselineEdits = [];
  let workflowEdits = [];
  if (!dryRun) {
    const pullRequest = await github.get(`/pulls/${report.pullRequest}`);
    if (pullRequest.head.sha !== headSha) {
      console.log('The pull request has moved on. Skipping this stale capture.');
      return;
    }
    const changed = await github.paginate(`/pulls/${report.pullRequest}/files`);
    const baselinePath = repositoryPath(env);
    baselineEdits = changed
      .map(({filename}) => filename)
      .filter((name) => name.startsWith(`${baselinePath}/`));
    workflowEdits = changed
      .map(({filename}) => filename)
      .filter((name) => name.startsWith('.github/workflows/'));
  }

  const evidencePath = `pr-${report.pullRequest}/${headSha}`;
  const approvable = baselineEdits.length === 0 && !report.failure;
  const sanitized = {...report, approvable};
  const commit = await writeEvidence(
    github,
    branch,
    [
      ...files.map(({name, bytes}) => ({path: `${evidencePath}/${name}`, bytes})),
      {
        path: `${evidencePath}/report.json`,
        bytes: Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`),
      },
    ],
    `Visual review evidence for #${report.pullRequest} at ${headSha.slice(0, 12)}`,
  );
  const imageBase = `${env.GITHUB_SERVER_URL}/${github.repository}/raw/${commit}/${evidencePath}`;
  const body = renderReport({
    approvable,
    baselineEdits,
    imageBase,
    report,
    runUrl,
    workflowEdits,
  });
  const summary = summarize(report, baselineEdits);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, body);
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `verdict=${summary.verdict}\n`);

  if (!dryRun) {
    await upsertComment(github, report.pullRequest, body);
    await setStatus(summary.state, summary.title);
  }
}

async function upsertComment(github, pullRequest, body) {
  const comments = await github.paginate(`/issues/${pullRequest}/comments`);
  const existing = comments.find(
    (comment) => comment.user?.login === botLogin && comment.body?.startsWith(commentMarker),
  );
  if (existing) await github.patch(`/issues/comments/${existing.id}`, {body});
  else await github.post(`/issues/${pullRequest}/comments`, {body});
}

export function repositoryPath(env) {
  const path = [env.TILEFLOW_REVIEW_WORKING_DIRECTORY, env.TILEFLOW_REVIEW_BASELINE_DIR]
    .join('/')
    .split('/')
    .filter((part) => part && part !== '.');
  if (path.includes('..') || path.length === 0) {
    throw new Error('baseline-dir must stay inside the repository.');
  }
  return path.join('/');
}
