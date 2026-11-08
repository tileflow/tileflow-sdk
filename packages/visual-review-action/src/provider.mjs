import {assertGitHubCaptureAllowed, createGitHubProvider} from './github/provider.mjs';

/**
 * Everything the review stages need from a Git host. Stages stay host-neutral and call only these
 * members, so adding a host means implementing this contract and registering it below.
 *
 * Trigger:
 * - `captureCameFromChangeRequest()`: whether the capture being reported ran for a change request.
 * - `approvalRequest()`: `{author, requestedSha}` when this run is an approval, otherwise `null`.
 * - `acknowledgeApproval(accepted)`: tells the approver the outcome, where the host has a way to.
 * - `approvalInstructions(headSha)`: Markdown lines telling a maintainer how to approve.
 * - `canApprove(author)`: whether the host grants that person write access.
 *
 * Change request:
 * - `reference(number)`: how the host writes a link to it, such as `#7` or `!7`.
 * - `getChangeRequest(number)`: `{number, headSha, baseBranch, open}`.
 * - `listChangedFiles(number)`: changed paths, from the host and never from the checkout.
 * - `isAutomationFile(path)`: whether a path can change what the host's CI runs.
 * - `comment(number, body)` and `upsertReport(number, body)`: the second keeps one sticky report.
 * - `setStatus(sha, state, description, targetUrl)`: state is `success`, `failure` or `error`.
 * - `captureRunUrl()`: link to the capture run.
 * - `writeRunOutput(body, verdict)`: the host's job summary and step outputs, if any.
 *
 * Storage. A handle is opaque to the stages, which only persist it and pass it back:
 * - `writeEvidence(files, message, removePrefixes)`: returns the id used in `evidenceUrl`.
 * - `readEvidenceJson(path)`: parsed JSON, or `null` when the file is absent.
 * - `listEvidence(prefix)`: `Map` of path relative to the prefix to its handle.
 * - `evidenceUrl(id, path)`: URL a comment can load the file from.
 * - `publishBaselines({baseBranch, files, message, number})`: `files` holds `{path, handle}`.
 *   Returns `{commit}`, or `{proposedIn}` with a reference when the branch refuses direct writes.
 */
const providers = {
  github: {
    assertCaptureAllowed: assertGitHubCaptureAllowed,
    create: createGitHubProvider,
  },
};

function select(env) {
  const name = env.TILEFLOW_REVIEW_PROVIDER || 'github';
  if (!Object.hasOwn(providers, name)) throw new Error(`Unsupported Git provider: ${name}.`);
  return providers[name];
}

export function createProvider(env) {
  return select(env).create(env);
}

/**
 * Capture runs pull request code without any token, so this check needs no provider instance.
 */
export function assertCaptureAllowed(env) {
  select(env).assertCaptureAllowed(env);
}
