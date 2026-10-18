import {readdir, readFile, writeFile} from 'node:fs/promises';
import {map1777Pigment} from '../src/official/map-1777-pigments';

// Run from the SDK checkout: pnpm exec tsx packages/maps/scripts/generate-map-1777-patterns.ts
const directory = new URL('../assets/map-1777/icons/', import.meta.url);
const originals = (await readdir(directory)).filter(
  (file) => file.endsWith('.svg') && !/^map-1777-(dawn|dusk|night)-/.test(file),
);
for (const file of originals) {
  const svg = await readFile(new URL(file, directory), 'utf8');
  for (const moment of ['dawn', 'dusk', 'night'] as const) {
    const variant = svg.replace(/#[\da-f]{6}/gi, (color) => map1777Pigment(color, moment));
    await writeFile(new URL(file.replace('map-1777-', `map-1777-${moment}-`), directory), variant);
  }
}
