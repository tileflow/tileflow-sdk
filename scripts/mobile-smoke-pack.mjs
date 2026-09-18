import {mkdir, readdir, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {
  assertArchiveListing,
  assertPackedAndroidConfig,
  assertPackedManifest,
  mobilePackages,
  mobileVersions,
  pnpmPackArguments,
  requireMobile,
  stageMobileManifest,
} from './mobile-smoke-contract.mjs';
import {
  assertOwnedPath,
  copyMobileInputs,
  mobileFileIdentity,
  readMobileFile,
  readMobileJson,
  writeMobileJson,
} from './mobile-smoke-workspace.mjs';
import {stagePackageLicenseInputs} from './package-license.mjs';

export function parseCommandJson(result) {
  try {
    return JSON.parse(result.stdout.toString('utf8'));
  } catch {
    requireMobile(false, 'COMMAND_FAILED');
  }
}
export async function extractMobileTarball(context, path, destination) {
  await assertOwnedPath(context.root, path);
  await assertOwnedPath(context.root, destination);
  await readMobileFile(context.root, path, 128 * 1024 * 1024);
  const names = await context.run('tar', ['-tzf', path], {
    step: 'pack',
    maxOutputBytes: 8 * 1024 * 1024,
  });
  const types = await context.run('tar', ['-tvzf', path], {
    step: 'pack',
    maxOutputBytes: 8 * 1024 * 1024,
  });
  const files = assertArchiveListing(names.stdout.toString(), types.stdout.toString());
  await mkdir(destination, {recursive: false});
  await context.run(
    'tar',
    ['-xzf', path, '-C', destination, '--no-same-owner', '--no-same-permissions'],
    {step: 'pack'},
  );
  for (const file of files)
    await readMobileFile(context.root, join(destination, 'package', file), 128 * 1024 * 1024);
  return {directory: join(destination, 'package'), files};
}

/** Build fresh staged sources using the repository lock; no checkout dist or consumer aliases. */
export async function packMobilePackages(context, repository, pnpm) {
  const sourceRoot = await realpath(repository);
  const stage = join(context.root, 'staging');
  await mkdir(stage);
  const excluded = new Set([
    'node_modules',
    'dist',
    '.git',
    '.turbo',
    'build',
    'Pods',
    '.gradle',
    '.DS_Store',
  ]);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
  ]) {
    await copyMobileInputs(join(sourceRoot, file), join(stage, file));
  }
  await copyMobileInputs(
    join(sourceRoot, 'docs', 'modules-api-reference.json'),
    join(stage, 'docs', 'modules-api-reference.json'),
  );
  for (const file of ['LICENSE', 'scripts/package-license.mjs'])
    await readMobileFile(sourceRoot, join(sourceRoot, file));
  await stagePackageLicenseInputs({root: sourceRoot, stagingRoot: stage});
  for (const directory of mobilePackages) {
    await copyMobileInputs(
      join(sourceRoot, 'packages', directory),
      join(stage, 'packages', directory),
      excluded,
    );
  }
  const inputLock = await mobileFileIdentity(
    context.root,
    join(stage, 'pnpm-lock.yaml'),
    'pnpm-lock.yaml',
  );
  await context.run(
    pnpm.command,
    [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'],
    {cwd: stage, step: 'stage'},
  );
  for (const directory of mobilePackages) {
    await context.run(
      pnpm.command,
      [...pnpm.prefix, '--filter', `@tileflow/${directory}`, 'run', 'build'],
      {cwd: stage, step: 'stage'},
    );
  }
  for (const directory of mobilePackages) {
    const path = join(stage, 'packages', directory, 'package.json');
    await writeMobileJson(
      context.root,
      path,
      stageMobileManifest(await readMobileJson(context.root, path)),
    );
  }
  const packs = join(context.root, 'packs');
  await mkdir(packs);
  const tarballs = [];
  for (const directory of mobilePackages) {
    const cwd = join(stage, 'packages', directory);
    const result = parseCommandJson(
      await context.run(pnpm.command, [...pnpm.prefix, ...pnpmPackArguments(packs)], {
        cwd,
        step: 'pack',
      }),
    );
    requireMobile(
      result.name === `@tileflow/${directory}` &&
        result.version === mobileVersions.package &&
        typeof result.filename === 'string',
      'PACK_INVALID',
      'pack',
    );
    const path = resolve(cwd, result.filename);
    requireMobile(path.endsWith('.tgz') && resolve(path, '..') === packs, 'PACK_INVALID', 'pack');
    const extracted = await extractMobileTarball(
      context,
      path,
      join(context.root, `unpacked-${directory}`),
    );
    const manifest = await readMobileJson(context.root, join(extracted.directory, 'package.json'));
    assertPackedManifest(manifest, extracted.files);
    if (directory === 'react-native') {
      const config = parseCommandJson(
        await context.run(
          process.execPath,
          [
            '-e',
            'process.stdout.write(JSON.stringify(require(process.argv[1])))',
            join(extracted.directory, 'react-native.config.cjs'),
          ],
          {step: 'pack'},
        ),
      );
      assertPackedAndroidConfig(config);
    }
    tarballs.push({
      name: manifest.name,
      version: manifest.version,
      path,
      ...extracted,
      identity: await mobileFileIdentity(context.root, path, `${directory}.tgz`),
    });
  }
  requireMobile((await readdir(packs)).length === mobilePackages.length, 'PACK_INVALID', 'pack');
  return {tarballs, inputLock};
}

/** npm pack is used only for pinned external templates, never a Tileflow workspace package. */
export async function packMobileTemplate(context, name, version, directory) {
  const packs = join(context.root, 'templates');
  await mkdir(packs, {recursive: true});
  const result = parseCommandJson(
    await context.run(
      'npm',
      ['pack', `${name}@${version}`, '--ignore-scripts', '--pack-destination', packs, '--json'],
      {step: 'templates'},
    ),
  );
  requireMobile(
    result.length === 1 &&
      result[0].name === name &&
      result[0].version === version &&
      /^[a-z0-9._-]+\.tgz$/u.test(result[0].filename),
    'TEMPLATE_INVALID',
    'templates',
  );
  const path = join(packs, result[0].filename);
  const extracted = await extractMobileTarball(
    context,
    path,
    join(context.root, `template-${directory}`),
  );
  return {
    name,
    version,
    path,
    ...extracted,
    identity: await mobileFileIdentity(context.root, path, `${directory}-template.tgz`),
  };
}
