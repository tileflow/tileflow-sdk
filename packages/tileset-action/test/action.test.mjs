import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runBuild} from '../src/build.mjs';
import {runPublish} from '../src/publish.mjs';
import {downloadSource, fileNameFromUrl} from '../src/source.mjs';
import {escapeCommandData} from '../src/workflow.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apiKey = 'tf_test_key_0123456789';

const fakeCli = String.raw`
import {appendFileSync} from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({args, apiKey: process.env.TILEFLOW_API_KEY ?? null}) + '\n');
const fail = (message) => {
  process.stderr.write(JSON.stringify({error: {code: 'TF_FAKE', message}, ok: false, schemaVersion: 1}) + '\n');
  process.exit(1);
};
if (process.env.FAKE_CLI_FAILURE === 'garbage') {
  process.stderr.write('crash with ' + process.env.TILEFLOW_API_KEY + '\n');
  process.exit(3);
}
if (process.env.FAKE_CLI_FAILURE) fail(process.env.FAKE_CLI_FAILURE);
if (args[1] === 'build') {
  console.log(JSON.stringify({
    archive: {byteCount: 2048, maxzoom: 10, minzoom: 0, path: 'ignored'},
    command: 'tileset build',
    input: {features: 12},
    warnings: process.env.FAKE_CLI_WARNING ? [process.env.FAKE_CLI_WARNING] : [],
  }));
} else {
  console.log(JSON.stringify({
    command: 'tileset publish',
    publication: process.env.FAKE_CLI_PUBLICATION ?? 'changed',
    team: null,
    tileset: {logicalId: 'stores', tilesetId: 'tls_x', version: {id: 'v_1', number: 7}},
  }));
}
`;

let root;
let project;
let cliLog;
let env;
let printed;
const log = (line) => printed.push(line);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tileflow-tileset-action-'));
  project = join(root, 'project');
  cliLog = join(root, 'cli.log');
  await installFakeCli(project);
  await writeFile(join(project, 'stores.geojson'), '{}');
  await writeFile(join(root, 'output'), '');
  await writeFile(join(root, 'summary'), '');
  await writeFile(cliLog, '');
  printed = [];
  env = {
    FAKE_CLI_LOG: cliLog,
    GITHUB_OUTPUT: join(root, 'output'),
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    PATH: process.env.PATH,
    RUNNER_TEMP: root,
    TILEFLOW_TILESET_HAS_API_KEY: 'true',
    TILEFLOW_TILESET_ID: 'stores',
    TILEFLOW_TILESET_PUBLISH: 'true',
    TILEFLOW_TILESET_REPROJECT: 'false',
    TILEFLOW_TILESET_SOURCE: 'stores.geojson',
  };
});

afterEach(async () => {
  await rm(root, {force: true, recursive: true});
});

async function installFakeCli(directory) {
  const packageDirectory = join(directory, 'node_modules', 'tileflow');
  await mkdir(packageDirectory, {recursive: true});
  await writeFile(
    join(packageDirectory, 'package.json'),
    JSON.stringify({name: 'tileflow', bin: {tileflow: './cli.mjs'}}),
  );
  await writeFile(join(packageDirectory, 'cli.mjs'), fakeCli);
}

async function cliCalls() {
  return (await readFile(cliLog, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function outputs() {
  const raw = await readFile(env.GITHUB_OUTPUT, 'utf8');
  const values = {};
  for (const match of raw.matchAll(/^([a-z-]+)<<(tileflow_[0-9a-f-]+)\n([\s\S]*?)\n\2$/gmu)) {
    values[match[1]] = match[3];
  }
  return values;
}

function build(overrides = {}, dependencies = {}) {
  return runBuild(
    {...env, ...overrides},
    {cwd: project, log, retryDelays: [0, 0], ...dependencies},
  );
}

async function publishAfterBuild(overrides = {}) {
  await build();
  const {cli, path} = await outputs();
  return runPublish(
    {
      ...env,
      TILEFLOW_API_KEY: apiKey,
      TILEFLOW_TILESET_ARCHIVE: path,
      TILEFLOW_TILESET_CLI: cli,
      ...overrides,
    },
    {cwd: project, log},
  );
}

function response(body, init = {}) {
  return new Response(body, {status: 200, ...init});
}

function fakeFetch(...answers) {
  const requests = [];
  const implementation = async (url, options) => {
    requests.push({options, url: String(url)});
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer();
  };
  return Object.assign(implementation, {requests});
}

describe('build', () => {
  it('passes the build options as single arguments and reports the archive path', async () => {
    await build({
      TILEFLOW_TILESET_ATTRIBUTION: 'Data © Example',
      TILEFLOW_TILESET_INCLUDE: 'name,kind',
      TILEFLOW_TILESET_INPUT_LAYER: 'stores_2026',
      TILEFLOW_TILESET_ZIP_ENTRY: 'data/stores.shp',
      TILEFLOW_TILESET_LAYER: '-stores',
      TILEFLOW_TILESET_MAXZOOM: '12',
      TILEFLOW_TILESET_RANK_BY: 'population',
      TILEFLOW_TILESET_REPROJECT: 'true',
      TILEFLOW_TILESET_SOURCE_CRS: 'EPSG:25830',
    });

    const [call] = await cliCalls();
    const {cli, path} = await outputs();
    assert.deepEqual(call.args.slice(0, 3), ['tileset', 'build', join(project, 'stores.geojson')]);
    assert.ok(path.startsWith(root) && !path.startsWith(project), path);
    assert.equal(basename(path), 'stores.pmtiles');
    assert.equal(cli, join(project, 'node_modules', 'tileflow', 'cli.mjs'));
    for (const argument of [
      `--output=${path}`,
      '--json',
      '--source-crs=EPSG:25830',
      '--reproject',
      '--maxzoom=12',
      '--rank-by=population',
      '--include=name,kind',
      '--input-layer=stores_2026',
      '--zip-entry=data/stores.shp',
      '--layer=-stores',
      '--attribution=Data © Example',
    ]) {
      assert.ok(call.args.includes(argument), argument);
    }
    assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /12 features/u);
  });

  it('omits options that were left empty', async () => {
    await build({TILEFLOW_TILESET_LAYER: '', TILEFLOW_TILESET_MAXZOOM: ''});
    const [call] = await cliCalls();
    assert.equal(call.args.filter((argument) => argument.startsWith('--')).length, 2);
  });

  it('never gives the build the API key, even if the job exports it', async () => {
    await build({TILEFLOW_API_KEY: apiKey});
    const [call] = await cliCalls();
    assert.equal(call.apiKey, null);
  });

  it('builds without an ID or key when publish is false', async () => {
    await build({
      TILEFLOW_TILESET_HAS_API_KEY: 'false',
      TILEFLOW_TILESET_ID: '',
      TILEFLOW_TILESET_PUBLISH: 'false',
    });
    assert.equal((await cliCalls()).length, 1);
    assert.ok((await outputs()).path);
  });

  it('fails before building when publishing has no ID or key', async () => {
    await assert.rejects(build({TILEFLOW_TILESET_ID: ''}), /tileset-id is required/u);
    await assert.rejects(build({TILEFLOW_TILESET_HAS_API_KEY: 'false'}), /api-key is required/u);
    assert.deepEqual(await cliCalls(), []);
  });

  it('refuses a misspelled boolean instead of guessing', async () => {
    await assert.rejects(build({TILEFLOW_TILESET_PUBLISH: 'no'}), /publish must be true or false/u);
    await assert.rejects(
      build({TILEFLOW_TILESET_REPROJECT: 'yes'}),
      /reproject must be true or false/u,
    );
    assert.deepEqual(await cliCalls(), []);
  });

  it('refuses to publish from a pull request but still builds one', async () => {
    for (const event of ['pull_request', 'pull_request_target']) {
      await assert.rejects(build({GITHUB_EVENT_NAME: event}), /unreviewed data/u);
    }
    assert.deepEqual(await cliCalls(), []);
    await build({GITHUB_EVENT_NAME: 'pull_request', TILEFLOW_TILESET_PUBLISH: 'false'});
    assert.equal((await cliCalls()).length, 1);
  });

  it('reports the structured CLI error', async () => {
    await assert.rejects(
      build({FAKE_CLI_FAILURE: 'The input does not state its CRS.'}),
      /The input does not state its CRS\. \(TF_FAKE\)/u,
    );
    assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), '');
  });

  it('keeps warnings from data from issuing workflow commands', async () => {
    await build({FAKE_CLI_WARNING: 'field renamed\n::add-mask::x 100%'});
    const line = printed.find((entry) => entry.startsWith('::warning::'));
    assert.equal(line, '::warning::field renamed%0A::add-mask::x 100%25');
  });
});

describe('CLI selection', () => {
  async function installFakeNpm() {
    const bin = join(root, 'bin');
    await mkdir(bin);
    const source = join(root, 'package-source');
    await installFakeCli(source);
    await writeFile(
      join(bin, 'npm'),
      `#!/bin/sh\necho "$@" > "${join(root, 'npm.log')}"\ncp -R "${join(source, 'node_modules')}" .\n`,
    );
    await chmod(join(bin, 'npm'), 0o755);
    return `${bin}:${process.env.PATH}`;
  }

  it('installs the exact version requested, ahead of a project install', async () => {
    const path = await installFakeNpm();
    await build({PATH: path, TILEFLOW_TILESET_CLI_VERSION: '1.2.3-alpha.4'});
    assert.match(await readFile(join(root, 'npm.log'), 'utf8'), /tileflow@1\.2\.3-alpha\.4/u);
    const {cli} = await outputs();
    assert.ok(cli.startsWith(root) && !cli.startsWith(project), cli);
  });

  for (const version of ['latest', 'alpha', '^1.2.3', '1.2', '1.2.3; touch x']) {
    it(`refuses the floating or malformed version ${version}`, async () => {
      await assert.rejects(
        build({TILEFLOW_TILESET_CLI_VERSION: version}),
        /must be an exact version/u,
      );
    });
  }

  it('explains what to do when no CLI is available', async () => {
    await rm(join(project, 'node_modules'), {force: true, recursive: true});
    await assert.rejects(build(), /Set tileflow-version/u);
  });
});

describe('URL sources', () => {
  const url = 'https://data.example.com/exports/stores.geojson?signature=TOP-SECRET';

  it('downloads the file and builds under its stable name', async () => {
    const fetch = fakeFetch(() => response('{"type":"FeatureCollection"}'));
    await build({TILEFLOW_TILESET_SOURCE: url}, {fetch});
    const [call] = await cliCalls();
    assert.equal(basename(call.args[2]), 'stores.geojson');
    assert.equal(fetch.requests[0].url, url);
    assert.equal(basename((await outputs()).path), 'stores.pmtiles');
    assert.equal(await readFile(call.args[2], 'utf8'), '{"type":"FeatureCollection"}');
  });

  it('never prints the query string, on success or on failure', async () => {
    await build({TILEFLOW_TILESET_SOURCE: url}, {fetch: fakeFetch(() => response('data'))});
    assert.ok(!printed.join('\n').includes('TOP-SECRET'));
    await assert.rejects(
      build({TILEFLOW_TILESET_SOURCE: url}, {fetch: fakeFetch(() => response('', {status: 403}))}),
      (error) => {
        assert.match(error.message, /403/u);
        assert.ok(!error.message.includes('TOP-SECRET'));
        return true;
      },
    );
  });

  it('retries temporary failures and then succeeds', async () => {
    const fetch = fakeFetch(
      () => response('', {status: 503}),
      new TypeError('fetch failed'),
      () => response('data'),
    );
    await build({TILEFLOW_TILESET_SOURCE: url}, {fetch});
    assert.equal(fetch.requests.length, 3);
  });

  it('gives up after the retries are used', async () => {
    const fetch = fakeFetch(
      () => response('', {status: 503}),
      () => response('', {status: 503}),
      () => response('', {status: 503}),
    );
    await assert.rejects(build({TILEFLOW_TILESET_SOURCE: url}, {fetch}), /answered 503/u);
    assert.equal(fetch.requests.length, 3);
    assert.deepEqual(await cliCalls(), []);
  });

  it('does not retry a request the server refused', async () => {
    const fetch = fakeFetch(() => response('', {status: 404}));
    await assert.rejects(build({TILEFLOW_TILESET_SOURCE: url}, {fetch}), /answered 404/u);
    assert.equal(fetch.requests.length, 1);
  });

  it('follows https redirects without changing the file name', async () => {
    const fetch = fakeFetch(
      () =>
        response(null, {status: 302, headers: {location: 'https://cdn.example.com/a1b2c3?x=1'}}),
      () => response('data'),
    );
    await build({TILEFLOW_TILESET_SOURCE: url}, {fetch});
    assert.equal(fetch.requests[0].options.redirect, 'manual');
    assert.equal(fetch.requests[1].url, 'https://cdn.example.com/a1b2c3?x=1');
    assert.equal(basename((await cliCalls())[0].args[2]), 'stores.geojson');
  });

  it('refuses a redirect that leaves https', async () => {
    const fetch = fakeFetch(() =>
      response(null, {status: 302, headers: {location: 'http://data.example.com/stores.geojson'}}),
    );
    await assert.rejects(build({TILEFLOW_TILESET_SOURCE: url}, {fetch}), /not https/u);
    assert.equal(fetch.requests.length, 1);
  });

  it('retries a truncated download', async () => {
    const fetch = fakeFetch(
      () => response('dat', {headers: {'content-length': '10'}}),
      () => response('0123456789', {headers: {'content-length': '10'}}),
    );
    await build({TILEFLOW_TILESET_SOURCE: url}, {fetch});
    assert.equal(fetch.requests.length, 2);
  });

  it('refuses an empty download', async () => {
    const fetch = fakeFetch(() => response(''));
    await assert.rejects(build({TILEFLOW_TILESET_SOURCE: url}, {fetch}), /empty/u);
  });

  for (const source of ['http://example.com/a.csv', 's3://bucket/a.csv', 'ftp://example.com/a']) {
    it(`refuses ${source}`, async () => {
      await assert.rejects(build({TILEFLOW_TILESET_SOURCE: source}), /Download the file/u);
    });
  }

  it('refuses a URL with embedded credentials and never repeats them', async () => {
    await assert.rejects(
      build({TILEFLOW_TILESET_SOURCE: 'https://user:hunter2@example.com/a.csv'}),
      (error) => {
        assert.match(error.message, /user name or password/u);
        assert.ok(!error.message.includes('hunter2'));
        return true;
      },
    );
  });

  it('derives a safe file name from any URL path', () => {
    const name = (value) => fileNameFromUrl(new URL(value));
    assert.equal(name('https://x.dev/a/stores.csv?y=1'), 'stores.csv');
    assert.equal(name('https://x.dev/a%20b%C3%B1.csv'), 'a_b_.csv');
    assert.equal(name('https://x.dev/'), 'source');
    assert.equal(name('https://x.dev/..%2F..%2Fetc%2Fpasswd'), '_.._etc_passwd');
    assert.equal(name('https://x.dev/%E0%A4%A'), '_E0_A4_A');
  });

  it('writes the download inside its directory', async () => {
    const directory = join(root, 'download');
    await mkdir(directory);
    const path = await downloadSource(new URL('https://x.dev/..%2Fescape.csv'), directory, {
      fetch: fakeFetch(() => response('data')),
    });
    assert.equal(dirname(path), directory);
  });
});

describe('publish', () => {
  it('sends the key by environment only and sets the outputs', async () => {
    await publishAfterBuild({
      TILEFLOW_TILESET_ATTRIBUTION: 'Data © Example',
      TILEFLOW_TILESET_NAME: 'Stores',
    });
    const publishCall = (await cliCalls())[1];
    const {path, id, version, publication} = await outputs();
    assert.deepEqual(publishCall.args.slice(0, 3), ['tileset', 'publish', path]);
    assert.equal(publishCall.apiKey, apiKey);
    assert.ok(!publishCall.args.join(' ').includes(apiKey));
    assert.ok(!publishCall.args.some((argument) => argument.startsWith('--api-key')));
    assert.ok(publishCall.args.includes('--id=stores'));
    assert.ok(publishCall.args.includes('--name=Stores'));
    assert.ok(publishCall.args.includes('--attribution=Data © Example'));
    assert.deepEqual(
      {id, publication, version},
      {id: 'stores', publication: 'changed', version: '7'},
    );
  });

  it('never forwards the Team, which the CLI refuses alongside a key', async () => {
    await publishAfterBuild({TILEFLOW_TILESET_TEAM: '@acme'});
    const publishCall = (await cliCalls())[1];
    assert.ok(!publishCall.args.some((argument) => argument.startsWith('--team')));
    assert.ok(printed.some((line) => line.startsWith('::notice::') && line.includes('@acme')));
  });

  it('reports an unchanged publication', async () => {
    await publishAfterBuild({FAKE_CLI_PUBLICATION: 'unchanged'});
    assert.equal((await outputs()).publication, 'unchanged');
    assert.ok(printed.includes('Unchanged stores at version 7.'));
  });

  it('masks the key first and removes it from errors', async () => {
    await assert.rejects(publishAfterBuild({FAKE_CLI_FAILURE: 'garbage'}), (error) => {
      assert.match(error.message, /crash with \*\*\*/u);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
    assert.equal(printed.filter((line) => line.includes(apiKey)).length, 1);
    assert.equal(
      printed.find((line) => line.includes(apiKey)),
      `::add-mask::${apiKey}`,
    );
  });

  it('removes the key from a structured error', async () => {
    await assert.rejects(
      publishAfterBuild({FAKE_CLI_FAILURE: `Key ${apiKey} was rejected.`}),
      (error) => !error.message.includes(apiKey) && /Key \*\*\* was rejected/u.test(error.message),
    );
  });

  it('requires a key even if the build step was told one exists', async () => {
    await assert.rejects(runPublish({...env, TILEFLOW_API_KEY: ''}), /api-key is required/u);
  });
});

describe('entry point', () => {
  function runMain(stage, overrides) {
    return spawnSync(process.execPath, [join(packageRoot, 'src', 'main.mjs'), stage], {
      cwd: project,
      encoding: 'utf8',
      env: {...env, ...overrides},
    });
  }

  it('turns a failure into one escaped error annotation and exit code 1', () => {
    const result = runMain('build', {TILEFLOW_TILESET_ID: '', TILEFLOW_TILESET_SOURCE: ''});
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '::error::tileset-id is required.\n');
  });

  it('keeps the key out of everything except the mask command', async () => {
    await build();
    const {cli, path} = await outputs();
    const result = runMain('publish', {
      FAKE_CLI_FAILURE: 'garbage',
      TILEFLOW_API_KEY: apiKey,
      TILEFLOW_TILESET_ARCHIVE: path,
      TILEFLOW_TILESET_CLI: cli,
    });
    assert.equal(result.status, 1);
    const lines = result.stdout.split('\n').filter((line) => line.includes(apiKey));
    assert.deepEqual(lines, [`::add-mask::${apiKey}`]);
    assert.ok(!result.stderr.includes(apiKey));
  });

  it('refuses an unknown stage', () => {
    assert.equal(runMain('deploy', {}).status, 1);
  });

  it('exits cleanly after a successful build', () => {
    const result = runMain('build', {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

describe('workflow commands', () => {
  it('escapes percent signs and line breaks', () => {
    assert.equal(escapeCommandData('100%\r\nnext'), '100%25%0D%0Anext');
  });
});

describe('action.yml', () => {
  async function steps() {
    const manifest = await readFile(join(packageRoot, 'action.yml'), 'utf8');
    return manifest
      .split('\n    - name: ')
      .slice(1)
      .map((text) => ({name: text.split('\n')[0], text}));
  }

  it('gives the key to the publish step alone', async () => {
    const all = await steps();
    const holding = all.filter(({text}) => text.includes('TILEFLOW_API_KEY:'));
    assert.deepEqual(
      holding.map(({name}) => name),
      ['Publish tileset'],
    );
    const build = all.find(({name}) => name === 'Build tileset');
    assert.ok(!build.text.includes('inputs.api-key }}'));
  });

  it('never expands an input inside a shell command', async () => {
    for (const {text} of await steps()) {
      for (const line of text.split('\n').filter((entry) => entry.trim().startsWith('run:'))) {
        assert.ok(!line.includes('${{'), line);
      }
    }
  });

  it('pins every action to a full commit', async () => {
    const uses = (await steps()).flatMap(({text}) => text.match(/uses: \S+/gu) ?? []);
    assert.ok(uses.length > 0);
    for (const entry of uses) assert.match(entry, /@[0-9a-f]{40}$/u);
  });
});
