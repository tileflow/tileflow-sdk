import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {arch, platform, tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {digest} from '../src/identity';
import {coordinatesExecutionReleaseSchema} from '../src/release';

const files = {
  'bin/coordinates': Buffer.from('engine'),
  'bin/coordinates-native': Buffer.from('native'),
  'catalog/catalog.json': Buffer.from('catalog'),
  'resources/proj.db': Buffer.from('proj database'),
} as const;

export async function createSetupFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-setup-'));
  const source = join(directory, 'source');
  const cache = join(directory, 'cache');
  await mkdir(source);
  const assets = createAssets();
  const release = createRelease(assets);
  const locations = {
    [release.artifacts[0]!.id]: {
      [assets[0]!.id]: assets[0]!.location,
      [assets[1]!.id]: assets[1]!.location,
    },
  };
  await writeFile(join(source, assets[0]!.location), assets[0]!.body);
  await writeFile(join(source, assets[1]!.location), assets[1]!.body);
  await writeDistribution(source, release, locations);
  return {
    assets,
    cache,
    close: () => rm(directory, {force: true, recursive: true}),
    directory,
    locations,
    release,
    source,
  };
}

export function distribution(
  release: ReturnType<typeof createRelease>,
  locations: Record<string, Record<string, string>>,
) {
  return {schemaVersion: 1 as const, release, locations};
}

export async function writeDistribution(
  source: string,
  release: ReturnType<typeof createRelease>,
  locations: Record<string, Record<string, string>>,
) {
  await writeFile(
    join(source, 'distribution.json'),
    `${JSON.stringify(distribution(release, locations))}\n`,
  );
}

export function alternateRelease(release: ReturnType<typeof createRelease>) {
  const alternative = structuredClone(release);
  alternative.execution.selectionPolicy = 'fixture-policy-v2';
  reseal(alternative);
  return coordinatesExecutionReleaseSchema.parse(alternative);
}

export async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function createRelease(assets: ReturnType<typeof createAssets>) {
  const artifactId = 'fixture-runtime';
  const release = {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    releaseId: '',
    execution: {
      engine: {name: 'PROJ' as const, version: '9.8.1'},
      catalog: {
        authority: 'EPSG' as const,
        digest: hash(files['resources/proj.db']),
        revision: 'v12.029',
      },
      gridSetDigest: digest([]),
      selectionPolicy: 'fixture-policy-v1',
      numericConvention: 'xy-geographic-degrees-crs-linear-v1' as const,
      longitudeReference: 'crs-prime-meridian' as const,
    },
    resources: [],
    artifacts: [
      {
        id: artifactId,
        platform: platform(),
        architecture: arch(),
        enginePath: 'bin/coordinates',
        nativePath: 'bin/coordinates-native',
        catalogPath: 'catalog/catalog.json',
        resourceDirectory: 'resources',
        assets: assets.map(({body: _body, location: _location, ...asset}) => asset),
        files: [
          file('bin/coordinates', 'engine-native', true),
          file('bin/coordinates-native', 'engine-native', true),
          file('catalog/catalog.json', 'catalog-data', false),
          file('resources/proj.db', 'catalog-data', false),
        ],
        distribution: {kind: 'development' as const},
      },
    ],
  };
  reseal(release);
  return coordinatesExecutionReleaseSchema.parse(release);
}

function createAssets() {
  const engineNative = gzipSync(
    tar([
      {name: 'bin/', type: '5'},
      {data: files['bin/coordinates'], mode: 0o755, name: 'bin/coordinates'},
      {data: files['bin/coordinates-native'], mode: 0o755, name: 'bin/coordinates-native'},
    ]),
  );
  const catalogData = gzipSync(
    tar([
      {name: 'catalog/', type: '5'},
      {data: files['catalog/catalog.json'], name: 'catalog/catalog.json'},
      {name: 'resources/', type: '5'},
      {data: files['resources/proj.db'], name: 'resources/proj.db'},
    ]),
  );
  return [
    asset('engine-native', 'engine-native.tar.gz', engineNative),
    asset('catalog-data', 'catalog-data.tar.gz', catalogData),
  ];
}

function asset(id: string, location: string, body: Buffer) {
  return {
    id,
    location,
    body,
    bytes: body.byteLength,
    sha256: hash(body),
    format: 'tar-gzip' as const,
  };
}

function file(path: keyof typeof files, assetId: string, executable: boolean) {
  const body = files[path];
  return {assetId, path, executable, bytes: body.byteLength, sha256: hash(body)};
}

function reseal(release: {releaseId: string}) {
  const {releaseId: _releaseId, ...identity} = release as typeof release & Record<string, unknown>;
  release.releaseId = `cr_${digest(identity)}`;
}

type Entry = Readonly<{data?: Uint8Array; mode?: number; name: string; type?: '0' | '5'}>;

function tar(entries: readonly Entry[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ? Buffer.from(entry.data) : Buffer.alloc(0);
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, entry.mode ?? (entry.type === '5' ? 0o755 : 0o644));
    writeOctal(header, 124, 12, data.byteLength);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    writeString(header, 257, 6, 'ustar');
    writeString(header, 263, 2, '00');
    header.fill(0x20, 148, 156);
    writeOctal(
      header,
      148,
      8,
      header.reduce((sum, byte) => sum + byte, 0),
    );
    blocks.push(header, data, Buffer.alloc((512 - (data.byteLength % 512)) % 512));
  }
  blocks.push(Buffer.alloc(512), Buffer.alloc(512));
  return Buffer.concat(blocks);
}

function writeString(target: Buffer, offset: number, length: number, value: string) {
  Buffer.from(value).copy(target, offset, 0, length);
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  writeString(target, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function hash(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
