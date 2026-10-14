// Prepares the 3D tree models a map declares: the glTF binaries (.glb) in its `models` directories,
// read, checked and turned into Core's compact tree models, which the compiler carries in the
// style. A file's name is its model's id; `<id>.far.glb` is the same model for far trees. A later
// directory's model replaces an earlier one of the same id, as icons do.
import {createHash} from 'node:crypto';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  encodeTileflowTreeModel,
  type TileflowModelDirectory,
  type TileflowTreeModel,
  tileflowTreeModelLimits,
} from '@tileflow/core';
import type {TileflowEffectiveModelSourceIdentity} from '@tileflow/core/build';
import {resolveTileflowAssetDirectories} from './asset-directories';
import {TileflowGltfError} from './gltf-reader';
import {prepareTileflowTreeModelMesh} from './tree-model-mesh';

export type TileflowTreeModelIssue = {message: string; path: string};

export class TileflowTreeModelError extends Error {
  readonly code = 'TREE_MODEL_INVALID' as const;
  readonly issues: readonly TileflowTreeModelIssue[];
  readonly phase = 'tree-model-preparation' as const;

  constructor(issues: readonly TileflowTreeModelIssue[]) {
    super(
      [
        'Invalid Tileflow tree models',
        ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'TileflowTreeModelError';
    this.issues = issues;
  }
}

export type PreparedTileflowTreeModels = {
  /** The prepared models by id. */
  models: Record<string, TileflowTreeModel>;
  identities: TileflowEffectiveModelSourceIdentity[];
  /** Directories to watch for changes. */
  watchPaths: string[];
};

const fileLimit = 8 * 1024 * 1024;
const modelId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Reads, checks and prepares one map's model directories. */
export async function prepareTileflowMapTreeModels(
  directories: readonly TileflowModelDirectory[],
  options: {baseDirectory: string; configPath: string; cwd: string; target: 'hosted' | 'local'},
): Promise<PreparedTileflowTreeModels> {
  const resolved = await resolveTileflowAssetDirectories(directories, {
    baseDirectory: options.baseDirectory,
    configPath: options.configPath,
    cwd: options.cwd,
    kind: 'models',
    target: options.target,
  });
  const issues: TileflowTreeModelIssue[] = [];
  // id → level → file, the last directory winning.
  const files = new Map<
    string,
    {near?: {path: string; display: string}; far?: {path: string; display: string}}
  >();
  for (const directory of resolved) {
    let names: string[];
    try {
      names = (await readdir(directory.realPath)).sort();
    } catch {
      issues.push({message: 'is not a readable directory', path: directory.configPath});
      continue;
    }
    for (const name of names) {
      const display = `${directory.configPath}/${name}`;
      const lower = name.toLowerCase();
      if (lower.endsWith('.gltf')) {
        issues.push({
          message: 'is a text glTF; export the model as a glTF binary (.glb)',
          path: display,
        });
        continue;
      }
      if (!lower.endsWith('.glb')) continue;
      const far = name.endsWith('.far.glb');
      const id = name.slice(0, name.length - (far ? 8 : 4));
      if (!modelId.test(id) || id.length > 64) {
        issues.push({
          message:
            "a model's file name is its id: lowercase letters, digits and hyphens, up to 64, such as royal-palm.glb",
          path: display,
        });
        continue;
      }
      const path = join(directory.realPath, name);
      const info = await lstat(path).catch(() => undefined);
      if (!info?.isFile()) {
        issues.push({message: 'is not a regular file', path: display});
        continue;
      }
      if (info.size > fileLimit) {
        issues.push({message: 'is larger than 8 MiB', path: display});
        continue;
      }
      const entry = files.get(id) ?? {};
      entry[far ? 'far' : 'near'] = {path, display};
      files.set(id, entry);
    }
  }
  const models: Record<string, TileflowTreeModel> = {};
  const identities: TileflowEffectiveModelSourceIdentity[] = [];
  for (const [id, entry] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!entry.near) {
      issues.push({message: `has no ${id}.glb beside it`, path: entry.far!.display});
      continue;
    }
    const prepared: {near?: string; far?: string} = {};
    for (const level of ['near', 'far'] as const) {
      const file = entry[level];
      if (!file) continue;
      try {
        const bytes = new Uint8Array(await readFile(file.path));
        prepared[level] = encodeTileflowTreeModel(
          prepareTileflowTreeModelMesh(bytes, level),
          level,
        );
        identities.push({id, level, sha256: createHash('sha256').update(bytes).digest('hex')});
      } catch (error) {
        issues.push({
          message:
            error instanceof TileflowGltfError || error instanceof RangeError
              ? error.message
              : 'cannot be read',
          path: file.display,
        });
      }
    }
    if (prepared.near)
      models[id] = {near: prepared.near, ...(prepared.far ? {far: prepared.far} : {})};
  }
  if (Object.keys(models).length > tileflowTreeModelLimits.models)
    issues.push({
      message: `holds ${Object.keys(models).length} models; a map takes at most ${tileflowTreeModelLimits.models}`,
      path: options.configPath,
    });
  if (issues.length > 0) throw new TileflowTreeModelError(issues);
  return {
    models,
    identities,
    watchPaths: resolved
      .filter((directory) => directory.watch)
      .map((directory) => directory.realPath),
  };
}
