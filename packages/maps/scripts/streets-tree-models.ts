/**
 * Writes Streets' tree model files from its GLB artwork: one file per model and level, the bytes
 * Tileflow publishes as its official tree-model base asset set.
 *
 *   pnpm --filter @tileflow/maps exec tsx scripts/streets-tree-models.ts
 *
 * Run it again after changing the artwork in `assets/streets/models`, then update the set's
 * identity in `src/assets.ts` to the one it prints. A new identity is a new set, published before
 * any release of this package names it.
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  encodeTileflowTreeModelBytes,
  serializeCanonicalJson,
  tileflowTreeModelContentType,
} from '@tileflow/core';
import {prepareTileflowTreeModelMesh} from '../../dev/src/tree-model-mesh';

export const streetsTreeModelIds = [
  'streets-tree-columnar',
  'streets-tree-conifer',
  'streets-tree-open',
  'streets-tree-palm-fan',
  'streets-tree-palm-feather',
  'streets-tree-round',
  'streets-tree-tall',
] as const;

const artwork = resolve(import.meta.dirname, '../assets/streets/models');
export const streetsTreeModelDirectory = resolve(
  import.meta.dirname,
  '../assets/streets/tree-models',
);

/** Each model level's file, by its path in the set (`models/<id>-<level>`). */
export async function buildStreetsTreeModelFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const id of streetsTreeModelIds)
    for (const level of ['far', 'near'] as const) {
      const glb = await readFile(resolve(artwork, `${id}${level === 'far' ? '.far' : ''}.glb`));
      files.set(
        `models/${id}-${level}`,
        encodeTileflowTreeModelBytes(prepareTileflowTreeModelMesh(glb, level), level),
      );
    }
  return files;
}

/** The set's canonical manifest and its identity, the SHA-256 of the manifest's bytes. */
export function streetsTreeModelManifest(files: ReadonlyMap<string, Uint8Array>) {
  const manifest = {
    files: [...files]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, bytes]) => ({
        byteLength: bytes.byteLength,
        contentType: tileflowTreeModelContentType,
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
    format: 'tileflow-base-asset-set-v1',
    kind: 'tree-models',
    models: [...streetsTreeModelIds],
  };
  const serialized = serializeCanonicalJson(manifest);
  return {
    manifest,
    serialized,
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await buildStreetsTreeModelFiles();
  await mkdir(resolve(streetsTreeModelDirectory, 'models'), {recursive: true});
  for (const [path, bytes] of files)
    await writeFile(resolve(streetsTreeModelDirectory, path), bytes);
  const {sha256} = streetsTreeModelManifest(files);
  console.log(`Wrote ${files.size} tree model files; set ${sha256}`);
}
