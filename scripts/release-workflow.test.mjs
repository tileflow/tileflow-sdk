import assert from 'node:assert/strict';
import test from 'node:test';
import {assertTrustedMainCiRun, classifyAssociatedPullRequests} from './release-workflow.mjs';

const repository = 'tileflow/tileflow-sdk';
const releaseSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

test('accepts only a successful push CI run from tileflow-sdk main', () => {
  const workflowRun = {
    name: 'CI',
    path: '.github/workflows/ci.yml',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_repository: {full_name: repository},
    head_sha: releaseSha,
  };
  assert.equal(assertTrustedMainCiRun(workflowRun, repository), releaseSha);

  for (const override of [
    {name: 'CI clone'},
    {path: '.github/workflows/untrusted.yml'},
    {conclusion: 'failure'},
    {event: 'pull_request'},
    {head_branch: 'feature'},
    {head_repository: {full_name: 'attacker/tileflow-sdk'}},
    {head_sha: 'main'},
  ]) {
    assert.throws(() => assertTrustedMainCiRun({...workflowRun, ...override}, repository));
  }
});

test('recognizes only the merged official Release PR', () => {
  const trusted = pullRequest();
  assert.deepEqual(classifyAssociatedPullRequests([trusted], repository, releaseSha), {
    baseSha,
    pullNumber: 42,
    trustedRelease: true,
  });

  assert.deepEqual(
    classifyAssociatedPullRequests(
      [pullRequest({head: {ref: 'feature', repo: {full_name: repository}}})],
      repository,
      releaseSha,
    ),
    {baseSha, pullNumber: 42, trustedRelease: false},
  );
});

test('ignores forks, wrong bases, unmerged PRs, and unrelated commits', () => {
  for (const override of [
    {merged_at: null},
    {base: {ref: 'next', sha: baseSha}},
    {head: {ref: 'changeset-release/main', repo: {full_name: 'attacker/tileflow-sdk'}}},
    {merge_commit_sha: 'c'.repeat(40)},
  ]) {
    assert.deepEqual(
      classifyAssociatedPullRequests([pullRequest(override)], repository, releaseSha),
      {baseSha: null, pullNumber: null, trustedRelease: false},
    );
  }
});

test('fails closed when one commit maps to multiple merged main PRs', () => {
  assert.throws(
    () =>
      classifyAssociatedPullRequests(
        [pullRequest(), pullRequest({number: 43})],
        repository,
        releaseSha,
      ),
    /multiple merged main pull requests/u,
  );
});

function pullRequest(overrides = {}) {
  return {
    number: 42,
    merged_at: '2026-08-13T17:00:00Z',
    base: {ref: 'main', sha: baseSha},
    head: {ref: 'changeset-release/main', repo: {full_name: repository}},
    merge_commit_sha: releaseSha,
    ...overrides,
  };
}
