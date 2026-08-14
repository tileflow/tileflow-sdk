import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {classifyPublicationState} from './publication-decision.mjs';

const execFileAsync = promisify(execFile);
const scriptsRoot = dirname(fileURLToPath(import.meta.url));

test('classifies idempotent registry retries and rejects tag or byte drift', () => {
  const release = {from: '0.1.0-alpha.16', to: '0.1.0-alpha.17'};
  assert.equal(
    classifyPublicationState({...release, currentTag: release.from, targetState: 'missing'}),
    'publish',
  );
  assert.equal(
    classifyPublicationState({...release, currentTag: release.to, targetState: 'identical'}),
    'published',
  );
  assert.throws(
    () =>
      classifyPublicationState({...release, currentTag: release.from, targetState: 'different'}),
    /different package contents/u,
  );
  assert.throws(
    () =>
      classifyPublicationState({...release, currentTag: release.from, targetState: 'identical'}),
    /cannot repair dist-tags/u,
  );
  assert.throws(
    () =>
      classifyPublicationState({
        ...release,
        currentTag: '0.1.0-alpha.15',
        targetState: 'missing',
      }),
    /Expected alpha/u,
  );
});

test('runs the publish preflight decision without installed workspace dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-publication-decision-test-'));
  try {
    const isolatedScripts = join(root, 'scripts');
    await mkdir(isolatedScripts);
    await Promise.all(
      ['publication-decision.mjs', 'release-config.mjs'].map((filename) =>
        copyFile(join(scriptsRoot, filename), join(isolatedScripts, filename)),
      ),
    );
    const entrypoint = await realpath(join(isolatedScripts, 'publication-decision.mjs'));
    const runDecision = (...arguments_) =>
      execFileAsync(process.execPath, [entrypoint, ...arguments_], {
        cwd: root,
        env: {...process.env, NODE_PATH: ''},
      });

    const publish = await runDecision(
      '0.1.0-alpha.16',
      '0.1.0-alpha.17',
      '0.1.0-alpha.16',
      'missing',
    );
    assert.equal(publish.stderr, '');
    assert.equal(publish.stdout, 'publish\n');

    const published = await runDecision(
      '0.1.0-alpha.16',
      '0.1.0-alpha.17',
      '0.1.0-alpha.17',
      'identical',
    );
    assert.equal(published.stderr, '');
    assert.equal(published.stdout, 'published\n');

    await assert.rejects(
      runDecision('0.1.0-alpha.16', '0.1.0-alpha.17', '0.1.0-alpha.16', 'different'),
      /different package contents/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
