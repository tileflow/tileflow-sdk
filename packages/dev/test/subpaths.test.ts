import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

const packageRoot = new URL('..', import.meta.url).pathname;

test('focused subpaths do not route back through the compatibility root', async () => {
  const [artifacts, server, packageJson] = await Promise.all([
    readFile(join(packageRoot, 'src', 'artifacts.ts'), 'utf8'),
    readFile(join(packageRoot, 'src', 'server.ts'), 'utf8'),
    readFile(join(packageRoot, 'package.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(packageJson) as {exports?: Record<string, unknown>};

  assert.doesNotMatch(artifacts, /from ['"]\.\/index['"]/);
  assert.doesNotMatch(artifacts, /preview-html|feature-inspection|three/iu);
  assert.doesNotMatch(server, /from ['"]\.\/index['"]/);
  assert.doesNotMatch(
    server,
    /feature-inspection|landmark|from ['"]\.\/preview['"]|from ['"]three['"]/iu,
  );
  assert.match(server, /import\(['"]\.\/preview['"]\)/);
  assert.match(server, /import\(['"]\.\/preview-assets['"]\)/);
  for (const subpath of [
    './artifacts',
    './config',
    './icons',
    './inspect',
    './preview',
    './server',
    './validation',
  ]) {
    assert.ok(manifest.exports?.[subpath], `missing package export ${subpath}`);
  }
});
