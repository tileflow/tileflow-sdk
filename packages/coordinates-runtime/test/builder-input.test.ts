import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {
  CoordinatesBuilderInputError,
  coordinatesBuilderInputSchema,
  coordinatesBuilderInputSourceSchema,
  verifyCoordinatesBuilderInput,
} from '../src/builder-input';
import {digest} from '../src/identity';
import {nativeRuntimeProfile} from '../src/qualification';

test('verifies an offline builder input and the exact installed runtime package', async () => {
  const fixture = await createFixture();
  try {
    const input = await verifyCoordinatesBuilderInput({
      directory: fixture.directory,
      runtimePackageDirectory: fixture.runtimePackageDirectory,
    });

    assert.equal(input.manifest.inputId, fixture.manifest.inputId);
    assert.equal(input.manifest.admission, 'native-qualified-eligible');
    assert.equal(input.paths.nativeSource, join(fixture.directory, 'sources/native/engine.cpp'));
  } finally {
    await fixture.close();
  }
});

test('rejects changed source, proof, toolchain evidence, and file inventory before use', async () => {
  for (const mutate of [
    (fixture: Fixture) =>
      writeFile(join(fixture.directory, 'sources/native/engine.cpp'), 'changed'),
    (fixture: Fixture) =>
      writeFile(join(fixture.directory, 'proofs/epsg-9602-static-v1.json'), '{}'),
    (fixture: Fixture) =>
      writeFile(join(fixture.directory, 'verification.json'), '{"toolchain":"changed"}\n'),
    (fixture: Fixture) => writeFile(join(fixture.directory, 'runtime-package.tgz'), 'changed'),
  ]) {
    const fixture = await createFixture();
    try {
      await mutate(fixture);
      await assert.rejects(
        verifyCoordinatesBuilderInput({
          directory: fixture.directory,
          runtimePackageDirectory: fixture.runtimePackageDirectory,
        }),
        (error: unknown) =>
          error instanceof CoordinatesBuilderInputError &&
          error.code === 'BUILDER_INPUT_FILE_INVALID',
      );
    } finally {
      await fixture.close();
    }
  }
});

test('rejects an installed runtime package whose source descriptor or bytes do not match', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      join(fixture.runtimePackageDirectory, 'dist/builder-input-source.json'),
      '{}\n',
    );
    await assert.rejects(
      verifyCoordinatesBuilderInput({
        directory: fixture.directory,
        runtimePackageDirectory: fixture.runtimePackageDirectory,
      }),
      (error: unknown) =>
        error instanceof CoordinatesBuilderInputError &&
        error.code === 'BUILDER_INPUT_RUNTIME_PACKAGE_MISMATCH',
    );
  } finally {
    await fixture.close();
  }
});

test('rejects missing or unknown builder-input fields', () => {
  const source = sourceDescriptor([{path: 'sources/native/engine.cpp', sha256: '4'.repeat(64)}]);
  const candidate = {
    schemaVersion: 1,
    kind: 'tileflow-coordinates-builder-input',
    inputId: 'cbi_' + '0'.repeat(64),
    admission: 'development',
    runtimePackage: {
      archive: file('runtime-package.tgz', Buffer.from('runtime-package')),
      files: [],
      integrity: integrity(Buffer.from('runtime-package')),
      name: '@tileflow/coordinates-runtime',
      sourceDescriptor: {digest: source.sourceDigest, path: 'dist/builder-input-source.json'},
      version: '0.0.0-development',
    },
    adapter: {
      buildConfiguration: {path: 'sources/tsup.engine.config.ts', sha256: '1'.repeat(64)},
      engineBundle: {path: 'artifacts/engine.mjs', sha256: '5'.repeat(64)},
      files: [],
      nativeSource: {path: 'sources/native/engine.cpp', sha256: '2'.repeat(64)},
      sourceDigest: source.sourceDigest,
      sourceRevision: 'a'.repeat(40),
      verifiers: [
        {path: 'artifacts/verifiers/analytical-runtime.conformance.mjs', sha256: '6'.repeat(64)},
        {path: 'artifacts/verifiers/axis.conformance.mjs', sha256: '7'.repeat(64)},
        {path: 'artifacts/verifiers/native.conformance.mjs', sha256: '8'.repeat(64)},
        {path: 'artifacts/verifiers/runtime.conformance.mjs', sha256: '9'.repeat(64)},
      ],
    },
    proofs: [],
    runtimeProfile: nativeRuntimeProfile,
    provenance: {
      toolchain: {nodeVersion: '24.0.0', tsupVersion: '8.5.1'},
      verificationReport: {path: 'verification.json', sha256: '3'.repeat(64)},
    },
    files: [file('runtime-package.tgz', Buffer.from('runtime-package'))],
  };

  assert.equal(coordinatesBuilderInputSchema.safeParse(candidate).success, false);
  assert.equal(
    coordinatesBuilderInputSchema.safeParse({...candidate, unexpected: true}).success,
    false,
  );
});

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-builder-input-'));
  const runtimePackageDirectory = await mkdtemp(join(tmpdir(), 'tileflow-runtime-package-'));
  const sourceContents = new Map([
    ['sources/native/engine.cpp', Buffer.from('native source')],
    ['sources/tsup.engine.config.ts', Buffer.from('export default {};\n')],
    ['proofs/epsg-9602-static-v1.json', Buffer.from('{"schemaVersion":1}\n')],
  ]);
  const sourceFiles = [
    file('sources/native/engine.cpp', Buffer.from('native source')),
    file('sources/tsup.engine.config.ts', Buffer.from('export default {};\n')),
    file('proofs/epsg-9602-static-v1.json', Buffer.from('{"schemaVersion":1}\n')),
  ].sort(comparePath);
  const source = sourceDescriptor(
    sourceFiles.map(({bytes: _bytes, executable: _executable, ...entry}) => entry),
  );
  const descriptor = Buffer.from(`${JSON.stringify(source)}\n`);
  const runtimePackageContents = new Map([
    [
      'package.json',
      Buffer.from('{"name":"@tileflow/coordinates-runtime","version":"0.1.0-alpha.1"}\n'),
    ],
    ['dist/builder-input-source.json', descriptor],
  ]);
  const runtimePackageFiles = [
    file(
      'package.json',
      Buffer.from('{"name":"@tileflow/coordinates-runtime","version":"0.1.0-alpha.1"}\n'),
    ),
    file('dist/builder-input-source.json', descriptor),
  ].sort(comparePath);
  const archive = Buffer.from('runtime-package');
  const verification = Buffer.from('{"schemaVersion":1,"ok":true}\n');
  const artifacts = new Map([
    ['artifacts/engine.mjs', Buffer.from('engine bundle')],
    ['artifacts/verifiers/analytical-runtime.conformance.mjs', Buffer.from('analytical verifier')],
    ['artifacts/verifiers/axis.conformance.mjs', Buffer.from('axis verifier')],
    ['artifacts/verifiers/native.conformance.mjs', Buffer.from('native verifier')],
    ['artifacts/verifiers/runtime.conformance.mjs', Buffer.from('runtime verifier')],
  ]);
  const artifactFiles = [...artifacts].map(([path, value]) => file(path, value)).sort(comparePath);
  const files = [
    ...sourceFiles,
    ...artifactFiles,
    file('runtime-package.tgz', archive),
    file('verification.json', verification),
  ].sort(comparePath);
  const nativeSource = sourceFiles.find((entry) => entry.path === 'sources/native/engine.cpp')!;
  const buildConfiguration = sourceFiles.find(
    (entry) => entry.path === 'sources/tsup.engine.config.ts',
  )!;
  const proof = sourceFiles.find((entry) => entry.path === 'proofs/epsg-9602-static-v1.json')!;
  const engineBundle = artifactFiles.find((entry) => entry.path === 'artifacts/engine.mjs')!;
  const verifiers = artifactFiles
    .filter((entry) => entry.path.startsWith('artifacts/verifiers/'))
    .map(({path, sha256}) => ({path, sha256}));
  const manifest = seal({
    schemaVersion: 1 as const,
    kind: 'tileflow-coordinates-builder-input' as const,
    admission: 'native-qualified-eligible' as const,
    runtimePackage: {
      archive: file('runtime-package.tgz', archive),
      files: runtimePackageFiles,
      integrity: integrity(archive),
      name: '@tileflow/coordinates-runtime' as const,
      sourceDescriptor: {digest: source.sourceDigest, path: 'dist/builder-input-source.json'},
      version: '0.1.0-alpha.1',
    },
    adapter: {
      buildConfiguration: {path: buildConfiguration.path, sha256: buildConfiguration.sha256},
      engineBundle: {path: engineBundle.path, sha256: engineBundle.sha256},
      files: source.files,
      nativeSource: {path: nativeSource.path, sha256: nativeSource.sha256},
      sourceDigest: source.sourceDigest,
      sourceRevision: 'a'.repeat(40),
      verifiers,
    },
    proofs: [
      {
        path: proof.path,
        sha256: proof.sha256,
      },
    ],
    runtimeProfile: nativeRuntimeProfile,
    provenance: {
      toolchain: {nodeVersion: '24.0.0', tsupVersion: '8.5.1'},
      verificationReport: {path: 'verification.json', sha256: hash(verification)},
    },
    files,
  });
  await writeInput(
    directory,
    files,
    new Map([
      ...sourceContents,
      ...artifacts,
      ['runtime-package.tgz', archive],
      ['verification.json', verification],
    ]),
    manifest,
  );
  await writeInput(runtimePackageDirectory, runtimePackageFiles, runtimePackageContents);

  return {
    close: async () => {
      await rm(directory, {force: true, recursive: true});
      await rm(runtimePackageDirectory, {force: true, recursive: true});
    },
    directory,
    manifest,
    runtimePackageDirectory,
  };
}

async function writeInput(
  root: string,
  files: Array<{bytes: number; executable: boolean; path: string; sha256: string}>,
  contents: ReadonlyMap<string, Buffer>,
  manifest?: unknown,
) {
  for (const entry of files) {
    const value = contents.get(entry.path);
    await mkdir(dirname(join(root, entry.path)), {recursive: true});
    await writeFile(join(root, entry.path), value!);
  }
  if (manifest) await writeFile(join(root, 'builder-input.json'), `${JSON.stringify(manifest)}\n`);
}

function sourceDescriptor(files: Array<{path: string; sha256: string}>) {
  const ordered = [...files].sort(comparePath);
  return coordinatesBuilderInputSourceSchema.parse({
    schemaVersion: 1,
    kind: 'tileflow-coordinates-builder-source',
    files: ordered,
    sourceDigest: digest({
      kind: 'tileflow-coordinates-builder-source',
      schemaVersion: 1,
      files: ordered,
    }),
  });
}

function seal(value: Record<string, unknown>) {
  return coordinatesBuilderInputSchema.parse({...value, inputId: `cbi_${digest(value)}`});
}

function file(path: string, value: Buffer, executable = false) {
  return {bytes: value.byteLength, executable, path, sha256: hash(value)};
}

function hash(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function integrity(value: Buffer) {
  return `sha512-${createHash('sha512').update(value).digest('base64')}`;
}

function comparePath(left: {path: string}, right: {path: string}) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

type Fixture = {
  close: () => Promise<void>;
  directory: string;
  manifest: {inputId: string};
  runtimePackageDirectory: string;
};
