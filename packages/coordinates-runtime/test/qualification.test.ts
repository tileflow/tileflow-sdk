import assert from 'node:assert/strict';
import {test} from 'node:test';
import {digest} from '../src/identity';
import {
  coordinatesNativeQualificationSchema,
  coordinatesQualificationSubject,
  nativeRuntimeProfile,
  runtimeProfileMatches,
} from '../src/qualification';
import {coordinatesExecutionReleaseSchema} from '../src/release';
import {createSetupFixture} from './setup-fixture';

test('qualification binds tested bytes, execution semantics, profile and evidence without a release cycle', async () => {
  const fixture = await createSetupFixture();
  try {
    const release = structuredClone(fixture.release);
    const artifact = release.artifacts[0];
    artifact.platform = 'linux';
    artifact.architecture = 'x64';
    const subjectDigest = coordinatesQualificationSubject(release, artifact);
    const qualification = qualified(subjectDigest);
    artifact.distribution = {kind: 'native-qualified', qualification};
    seal(release);
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, true);
    assert.notEqual(release.releaseId, fixture.release.releaseId);
    assert.equal(coordinatesQualificationSubject(release, artifact), subjectDigest);
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(fixture.release).success, true);

    for (const change of [
      () => {
        artifact.files[0].sha256 = '1'.repeat(64);
      },
      () => {
        artifact.assets[0].sha256 = '2'.repeat(64);
      },
      () => {
        release.execution.selectionPolicy = 'changed-policy';
      },
    ]) {
      const saved = structuredClone(release);
      change();
      seal(release);
      assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, false);
      Object.assign(release, saved);
      // Preserve the reference used by the mutations.
      Object.assign(artifact, saved.artifacts[0]);
      release.artifacts[0] = artifact;
    }
  } finally {
    await fixture.close();
  }
});

test('qualification rejects missing evidence, provider fields, mismatched identities and unsupported profiles', () => {
  const qualification = qualified('a'.repeat(64));
  assert.equal(coordinatesNativeQualificationSchema.safeParse(qualification).success, true);
  for (const mutate of [
    (value: any) => {
      value.account = '123456789012';
    },
    (value: any) => {
      value.builderInput.id = 'cbi_' + '0'.repeat(64);
    },
    (value: any) => {
      value.runtimeProfile.region = 'example';
    },
    (value: any) => {
      value.evidence.checks.pop();
    },
    (value: any) => {
      value.evidence.checks[0].failed = 1;
    },
    (value: any) => {
      value.evidence.checks[1].skipped = 1;
    },
    (value: any) => {
      value.runtimeProfile.libcVersion = '2.40';
    },
    (value: any) => {
      value.policy = 'unrestricted';
    },
    (value: any) => {
      value.id = 'nq_' + 'b'.repeat(64);
    },
  ]) {
    const candidate = structuredClone(qualification);
    mutate(candidate);
    assert.equal(coordinatesNativeQualificationSchema.safeParse(candidate).success, false);
  }
});

test('runtime-profile matching does not infer support for another OS, ABI or Node major', () => {
  const observed = {
    platform: 'linux',
    architecture: 'x64',
    distribution: 'debian',
    distributionVersion: '12',
    libcVersion: '2.36',
    nodeMajor: 24,
  };
  assert.equal(runtimeProfileMatches(nativeRuntimeProfile, observed), true);
  for (const patch of [
    {platform: 'darwin'},
    {architecture: 'arm64'},
    {distribution: 'almalinux'},
    {distributionVersion: '13'},
    {libcVersion: '2.40'},
    {nodeMajor: 22},
    {libcVersion: null},
  ])
    assert.equal(runtimeProfileMatches(nativeRuntimeProfile, {...observed, ...patch}), false);
});

test('Linux qualification cannot qualify macOS or a development artifact by configuration', async () => {
  const fixture = await createSetupFixture();
  try {
    const release = structuredClone(fixture.release);
    const artifact = release.artifacts[0];
    const qualification = qualified(coordinatesQualificationSubject(release, artifact));
    artifact.distribution = {kind: 'development', qualification} as any;
    seal(release);
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, false);
    artifact.platform = 'darwin';
    artifact.architecture = 'arm64';
    artifact.distribution = {
      kind: 'native-qualified',
      qualification: qualified(coordinatesQualificationSubject(release, artifact)),
    };
    seal(release);
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(release).success, false);
  } finally {
    await fixture.close();
  }
});

export function qualified(subjectDigest: string) {
  const value = {
    schemaVersion: 1 as const,
    policy: 'native-offline-v1' as const,
    subjectDigest,
    builderInput: {
      id: 'cbi_' + 'a'.repeat(64),
      sourceDigest: 'b'.repeat(64),
      runtimePackage: {
        integrity:
          'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        name: '@tileflow/coordinates-runtime' as const,
        version: '0.1.0-alpha.1',
      },
    },
    runtimeProfile: nativeRuntimeProfile,
    toolchain: {
      compiler: {name: 'gcc' as const, version: '12.2.0'},
      nativeSourceDigest: 'b'.repeat(64),
      sourceArchivesDigest: 'c'.repeat(64),
      staticLinkInputsDigest: 'd'.repeat(64),
      buildEnvironmentDigest: 'e'.repeat(64),
      nodeVersion: '24.19.0',
    },
    evidence: {
      executionMode: 'emulated' as const,
      network: 'disabled' as const,
      readOnlyPayload: true as const,
      checks: [
        check('inventory-integrity', 1),
        check('license-closure', 1),
        check('native-conformance', 15),
        check('installed-conformance', 8),
        check('offline-execution', 1),
      ],
    },
  };
  return coordinatesNativeQualificationSchema.parse({...value, id: `nq_${digest(value)}`});
}

function check(id: string, passed: number) {
  return {
    id,
    verifierDigest: 'f'.repeat(64),
    reportDigest: 'a'.repeat(64),
    passed,
    failed: 0,
    skipped: 0,
  };
}

function seal(release: {releaseId: string}) {
  const {releaseId: _releaseId, ...identity} = release;
  release.releaseId = `cr_${digest(identity)}`;
}
