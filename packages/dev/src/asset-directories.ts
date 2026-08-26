import {realpath, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {
  isTileflowLocalDirectory,
  type TileflowIconDirectory,
  tileflowLocalDirectoryMessage,
  type TileflowPackageDirectory,
} from '@tileflow/core';

export type TileflowAssetDirectoryKind = 'fonts' | 'icons';

export type ResolvedTileflowAssetDirectory = {
  authoring: TileflowIconDirectory;
  configPath: string;
  containmentRoot: string;
  packageOwned: boolean;
  realPath: string;
  watch: boolean;
};

export type TileflowAssetDirectoryIssue = {
  message: string;
  path: string;
};

export class TileflowAssetDirectoryError extends Error {
  readonly code = 'ASSET_DIRECTORY_INVALID' as const;
  readonly issues: readonly TileflowAssetDirectoryIssue[];
  readonly phase = 'asset-directory-resolution' as const;

  constructor(kind: TileflowAssetDirectoryKind, issues: readonly TileflowAssetDirectoryIssue[]) {
    super(
      [
        `Invalid Tileflow ${kind} directories`,
        ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'TileflowAssetDirectoryError';
    this.issues = issues;
  }
}

/** Resolve ordered authoring directories without allowing package or workspace escapes. */
export async function resolveTileflowAssetDirectories(
  directories: readonly TileflowIconDirectory[],
  options: {
    baseDirectory?: string;
    configPath: string;
    cwd: string;
    kind: TileflowAssetDirectoryKind;
    target: 'hosted' | 'local';
  },
): Promise<ResolvedTileflowAssetDirectory[]> {
  const issues: TileflowAssetDirectoryIssue[] = [];
  let realCwd: string;
  let realBaseDirectory: string;
  try {
    realCwd = await realpath(options.cwd);
    if (!(await stat(realCwd)).isDirectory()) throw new Error('Working tree is not a directory');
  } catch (error) {
    throw new TileflowAssetDirectoryError(options.kind, [
      {message: filesystemMessage(error, 'Selected working tree was not found'), path: 'cwd'},
    ]);
  }
  try {
    realBaseDirectory = await realpath(options.baseDirectory ?? options.cwd);
    if (!(await stat(realBaseDirectory)).isDirectory()) {
      throw new Error('Config base is not a directory');
    }
    if (!isPathInside(realCwd, realBaseDirectory)) {
      throw new Error('Config base directory escapes the selected working tree');
    }
  } catch (error) {
    throw new TileflowAssetDirectoryError(options.kind, [
      {
        message: filesystemMessage(error, 'Config base directory was not found'),
        path: 'baseDirectory',
      },
    ]);
  }

  const result: ResolvedTileflowAssetDirectory[] = [];
  const seen = new Map<string, string>();
  for (const [index, directory] of directories.entries()) {
    const configPath = `${options.configPath}.${index}`;
    let candidate: string;
    let containmentRoot: string;
    let packageOwned = false;

    if (typeof directory === 'string') {
      if (!isTileflowLocalDirectory(directory)) {
        issues.push({
          message: tileflowLocalDirectoryMessage,
          path: configPath,
        });
        continue;
      }
      candidate = resolve(realBaseDirectory, directory);
      containmentRoot = realCwd;
    } else if (isPackageDirectory(directory)) {
      packageOwned = true;
      let packageRoot: string;
      try {
        validatePackageDirectory(directory);
        const requireFromProject = createRequire(resolve(realCwd, '__tileflow_config__.cjs'));
        let packageJson: string;
        try {
          packageJson = requireFromProject.resolve(`${directory.package}/package.json`);
        } catch {
          // Package-owned descriptors remain usable in isolated build/test working trees.
          // Containment below still binds the requested path to the resolved owner package.
          packageJson = createRequire(import.meta.url).resolve(`${directory.package}/package.json`);
        }
        packageRoot = dirname(packageJson);
        containmentRoot = await realpath(packageRoot);
        candidate = resolve(containmentRoot, ...directory.path.split('/'));
      } catch (error) {
        issues.push({
          message:
            error instanceof Error ? error.message : 'Package directory could not be resolved',
          path: configPath,
        });
        continue;
      }
    } else {
      issues.push({
        message: 'Expected a relative directory or imported package-directory descriptor',
        path: configPath,
      });
      continue;
    }

    try {
      const realCandidate = await realpath(candidate);
      if (!(await stat(realCandidate)).isDirectory()) {
        throw new Error('Asset source must be a directory');
      }
      if (!isPathInside(containmentRoot, realCandidate)) {
        throw new Error(
          packageOwned
            ? 'Package asset directory escapes its installed package'
            : 'Asset directory escapes the selected working tree',
        );
      }
      if (options.target === 'hosted' && !packageOwned && !isPathInside(realCwd, realCandidate)) {
        throw new Error('Hosted asset directories must remain inside the selected working tree');
      }
      const previous = seen.get(realCandidate);
      if (previous) {
        issues.push({message: `Directory duplicates ${previous}`, path: configPath});
        continue;
      }
      seen.set(realCandidate, configPath);
      result.push({
        authoring: directory,
        configPath,
        containmentRoot,
        packageOwned,
        realPath: realCandidate,
        watch: !packageOwned,
      });
    } catch (error) {
      issues.push({
        message: filesystemMessage(error, 'Asset directory was not found'),
        path: configPath,
      });
    }
  }

  if (issues.length > 0) throw new TileflowAssetDirectoryError(options.kind, issues);
  return result;
}

function isPackageDirectory(value: unknown): value is TileflowPackageDirectory {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    (value as {kind?: unknown}).kind === 'package-directory',
  );
}

function validatePackageDirectory(directory: TileflowPackageDirectory): void {
  const keys = Object.keys(directory).sort();
  if (keys.join(',') !== 'kind,package,path') {
    throw new Error('Package directory accepts exactly kind, package, and path');
  }
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(
      directory.package,
    )
  ) {
    throw new Error('Package directory has an invalid npm package name');
  }
  if (
    !directory.path ||
    directory.path.startsWith('/') ||
    directory.path.includes('\\') ||
    directory.path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Package directory path must be a portable package-relative path');
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function filesystemMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as {code?: unknown}).code ?? '');
    if (code === 'ENOENT') return fallback;
    if (code === 'EACCES' || code === 'EPERM') return 'Asset directory is not readable';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
