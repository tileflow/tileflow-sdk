import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';

const sha = 'a'.repeat(40);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString(
  'base64',
);

/** Stands in for gh and glab: it answers from a JSON file and records every write. */
const fakeHost = `#!/usr/bin/env node
const {readFileSync, writeFileSync} = require('node:fs');
const {basename} = require('node:path');
const statePath = process.env.FAKE_HOST_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const done = (value) => {
  writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(typeof value === 'string' ? value : Buffer.isBuffer(value) ? value : JSON.stringify(value));
  process.exit(0);
};
const missing = () => { process.stderr.write('Not Found (HTTP 404)\\n'); process.exit(1); };
const evidence = (path) => {
  const value = state.evidence[path];
  return value === undefined ? missing() : done(Buffer.from(value, 'base64'));
};
if (args[0] === 'pr') done(state.pull);
const post = args.includes('POST');
const path = args.filter((value) => /^(repos|projects)\\//.test(value)).at(-1);
if (basename(process.argv[1]) === 'gh') {
  const contents = /contents\\/(.+)\\?ref=/.exec(path);
  if (contents) evidence(decodeURI(contents[1]));
  if (path.includes('/status')) done({statuses: state.statuses});
  if (post) {
    const body = args[args.indexOf('-f') + 1].replace(/^body=/, '');
    const comment = {id: 10, body, created_at: '2026-11-09T00:00:00Z'};
    state.comments.push(comment);
    if (state.onApprove === 'approve') state.statuses = [{context: 'Tileflow visual review', state: 'success', description: 'Approved by maintainer'}];
    if (state.onApprove === 'refuse') state.comments.push({id: 11, body: 'Approval not recorded: only people with write access to this repository can approve.'});
    done(comment);
  }
  if (path.includes('/comments')) done(state.comments);
} else {
  const file = /repository\\/files\\/(.+)\\/raw/.exec(path);
  if (file) evidence(decodeURIComponent(file[1]));
  if (path.includes('/statuses')) done(state.statuses);
  if (path.includes('/notes')) done(state.notes);
  if (path.includes('/pipelines') && path.includes('merge_requests')) done(state.pipelines);
  if (path.includes('/jobs?')) done(state.jobs);
  const action = /jobs\\/(\\d+)\\/(play|retry)/.exec(path);
  if (action) {
    state.actions.push(action[2] + ':' + action[1]);
    const job = {id: 21, status: state.onApprove === 'refuse' ? 'failed' : 'success', user: {username: 'maintainer'}};
    state.started = job;
    done(job);
  }
  if (/jobs\\/\\d+$/.test(path)) done(state.started);
  if (/merge_requests\\/\\d+$/.test(path)) done(state.mergeRequest);
  if (path.includes('merge_requests?')) done([state.mergeRequest]);
}
process.stderr.write('Unexpected call: ' + args.join(' ') + '\\n');
process.exit(1);
`;

function evidenceReport(scenes: unknown[], overrides: Record<string, unknown> = {}): string {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      headSha: sha,
      approvable: true,
      cliVersion: '1.0.0',
      failure: null,
      scenes,
      semantic: [],
      warnings: [],
      ...overrides,
    }),
  ).toString('base64');
}

const changedScene = {
  scene: 'centro',
  map: 'madrid',
  status: 'changed',
  noise: false,
  exactPixels: 40,
  perceptualPixels: 30,
  totalPixels: 1000,
  images: {before: true, after: true, diff: true},
};

const unchangedScene = {
  ...changedScene,
  scene: 'retiro',
  status: 'unchanged',
  images: {before: true, after: true, diff: false},
};

function hostState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pull: {number: 7, url: 'https://github.test/pull/7', headRefOid: sha, state: 'OPEN'},
    mergeRequest: {iid: 7, sha, state: 'opened', web_url: 'https://gitlab.test/-/7'},
    statuses: [],
    comments: [],
    notes: [],
    pipelines: [{id: 5, sha}],
    jobs: [{id: 20, name: 'tileflow-visual-review-approve', status: 'manual'}],
    actions: [],
    evidence: {
      [`pr-7/${sha}/report.json`]: evidenceReport([changedScene, unchangedScene]),
      [`pr-7/${sha}/centro.before.png`]: png,
      [`pr-7/${sha}/centro.after.png`]: png,
      [`pr-7/${sha}/centro.diff.png`]: png,
    },
    ...overrides,
  };
}

async function fixture(t: TestContext, state: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-visual-approval-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  for (const name of ['gh', 'glab']) {
    await writeFile(join(bin, name), fakeHost);
    await chmod(join(bin, name), 0o755);
  }
  const statePath = join(directory, 'state.json');
  await writeFile(statePath, JSON.stringify(state));
  return {
    directory,
    bin,
    readState: async () => JSON.parse(await readFile(statePath, 'utf8')),
    run: (args: string[], path = `${bin}${delimiter}${process.env.PATH}`) =>
      runCli(directory, args, {FAKE_HOST_STATE: statePath, PATH: path}),
  };
}

async function runCli(cwd: string, args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, cliFixtureArguments(args), {
    cwd,
    env: {...process.env, ...env},
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const [code] = await once(child, 'close');
  return {code: code as number, stdout, stderr};
}

const reportArgs = ['visual', 'report', '7', '--provider', 'github', '--json'];
const approveArgs = ['visual', 'approve', '7', '--provider', 'github', '--commit', sha, '--json'];

test('report downloads images only for the scenes that need a decision', async (t) => {
  const host = await fixture(t, hostState());
  const result = await host.run(reportArgs);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.command, 'visual.report');
  assert.equal(document.state, 'needs-approval');
  assert.equal(document.commit, sha);
  const [centro, retiro] = document.scenes;
  assert.equal(centro.needsApproval, true);
  assert.equal(retiro.needsApproval, false);
  assert.equal(retiro.afterPath, null);
  assert.deepEqual(
    await readFile(join(host.directory, centro.afterPath)),
    Buffer.from(png, 'base64'),
  );
  assert.match(document.nextStep, /Only after they accept them/u);
  assert.match(document.nextStep, new RegExp(`--commit ${sha}`, 'u'));
  assert.ok(document.untrustedFields.includes('semantic'));
});

test('report states what is still missing or already settled', async (t) => {
  const pending = await fixture(t, hostState({evidence: {}}));
  assert.equal(JSON.parse((await pending.run(reportArgs)).stdout).state, 'pending');

  const approved = await fixture(
    t,
    hostState({
      evidence: {
        ...(hostState().evidence as object),
        'approvals/pr-7.json': Buffer.from(
          JSON.stringify({headSha: sha, approvedBy: 'maintainer'}),
        ).toString('base64'),
      },
    }),
  );
  const document = JSON.parse((await approved.run(reportArgs)).stdout);
  assert.equal(document.state, 'approved');
  assert.equal(document.approvedBy, 'maintainer');
  assert.equal(document.nextStep, null);

  const blocked = await fixture(
    t,
    hostState({
      evidence: {
        [`pr-7/${sha}/report.json`]: evidenceReport([], {approvable: false, failure: 'broken'}),
      },
    }),
  );
  assert.equal(JSON.parse((await blocked.run(reportArgs)).stdout).state, 'blocked');
});

test('report rejects a scene name that would leave the output directory', async (t) => {
  const host = await fixture(
    t,
    hostState({
      evidence: {
        [`pr-7/${sha}/report.json`]: evidenceReport([{...changedScene, scene: '../../escape'}]),
      },
    }),
  );
  const result = await host.run(reportArgs);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unsupported scene name/u);
});

test('report refuses evidence for another commit', async (t) => {
  const host = await fixture(
    t,
    hostState({
      evidence: {[`pr-7/${sha}/report.json`]: evidenceReport([], {headSha: 'b'.repeat(40)})},
    }),
  );
  const result = await host.run(reportArgs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /another commit/u);
});

test('approve asks the workflow to decide and reports its result', async (t) => {
  const host = await fixture(t, hostState({onApprove: 'approve'}));
  const result = await host.run(approveArgs);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.state, 'approved');
  assert.equal(document.approvedBy, 'maintainer');
  const {comments} = await host.readState();
  assert.equal(comments[0].body, `/tileflow approve ${sha}`);
});

test('approve surfaces a refusal from the workflow', async (t) => {
  const host = await fixture(t, hostState({onApprove: 'refuse'}));
  const result = await host.run(approveArgs);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /only people with write access/u);
});

test('approve can return as soon as the approval is requested', async (t) => {
  const host = await fixture(t, hostState());
  const result = await host.run([...approveArgs, '--timeout', '0']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, 'requested');
});

test('approve never touches the host for a commit other than the current one', async (t) => {
  const host = await fixture(t, hostState({onApprove: 'approve'}));
  const result = await host.run([
    'visual',
    'approve',
    '7',
    '--provider',
    'github',
    '--commit',
    'b'.repeat(40),
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Review the latest report/u);
  assert.deepEqual((await host.readState()).comments, []);
});

test('approve refuses a report with nothing to approve', async (t) => {
  const host = await fixture(
    t,
    hostState({evidence: {[`pr-7/${sha}/report.json`]: evidenceReport([unchangedScene])}}),
  );
  const result = await host.run(approveArgs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /nothing to approve/u);
  assert.deepEqual((await host.readState()).comments, []);
});

test('approve plays the manual job on GitLab', async (t) => {
  const host = await fixture(t, hostState());
  const report = await host.run(['visual', 'report', '7', '--provider', 'gitlab', '--json']);
  assert.equal(report.code, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).provider, 'gitlab');

  const result = await host.run([
    'visual',
    'approve',
    '7',
    '--provider',
    'gitlab',
    '--commit',
    sha.slice(0, 12),
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).approvedBy, 'maintainer');
  assert.deepEqual((await host.readState()).actions, ['play:20']);
});

test('approve runs a finished GitLab job again and reports a refusal', async (t) => {
  const host = await fixture(
    t,
    hostState({
      onApprove: 'refuse',
      jobs: [{id: 20, name: 'tileflow-visual-review-approve', status: 'failed'}],
      notes: [{body: 'Approval not recorded: the person who opened this merge request cannot.'}],
    }),
  );
  const result = await host.run([
    'visual',
    'approve',
    '7',
    '--provider',
    'gitlab',
    '--commit',
    sha,
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /opened this merge request/u);
  assert.deepEqual((await host.readState()).actions, ['retry:20']);
});

test('the host comes from the origin remote', async (t) => {
  const host = await fixture(t, hostState());
  const git = (...args: string[]) => spawnSync('git', args, {cwd: host.directory});
  git('init', '-q');
  git('remote', 'add', 'origin', 'git@gitlab.com:acme/maps.git');
  const result = await host.run(['visual', 'report', '7', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).provider, 'gitlab');
});

test('a missing host CLI names what to install', async (t) => {
  const host = await fixture(t, hostState());
  const result = await host.run(reportArgs, join(host.directory, 'empty'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /gh is not installed/u);
});

test('commands validate their arguments before calling the host', async (t) => {
  const host = await fixture(t, hostState());
  const badCommit = await host.run([
    'visual',
    'approve',
    '7',
    '--provider',
    'github',
    '--commit',
    'not-a-commit',
    '--json',
  ]);
  assert.equal(badCommit.code, 1);
  assert.match(badCommit.stderr, /--commit expects/u);

  const badChange = await host.run(['visual', 'report', '7;x', '--provider', 'github', '--json']);
  assert.equal(badChange.code, 1);
  assert.match(badChange.stderr, /positive number/u);

  const badProvider = await host.run(['visual', 'report', '7', '--provider', 'bitbucket']);
  assert.equal(badProvider.code, 1);
  assert.match(badProvider.stderr, /github or gitlab/u);
});
