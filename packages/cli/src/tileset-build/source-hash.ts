import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {shapefileSidecar} from './read-shapefile';
import type {TilesetBuildFormat} from './recipe';

/** SHA-256 of the data read: the file, plus the sidecars that change what a bare Shapefile means. */
export async function hashSource(
  input: string,
  format: TilesetBuildFormat,
  zipped: boolean,
): Promise<string> {
  const hash = createHash('sha256');
  const sidecars =
    format === 'shapefile' && !zipped
      ? ['.dbf', '.prj', '.cpg'].flatMap((extension) => shapefileSidecar(input, extension) ?? [])
      : [];
  for (const path of [input, ...sidecars]) {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
