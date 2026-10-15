// Prepares the 3D models a map declares: the glTF binaries (.glb) in its `models` directories, read,
// checked and turned into Core's models. A model's materials say what it is: one whose materials
// name the parts of a tree (bark, leaves, fronds, stem) becomes a compact tree model the compiler
// carries in the style; one whose materials name the parts of a building (surface, secondary, glass,
// accent, roof) becomes a building model file the build writes beside the style. A file's name is
// its model's id; `<id>.far.glb` is the same model for far trees, and `<id>.mid.glb` and
// `<id>.far.glb` a building's farther levels of detail. A later directory's model replaces an
// earlier one of the same id, as icons do.
import {createHash} from 'node:crypto';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  encodeTileflowModel,
  encodeTileflowTreeModel,
  type TileflowModelDirectory,
  type TileflowModelMesh,
  type TileflowTreeModel,
  tileflowTreeModelLimits,
} from '@tileflow/core';
import type {TileflowEffectiveModelSourceIdentity} from '@tileflow/core/build';
import {resolveTileflowAssetDirectories} from './asset-directories';
import {
  isTileflowBuildingModel,
  prepareTileflowBuildingModelMesh,
  tileflowBuildingModelDeclaredFootprint,
  tileflowBuildingModelFootprint,
} from './building-model-mesh';
import {readTileflowGltfTriangles, TileflowGltfError} from './gltf-reader';
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

/** A building model file, prepared for the build to write beside the style. */
export type PreparedTileflowBuildingModel = {
  /** Its file name, content-addressed: `<id>-<first 16 hex of its SHA-256>.tfmd`. */
  fileName: string;
  bytes: Uint8Array;
};

/** The most building models one map prepares. */
export const tileflowBuildingModelLimit = 64;

/**
 * Prepares one building model from its glTF binaries, nearest level first, into the file a build
 * writes beside the style. Its footprint is the near level's `footprint` mesh, or else its outline
 * on the ground. Throws `TileflowGltfError` or `RangeError` with words an author can act on.
 */
export function prepareTileflowBuildingModel(
  levels: Readonly<{near: Uint8Array; mid?: Uint8Array; far?: Uint8Array}>,
): {bytes: Uint8Array; sha256: string} {
  const primitives = readTileflowGltfTriangles(levels.near);
  if (!isTileflowBuildingModel(primitives))
    throw new TileflowGltfError(
      'is not a building model; name each material surface, secondary, glass, accent or roof',
    );
  const meshes: TileflowModelMesh[] = [prepareTileflowBuildingModelMesh(primitives)];
  for (const level of [levels.mid, levels.far])
    if (level) meshes.push(prepareTileflowBuildingModelMesh(level));
  const bytes = encodeTileflowModel({
    levels: meshes,
    footprint: tileflowBuildingModelFootprint(
      tileflowBuildingModelDeclaredFootprint(primitives) ?? meshes[0]!,
    ),
  });
  return {bytes, sha256: createHash('sha256').update(bytes).digest('hex')};
}

export type PreparedTileflowTreeModels = {
  /** The prepared tree models by id. */
  models: Record<string, TileflowTreeModel>;
  /** The prepared building models by id. */
  buildings: Record<string, PreparedTileflowBuildingModel>;
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
  type File = {path: string; display: string};
  const files = new Map<string, {near?: File; mid?: File; far?: File}>();
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
      const level = name.endsWith('.far.glb') ? 'far' : name.endsWith('.mid.glb') ? 'mid' : 'near';
      const id = name.slice(0, name.length - (level === 'near' ? 4 : 8));
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
      entry[level] = {path, display};
      files.set(id, entry);
    }
  }
  const models: Record<string, TileflowTreeModel> = {};
  const buildings: Record<string, PreparedTileflowBuildingModel> = {};
  const identities: TileflowEffectiveModelSourceIdentity[] = [];
  for (const [id, entry] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!entry.near) {
      issues.push({message: `has no ${id}.glb beside it`, path: (entry.mid ?? entry.far)!.display});
      continue;
    }
    // A model whose materials name the parts of a building is a building model.
    let nearBytes: Uint8Array;
    let primitives: ReturnType<typeof readTileflowGltfTriangles>;
    try {
      nearBytes = new Uint8Array(await readFile(entry.near.path));
      primitives = readTileflowGltfTriangles(nearBytes);
    } catch (error) {
      issues.push({
        message: error instanceof TileflowGltfError ? error.message : 'cannot be read',
        path: entry.near.display,
      });
      continue;
    }
    if (isTileflowBuildingModel(primitives)) {
      const files: {near: Uint8Array; mid?: Uint8Array; far?: Uint8Array} = {near: nearBytes};
      let failing = entry.near;
      try {
        for (const level of ['near', 'mid', 'far'] as const) {
          const file = entry[level];
          if (!file) continue;
          failing = file;
          const bytes = level === 'near' ? nearBytes : new Uint8Array(await readFile(file.path));
          files[level] = bytes;
          // Each level is read on its own first, so a problem names its file.
          if (level !== 'near') prepareTileflowBuildingModelMesh(bytes);
          identities.push({id, level, sha256: createHash('sha256').update(bytes).digest('hex')});
        }
        failing = entry.near;
        const prepared = prepareTileflowBuildingModel(files);
        buildings[id] = {
          fileName: `${id}-${prepared.sha256.slice(0, 16)}.tfmd`,
          bytes: prepared.bytes,
        };
      } catch (error) {
        issues.push({
          message:
            error instanceof TileflowGltfError || error instanceof RangeError
              ? error.message
              : 'cannot be read',
          path: failing.display,
        });
      }
      continue;
    }
    if (entry.mid) {
      issues.push({
        message:
          'is a tree model; trees have a near model and a far one (<id>.far.glb), not a mid one',
        path: entry.mid.display,
      });
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
      message: `holds ${Object.keys(models).length} tree models; a map takes at most ${tileflowTreeModelLimits.models}`,
      path: options.configPath,
    });
  if (Object.keys(buildings).length > tileflowBuildingModelLimit)
    issues.push({
      message: `holds ${Object.keys(buildings).length} building models; a map takes at most ${tileflowBuildingModelLimit}`,
      path: options.configPath,
    });
  if (issues.length > 0) throw new TileflowTreeModelError(issues);
  return {
    models,
    buildings,
    identities,
    watchPaths: resolved
      .filter((directory) => directory.watch)
      .map((directory) => directory.realPath),
  };
}
