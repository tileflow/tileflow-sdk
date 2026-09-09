import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {CoordinatesContractError} from '@tileflow/coordinates/contract';
import {createLocalCoordinates} from '../src/local';
import {
  CoordinatesRuntimeProfileError,
  nativeRuntimeProfile,
  verifyQualifiedRuntimeProfile,
} from '../src/qualification';
import {createCoordinatesSetup} from '../src/setup';
import {createSetupFixture} from './setup-fixture';

test('the public loader never admits a development release without explicit opt-in', async () => {
  const fixture = await createSetupFixture();
  const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
  try {
    const installed = await setup({
      source: fixture.source,
      cacheDirectory: fixture.cache,
      allowDevelopment: true,
    });
    await assert.rejects(
      createLocalCoordinates({directory: installed.directory}),
      (error: unknown) =>
        error instanceof CoordinatesContractError &&
        error.toJSON().error.reason === 'RELEASE_UNAVAILABLE',
    );
  } finally {
    await fixture.close();
  }
});

test('the public loader rejects altered artifact, proof, and license inventories before spawning', async () => {
  for (const alter of [
    (release: any) => {
      release.artifacts[0].files[0].sha256 = 'f'.repeat(64);
    },
    (release: any) => {
      release.artifacts[0].files.push({
        path: 'proofs/unregistered.json',
        bytes: 1,
        sha256: 'f'.repeat(64),
        executable: false,
        assetId: release.artifacts[0].assets[0].id,
      });
    },
    (release: any) => {
      release.resources.push({
        name: 'licensed-grid.tif',
        available: true,
        digest: 'f'.repeat(64),
        license: null,
        attribution: [],
      });
    },
  ]) {
    const fixture = await createSetupFixture();
    const setup = createCoordinatesSetup({validateInstalled: async () => undefined});
    try {
      const installed = await setup({
        source: fixture.source,
        cacheDirectory: fixture.cache,
        allowDevelopment: true,
      });
      const release = structuredClone(fixture.release);
      alter(release);
      await writeFile(join(installed.directory, 'release.json'), JSON.stringify(release));
      await assert.rejects(
        createLocalCoordinates({directory: installed.directory, allowDevelopment: true}),
        (error: unknown) =>
          error instanceof CoordinatesContractError &&
          error.toJSON().error.reason === 'RELEASE_INTEGRITY_FAILED',
      );
    } finally {
      await fixture.close();
    }
  }
});

test('the runtime-profile boundary rejects a native-qualified artifact outside the exact profile', async () => {
  const artifact = {
    distribution: {
      kind: 'native-qualified',
      qualification: {runtimeProfile: {...nativeRuntimeProfile, platform: 'unsupported'}},
    },
  };
  await assert.rejects(
    verifyQualifiedRuntimeProfile(artifact as never),
    CoordinatesRuntimeProfileError,
  );
});
