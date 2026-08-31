import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {chmod, copyFile, lstat, mkdir, open, readdir, realpath, rm, stat} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import {compareCodeUnits, type MapLibreStyle} from '@tileflow/core';
import type {TileflowBuildCatalog, TileflowBuildStyles} from '@tileflow/core/build';
import {isPathWithin} from './path-safety';
import {joinTileflowPublicUrl} from './public-paths';
import {
  inspectTileflowPmtilesForLocalUse,
  type TileflowLocalTilesetInspection,
} from './tileset-inspection';

export type TileflowLocalTilesetFile = Readonly<{
  byteLength: number;
  etag: string;
  fileName: string;
  logicalId: string;
  sourcePath: string;
}>;

type SourceIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  mtimeNanoseconds: bigint;
  size: bigint;
}>;

type LocalSnapshot = Readonly<{
  byteLength: number;
  etag: string;
  inspection: TileflowLocalTilesetInspection;
  sourcePath: string;
}>;

const minimumLocalPmtilesBytes = 127n;
const maximumLocalPmtilesBytes = 8_000_000_000n;

export async function prepareTileflowLocalTilesets(
  project: TileflowBuildCatalog,
  styles: TileflowBuildStyles,
  options: {assetBaseUrl: string; baseDirectory: string; cwd: string},
): Promise<{
  dispose(): Promise<void>;
  files: TileflowLocalTilesetFile[];
  styles: TileflowBuildStyles;
  watchPaths: string[];
}> {
  const hasSources = Object.values(project.maps).some(
    (map) => Object.keys(map.sources ?? {}).length > 0,
  );
  if (!hasSources) {
    return {dispose: async () => undefined, files: [], styles, watchPaths: []};
  }

  const logicalProjectRoot = resolve(options.cwd);
  const projectRoot = await realpath(logicalProjectRoot).catch(() => logicalProjectRoot);
  const snapshotStore = resolve(logicalProjectRoot, '.tileflow/cache/pmtiles-snapshots/v1');
  await assertSafeSnapshotStore(logicalProjectRoot, snapshotStore);
  await collectAbandonedSnapshotGenerations(snapshotStore);

  const generationId = `snapshot-${process.pid}-${randomUUID().replaceAll('-', '')}`;
  const generationDirectory = resolve(snapshotStore, generationId);
  await mkdir(generationDirectory);

  const bindings = new Map<string, {file: TileflowLocalTilesetFile; originalSourcePath: string}>();
  const files = new Map<string, TileflowLocalTilesetFile>();
  const snapshots = new Map<string, LocalSnapshot>();
  const output: TileflowBuildStyles = Object.fromEntries(
    Object.entries(styles).map(([mapName, family]) => [
      mapName,
      Object.fromEntries(
        Object.entries(family).map(([themeName, style]) => [themeName, cloneStyle(style)]),
      ),
    ]),
  );
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (!isPathWithin(snapshotStore, generationDirectory)) {
      throw new Error('Local PMTiles snapshot generation escaped its store.');
    }
    await rm(generationDirectory, {force: true, recursive: true});
  };

  try {
    for (const mapName of Object.keys(project.maps).sort(compareCodeUnits)) {
      const map = project.maps[mapName]!;
      for (const [sourceId, source] of Object.entries(map.sources ?? {}).sort(([left], [right]) =>
        compareCodeUnits(left, right),
      )) {
        const requestedPath = resolve(options.baseDirectory, source.local);
        const sourcePath = await realpath(requestedPath).catch(() => requestedPath);
        if (!isPathWithin(projectRoot, sourcePath)) {
          throw localTilesetError(
            'TF_LOCAL_TILESET_OUTSIDE_ROOT',
            `maps.${mapName}.sources.${sourceId}.local`,
            'Local hosted tileset must stay inside the project root.',
          );
        }

        const sourceStat = await lstat(sourcePath).catch(() => null);
        if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
          throw localTilesetError(
            'TF_LOCAL_TILESET_NOT_FOUND',
            `maps.${mapName}.sources.${sourceId}.local`,
            `Local hosted tileset "${sourceId}" was not found.`,
          );
        }

        let snapshot = snapshots.get(sourcePath);
        if (!snapshot) {
          snapshot = await createLocalTilesetSnapshot(
            sourcePath,
            generationDirectory,
            snapshots.size,
          );
          snapshots.set(sourcePath, snapshot);
        }

        const file: TileflowLocalTilesetFile = {
          byteLength: snapshot.byteLength,
          etag: snapshot.etag,
          fileName: `tilesets/${source.tileset}.pmtiles`,
          logicalId: source.tileset,
          sourcePath: snapshot.sourcePath,
        };
        const existing = bindings.get(source.tileset);
        if (existing && existing.originalSourcePath !== sourcePath) {
          throw localTilesetError(
            'TF_LOCAL_TILESET_BINDING_CONFLICT',
            `maps.${mapName}.sources.${sourceId}.local`,
            `Logical tileset "${source.tileset}" resolves to different local archives in one generation.`,
          );
        }
        bindings.set(source.tileset, {file, originalSourcePath: sourcePath});
        files.set(file.fileName, files.get(file.fileName) ?? file);
        validateSourceContract(
          mapName,
          sourceId,
          source.type,
          output[mapName] ?? {},
          snapshot.inspection,
        );

        const publicUrl = joinTileflowPublicUrl(options.assetBaseUrl, file.fileName);
        for (const style of Object.values(output[mapName] ?? {})) {
          const definition = style.sources[sourceId];
          if (!definition) {
            throw localTilesetError(
              'TF_LOCAL_TILESET_SOURCE_MISSING',
              `maps.${mapName}.sources.${sourceId}`,
              `Compiled style is missing hosted source "${sourceId}".`,
            );
          }
          definition.url = `tileflow-pmtiles://${publicUrl}`;
          delete definition.tiles;
        }
      }
    }

    return {
      dispose,
      files: [...files.values()].sort((left, right) =>
        compareCodeUnits(left.fileName, right.fileName),
      ),
      styles: output,
      watchPaths: [...snapshots.keys()].sort(compareCodeUnits),
    };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}

async function createLocalTilesetSnapshot(
  sourcePath: string,
  generationDirectory: string,
  index: number,
): Promise<LocalSnapshot> {
  const sourceHandle = await open(sourcePath, 'r');
  const snapshotPath = resolve(generationDirectory, `${index}.pmtiles`);

  try {
    const before = sourceIdentity(await sourceHandle.stat({bigint: true}));
    if (before.size < minimumLocalPmtilesBytes || before.size > maximumLocalPmtilesBytes) {
      throw localTilesetError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Expected one bounded PMTiles file.',
      );
    }
    await copyFile(sourcePath, snapshotPath, constants.COPYFILE_FICLONE);
    await syncFile(snapshotPath);

    const [afterHandle, afterPath, snapshotStat] = await Promise.all([
      sourceHandle.stat({bigint: true}).then(sourceIdentity),
      stat(sourcePath, {bigint: true}).then(sourceIdentity),
      stat(snapshotPath, {bigint: true}),
    ]);
    assertSourceIdentity(before, afterHandle);
    assertSourceIdentity(before, afterPath);
    if (!snapshotStat.isFile() || snapshotStat.size !== before.size) {
      throw localTilesetError(
        'TF_LOCAL_TILESET_CHANGED',
        'local',
        'Local hosted tileset changed while its immutable snapshot was prepared.',
      );
    }

    const inspection = await inspectTileflowPmtilesForLocalUse(snapshotPath);
    await chmod(snapshotPath, 0o444);
    return Object.freeze({
      byteLength: Number(before.size),
      etag: `"${generationIdFromDirectory(generationDirectory)}-${index}"`,
      inspection,
      sourcePath: snapshotPath,
    });
  } finally {
    await sourceHandle.close();
  }
}

function generationIdFromDirectory(path: string): string {
  const generationId = basename(path);
  if (!/^snapshot-\d+-[a-f0-9]{32}$/u.test(generationId)) {
    throw new Error('Local PMTiles snapshot generation is invalid.');
  }
  return generationId;
}

function sourceIdentity(
  value: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
): SourceIdentity {
  if (!value.isFile()) throw new Error('Local PMTiles source is not a file.');
  return Object.freeze({
    device: BigInt(value.dev),
    inode: BigInt(value.ino),
    mtimeNanoseconds:
      'mtimeNs' in value ? BigInt(value.mtimeNs) : BigInt(Math.round(value.mtimeMs * 1e6)),
    size: BigInt(value.size),
  });
}

function assertSourceIdentity(before: SourceIdentity, after: SourceIdentity): void {
  if (
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.mtimeNanoseconds !== after.mtimeNanoseconds ||
    before.size !== after.size
  ) {
    throw localTilesetError(
      'TF_LOCAL_TILESET_CHANGED',
      'local',
      'Local hosted tileset changed while its immutable snapshot was prepared.',
    );
  }
}

function validateSourceContract(
  mapName: string,
  sourceId: string,
  sourceType: 'raster' | 'vector',
  styles: Record<string, MapLibreStyle>,
  inspection: TileflowLocalTilesetInspection,
): void {
  const isVectorArchive =
    inspection.contract.tileType === 'mlt' || inspection.contract.tileType === 'mvt';
  if ((sourceType === 'vector') !== isVectorArchive) {
    throw localTilesetError(
      'TF_SOURCE_TILE_TYPE_MISMATCH',
      `maps.${mapName}.sources.${sourceId}.type`,
      `Source "${sourceId}" declares ${sourceType} but the PMTiles archive contains ${inspection.contract.tileType}.`,
    );
  }
  if (!isVectorArchive || !inspection.contract.sourceLayersDeclared) return;

  const availableLayers = new Map(
    inspection.contract.sourceLayers.map((layer) => [layer.id, layer] as const),
  );
  for (const style of Object.values(styles)) {
    const requirements = asRecord(style.metadata?.['tileflow:sourceRequirements']);
    const sources = asRecord(requirements?.sources);
    const source = asRecord(sources?.[sourceId]);
    const sourceLayers = Array.isArray(source?.sourceLayers) ? source.sourceLayers : [];
    for (const candidate of sourceLayers) {
      const required = asRecord(candidate);
      const layerId = required?.id;
      if (typeof layerId !== 'string') continue;
      const available = availableLayers.get(layerId);
      if (!available) {
        const candidates = [...availableLayers.keys()].sort(compareCodeUnits);
        throw localTilesetError(
          'TF_SOURCE_LAYER_NOT_FOUND',
          `maps.${mapName}.sources.${sourceId}.sourceLayers.${layerId}`,
          `Source "${sourceId}" has no source-layer "${layerId}". Available: ${candidates.join(', ') || '(none)'}.`,
        );
      }
      if (!available.fieldsDeclared) continue;

      const availableFields = new Map(available.fields.map((field) => [field.name, field.type]));
      const requiredFields = Array.isArray(required?.fields) ? required.fields : [];
      for (const fieldCandidate of requiredFields) {
        const field = asRecord(fieldCandidate);
        const fieldName = field?.name;
        if (typeof fieldName !== 'string') continue;
        if (!availableFields.has(fieldName)) {
          const candidates = [...availableFields.keys()].sort(compareCodeUnits);
          throw localTilesetError(
            'TF_SOURCE_FIELD_NOT_FOUND',
            `maps.${mapName}.sources.${sourceId}.sourceLayers.${layerId}.fields.${fieldName}`,
            `Source-layer "${layerId}" has no field "${fieldName}". Available: ${candidates.join(', ') || '(none)'}.`,
          );
        }
        const requiredType = field?.type;
        const actualType = availableFields.get(fieldName);
        if (
          typeof requiredType === 'string' &&
          actualType !== undefined &&
          requiredType !== actualType
        ) {
          throw localTilesetError(
            'TF_SOURCE_FIELD_TYPE_MISMATCH',
            `maps.${mapName}.sources.${sourceId}.sourceLayers.${layerId}.fields.${fieldName}`,
            `Field "${layerId}.${fieldName}" is ${actualType}; ${requiredType} is required.`,
          );
        }
      }
    }
  }
}

async function collectAbandonedSnapshotGenerations(store: string): Promise<void> {
  const entries = await readdir(store, {withFileTypes: true}).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = /^snapshot-(\d+)-[a-f0-9]{32}$/u.exec(entry.name);
    if (!match?.[1] || processIsAlive(Number(match[1]))) continue;
    const path = resolve(store, entry.name);
    if (isPathWithin(store, path)) await rm(path, {force: true, recursive: true});
  }
}

async function assertSafeSnapshotStore(projectRoot: string, store: string): Promise<void> {
  const segments = ['.tileflow', 'cache', 'pmtiles-snapshots', 'v1'];
  let current = projectRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const value = await lstat(current);
      if (!value.isDirectory() || value.isSymbolicLink()) {
        throw new Error(`Local PMTiles snapshot path is unsafe: ${current}`);
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      await mkdir(current).catch((mkdirError) => {
        if (!hasErrorCode(mkdirError, 'EEXIST')) throw mkdirError;
      });
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error(`Local PMTiles snapshot path is unsafe: ${current}`);
      }
    }
  }
  if (resolve(current) !== resolve(store)) {
    throw new Error('Local PMTiles snapshot path escaped its project root.');
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, 'ESRCH');
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function cloneStyle(style: MapLibreStyle): MapLibreStyle {
  return JSON.parse(JSON.stringify(style)) as MapLibreStyle;
}

function localTilesetError(code: string, path: string, message: string): Error {
  return Object.assign(new Error(message), {code, path, phase: 'local-tileset-resolution'});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as {code?: unknown}).code === code);
}
