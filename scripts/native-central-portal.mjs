import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {basename, isAbsolute, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {primaryFileNames} from './native-maven-bundle.mjs';
import {mavenArtifactDirectory, readNativeReleaseCatalog} from './native-release-config.mjs';

// Central Publisher Portal API client (https://central.sonatype.org/publish/publish-portal-api/).
// Uploads stop at VALIDATED (USER_MANAGED); the release workflow publishes a validated deployment
// only after the Swift distribution tag exists, so neither side becomes public after a failed check.

export const portalUrl = 'https://central.sonatype.com';
export const repositoryUrl = 'https://repo1.maven.org/maven2';

export class CentralPortalError extends Error {}

export function centralPortal({username, password, fetch: request = fetch, baseUrl = portalUrl}) {
  if (!username || !password) {
    throw new CentralPortalError(
      'MAVEN_CENTRAL_TOKEN_USERNAME and MAVEN_CENTRAL_TOKEN_PASSWORD must hold a Central Portal user token.',
    );
  }
  const authorization = `Bearer ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  async function call(method, path, {body, expected = [200]} = {}) {
    const response = await request(`${baseUrl}${path}`, {
      method,
      headers: {authorization},
      body,
    });
    const text = await response.text();
    if (!expected.includes(response.status)) {
      throw new CentralPortalError(
        `Central Portal ${method} ${path.split('?')[0]} answered ${response.status}: ${text.slice(0, 2000)}`,
      );
    }
    return text;
  }
  return {
    async published(namespace, name, version) {
      const query = new URLSearchParams({namespace, name, version});
      const answer = JSON.parse(await call('GET', `/api/v1/publisher/published?${query}`));
      if (typeof answer.published !== 'boolean') {
        throw new CentralPortalError('Central Portal returned an unexpected published state.');
      }
      return answer.published;
    },
    async upload(bundlePath, deploymentName) {
      const form = new FormData();
      form.append('bundle', await openAsBlob(bundlePath), basename(bundlePath));
      const query = new URLSearchParams({name: deploymentName, publishingType: 'USER_MANAGED'});
      const id = (
        await call('POST', `/api/v1/publisher/upload?${query}`, {body: form, expected: [200, 201]})
      ).trim();
      if (!/^[0-9a-f-]{36}$/u.test(id)) {
        throw new CentralPortalError(`Central Portal returned an unexpected deployment id: ${id}`);
      }
      return id;
    },
    async status(id) {
      const query = new URLSearchParams({id});
      return JSON.parse(await call('POST', `/api/v1/publisher/status?${query}`));
    },
    async publish(id) {
      await call('POST', `/api/v1/publisher/deployment/${encodeURIComponent(id)}`, {
        expected: [200, 204],
      });
    },
    async drop(id) {
      await call('DELETE', `/api/v1/publisher/deployment/${encodeURIComponent(id)}`, {
        expected: [200, 204],
      });
    },
  };
}

/** Polls a deployment until it reaches `target`; FAILED or a timeout stops with Portal's errors. */
export async function waitForDeployment(portal, id, target, {timeoutMs, intervalMs = 10_000, log}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() <= deadline) {
    const status = await portal.status(id);
    if (status.deploymentState !== last) log?.(`Deployment ${id}: ${status.deploymentState}`);
    last = status.deploymentState;
    if (status.deploymentState === target) return status;
    if (status.deploymentState === 'FAILED') {
      throw new CentralPortalError(
        `Central Portal rejected deployment ${id}:\n${JSON.stringify(status.errors ?? {}, null, 2)}`,
      );
    }
    if (target === 'VALIDATED' && ['PUBLISHING', 'PUBLISHED'].includes(status.deploymentState)) {
      throw new CentralPortalError(`Deployment ${id} is publishing without approval.`);
    }
    await delay(intervalMs);
  }
  throw new CentralPortalError(
    `Deployment ${id} did not reach ${target} in ${Math.round(timeoutMs / 60_000)} minutes (last state ${last}). Check https://central.sonatype.com/publishing/deployments; rerunning the failed job is safe.`,
  );
}

/**
 * Every artifact of a release is either new or already published. A mixture means a previous
 * publication was interrupted in a way this workflow never produces, so it stops for a person.
 */
export async function centralReleaseState(portal, catalog, version) {
  const states = {};
  for (const {artifactId} of catalog.maven.publications) {
    states[artifactId] = await portal.published(catalog.maven.group, artifactId, version);
  }
  const values = Object.values(states);
  if (values.every(Boolean)) return 'published';
  if (!values.some(Boolean)) return 'new';
  throw new CentralPortalError(
    `Maven Central has only part of ${version}: ${JSON.stringify(states)}. Investigate before retrying.`,
  );
}

/** Downloads every released file from Maven Central and compares it with the approved bytes. */
export async function verifyCentralFiles({
  catalog,
  version,
  repository,
  fetch: request = fetch,
  baseUrl = repositoryUrl,
  timeoutMs,
  intervalMs = 30_000,
  log,
}) {
  const pending = new Map();
  for (const {artifactId} of catalog.maven.publications) {
    for (const name of primaryFileNames(artifactId, version)) {
      const path = `${mavenArtifactDirectory(catalog, artifactId)}/${version}/${name}`;
      pending.set(
        path,
        createHash('sha256')
          .update(await readFile(join(repository, path)))
          .digest('hex'),
      );
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    for (const [path, expected] of pending) {
      const response = await request(`${baseUrl}/${path}`);
      if (response.status === 404) continue;
      if (!response.ok)
        throw new CentralPortalError(`${baseUrl}/${path} answered ${response.status}.`);
      const actual = createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex');
      if (actual !== expected)
        throw new CentralPortalError(`Maven Central serves different bytes for ${path}.`);
      pending.delete(path);
    }
    if (pending.size === 0) break;
    if (Date.now() > deadline) {
      throw new CentralPortalError(
        `${pending.size} file(s) are not yet on Maven Central, for example ${[...pending.keys()][0]}. Publication can take longer than the wait; rerun the verification job later.`,
      );
    }
    log?.(`Waiting for ${pending.size} file(s) to reach Maven Central.`);
    await delay(intervalMs);
  }
}

function option(args, key) {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const catalog = await readNativeReleaseCatalog();
  const version = option(args, '--version');
  if (!version) throw new Error('--version is required.');
  const portal = () =>
    centralPortal({
      username: process.env.MAVEN_CENTRAL_TOKEN_USERNAME,
      password: process.env.MAVEN_CENTRAL_TOKEN_PASSWORD,
    });
  const log = (message) => console.log(message);
  if (command === 'state') {
    console.log(await centralReleaseState(portal(), catalog, version));
  } else if (command === 'upload') {
    const bundle = option(args, '--bundle');
    if (!bundle || !isAbsolute(bundle)) throw new Error('--bundle must be an absolute path.');
    const client = portal();
    const id = await client.upload(bundle, `tileflow-native-${version}`);
    log(`Uploaded ${basename(bundle)} as deployment ${id}.`);
    await waitForDeployment(client, id, 'VALIDATED', {timeoutMs: 30 * 60_000, log});
    console.log(`deployment=${id}`);
  } else if (command === 'publish') {
    const id = option(args, '--deployment');
    if (!id) throw new Error('--deployment is required.');
    const client = portal();
    await client.publish(id);
    await waitForDeployment(client, id, 'PUBLISHED', {timeoutMs: 60 * 60_000, log});
  } else if (command === 'drop') {
    const id = option(args, '--deployment');
    if (!id) throw new Error('--deployment is required.');
    await portal().drop(id);
    log(`Dropped deployment ${id}.`);
  } else if (command === 'verify') {
    const repository = option(args, '--repository');
    if (!repository || !isAbsolute(repository)) throw new Error('--repository must be absolute.');
    await verifyCentralFiles({catalog, version, repository, timeoutMs: 45 * 60_000, log});
    log(`Maven Central serves the approved bytes for every ${version} artifact.`);
  } else {
    throw new Error(
      'Usage: native-central-portal.mjs state|upload|publish|drop|verify --version V',
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
