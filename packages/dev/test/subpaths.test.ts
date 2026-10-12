import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

const packageRoot = new URL('..', import.meta.url).pathname;

test('focused subpaths keep their responsibilities and the package has no root entry', async () => {
  const [artifacts, server, packageJson] = await Promise.all([
    readFile(join(packageRoot, 'src', 'artifacts.ts'), 'utf8'),
    readFile(join(packageRoot, 'src', 'server.ts'), 'utf8'),
    readFile(join(packageRoot, 'package.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(packageJson) as {
    exports?: Record<string, unknown>;
    main?: string;
    types?: string;
  };

  assert.equal(manifest.exports?.['.'], undefined);
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.types, undefined);
  assert.doesNotMatch(artifacts, /preview-html|feature-inspection|three/iu);
  assert.doesNotMatch(
    server,
    /feature-inspection|landmark|from ['"]\.\/preview['"]|from ['"]three['"]/iu,
  );
  assert.match(server, /import\(['"]\.\/preview['"]\)/);
  assert.match(server, /import\(['"]\.\/preview-assets['"]\)/);
  for (const subpath of [
    './artifacts',
    './config',
    './fonts',
    './icons',
    './inspect',
    './preview',
    './server',
    './tilesets',
    './validation',
  ]) {
    assert.ok(manifest.exports?.[subpath], `missing package export ${subpath}`);
  }
});
