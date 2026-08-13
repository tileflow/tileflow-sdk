import assert from 'node:assert/strict';

const commitPattern = /^[0-9a-f]{40}$/u;

export function assertTrustedMainCiRun(workflowRun, repository) {
  assert.equal(workflowRun?.name, 'CI', 'The triggering workflow must be named CI.');
  assert.equal(
    workflowRun?.path,
    '.github/workflows/ci.yml',
    'The triggering workflow must be .github/workflows/ci.yml.',
  );
  assert.equal(workflowRun?.conclusion, 'success', 'The triggering CI run must succeed.');
  assert.equal(workflowRun?.event, 'push', 'The triggering CI run must be a push run.');
  assert.equal(workflowRun?.head_branch, 'main', 'The triggering CI run must target main.');
  assert.equal(
    workflowRun?.head_repository?.full_name,
    repository,
    `The triggering CI run must belong to ${repository}.`,
  );
  assert.match(
    workflowRun?.head_sha ?? '',
    commitPattern,
    'The triggering CI run must provide a full lowercase commit SHA.',
  );
  return workflowRun.head_sha;
}

export function classifyAssociatedPullRequests(pullRequests, repository, releaseSha) {
  assert.ok(Array.isArray(pullRequests), 'Associated pull requests must be an array.');
  assert.match(releaseSha, commitPattern, 'Expected a full lowercase release commit SHA.');

  const mergedMainPullRequests = pullRequests.filter(
    (pullRequest) =>
      pullRequest?.merged_at &&
      pullRequest?.base?.ref === 'main' &&
      pullRequest?.head?.repo?.full_name === repository &&
      pullRequest?.merge_commit_sha === releaseSha,
  );
  assert.ok(
    mergedMainPullRequests.length <= 1,
    `Release commit ${releaseSha} is associated with multiple merged main pull requests.`,
  );

  const [pullRequest] = mergedMainPullRequests;
  if (!pullRequest) return {baseSha: null, pullNumber: null, trustedRelease: false};

  assert.match(
    pullRequest.base?.sha ?? '',
    commitPattern,
    'The associated pull request must provide a full lowercase base SHA.',
  );
  return {
    baseSha: pullRequest.base.sha,
    pullNumber: pullRequest.number,
    trustedRelease: pullRequest.head.ref === 'changeset-release/main',
  };
}
