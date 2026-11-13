import * as fontkit from 'fontkit';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(
  await readFile(new URL('./official-fonts.lock.json', import.meta.url), 'utf8'),
);
const cache =
  process.env.TILEFLOW_OFFICIAL_FONT_CACHE || resolve(tmpdir(), 'tileflow-official-fonts');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  JSON.stringify(value, function (_key, entry) {
    return entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry;
  });

export async function officialFontFile(path) {
  const entry = lock.files.find((file) => file.path === path);
  if (!entry) throw new Error(`Unknown official font file: ${path}`);
  const destination = resolve(cache, path);
  let bytes;
  try {
    bytes = await readFile(destination);
  } catch {
    // A missing cache entry is downloaded and verified below.
  }
  if (!bytes || bytes.length !== entry.byteLength || hash(bytes) !== entry.sha256) {
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`Official font download failed: ${response.status} ${path}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== entry.byteLength || hash(bytes) !== entry.sha256)
      throw new Error(`Official font identity mismatch: ${path}`);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, bytes);
  }
  return bytes;
}

function ranges(bytes) {
  const font = fontkit.create(bytes);
  const points = [...new Set(font.characterSet)]
    .filter((point) => font.hasGlyphForCodePoint(point))
    .sort((a, b) => a - b);
  const runs = [];
  for (const point of points) {
    const last = runs.at(-1);
    if (last && point === last[1] + 1) last[1] = point;
    else runs.push([point, point]);
  }
  if (!runs.length || runs.length > 4096) throw new Error('Invalid official cmap');
  return runs.map(
    ([start, end]) =>
      `U+${start.toString(16).toUpperCase().padStart(4, '0')}-${end.toString(16).toUpperCase().padStart(4, '0')}`,
  );
}

async function generate() {
  const files = [],
    faces = [];
  for (const entry of lock.files) {
    const bytes = await officialFontFile(entry.path);
    files.push({
      path: entry.path,
      sha256: entry.sha256,
      byteLength: entry.byteLength,
      contentType: entry.path.endsWith('.ttf')
        ? 'font/ttf'
        : entry.path.endsWith('.otf')
          ? 'font/otf'
          : 'text/plain; charset=utf-8',
    });
    if (entry.licensePath)
      faces.push({
        path: entry.path,
        licensePath: entry.licensePath,
        'unicode-range': ranges(bytes),
      });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    format: 'tileflow-base-asset-set-v1',
    kind: 'font-files',
    files,
    fontFaces: lock.fontFaces.map((face) => ({
      name: face.name,
      files: face.files.map((path) => {
        const file = faces.find((file) => file.path === path);
        if (!file) throw new Error(`Unknown shared font file: ${path}`);
        return file;
      }),
    })),
    source: {repositories: lock.sources, files: lock.files.map(({path, url}) => ({path, url}))},
  };
  const bytes = canonical(manifest);
  const assetSetSha256 = hash(bytes);
  const destination = resolve(root, 'packages/core/src/official-fonts.generated.json');
  const generated = await format(JSON.stringify({assetSetSha256, manifest}), {
    ...(await resolveConfig(destination)),
    filepath: destination,
  });
  if (process.argv.includes('--write')) await writeFile(destination, generated);
  else if ((await readFile(destination, 'utf8')) !== generated)
    throw new Error('Run node scripts/official-fonts.mjs --write');
  const outIndex = process.argv.indexOf('--output');
  if (outIndex >= 0) {
    const output = resolve(process.argv[outIndex + 1], 'base', assetSetSha256);
    for (const file of files) {
      const path = resolve(output, file.path);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, await officialFontFile(file.path));
    }
    await writeFile(resolve(output, 'manifest.json'), bytes);
  }
  console.log(
    `${assetSetSha256}: ${faces.length} complete fonts, ${files.reduce((total, file) => total + file.byteLength, 0)} bytes`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generate();
