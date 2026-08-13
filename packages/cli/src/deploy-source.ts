export type DeploySourceKind = 'cli' | 'github_actions' | 'gitlab_ci' | 'generic_ci';

export type DeploySource = {
  kind: DeploySourceKind;
  repository?: string;
  revision?: string;
  ref?: string;
  runId?: string;
  runUrl?: string;
};

type DeployEnvironment = Readonly<Record<string, string | undefined>>;
type OptionalDeploySource = Omit<DeploySource, 'kind'>;

const overrideFields = [
  ['TILEFLOW_DEPLOY_REPOSITORY', 'repository', 255],
  ['TILEFLOW_DEPLOY_REVISION', 'revision', 128],
  ['TILEFLOW_DEPLOY_REF', 'ref', 255],
  ['TILEFLOW_DEPLOY_RUN_ID', 'runId', 128],
] as const;

export function allowsStoredDeployCredential(source: DeploySource) {
  return source.kind === 'cli';
}

export function resolveDeploySource(env: DeployEnvironment): DeploySource {
  const source = providerSource(env);

  for (const [variable, field, maximum] of overrideFields) {
    const value = explicitText(env, variable, maximum);

    if (value !== undefined) {
      source[field] = value;
    }
  }

  const runUrl = explicitUrl(env, 'TILEFLOW_DEPLOY_RUN_URL');

  if (runUrl !== undefined) {
    source.runUrl = runUrl;
  }

  return source;
}

function providerSource(env: DeployEnvironment): DeploySource {
  if (env.GITHUB_ACTIONS === 'true') {
    const repository = providerText(env.GITHUB_REPOSITORY, 255);
    const revision = providerText(env.GITHUB_SHA, 128);
    const ref = providerText(env.GITHUB_REF_NAME, 255) ?? providerText(env.GITHUB_REF, 255);
    const runId = providerText(env.GITHUB_RUN_ID, 128);
    const serverUrl = providerUrl(env.GITHUB_SERVER_URL);
    const runUrl =
      serverUrl && repository && runId ? githubRunUrl(serverUrl, repository, runId) : undefined;

    return compactSource({
      kind: 'github_actions',
      ref,
      repository,
      revision,
      runId,
      runUrl,
    });
  }

  if (env.GITLAB_CI === 'true') {
    return compactSource({
      kind: 'gitlab_ci',
      ref: providerText(env.CI_COMMIT_REF_NAME, 255),
      repository: providerText(env.CI_PROJECT_PATH, 255),
      revision: providerText(env.CI_COMMIT_SHA, 128),
      runId: providerText(env.CI_PIPELINE_ID, 128),
      runUrl: providerUrl(env.CI_PIPELINE_URL),
    });
  }

  return {kind: env.CI ? 'generic_ci' : 'cli'};
}

function compactSource(source: DeploySource): DeploySource {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ) as DeploySource;
}

function explicitText(env: DeployEnvironment, variable: string, maximum: number) {
  const raw = env[variable];

  if (raw === undefined) {
    return undefined;
  }

  const value = raw.trim();

  // Tileflow overrides are an explicit user contract, so a typo must fail the
  // deploy. Provider fields are best-effort metadata and are omitted instead.
  if (!value || value.length > maximum || !isSafeDeploySourceText(value)) {
    throw new Error(`Invalid ${variable}: expected 1-${maximum} characters.`);
  }

  return value;
}

function explicitUrl(env: DeployEnvironment, variable: string) {
  const raw = env[variable];

  if (raw === undefined) {
    return undefined;
  }

  const value = safeHttpUrl(raw);

  if (!value) {
    throw new Error(
      `Invalid ${variable}: expected an absolute HTTP or HTTPS URL without credentials (maximum 2048 characters).`,
    );
  }

  return value;
}

function providerText(raw: string | undefined, maximum: number) {
  if (raw === undefined) {
    return undefined;
  }

  const value = raw.trim();
  return value && value.length <= maximum && isSafeDeploySourceText(value) ? value : undefined;
}

function providerUrl(raw: string | undefined) {
  return raw === undefined ? undefined : safeHttpUrl(raw);
}

function safeHttpUrl(raw: string) {
  const value = raw.trim();

  if (!value || value.length > 2048 || !isSafeDeploySourceText(value)) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }

    return value;
  } catch {
    return undefined;
  }
}

function githubRunUrl(serverUrl: string, repository: string, runId: string) {
  const repositorySegments = repository.split('/');

  if (
    repositorySegments.length !== 2 ||
    repositorySegments.some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^\d+$/.test(runId)
  ) {
    return undefined;
  }

  const url = new URL(serverUrl);
  const prefix = url.pathname.replace(/\/$/, '');
  const repositoryPath = repositorySegments.map(encodeURIComponent).join('/');
  url.pathname = `${prefix}/${repositoryPath}/actions/runs/${encodeURIComponent(runId)}`;
  url.search = '';
  url.hash = '';

  return safeHttpUrl(url.toString());
}

function isSafeDeploySourceText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return false;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }

      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}
