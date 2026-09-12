import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  collectCoordinatesBuilderSource,
  createCoordinatesBuilderInput,
  writeCoordinatesBuilderInputSource,
} from './coordinates-builder-input.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('emits a clean, offline-verifiable development builder input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tileflow-builder-input-test-'));
  try {
    const source = await collectCoordinatesBuilderSource(root);
    const descriptor = await writeCoordinatesBuilderInputSource(root);
    assert.deepEqual(descriptor.files, source);
    assert.ok(source.some(({path}) => path === 'sources/native/engine.cpp'));
    assert.ok(source.some(({path}) => path === 'proofs/epsg-9602-static-v1.json'));
    assert.ok(source.some(({path}) => path === 'notices/TILEFLOW-LICENSE'));

    const packageDirectory = join(root, 'packages/coordinates-runtime');
    const {stdout} = await execFileAsync(
      'pnpm',
      ['pack', '--pack-destination', temporary, '--json'],
      {cwd: packageDirectory},
    );
    const packed = JSON.parse(stdout);
    const packageResult = Array.isArray(packed) ? packed[0] : packed;
    const tarball = isAbsolute(packageResult.filename)
      ? packageResult.filename
      : join(temporary, packageResult.filename);
    const output = join(temporary, 'builder-input');
    const result = await createCoordinatesBuilderInput({
      admission: 'development',
      output,
      root,
      runtimePackage: tarball,
    });
    const manifest = JSON.parse(await readFile(join(output, 'builder-input.json'), 'utf8'));

    assert.equal(result.manifest.inputId, manifest.inputId);
    assert.equal(manifest.admission, 'development');
    assert.equal(manifest.runtimePackage.name, '@tileflow/coordinates-runtime');
    assert.equal(manifest.adapter.sourceDigest, descriptor.sourceDigest);
    assert.equal(manifest.adapter.engineBundle.path, 'artifacts/engine.mjs');
    assert.equal(manifest.adapter.verifiers.length, 4);

    const environment = {...process.env};
    delete environment.NODE_TEST_CONTEXT;

    // Standalone bundles must reach their input guard without an installed runtime or node_modules.
    for (const key of [
      'COORDINATES_INSTALLATION_PATH',
      'COORDINATES_DISTRIBUTION_PATH',
      'COORDINATES_CACHE_PATH',
      'COORDINATES_NATIVE_PATH',
      'COORDINATES_RESOURCES_PATH',
    ]) {
      delete environment[key];
    }

    for (const verifier of manifest.adapter.verifiers) {
      await assert.rejects(
        execFileAsync(process.execPath, [join(output, verifier.path)], {
          cwd: temporary,
          env: environment,
        }),
        {
          stderr:
            /Error: (?:An explicit installed proof-bearing execution release is required\.|Explicit native artifact and resources are required\.|Native conformance requires an explicit native artifact and resource directory\.|Runtime conformance requires an explicit development distribution and cache\.)/u,
        },
      );
    }
  } finally {
    await rm(temporary, {force: true, recursive: true});
  }
});
