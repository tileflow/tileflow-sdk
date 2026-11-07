import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {parseApproval, runApprove} from '../src/approve.mjs';
import {runCapture} from '../src/capture.mjs';
import {commentMarker, readUntrustedReport} from '../src/contract.mjs';
import {runPromote} from '../src/promote.mjs';
import {escapeText, renderReport, summarize} from '../src/render.mjs';
import {runReport} from '../src/report.mjs';
import {startFakeGitHub} from './fake-github.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const afterSha256 = 'c'.repeat(64);

function png() {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(500, 20);
  return bytes;
}

function scene(overrides = {}) {
  return {
    scene: 'madrid',
    map: 'main',
    status: 'changed',
    noise: false,
    exactPixels: 1200,
    perceptualPixels: 300,
    totalPixels: 400000,
    afterSha256,
    images: {before: true, after: true, diff: true, receipt: true},
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    pullRequest: 7,
    headSha,
    baseSha,
    cliVersion: '0.1.0-alpha.22',
    exitCode: 2,
    failure: null,
    scenes: [scene()],
    semantic: [
      {
        map: 'main',
        total: 1,
        changes: [
          {kind: 'change', path: '/modules/roads/weight', before: 'regular', after: 'bold'},
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

async function writeArtifact(directory, document) {
  await rm(directory, {force: true, recursive: true});
  await mkdir(join(directory, 'scenes'), {recursive: true});
  await writeFile(join(directory, 'report.json'), JSON.stringify(document));
  for (const {scene: name, images} of document.scenes ?? []) {
    for (const kind of ['before', 'after', 'diff']) {
      if (images[kind]) await writeFile(join(directory, 'scenes', `${name}.${kind}.png`), png());
    }
    if (images.receipt) {
      await writeFile(
        join(directory, 'scenes', `${name}.receipt.json`),
        JSON.stringify({scene: {name}, image: {sha256: afterSha256}}),
      );
    }
  }
}

describe('untrusted evidence', () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tileflow-review-test-'));
  });
  afterEach(() => rm(directory, {force: true, recursive: true}));

  it('rejects scene names that could escape the evidence directory', async () => {
    await writeArtifact(directory, report({scenes: []}));
    const document = report({scenes: [scene({scene: '../../main'})]});
    await writeFile(join(directory, 'report.json'), JSON.stringify(document));
    await assert.rejects(readUntrustedReport(directory), /unsupported scene name/);
  });

  it('rejects unknown statuses and oversized scene lists', async () => {
    await writeArtifact(directory, report({scenes: []}));
    const unknown = report({scenes: [scene({status: 'approved'})]});
    await writeFile(join(directory, 'report.json'), JSON.stringify(unknown));
    await assert.rejects(readUntrustedReport(directory), /Unknown scene status/);
    const many = report({scenes: Array.from({length: 31}, (_, i) => scene({scene: `s${i}`}))});
    await writeFile(join(directory, 'report.json'), JSON.stringify(many));
    await assert.rejects(readUntrustedReport(directory), /scenes list is invalid/);
  });

  it('refuses a report that is a symbolic link', async () => {
    await writeFile(join(directory, 'secret.json'), '{}');
    await symlink(join(directory, 'secret.json'), join(directory, 'report.json'));
    await assert.rejects(readUntrustedReport(directory), /regular files/);
  });
});

describe('rendering', () => {
  it('escapes mentions, markup and links from pull request text', () => {
    const escaped = escapeText('@all <img src=x> [a](http://b) `c` | ![d]');
    assert.doesNotMatch(escaped, /[@<>[\]`|!]/);
    assert.match(escapeText('#12 www.x.io'), /&#8203;/);
  });

  it('keeps hostile values out of the rendered comment', () => {
    const body = renderReport({
      approvable: true,
      baselineEdits: [],
      imageBase: 'https://github.test/raw/1',
      runUrl: 'https://github.test/run',
      workflowEdits: [],
      report: report({
        cliVersion: '<script>',
        semantic: [
          {
            map: '@org/team',
            total: 1,
            changes: [{kind: 'add', path: '/a', before: null, after: '![x](http://evil)'}],
          },
        ],
        warnings: ['@everyone [click](http://evil)'],
      }),
    });
    assert.ok(body.startsWith(commentMarker));
    const decoded = body.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    assert.doesNotMatch(body, /<script>/);
    assert.doesNotMatch(decoded, /@org|@everyone|http:\/\/evil/);
    assert.match(body, /\/tileflow approve aaaaaaaaaaaa/);
  });

  it('passes renderer noise but keeps it visible', () => {
    const noisy = report({scenes: [scene({noise: true, exactPixels: 2, perceptualPixels: 0})]});
    assert.equal(summarize(noisy).state, 'success');
    const body = renderReport({
      approvable: true,
      baselineEdits: [],
      imageBase: 'x',
      report: noisy,
      workflowEdits: [],
    });
    assert.match(body, /Renderer noise/);
    assert.doesNotMatch(body, /tileflow approve/);
  });

  it('fails when a pull request edits baselines by hand', () => {
    const clean = report({scenes: [scene({status: 'unchanged'})]});
    assert.equal(summarize(clean, ['test/visual-baselines/a.png']).state, 'failure');
  });
});

describe('approval command', () => {
  it('accepts only an exact command on the first line', () => {
    assert.equal(parseApproval('/tileflow approve abc1234'), 'abc1234');
    assert.equal(parseApproval('/tileflow approve abc1234\nthanks'), 'abc1234');
    assert.equal(parseApproval('/tileflow approve'), null);
    assert.equal(parseApproval('please /tileflow approve abc1234'), null);
    assert.equal(parseApproval('/tileflow approve zzz1234'), null);
  });
});

describe('capture safety', () => {
  it('refuses events that would give pull request code a write token', async () => {
    for (const event of ['pull_request_target', 'workflow_run', 'issue_comment']) {
      await assert.rejects(runCapture({GITHUB_EVENT_NAME: event}), /must not run on/);
    }
  });
});

describe('publishing stages', () => {
  let github;
  let directory;
  let env;

  beforeEach(async () => {
    github = await startFakeGitHub();
    github.seedBranch('main', {'README.md': 'map'});
    github.pulls.set(7, {
      number: 7,
      state: 'open',
      head: {sha: headSha},
      base: {ref: 'main'},
    });
    github.permissions.maintainer = 'write';
    directory = await mkdtemp(join(tmpdir(), 'tileflow-review-test-'));
    env = {
      GITHUB_API_URL: github.url,
      GITHUB_REPOSITORY: 'acme/maps',
      GITHUB_SERVER_URL: 'https://github.test',
      GITHUB_TOKEN: 'test-token',
      TILEFLOW_REVIEW_BASELINE_DIR: 'test/visual-baselines',
      TILEFLOW_REVIEW_COMMENT_AUTHOR: 'maintainer',
      TILEFLOW_REVIEW_COMMENT_BODY: `/tileflow approve ${headSha.slice(0, 12)}`,
      TILEFLOW_REVIEW_COMMENT_ID: '55',
      TILEFLOW_REVIEW_DRY_RUN: 'false',
      TILEFLOW_REVIEW_EVIDENCE_BRANCH: 'tileflow-visual-review',
      TILEFLOW_REVIEW_HEAD_SHA: headSha,
      TILEFLOW_REVIEW_MERGED: 'true',
      TILEFLOW_REVIEW_OUTPUT: directory,
      TILEFLOW_REVIEW_PULL_REQUEST: '7',
      TILEFLOW_REVIEW_RUN_EVENT: 'pull_request',
      TILEFLOW_REVIEW_RUN_ID: '99',
      TILEFLOW_REVIEW_WORKING_DIRECTORY: '.',
    };
    process.exitCode = 0;
  });

  afterEach(async () => {
    process.exitCode = 0;
    await github.close();
    await rm(directory, {force: true, recursive: true});
  });

  const lastStatus = () => github.statuses.at(-1);

  it('takes a change from report to approval to merged baselines', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    assert.equal(lastStatus().state, 'failure');
    assert.equal(github.comments.length, 1);
    const evidence = github.files('tileflow-visual-review');
    assert.ok(evidence.has(`pr-7/${headSha}/madrid.after.png`));
    assert.match(github.comments[0].body, /raw\/\w{40}\/pr-7\/a+\/madrid\.after\.png/);

    await runReport(env);
    assert.equal(github.comments.length, 1, 'a rerun updates the same comment');

    await runApprove(env);
    assert.equal(lastStatus().state, 'success');
    assert.match(lastStatus().description, /Approved by maintainer/);
    assert.deepEqual(github.reactions, [{comment: 55, content: '+1'}]);

    await runPromote(env);
    const main = github.files('main');
    assert.deepEqual(main.get('test/visual-baselines/madrid.png'), png());
    assert.ok(main.has('test/visual-baselines/madrid.receipt.json'));
    const remaining = [...github.files('tileflow-visual-review').keys()];
    assert.deepEqual(remaining, [], 'closing clears the evidence for this pull request');
  });

  it('ignores a forged bot comment when updating its report', async () => {
    github.comments.push({
      id: 500,
      issue: 7,
      body: `${commentMarker} forged`,
      user: {login: 'mallory'},
    });
    await writeArtifact(directory, report());
    await runReport(env);
    assert.equal(github.comments.length, 2);
    assert.match(github.comments[0].body, /forged/);
  });

  it('reports an error status when the evidence is rejected or missing', async () => {
    await runReport(env);
    assert.equal(lastStatus().state, 'error');
    assert.equal(github.comments.length, 0);
    await writeArtifact(directory, report({headSha: 'd'.repeat(40)}));
    await runReport(env);
    assert.match(lastStatus().description, /another commit/);
  });

  it('skips stale evidence once the pull request has moved on', async () => {
    github.pulls.get(7).head.sha = 'e'.repeat(40);
    await writeArtifact(directory, report());
    await runReport(env);
    assert.equal(github.comments.length, 0);
    assert.equal(github.statuses.length, 0);
  });

  it('ignores a capture run that is not from a pull request', async () => {
    await writeArtifact(directory, report());
    await runReport({...env, TILEFLOW_REVIEW_RUN_EVENT: 'push'});
    assert.equal(github.statuses.length, 0);
  });

  it('fails hand-edited baselines using the trusted file list, and blocks approval', async () => {
    github.pullFiles.set(7, [{filename: 'test/visual-baselines/madrid.png'}]);
    await writeArtifact(directory, report({scenes: [scene({status: 'unchanged', images: {}})]}));
    await runReport(env);
    assert.equal(lastStatus().state, 'failure');
    await runApprove(env);
    assert.equal(process.exitCode, 1);
    assert.equal(github.reactions.at(-1).content, '-1');
  });

  it('flags workflow edits in the report', async () => {
    github.pullFiles.set(7, [{filename: '.github/workflows/tileflow-visual-review.yml'}]);
    await writeArtifact(directory, report());
    await runReport(env);
    assert.match(github.comments[0].body, /edits workflow files/);
  });

  it('refuses an approval from someone without write access', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    github.permissions.maintainer = 'read';
    await runApprove(env);
    assert.equal(process.exitCode, 1);
    assert.equal(lastStatus().state, 'failure');
    assert.equal(github.files('tileflow-visual-review').has('approvals/pr-7.json'), false);
  });

  it('refuses an approval for a commit that is no longer the head', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    github.pulls.get(7).head.sha = 'f'.repeat(40);
    await runApprove(env);
    assert.equal(process.exitCode, 1);
    assert.equal(lastStatus().state, 'failure');
  });

  it('leaves baselines alone when an unapproved pull request merges', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    await runPromote(env);
    assert.equal(github.files('main').has('test/visual-baselines/madrid.png'), false);
  });

  it('does not promote when the pull request closes unmerged', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    await runApprove(env);
    await runPromote({...env, TILEFLOW_REVIEW_MERGED: 'false'});
    assert.equal(github.files('main').has('test/visual-baselines/madrid.png'), false);
    assert.deepEqual([...github.files('tileflow-visual-review').keys()], []);
  });

  it('does not promote when different commits merged than were approved', async () => {
    await writeArtifact(directory, report());
    await runReport(env);
    await runApprove(env);
    github.pulls.get(7).head.sha = 'f'.repeat(40);
    await runPromote(env);
    assert.equal(github.files('main').has('test/visual-baselines/madrid.png'), false);
    assert.match(github.comments.at(-1).body, /were not updated/);
  });

  it('proposes baselines as a pull request on a protected branch', async () => {
    github.protectedBranches.add('main');
    await writeArtifact(directory, report());
    await runReport(env);
    await runApprove(env);
    await runPromote(env);
    assert.equal(github.files('main').has('test/visual-baselines/madrid.png'), false);
    const proposal = github.files('tileflow-visual-review-baselines/pr-7');
    assert.ok(proposal.has('test/visual-baselines/madrid.png'));
    assert.equal(lastStatus().state, 'success');
    assert.match(github.comments.at(-1).body, /protected/);
  });

  it('keeps pull requests and commit statuses untouched in a dry run', async () => {
    const summary = join(directory, 'summary.md');
    await writeArtifact(directory, report());
    await runReport({
      ...env,
      GITHUB_STEP_SUMMARY: summary,
      TILEFLOW_REVIEW_DRY_RUN: 'true',
      TILEFLOW_REVIEW_RUN_EVENT: '',
    });
    assert.equal(github.comments.length, 0);
    assert.equal(github.statuses.length, 0);
    assert.match(await readFile(summary, 'utf8'), /Tileflow visual review/);
  });
});
