import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {publicPackageNames} from './release-config.mjs';
import {
  assertSuccessfulRequiredJob,
  assertTrustedMainCiRun,
  findSuccessfulMainCiRun,
} from './release-workflow.mjs';

const repository = 'tileflow/tileflow-sdk';
const releaseSha = 'a'.repeat(40);
const execFileAsync = promisify(execFile);

test('checks the public release interlock before npm reconciliation', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const interlock = workflow.indexOf('Enforce public SDK release interlock');
  const registryRead = workflow.indexOf('Download current npm alpha baselines');

  assert.ok(interlock >= 0);
  assert.ok(registryRead > interlock);
  assert.match(workflow, /node scripts\/public-release-interlock\.mjs/u);
  assert.doesNotMatch(workflow.slice(0, registryRead), /npm (?:view|pack|publish)/u);
});

test('documents candidate, approval, and human-owned stable SemVer boundaries', async () => {
  const publishing = await readFile(new URL('../PUBLISHING.md', import.meta.url), 'utf8');

  assert.match(
    publishing,
    /ordinary merge to `main`\s+creates a release candidate; it never publishes/u,
  );
  assert.match(publishing, /has no package, version, SHA, or channel inputs/u);
  assert.match(publishing, /one\s+approval on the GitHub `npm-publish` environment/u);
  assert.match(publishing, /reconciler never chooses patch, minor, or\s+major intent/u);
  assert.match(publishing, /For `@tileflow\/maps`/u);
  assert.match(publishing, /workflow never offers a bump\s+override/u);
});

test('only a deliberate parameter-free dispatch from current main can prepare publication', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n/mu);
  assert.doesNotMatch(workflow, /^ {2}(?:workflow_run|schedule):/mu);
  assert.doesNotMatch(workflow, /workflow_dispatch:\n\s+inputs:/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /RELEASE_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /core\.setFailed\(/u);
  assert.match(workflow, /environment: npm-publish/u);
  assert.match(workflow, /retention-days: 30/u);
});

test('publishes the approved bundle without rebuilding and verifies a final receipt', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const publishJob = workflow.slice(workflow.indexOf('\n  publish:\n'));

  assert.ok(publishJob.length > 0, 'Expected the isolated publish job.');
  assert.doesNotMatch(publishJob, /pnpm (?:install|build|check)/u);
  assert.doesNotMatch(publishJob, /turbo build/u);
  assert.ok(publishJob.indexOf('Verify release bundle and current main') >= 0);
  assert.ok(
    publishJob.indexOf('Verify release bundle and current main') <
      publishJob.indexOf('Publish changed packages'),
  );
  assert.ok(
    publishJob.indexOf('Publish changed packages') <
      publishJob.indexOf('Wait for npm registry processing'),
  );
  assert.ok(
    publishJob.indexOf('Wait for npm registry processing') <
      publishJob.indexOf('Verify exact published artifacts and create receipt'),
  );
  assert.match(publishJob, /node scripts\/wait-for-published-packages\.mjs/u);
  assert.match(publishJob, /compare-package-tarballs\.mjs/u);
  assert.match(publishJob, /dist\.integrity/u);
  assert.match(publishJob, /create-release-receipt\.mjs/u);
  assert.match(publishJob, /retention-days: 90/u);
  assert.equal((workflow.match(/id-token: write/gu) ?? []).length, 1);
});

test('loads every post-approval repository script without workspace dependencies', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tileflow-publish-scripts-'));

  try {
    const scriptsRoot = join(temporaryRoot, 'scripts');
    await cp(fileURLToPath(new URL('.', import.meta.url)), scriptsRoot, {recursive: true});

    for (const entrypoint of [
      'compare-package-tarballs.mjs',
      'create-release-receipt.mjs',
      'publication-decision.mjs',
      'wait-for-published-packages.mjs',
    ]) {
      await import(`${pathToFileURL(join(scriptsRoot, entrypoint)).href}?isolated=${entrypoint}`);
    }
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
});

test('downloads registry baselines from the single dependency-safe public catalog', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const script = fileURLToPath(new URL('./reconcile-release.mjs', import.meta.url));
  const {stdout, stderr} = await execFileAsync(process.execPath, [script, 'catalog']);

  assert.equal(stderr, '');
  assert.deepEqual(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.split('\t')[0]),
    publicPackageNames,
  );
  assert.match(workflow, /done < <\(node scripts\/reconcile-release\.mjs catalog\)/u);
  assert.doesNotMatch(workflow, /for package_name in/u);
  assert.match(workflow, /\\tunpublished\\n/u);
  assert.match(workflow, /configured first release \$initial_version/u);
  assert.match(workflow, /baseline_state/u);
});

test('validates peer-smoke topology and peer ranges without installing packages', async () => {
  const script = fileURLToPath(new URL('./peer-compat-smoke.mjs', import.meta.url));
  const {stdout, stderr} = await execFileAsync(process.execPath, [script, '--validate-only']);
  const result = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.buildDirectories.slice(0, 4), ['core', 'interactions', 'static', 'dev']);
  assert.ok(result.packageDirectories.includes('interactions'));
  assert.deepEqual(result.suites.find(({name}) => name === 'react')?.peers, {
    'maplibre-gl': '>=5 <7',
    react: '>=18 <20',
    'react-dom': '>=18 <20',
  });
});

test('keeps framework peer-smoke fixtures on the required source API', async () => {
  const peerSmoke = await readFile(new URL('./peer-compat-smoke.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(peerSmoke, /<Map\s+styleUrl=/u);
  assert.match(peerSmoke, /export const interactive = <Map source=\{\{kind: 'maplibre'/u);
  assert.match(peerSmoke, /const props = \{source: \{kind: 'maplibre' as const/u);
  assert.match(peerSmoke, /<TileflowMap source=\{\{kind: 'maplibre'/u);
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

test('finds exact successful main CI evidence for a deliberate release preparation', () => {
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
