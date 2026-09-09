import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {digest} from '../src/identity';
import {
  type CoordinatesExecutionRelease,
  coordinatesExecutionReleaseSchema,
  type CoordinatesRuntimeArtifact,
  runtimeProvenance,
  verifyRuntimeFiles,
} from '../src/release';

const contents = {
  'bin/coordinates': Buffer.from('engine'),
  'bin/coordinates-native': Buffer.from('native'),
  'catalog/catalog.json': Buffer.from('catalog'),
  'resources/proj.db': Buffer.from('proj database'),
} as const;

test('binds release identity to the complete manifest and rejects delivery fields', () => {
  const release = developmentRelease();
  const parsed = coordinatesExecutionReleaseSchema.parse(release);
  const artifact = parsed.artifacts[0]!;

  assert.equal(parsed.releaseId, release.releaseId);
  assert.deepEqual(runtimeProvenance(parsed, artifact).artifact, {
    digest: digest(artifact),
    id: artifact.id,
  });

  const withLocation = {...release, location: 'outside-release'};
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(withLocation).success, false);

  const withProvider = structuredClone(release);
  const providerArtifact = {...withProvider.artifacts[0]!, provider: 'external'};
  withProvider.artifacts = [providerArtifact];
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(withProvider).success, false);

  const withUrl = structuredClone(release);
  const urlArtifact = {
    ...withUrl.artifacts[0]!,
    assets: [{...withUrl.artifacts[0]!.assets[0]!, url: 'https://example.invalid/archive'}],
  };
  withUrl.artifacts = [urlArtifact];
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(withUrl).success, false);
});

test('rejects duplicate, missing, extra, and unbound release entries', () => {
  const release = developmentRelease();
  const artifact = release.artifacts[0]!;

  const duplicatePath = structuredClone(release);
  duplicatePath.artifacts[0]!.files.push(structuredClone(artifact.files[0]!));
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(duplicatePath).success, false);

  const missingProjDb = structuredClone(release);
  missingProjDb.artifacts[0]!.files = missingProjDb.artifacts[0]!.files.filter(
    (file) => file.path !== 'resources/proj.db',
  );
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(missingProjDb).success, false);

  const extraResource = structuredClone(release);
  extraResource.artifacts[0]!.files.push(file('resources/extra.bin', Buffer.from('extra'), false));
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(extraResource).success, false);

  const unboundAsset = structuredClone(release);
  unboundAsset.artifacts[0]!.assets.push(asset('unbound'));
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(unboundAsset).success, false);
});

test('binds catalog and grid entries to their declared hashes', () => {
  const catalogMismatch = developmentRelease();
  catalogMismatch.execution.catalog.digest = '0'.repeat(64);
  reseal(catalogMismatch);
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(catalogMismatch).success, false);

  const grid = Buffer.from('grid');
  const release = developmentRelease({
    grid: {
      attribution: [{text: 'Agency'}],
      available: true,
      digest: hash(grid),
      license: 'CC-BY-4.0',
      name: 'grid.tif',
    },
    gridFile: grid,
  });
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, true);

  release.artifacts[0]!.files.find((file) => file.path === 'resources/grid.tif')!.sha256 =
    '0'.repeat(64);
  reseal(release);
  assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, false);
});

test('verifies an exact runtime directory and rejects file-system drift', async () => {
  const release = coordinatesExecutionReleaseSchema.parse(developmentRelease());
  const artifact = release.artifacts[0]!;

  for (const mutation of [
    async (root: string) => writeFile(join(root, 'extra'), 'extra'),
    async (root: string) => unlink(join(root, 'resources/proj.db')),
    async (root: string) => {
      await unlink(join(root, 'resources/proj.db'));
      await symlink('catalog.json', join(root, 'resources/proj.db'));
    },
    async (root: string) => chmod(join(root, 'bin/coordinates-native'), 0o644),
  ]) {
    const root = await runtimeDirectory(artifact);
    try {
      await verifyRuntimeFiles(root, artifact);
      await mutation(root);
      await assert.rejects(
        verifyRuntimeFiles(root, artifact),
        /RUNTIME_FILE_(?:INVALID|MISSING|UNDECLARED)/u,
      );
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  }
});

function developmentRelease(
  input: {
    grid?: {
      attribution: {text: string}[];
      available: boolean;
      digest: string;
      license: string;
      name: string;
    };
    gridFile?: Buffer;
  } = {},
): MutableRelease {
  const files = [
    file('bin/coordinates', contents['bin/coordinates'], true),
    file('bin/coordinates-native', contents['bin/coordinates-native'], true),
    file('catalog/catalog.json', contents['catalog/catalog.json'], false),
    file('resources/proj.db', contents['resources/proj.db'], false),
  ];
  const resources = input.grid ? [input.grid] : [];
  if (input.grid && input.gridFile)
    files.push(file(`resources/${input.grid.name}`, input.gridFile, false));
  const release: MutableRelease = {
    schemaVersion: 1,
    protocolVersion: 1,
    releaseId: '',
    execution: {
      engine: {name: 'PROJ', version: '9.8.1'},
      catalog: {
        authority: 'EPSG',
        digest: hash(contents['resources/proj.db']),
        revision: 'v12.029',
      },
      gridSetDigest: digest(resources),
      selectionPolicy: 'strict-v1',
      numericConvention: 'xy-geographic-degrees-crs-linear-v1',
      longitudeReference: 'crs-prime-meridian',
    },
    resources,
    artifacts: [
      {
        id: 'development',
        platform: 'darwin',
        architecture: 'arm64',
        enginePath: 'bin/coordinates',
        nativePath: 'bin/coordinates-native',
        catalogPath: 'catalog/catalog.json',
        resourceDirectory: 'resources',
        assets: [asset('development-archive')],
        files,
        distribution: {kind: 'development'},
      },
    ],
  };
  reseal(release);
  return release;
}

async function runtimeDirectory(artifact: CoordinatesRuntimeArtifact) {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-runtime-'));
  for (const entry of artifact.files) {
    const value = contents[entry.path as keyof typeof contents];
    await mkdir(dirname(join(root, entry.path)), {recursive: true});
    await writeFile(join(root, entry.path), value);
    await chmod(join(root, entry.path), entry.executable ? 0o755 : 0o644);
  }
  return root;
}

function file(path: string, value: Buffer, executable: boolean) {
  return {
    assetId: 'development-archive',
    bytes: value.byteLength,
    executable,
    path,
    sha256: hash(value),
  };
}

function asset(id: string) {
  return {bytes: 1, format: 'tar-gzip' as const, id, sha256: hash(Buffer.from(id))};
}

function reseal(release: MutableRelease) {
  const {releaseId: _releaseId, ...identity} = release;
  release.releaseId = `cr_${digest(identity)}`;
}

function hash(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

type MutableRelease = Omit<CoordinatesExecutionRelease, 'artifacts' | 'resources' | 'releaseId'> & {
  artifacts: Array<{
    architecture: string;
    assets: Array<{bytes: number; format: 'tar-gzip'; id: string; sha256: string}>;
    catalogPath: string;
    distribution: {kind: 'development'};
    enginePath: string;
    files: Array<{
      assetId: string;
      bytes: number;
      executable: boolean;
      path: string;
      sha256: string;
    }>;
    id: string;
    nativePath: string;
    platform: string;
    resourceDirectory: string;
  }>;
  releaseId: string;
  resources: Array<{
    attribution: {text: string}[];
    available: boolean;
    digest: string;
    license: string;
    name: string;
  }>;
};
