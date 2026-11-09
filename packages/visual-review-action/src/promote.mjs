import {createProvider} from './provider.mjs';
import {repositoryPath} from './report.mjs';

/**
 * Runs when a pull request closes. A merged, approved pull request moves exactly the approved image
 * and receipt files into the baseline directory: the bytes the reviewer saw, nothing rendered anew.
 */
export async function runPromote(env = process.env, provider = createProvider(env)) {
  for (const {number, merged} of await provider.closedChangeRequests()) {
    const approvalPath = `approvals/pr-${number}.json`;
    const approval = await provider.readEvidenceJson(approvalPath);
    if (approval && merged) {
      const changeRequest = await provider.getChangeRequest(number);
      if (changeRequest.headSha === approval.headSha) {
        await promote(provider, env, changeRequest, approval);
      } else {
        await provider.comment(
          number,
          `Baselines were not updated: the approval covered ${approval.headSha.slice(0, 12)}, but ${changeRequest.headSha.slice(0, 12)} merged.`,
        );
      }
    }
    await provider.writeEvidence([], `Close visual review for ${provider.reference(number)}`, [
      `pr-${number}/`,
      approvalPath,
    ]);
  }
}

async function promote(provider, env, {baseBranch, number}, approval) {
  const directory = repositoryPath(env);
  const result = await provider.publishBaselines({
    baseBranch,
    number,
    files: approval.scenes.flatMap(({scene, png, receipt}) => [
      {path: `${directory}/${scene}.png`, handle: png},
      {path: `${directory}/${scene}.receipt.json`, handle: receipt},
    ]),
    message: `Update visual baselines for ${provider.reference(number)}\n\nApproved-by: ${approval.approvedBy}`,
  });
  await provider.comment(
    number,
    result.proposedIn
      ? `${baseBranch} is protected, so the approved baselines are waiting in ${result.proposedIn}.`
      : `Baselines updated in ${result.commit.slice(0, 12)}.`,
  );
}
