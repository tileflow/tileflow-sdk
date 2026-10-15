import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

/** The image IDs of the packaged Streets atlas, in code-unit order. */
export function readStreetsIconIds(): string[] {
  const maps = dirname(createRequire(import.meta.url).resolve('@tileflow/maps/package.json'));
  return readdirSync(join(maps, 'assets/streets/icons'))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -'.svg'.length))
    .sort();
}
