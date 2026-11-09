import {readUntrustedImages, readUntrustedReport} from './contract.mjs';
import {createProvider} from './provider.mjs';
import {renderReport, summarize} from './render.mjs';

/**
 * Runs from the default branch with write access. It never checks out or executes pull request
 * code, and it treats the capture artifact purely as data to validate and display.
 */
export async function runReport(env = process.env, provider = createProvider(env)) {
  const dryRun = env.TILEFLOW_REVIEW_DRY_RUN === 'true';
  const headSha = env.TILEFLOW_REVIEW_HEAD_SHA;
  if (!dryRun && !provider.captureCameFromChangeRequest()) {
    console.log('The capture run did not come from a pull request. Nothing to report.');
    return;
  }
  const runUrl = provider.captureRunUrl();
  const setStatus = (state, description) =>
    dryRun ? undefined : provider.setStatus(headSha, state, description, runUrl);

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
    const changeRequest = await provider.getChangeRequest(report.pullRequest);
    if (changeRequest.headSha !== headSha) {
      console.log('The pull request has moved on. Skipping this stale capture.');
      return;
    }
    const changed = await provider.listChangedFiles(report.pullRequest);
    const baselinePath = repositoryPath(env);
    baselineEdits = changed.filter((name) => name.startsWith(`${baselinePath}/`));
    workflowEdits = changed.filter((name) => provider.isAutomationFile(name));
  }

  const evidencePath = `pr-${report.pullRequest}/${headSha}`;
  const approvable = baselineEdits.length === 0 && !report.failure;
  const sanitized = {...report, approvable};
  const evidenceId = await provider.writeEvidence(
    [
      ...files.map(({name, bytes}) => ({path: `${evidencePath}/${name}`, bytes})),
      {
        path: `${evidencePath}/report.json`,
        bytes: Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`),
      },
    ],
    `Visual review evidence for ${provider.reference(report.pullRequest)} at ${headSha.slice(0, 12)}`,
  );
  const body = renderReport({
    approvable,
    approvalInstructions: provider.approvalInstructions(headSha),
    changeRequestNoun: provider.changeRequestNoun,
    baselineEdits,
    imageBase: provider.evidenceUrl(evidenceId, evidencePath),
    report,
    runUrl,
    workflowEdits,
  });
  const summary = summarize(report, baselineEdits);
  await provider.writeRunOutput(body, summary.verdict);

  if (!dryRun) {
    await provider.upsertReport(report.pullRequest, body);
    await setStatus(summary.state, summary.title);
  }
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
