import {existsSync} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const manifests: Record<string, RegExp> = {
  'Package.swift': /tileflow\/tileflow-swift\b/iu,
  Podfile: /(?:pod\s+['"]Tileflow['"]|tileflow\/tileflow-swift\b)/iu,
  'build.gradle': /dev\.tileflow:tileflow(?=[:'"])/u,
  'build.gradle.kts': /dev\.tileflow:tileflow(?=[:'"])/u,
  'libs.versions.toml': /dev\.tileflow:tileflow(?=[:'"])/u,
};
const ignored = new Set(['node_modules', 'vendor', 'Pods', 'build', 'dist', 'DerivedData']);

export const enableNativePlatforms = 'platforms: ["web", "native"],';

/** Look for map SDK dependencies in the config repository, including common app subdirectories. */
export async function usesTileflowNativeSdk(configFile: string): Promise<boolean> {
  let root = dirname(configFile);
  for (let parent = root; parent !== dirname(parent); parent = dirname(parent)) {
    if (!existsSync(join(parent, '.git'))) continue;
    root = parent;
    break;
  }
  const pending = [{path: root, depth: 0}];
  for (let seen = 0; pending.length && seen < 512; seen++) {
    const {path, depth} = pending.shift()!;
    const entries = await readdir(path, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
      const file = join(path, entry.name);
      if (
        entry.isDirectory() &&
        depth < 5 &&
        !entry.name.startsWith('.') &&
        !ignored.has(entry.name)
      )
        pending.push({path: file, depth: depth + 1});
      if (
        !entry.isFile() ||
        !(Object.hasOwn(manifests, entry.name) || entry.name === 'package.json')
      )
        continue;
      const size = (await stat(file).catch(() => undefined))?.size;
      if (size === undefined || size > 256 * 1024) continue;
      const text = await readFile(file, 'utf8').catch(() => '');
      if (manifests[entry.name]?.test(text)) return true;
      if (entry.name !== 'package.json') continue;
      try {
        const manifest = JSON.parse(text);
        if (
          ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
            (key) => typeof manifest?.[key]?.['@tileflow/react-native'] === 'string',
          )
        )
          return true;
      } catch {
        // Dependency detection is advisory.
      }
    }
  }
  return false;
}
