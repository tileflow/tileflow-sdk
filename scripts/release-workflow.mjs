import assert from 'node:assert/strict';

const commitPattern = /^[0-9a-f]{40}$/u;

export function assertTrustedMainCiRun(workflowRun, repository, expectedSha) {
  assert.equal(workflowRun?.name, 'CI', 'The tested workflow must be named CI.');
  assert.equal(
    workflowRun?.path,
    '.github/workflows/ci.yml',
    'The tested workflow must be .github/workflows/ci.yml.',
  );
  assert.equal(workflowRun?.conclusion, 'success', 'The tested CI run must succeed.');
  assert.equal(workflowRun?.event, 'push', 'The tested CI run must be a push run.');
  assert.equal(workflowRun?.head_branch, 'main', 'The tested CI run must target main.');
  assert.equal(
    workflowRun?.head_repository?.full_name,
    repository,
    `The tested CI run must belong to ${repository}.`,
  );
  assert.match(
    workflowRun?.head_sha ?? '',
    commitPattern,
    'The tested CI run must provide a full lowercase commit SHA.',
  );
  if (expectedSha !== undefined) {
    assert.match(expectedSha, commitPattern, 'Expected a full lowercase release SHA.');
    assert.equal(workflowRun.head_sha, expectedSha, 'The CI run tested a different commit.');
  }
  return workflowRun.head_sha;
}

export function findSuccessfulMainCiRun(workflowRuns, repository, expectedSha) {
  assert.ok(Array.isArray(workflowRuns), 'Workflow runs must be an array.');
  assert.match(expectedSha, commitPattern, 'Expected a full lowercase release SHA.');
  return (
    workflowRuns.find((workflowRun) => {
      try {
        assertTrustedMainCiRun(workflowRun, repository, expectedSha);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function assertSuccessfulRequiredJob(jobs) {
  assert.ok(Array.isArray(jobs), 'Workflow jobs must be an array.');
  const requiredJobs = jobs.filter((job) => job?.name === 'Required');
  assert.equal(requiredJobs.length, 1, 'The CI run must contain exactly one Required job.');
  assert.equal(
    requiredJobs[0].conclusion,
    'success',
    'The CI Required job must finish successfully.',
  );
  return requiredJobs[0];
}
