import {access, readdir, readFile} from 'node:fs/promises';
import {dirname, parse, resolve} from 'node:path';

/** Attribute the files actually bundled, including the engine's upstream bundled notices. */
export async function collectRuntimeNotices({inputs, packageRoot, repositoryRoot}) {
  const packages = new Map();
  for (const input of inputs) {
    let directory = dirname(resolve(packageRoot, input));
    while (directory !== parse(directory).root) {
      try {
        await access(resolve(directory, 'package.json'));
        const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
        if (manifest.name && manifest.version) {
          packages.set(`${manifest.name}@${manifest.version}`, {directory, manifest});
          break;
        }
      } catch {
        /* A source directory need not own a package. */
      }
      directory = dirname(directory);
    }
  }
  const inventory = [];
  const notices = [];
  for (const [identity, {directory, manifest}] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    if (manifest.name === '@tileflow/mobile-runtime') continue;
    const filenames = (await readdir(directory, {withFileTypes: true}))
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(?:licen[cs]e|copying|notice|third[ _-]party[ _-]notices?)(?:[._-].*)?$/iu.test(
            entry.name,
          ),
      )
      .map((entry) => entry.name)
      .sort();
    const texts = await Promise.all(
      filenames.map((name) => readFile(resolve(directory, name), 'utf8')),
    );
    if (texts.length === 0 && manifest.name.startsWith('@tileflow/')) {
      texts.push(await readFile(resolve(repositoryRoot, 'LICENSE'), 'utf8'));
    }
    if (texts.length === 0)
      throw new Error(`No license text found for bundled package ${identity}.`);
    inventory.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'SEE NOTICES',
    });
    notices.push(`${identity}\n${'='.repeat(identity.length)}\n\n${texts.join('\n\n')}`);
  }
  return {
    inventory,
    text: `Tileflow embedded runtime — dependency notices\n\n${notices.join('\n\n----------------------------------------\n\n')}\n`,
  };
}
