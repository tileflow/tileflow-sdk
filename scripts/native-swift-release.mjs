import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  parseAlphaVersion,
  readNativeReleaseCatalog,
  swiftRemotes,
} from './native-release-config.mjs';

// The Swift package is distributed from a dedicated repository whose root is the generated
// `swift/` tree of a candidate. `prepare` turns that tree into one commit on top of the
// distribution's current `main` plus a SemVer tag, packed as a git bundle; `publish` pushes exactly
// those objects. Source changes are never made in the distribution repository.

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const identity = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

async function git(args, {cwd, env, gitDir} = {}) {
  try {
    const {stdout} = await run('git', gitDir ? ['--git-dir', gitDir, ...args] : args, {
      cwd,
      env: {...process.env, GIT_TERMINAL_PROMPT: '0', ...env},
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(`git ${args[0]} failed: ${(error.stderr || error.message).trim()}`);
  }
}

/** Branch and tag heads of a remote; an unreachable repository fails with setup guidance. */
export async function remoteHeads(remote, version) {
  let listing;
  try {
    listing = await git(['ls-remote', remote, 'refs/heads/main', `refs/tags/${version}`]);
  } catch (error) {
    throw new Error(
      `The Swift distribution repository ${remote} is not reachable. Create the configured distribution repository before releasing.\n${error.message}`,
    );
  }
  const refs = new Map(
    listing
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t').reverse()),
  );
  return {main: refs.get('refs/heads/main') ?? null, tag: refs.get(`refs/tags/${version}`) ?? null};
}

/** Published versions, from the distribution's tags. Any other tag fails closed. */
export async function swiftVersions(remote) {
  let listing;
  try {
    listing = await git(['ls-remote', '--tags', '--refs', remote]);
  } catch (error) {
    throw new Error(
      `The Swift distribution repository ${remote} is not reachable. Create the configured distribution repository before releasing.\n${error.message}`,
    );
  }
  return listing
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].replace(/^refs\/tags\//u, ''));
}

/** Fetches the remote `main` and requires it to still be the commit that was observed. */
async function fetchMain(gitDir, remote, expected) {
  await git(
    ['fetch', '--quiet', '--no-tags', remote, 'refs/heads/main:refs/remotes/distribution/main'],
    {
      gitDir,
    },
  );
  const actual = await git(['rev-parse', 'refs/remotes/distribution/main'], {gitDir});
  if (actual !== expected) throw new Error(`${remote} main moved from ${expected} to ${actual}.`);
}

/** The git tree of a directory exactly as generated, ignored files included. */
async function treeOf(gitDir, directory, scratch) {
  const env = {GIT_INDEX_FILE: join(scratch, `index-${Date.now()}-${Math.random()}`)};
  await git(['--work-tree', directory, 'add', '--all', '--force', '.'], {gitDir, env});
  const tree = await git(['write-tree'], {gitDir, env});
  const files = (await git(['ls-tree', '-r', '--name-only', tree], {gitDir})).split('\n');
  return {tree, files: files.filter(Boolean).sort()};
}

export async function prepareSwiftRelease({candidate, output, remote}) {
  const manifest = JSON.parse(await readFile(join(candidate, 'candidate.json'), 'utf8'));
  const {version} = manifest;
  if (!parseAlphaVersion(version))
    throw new Error(`A Swift release needs an alpha version, not ${version}.`);
  if (manifest.sourceDirty)
    throw new Error('A Swift release needs a candidate built from clean source.');
  const swift = join(candidate, manifest.swift.path);
  const heads = await remoteHeads(remote, version);
  if (heads.tag) throw new Error(`${remote} already has tag ${version}.`);
  await mkdir(output);
  const scratch = await mkdtemp(join(tmpdir(), 'tileflow-swift-release-'));
  try {
    const gitDir = join(scratch, 'repository.git');
    await git(['init', '--quiet', '--bare', gitDir]);
    if (heads.main) await fetchMain(gitDir, remote, heads.main);
    const {tree, files} = await treeOf(gitDir, swift, scratch);
    const expected = Object.keys(manifest.swift.files).sort();
    if (JSON.stringify(files) !== JSON.stringify(expected)) {
      throw new Error('The Swift distribution tree differs from the candidate inventory.');
    }
    const date = await git(['show', '-s', '--format=%cI', manifest.sourceRevision], {cwd: root});
    const message = [
      `Tileflow ${version}`,
      '',
      `Generated from ${manifest.sourceRepository ?? 'https://github.com/tileflow/tileflow-sdk'}/commit/${manifest.sourceRevision}.`,
      `Embedded runtime ${manifest.runtime.runtimeHash}.`,
      '',
    ].join('\n');
    const commit = await git(
      ['commit-tree', tree, ...(heads.main ? ['-p', heads.main] : []), '-m', message],
      {
        gitDir,
        env: {
          GIT_AUTHOR_NAME: identity.name,
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: identity.name,
          GIT_COMMITTER_EMAIL: identity.email,
          GIT_COMMITTER_DATE: date,
        },
      },
    );
    await git(['update-ref', 'refs/heads/main', commit], {gitDir});
    await git(['update-ref', `refs/tags/${version}`, commit], {gitDir});
    const bundle = join(output, 'swift-release.bundle');
    await git(
      [
        'bundle',
        'create',
        '--quiet',
        bundle,
        'refs/heads/main',
        `refs/tags/${version}`,
        ...(heads.main ? [`^${heads.main}`] : []),
      ],
      {gitDir},
    );
    const release = {
      schemaVersion: 1,
      version,
      branch: 'main',
      parent: heads.main,
      commit,
      tree,
      sourceRevision: manifest.sourceRevision,
      runtimeHash: manifest.runtime.runtimeHash,
    };
    await writeFile(join(output, 'swift-release.json'), `${JSON.stringify(release, null, 2)}\n`);
    return release;
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}

/**
 * Pushes the prepared commit and tag without force. A rerun after a successful push is a no-op;
 * a remote that moved or holds a different tag stops the release.
 */
export async function publishSwiftRelease({release, bundle, swift, remote, log = console.log}) {
  const heads = await remoteHeads(remote, release.version);
  if (heads.tag) {
    if (heads.tag !== release.commit) {
      throw new Error(
        `${remote} tag ${release.version} points to ${heads.tag}, not ${release.commit}.`,
      );
    }
    log(`${release.version} is already published at ${release.commit}.`);
    return 'published';
  }
  if (heads.main !== release.parent && heads.main !== release.commit) {
    throw new Error(
      `${remote} main is ${heads.main ?? 'absent'}; the release was prepared on ${release.parent ?? 'an empty repository'}. Prepare a new release.`,
    );
  }
  const scratch = await mkdtemp(join(tmpdir(), 'tileflow-swift-publish-'));
  try {
    const gitDir = join(scratch, 'repository.git');
    await git(['init', '--quiet', '--bare', gitDir]);
    if (release.parent) await fetchMain(gitDir, remote, release.parent);
    await git(['bundle', 'verify', '--quiet', bundle], {gitDir});
    await git(
      [
        'fetch',
        '--quiet',
        bundle,
        'refs/heads/main:refs/heads/release',
        `refs/tags/${release.version}:refs/tags/${release.version}`,
      ],
      {gitDir},
    );
    const commit = await git(['rev-parse', 'refs/heads/release'], {gitDir});
    const tag = await git(['rev-parse', `refs/tags/${release.version}`], {gitDir});
    const tree = await git(['rev-parse', `${commit}^{tree}`], {gitDir});
    const parents = (await git(['rev-list', '--parents', '-n', '1', commit], {gitDir}))
      .split(' ')
      .slice(1);
    if (commit !== release.commit || tag !== release.commit || tree !== release.tree) {
      throw new Error('The Swift release bundle does not contain the approved commit.');
    }
    if (JSON.stringify(parents) !== JSON.stringify(release.parent ? [release.parent] : [])) {
      throw new Error('The Swift release commit has unexpected parents.');
    }
    if ((await treeOf(gitDir, swift, scratch)).tree !== release.tree) {
      throw new Error('The approved Swift tree differs from the release commit.');
    }
    const refspecs = [`refs/tags/${release.version}:refs/tags/${release.version}`];
    if (heads.main !== release.commit) refspecs.unshift(`${release.commit}:refs/heads/main`);
    await git(['push', '--atomic', '--quiet', remote, ...refspecs], {gitDir});
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
  const after = await remoteHeads(remote, release.version);
  if (after.main !== release.commit || after.tag !== release.commit) {
    throw new Error(
      `${remote} does not show ${release.version} at ${release.commit} after the push.`,
    );
  }
  log(`Published Swift ${release.version} at ${release.commit}.`);
  return 'new';
}

function options(args, allowed) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || result.has(args[index]) || !args[index + 1]) {
      throw new Error(`Unexpected argument ${args[index]}.`);
    }
    result.set(args[index], args[index + 1]);
  }
  for (const key of result.keys()) {
    if (key !== '--remote' && !isAbsolute(result.get(key)))
      throw new Error(`${key} must be absolute.`);
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const catalog = await readNativeReleaseCatalog();
  const remotes = swiftRemotes(catalog);
  if (command === 'prepare') {
    const values = options(args, ['--candidate', '--output', '--remote']);
    if (!values.has('--candidate') || !values.has('--output'))
      throw new Error('--candidate and --output are required.');
    const release = await prepareSwiftRelease({
      candidate: resolve(values.get('--candidate')),
      output: resolve(values.get('--output')),
      remote: values.get('--remote') ?? remotes.fetch,
    });
    console.log(
      `Prepared Swift ${release.version}: commit ${release.commit}, tree ${release.tree}, parent ${release.parent ?? 'none'}.`,
    );
  } else if (command === 'publish') {
    const values = options(args, ['--release', '--bundle', '--swift', '--remote']);
    for (const key of ['--release', '--bundle', '--swift']) {
      if (!values.has(key)) throw new Error(`${key} is required.`);
    }
    await publishSwiftRelease({
      release: JSON.parse(await readFile(values.get('--release'), 'utf8')),
      bundle: values.get('--bundle'),
      swift: values.get('--swift'),
      remote: values.get('--remote') ?? remotes.push,
    });
  } else {
    throw new Error(
      'Usage: native-swift-release.mjs prepare|publish [options]',
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
