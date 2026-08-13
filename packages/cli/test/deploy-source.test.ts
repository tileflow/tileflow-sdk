import assert from 'node:assert/strict';
import test from 'node:test';
import {allowsStoredDeployCredential, resolveDeploySource} from '../src/deploy-source';

test('local deploys contain only the CLI source kind', () => {
  assert.deepEqual(resolveDeploySource({}), {kind: 'cli'});
  assert.deepEqual(resolveDeploySource({TILEFLOW_DEPLOY_REPOSITORY: 'equipo/mapa-🗺️'}), {
    kind: 'cli',
    repository: 'equipo/mapa-🗺️',
  });
});

test('GitHub Actions provenance uses bounded provider fields and constructs the run URL', () => {
  assert.deepEqual(
    resolveDeploySource({
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/heads/fallback',
      GITHUB_REF_NAME: 'main',
      GITHUB_REPOSITORY: 'tileflow/maps',
      GITHUB_RUN_ID: '42',
      GITHUB_SERVER_URL: 'https://github.example.test',
      GITHUB_SHA: '0123456789abcdef',
    }),
    {
      kind: 'github_actions',
      ref: 'main',
      repository: 'tileflow/maps',
      revision: '0123456789abcdef',
      runId: '42',
      runUrl: 'https://github.example.test/tileflow/maps/actions/runs/42',
    },
  );
});

test('GitHub Actions falls back to GITHUB_REF and tolerates partial environments', () => {
  assert.deepEqual(
    resolveDeploySource({
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/pull/7/merge',
      GITHUB_REPOSITORY: '',
      GITHUB_RUN_ID: '7',
      GITHUB_SERVER_URL: 'file:///tmp/github',
    }),
    {
      kind: 'github_actions',
      ref: 'refs/pull/7/merge',
      runId: '7',
    },
  );
});

test('GitLab CI provenance uses the pipeline URL supplied by GitLab', () => {
  assert.deepEqual(
    resolveDeploySource({
      CI_COMMIT_REF_NAME: 'release',
      CI_COMMIT_SHA: 'abc123',
      CI_PIPELINE_ID: '91',
      CI_PIPELINE_URL: 'https://gitlab.example.test/group/maps/-/pipelines/91',
      CI_PROJECT_PATH: 'group/maps',
      GITLAB_CI: 'true',
    }),
    {
      kind: 'gitlab_ci',
      ref: 'release',
      repository: 'group/maps',
      revision: 'abc123',
      runId: '91',
      runUrl: 'https://gitlab.example.test/group/maps/-/pipelines/91',
    },
  );
});

test('generic CI is detected without reading the real process environment', () => {
  assert.deepEqual(resolveDeploySource({CI: '1'}), {kind: 'generic_ci'});
});

test('only an interactive local deploy may reuse a credential saved by tileflow login', () => {
  assert.equal(allowsStoredDeployCredential({kind: 'cli'}), true);
  assert.equal(allowsStoredDeployCredential({kind: 'github_actions'}), false);
  assert.equal(allowsStoredDeployCredential({kind: 'gitlab_ci'}), false);
  assert.equal(allowsStoredDeployCredential({kind: 'generic_ci'}), false);
});

test('explicit Tileflow provenance overrides provider metadata', () => {
  assert.deepEqual(
    resolveDeploySource({
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'provider/repository',
      GITHUB_RUN_ID: '1',
      GITHUB_SERVER_URL: 'https://github.com',
      TILEFLOW_DEPLOY_REF: 'refs/heads/override',
      TILEFLOW_DEPLOY_REPOSITORY: 'override/repository',
      TILEFLOW_DEPLOY_REVISION: 'override-sha',
      TILEFLOW_DEPLOY_RUN_ID: '99',
      TILEFLOW_DEPLOY_RUN_URL: 'https://ci.example.test/runs/99',
    }),
    {
      kind: 'github_actions',
      ref: 'refs/heads/override',
      repository: 'override/repository',
      revision: 'override-sha',
      runId: '99',
      runUrl: 'https://ci.example.test/runs/99',
    },
  );
});

test('invalid explicit metadata names the offending variable', () => {
  const invalid = [
    ['TILEFLOW_DEPLOY_REPOSITORY', ''],
    ['TILEFLOW_DEPLOY_REPOSITORY', 'maps\u0000forged'],
    ['TILEFLOW_DEPLOY_REVISION', 'a'.repeat(129)],
    ['TILEFLOW_DEPLOY_REVISION', '\ud800'],
    ['TILEFLOW_DEPLOY_REF', 'r'.repeat(256)],
    ['TILEFLOW_DEPLOY_REF', 'main\nforged'],
    ['TILEFLOW_DEPLOY_REF', 'main\u202eforged'],
    ['TILEFLOW_DEPLOY_RUN_ID', '1'.repeat(129)],
    ['TILEFLOW_DEPLOY_RUN_ID', '\udc00'],
    ['TILEFLOW_DEPLOY_RUN_URL', 'https://user:secret@example.test/run/1'],
    ['TILEFLOW_DEPLOY_RUN_URL', `https://example.test/${'a'.repeat(2049)}`],
  ] as const;

  for (const [variable, value] of invalid) {
    assert.throws(
      () => resolveDeploySource({[variable]: value}),
      (error: unknown) => error instanceof Error && error.message.includes(variable),
    );
  }
});

test('malformed or oversized provider metadata is omitted', () => {
  assert.deepEqual(
    resolveDeploySource({
      CI_COMMIT_REF_NAME: 'r'.repeat(256),
      CI_COMMIT_SHA: 'a'.repeat(129),
      CI_PIPELINE_ID: 'run\u0000forged',
      CI_PIPELINE_URL: 'https://user@example.test/run/1',
      CI_PROJECT_PATH: '\ud800',
      GITLAB_CI: 'true',
    }),
    {kind: 'gitlab_ci'},
  );
});

test('GitHub run links are omitted when provider path segments are not canonical', () => {
  assert.deepEqual(
    resolveDeploySource({
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: '../maps',
      GITHUB_RUN_ID: '..',
      GITHUB_SERVER_URL: 'https://github.example.test',
    }),
    {
      kind: 'github_actions',
      repository: '../maps',
      runId: '..',
    },
  );
});
