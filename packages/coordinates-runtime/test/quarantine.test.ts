import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {arch, platform, tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {digest} from '../src/identity';
import {coordinatesExecutionReleaseSchema} from '../src/release';
import {createCoordinatesSetup} from '../src/setup';

const jxaSetQuarantine = `
  ObjC.import('Foundation');
  const path = $.NSProcessInfo.processInfo.environment.objectForKey('TILEFLOW_TEST_QUARANTINE_PATH');
  const url = $.NSURL.fileURLWithPath(path);
  const error = $();
  const properties = $.NSMutableDictionary.alloc.init;
  properties.setObjectForKey($('LSQuarantineTypeWebDownload'), $('LSQuarantineType'));
  properties.setObjectForKey($('Tileflow'), $('LSQuarantineAgentName'));
  if (!url.setResourceValueForKeyError(properties, $.NSURLQuarantinePropertiesKey, error)) throw new Error('set failed');
`;

test(
  'offline DMG installation retains quarantine from source through cache and staged payload',
  {skip: process.platform !== 'darwin'},
  async () => {
    const fixture = await createDmgFixture();
    const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
    try {
      await markQuarantined(fixture.asset.path);
      assert.equal(await quarantined(fixture.asset.path), true);
      const result = await setup({
        source: fixture.source,
        cacheDirectory: fixture.cache,
        allowDevelopment: true,
      });
      const cached = join(fixture.cache, 'artifacts', `${fixture.asset.sha256}.asset`);
      assert.equal(await quarantined(cached), true);
      assert.equal(await quarantined(join(result.directory, 'payload/resources/proj.db')), true);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'remote DMG installation marks a verified cache asset before staging its payload',
  {skip: process.platform !== 'darwin'},
  async () => {
    const fixture = await createDmgFixture();
    const sourceDocument = JSON.parse(
      await readFile(join(fixture.source, 'distribution.json'), 'utf8'),
    );
    const artifact = fixture.release.artifacts[0]!;
    const document = {
      ...sourceDocument,
      locations: {[artifact.id]: {[fixture.asset.id]: 'https://delivery.example/runtime.dmg'}},
    };
    const setup = createCoordinatesSetup({
      fetch: async (url) => {
        const href = String(url);
        if (href.endsWith('/distribution.json')) return Response.json(document);
        if (href === 'https://delivery.example/runtime.dmg')
          return new Response(await readFile(fixture.asset.path));
        return new Response(null, {status: 404});
      },
      validateInstalled: async () => undefined,
    });
    try {
      const result = await setup({
        source: 'https://delivery.example/distribution.json',
        cacheDirectory: fixture.cache,
        allowDevelopment: true,
      });
      const cached = join(fixture.cache, 'artifacts', `${fixture.asset.sha256}.asset`);
      assert.equal(await quarantined(cached), true);
      assert.equal(await quarantined(join(result.directory, 'payload/resources/proj.db')), true);
    } finally {
      await fixture.close();
    }
  },
);

async function createDmgFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-quarantine-test-'));
  const source = join(directory, 'source');
  const cache = join(directory, 'cache');
  const image = join(directory, 'image');
  const payload = join(image, 'payload');
  const contents = {
    'bin/coordinates': Buffer.from('engine'),
    'bin/coordinates-native': Buffer.from('native'),
    'catalog/catalog.json': Buffer.from('catalog'),
    'resources/proj.db': Buffer.from('proj database'),
  } as const;
  await mkdir(join(payload, 'bin'), {recursive: true});
  await mkdir(join(payload, 'catalog'), {recursive: true});
  await mkdir(join(payload, 'resources'), {recursive: true});
  for (const [path, body] of Object.entries(contents)) await writeFile(join(payload, path), body);
  await chmod(join(payload, 'bin/coordinates'), 0o755);
  await chmod(join(payload, 'bin/coordinates-native'), 0o755);
  await mkdir(source);
  const assetPath = join(source, 'runtime.dmg');
  await command('/usr/bin/hdiutil', [
    'create',
    '-quiet',
    '-volname',
    'TileflowQuarantineTest',
    '-srcfolder',
    image,
    '-format',
    'UDZO',
    '-ov',
    assetPath,
  ]);
  const asset = {
    id: 'runtime-dmg',
    path: assetPath,
    format: 'dmg' as const,
    bytes: (await readFile(assetPath)).byteLength,
    sha256: hash(await readFile(assetPath)),
  };
  const artifact = {
    id: 'fixture-runtime',
    platform: platform(),
    architecture: arch(),
    enginePath: 'bin/coordinates',
    nativePath: 'bin/coordinates-native',
    catalogPath: 'catalog/catalog.json',
    resourceDirectory: 'resources',
    assets: [{id: asset.id, format: asset.format, bytes: asset.bytes, sha256: asset.sha256}],
    files: Object.entries(contents).map(([path, body]) => ({
      assetId: asset.id,
      path,
      bytes: body.byteLength,
      sha256: hash(body),
      executable: path.startsWith('bin/'),
    })),
    distribution: {kind: 'development' as const},
  };
  const release = {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    releaseId: '',
    execution: {
      engine: {name: 'PROJ' as const, version: '9.8.1'},
      catalog: {
        authority: 'EPSG' as const,
        digest: hash(contents['resources/proj.db']),
        revision: 'v12.029',
      },
      gridSetDigest: digest([]),
      selectionPolicy: 'fixture-policy-v1',
      numericConvention: 'xy-geographic-degrees-crs-linear-v1' as const,
      longitudeReference: 'crs-prime-meridian' as const,
    },
    resources: [],
    artifacts: [artifact],
  };
  const {releaseId: _releaseId, ...identity} = release;
  release.releaseId = `cr_${digest(identity)}`;
  const parsed = coordinatesExecutionReleaseSchema.parse(release);
  await writeFile(
    join(source, 'distribution.json'),
    `${JSON.stringify({schemaVersion: 1, release: parsed, locations: {[artifact.id]: {[asset.id]: 'runtime.dmg'}}})}\n`,
  );
  return {
    asset,
    cache,
    close: () => rm(directory, {force: true, recursive: true}),
    release: parsed,
    source,
  };
}

async function markQuarantined(path: string) {
  await command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxaSetQuarantine], {
    ...process.env,
    TILEFLOW_TEST_QUARANTINE_PATH: path,
  });
}

async function quarantined(path: string) {
  try {
    await command('/usr/bin/xattr', ['-p', 'com.apple.quarantine', path]);
    return true;
  } catch {
    return false;
  }
}

function command(file: string, args: readonly string[], env = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {env, stdio: 'ignore'});
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`${file} failed`))));
  });
}

function hash(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
