import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  assertSuccessfulRequiredJob,
  assertTrustedMainCiRun,
  findSuccessfulMainCiRun,
} from './release-workflow.mjs';

const repository = 'tileflow/tileflow-sdk';
const releaseSha = 'a'.repeat(40);

test('checks the public release interlock before npm reconciliation', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const blockers = await readFile(
    new URL('../PUBLIC_RELEASE_BLOCKERS.md', import.meta.url),
    'utf8',
  );
  const interlock = workflow.indexOf('Enforce public SDK release interlock');
  const registryRead = workflow.indexOf('Download current npm alpha baselines');

  assert.ok(interlock >= 0);
  assert.ok(registryRead > interlock);
  assert.match(workflow, /\[\[ -f PUBLIC_RELEASE_BLOCKERS\.md \]\]/u);
  assert.match(blockers, /legal copyright owner/u);
  assert.match(blockers, /asset-set\s+ID/u);
});

test('accepts only a successful push CI run from tileflow-sdk main at the exact SHA', () => {
  const workflowRun = trustedRun();
  assert.equal(assertTrustedMainCiRun(workflowRun, repository, releaseSha), releaseSha);

  for (const override of [
    {name: 'CI clone'},
    {path: '.github/workflows/untrusted.yml'},
    {conclusion: 'failure'},
    {event: 'pull_request'},
    {head_branch: 'feature'},
    {head_repository: {full_name: 'attacker/tileflow-sdk'}},
    {head_sha: 'main'},
    {head_sha: 'b'.repeat(40)},
  ]) {
    assert.throws(() =>
      assertTrustedMainCiRun({...workflowRun, ...override}, repository, releaseSha),
    );
  }
});

test('finds exact successful main CI evidence for scheduled and dispatched reconciliation', () => {
  const run = trustedRun();
  assert.equal(
    findSuccessfulMainCiRun(
      [{...run, conclusion: 'failure'}, {...run, event: 'workflow_dispatch'}, run],
      repository,
      releaseSha,
    ),
    run,
  );
  assert.equal(
    findSuccessfulMainCiRun([{...run, head_sha: 'b'.repeat(40)}], repository, releaseSha),
    null,
  );
  assert.equal(findSuccessfulMainCiRun([], repository, releaseSha), null);
});

test('requires the single CI Required job to be green', () => {
  const required = {name: 'Required', conclusion: 'success'};
  assert.equal(assertSuccessfulRequiredJob([{name: 'Build'}, required]), required);
  assert.throws(() => assertSuccessfulRequiredJob([]));
  assert.throws(() => assertSuccessfulRequiredJob([{...required, conclusion: 'failure'}]));
  assert.throws(() => assertSuccessfulRequiredJob([required, required]));
});

function trustedRun() {
  return {
    id: 123,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_repository: {full_name: repository},
    head_sha: releaseSha,
  };
}
