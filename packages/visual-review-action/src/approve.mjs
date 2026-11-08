import {evidenceFile, needsApproval} from './contract.mjs';
import {createProvider} from './provider.mjs';

/**
 * Records a maintainer's decision for one exact commit. The commit in the request must be the
 * pull request's current head, so a push after review can never inherit the approval.
 */
export async function runApprove(env = process.env, provider = createProvider(env)) {
  const request = provider.approvalRequest();
  if (!request) {
    console.log('This run is not an approval.');
    return;
  }
  const {author, requestedSha} = request;
  const number = Number(env.TILEFLOW_REVIEW_PULL_REQUEST);
  const refuse = async (reason) => {
    console.error(reason);
    await provider.acknowledgeApproval(false);
    await provider.comment(number, `Approval not recorded: ${reason}`);
    process.exitCode = 1;
  };

  if (!(await provider.canApprove(author))) {
    return refuse('only people with write access to this repository can approve.');
  }
  const {headSha, open} = await provider.getChangeRequest(number);
  if (!open) return refuse('this pull request is closed.');
  if (!headSha.startsWith(requestedSha)) {
    return refuse(
      `the command names ${requestedSha}, but the current commit is ${headSha.slice(0, 12)}. Review the latest report.`,
    );
  }
  const evidencePath = `pr-${number}/${headSha}`;
  const report = await provider.readEvidenceJson(`${evidencePath}/report.json`);
  if (!report) return refuse('there is no report for this commit yet.');
  if (!report.approvable) return refuse('this report cannot be approved. See its details.');
  const scenes = report.scenes.filter(needsApproval);
  if (scenes.length === 0) return refuse('this report has nothing to approve.');

  const handles = await provider.listEvidence(`${evidencePath}/`);
  const approval = {
    schemaVersion: 1,
    headSha,
    approvedBy: author,
    scenes: scenes.map(({scene, afterSha256}) => {
      const png = handles.get(evidenceFile(scene, 'after'));
      const receipt = handles.get(evidenceFile(scene, 'receipt'));
      if (!png || !receipt) throw new Error(`Evidence for ${scene} is incomplete.`);
      return {scene, sha256: afterSha256, png, receipt};
    }),
  };
  await provider.writeEvidence(
    [
      {
        path: `approvals/pr-${number}.json`,
        bytes: Buffer.from(`${JSON.stringify(approval, null, 2)}\n`),
      },
    ],
    `Approve visual baselines for ${provider.reference(number)} at ${headSha.slice(0, 12)}`,
  );
  await provider.setStatus(headSha, 'success', `Approved by ${author}`);
  await provider.acknowledgeApproval(true);
  await provider.comment(
    number,
    `Approved ${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} at ${headSha.slice(0, 12)}. Baselines update when this pull request merges.`,
  );
}
