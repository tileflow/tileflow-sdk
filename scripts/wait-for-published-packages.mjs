import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export const registryPropagationAttempts = 61;
export const registryPropagationIntervalMs = 10_000;

export async function waitForPublishedPackages(
  targets,
  {
    attempts = registryPropagationAttempts,
    intervalMs = registryPropagationIntervalMs,
    onRetry = defaultRetryNotice,
    readTag,
    sleep = defaultSleep,
  },
) {
  assert.ok(Array.isArray(targets) && targets.length > 0, 'Expected published package targets.');
  assert.ok(Number.isSafeInteger(attempts) && attempts > 0, 'Expected a positive attempt count.');
  assert.ok(Number.isSafeInteger(intervalMs) && intervalMs >= 0, 'Expected a retry interval.');
  assert.equal(typeof readTag, 'function', 'Expected an npm tag reader.');

  let pendingTargets = targets;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const observations = await Promise.all(
      pendingTargets.map(async (target) => {
        try {
          return {...target, current: await readTag(target.name)};
        } catch (error) {
          return {...target, current: null, error: safeErrorCode(error)};
        }
      }),
    );
    const pending = observations.filter(({current, version}) => current !== version);
    if (pending.length === 0) return {attempt, targets};

    if (attempt === attempts) {
      const details = pending
        .map(
          ({current, error, name, version}) =>
            `${name}@${version} (observed ${current ?? error ?? 'unavailable'})`,
        )
        .join(', ');
      throw new Error(`npm did not expose the approved dist-tags in time: ${details}`);
    }

    pendingTargets = pending.map(({name, version}) => ({name, version}));
    onRetry({attempt, pending});
    await sleep(intervalMs);
  }

  assert.fail('Unreachable registry propagation state.');
}

export async function readPublishedTargets(listPath, releaseRoot) {
  const [selectedContents, planContents] = await Promise.all([
    readFile(listPath, 'utf8'),
    readFile(resolve(releaseRoot, 'plan.json'), 'utf8'),
  ]);
  const selected = selectedContents.split('\n').filter(Boolean);
  const plan = JSON.parse(planContents);
  assert.ok(selected.length > 0, 'Expected selected release tarballs.');
  assert.ok(Array.isArray(plan.packages), 'Expected release plan packages.');
  assert.equal(
    selected.length,
    plan.packages.length,
    'Selected tarball count does not match the release plan.',
  );

  const targets = [];
  for (const [index, selectedPath] of selected.entries()) {
    assert.equal(isAbsolute(selectedPath), false, 'Selected tarball paths must be relative.');
    const tarball = resolve(releaseRoot, selectedPath);
    const projected = relative(releaseRoot, tarball);
    assert.ok(projected && !projected.startsWith('..') && !isAbsolute(projected));

    const {stdout} = await execFileAsync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    });
    const manifest = JSON.parse(stdout);
    const release = plan.packages[index];
    assert.equal(manifest.name, release?.name, 'Selected package order differs from release plan.');
    assert.equal(
      manifest.version,
      release?.to,
      `${manifest.name} selected version differs from release plan.`,
    );
    assert.match(manifest.version, /^0\.1\.0-alpha\.\d+$/u);
    targets.push({name: manifest.name, version: manifest.version});
  }

  return targets;
}

async function main() {
  const [listPath, releaseRoot] = process.argv.slice(2);
  assert.ok(listPath && releaseRoot, 'Usage: wait-for-published-packages <list> <release-root>');
  const tag = process.env.NPM_TAG;
  assert.match(tag ?? '', /^[a-z][a-z0-9-]*$/u, 'Expected a valid NPM_TAG.');
  const targets = await readPublishedTargets(listPath, releaseRoot);
  const result = await waitForPublishedPackages(targets, {
    readTag: async (packageName) => {
      const {stdout} = await execFileAsync(
        'npm',
        ['view', packageName, `dist-tags.${tag}`, '--prefer-online'],
        {encoding: 'utf8'},
      );
      return stdout.trim();
    },
  });
  console.log(
    `npm exposed ${targets.length} approved ${tag} target(s) after ${result.attempt} check(s).`,
  );
}

function defaultRetryNotice({attempt, pending}) {
  console.log(
    `Waiting for npm registry processing after check ${attempt}: ${pending
      .map(({name, version}) => `${name}@${version}`)
      .join(', ')}`,
  );
}

function defaultSleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : 'unavailable';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
