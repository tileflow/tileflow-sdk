import {readFile} from 'node:fs/promises';
import {arch, platform} from 'node:os';
import {z} from 'zod';
import {digest} from './identity';
import type {CoordinatesExecutionRelease, CoordinatesRuntimeArtifact} from './release';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().regex(/^\d+\.\d+\.\d+$/u);
const integrity = z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);

/** The first qualified ABI profile; other profiles need their own verified evidence. */
export const nativeRuntimeProfile = Object.freeze({
  id: 'linux-x64-debian12-node24-v1',
  platform: 'linux',
  architecture: 'x64',
  distribution: 'debian',
  distributionVersion: '12',
  libcVersion: '2.36',
  nodeMajor: 24,
} as const);

const profileSchema = z
  .object({
    id: z.literal(nativeRuntimeProfile.id),
    platform: z.literal('linux'),
    architecture: z.literal('x64'),
    distribution: z.literal('debian'),
    distributionVersion: z.literal('12'),
    libcVersion: z.literal('2.36'),
    nodeMajor: z.literal(24),
  })
  .strict();

const check = <T extends string>(id: T, minimum: number) =>
  z
    .object({
      id: z.literal(id),
      verifierDigest: sha256,
      reportDigest: sha256,
      passed: z.number().int().min(minimum).max(100000),
      failed: z.literal(0),
      skipped: z.literal(0),
    })
    .strict();

export const coordinatesNativeQualificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^nq_[a-f0-9]{64}$/u),
    policy: z.literal('native-offline-v1'),
    subjectDigest: sha256,
    builderInput: z
      .object({
        id: z.string().regex(/^cbi_[a-f0-9]{64}$/u),
        sourceDigest: sha256,
        runtimePackage: z
          .object({
            integrity,
            name: z.literal('@tileflow/coordinates-runtime'),
            version: z.string().regex(/^\d+\.\d+\.\d+-alpha\.\d+$/u),
          })
          .strict(),
      })
      .strict(),
    runtimeProfile: profileSchema,
    toolchain: z
      .object({
        compiler: z.object({name: z.literal('gcc'), version}).strict(),
        nativeSourceDigest: sha256,
        sourceArchivesDigest: sha256,
        staticLinkInputsDigest: sha256,
        buildEnvironmentDigest: sha256,
        nodeVersion: version.refine((value) => value.startsWith('24.')),
      })
      .strict(),
    evidence: z
      .object({
        executionMode: z.enum(['native', 'emulated']),
        network: z.literal('disabled'),
        readOnlyPayload: z.literal(true),
        checks: z.tuple([
          check('inventory-integrity', 1),
          check('license-closure', 1),
          check('native-conformance', 15),
          check('installed-conformance', 8),
          check('offline-execution', 1),
        ]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const {id, ...record} = value;
    if (id !== `nq_${digest(record)}`)
      context.addIssue({code: 'custom', message: 'Qualification identity mismatch'});
  });

export type CoordinatesNativeQualification = z.infer<typeof coordinatesNativeQualificationSchema>;

/**
 * Bind the tested artifact and execution inputs, excluding the later qualification and release ID.
 * Evidence lives in the outer manifest, so archive bytes do not depend on this digest.
 */
export function coordinatesQualificationSubject(
  release: Pick<
    CoordinatesExecutionRelease,
    'schemaVersion' | 'protocolVersion' | 'execution' | 'resources'
  >,
  artifact: CoordinatesRuntimeArtifact,
): string {
  const {distribution: _distribution, ...content} = artifact;
  return digest({
    schemaVersion: release.schemaVersion,
    protocolVersion: release.protocolVersion,
    execution: release.execution,
    resources: release.resources,
    artifact: content,
  });
}

type ObservedProfile = {
  platform: string;
  architecture: string;
  distribution: string | null;
  distributionVersion: string | null;
  libcVersion: string | null;
  nodeMajor: number;
};

export function runtimeProfileMatches(
  expected: CoordinatesNativeQualification['runtimeProfile'],
  observed: ObservedProfile,
): boolean {
  const {id: _id, ...fields} = expected;
  return Object.entries(fields).every(
    ([key, value]) => observed[key as keyof ObservedProfile] === value,
  );
}

export class CoordinatesRuntimeProfileError extends Error {
  constructor(readonly profileId: string) {
    super('RUNTIME_PROFILE_UNSUPPORTED');
  }
}

/** Shared by setup and local/Hosted loading; there is no environment or caller override. */
export async function verifyQualifiedRuntimeProfile(
  artifact: CoordinatesRuntimeArtifact,
): Promise<void> {
  if (artifact.distribution.kind !== 'native-qualified') return;
  let osRelease = '';
  try {
    osRelease = await readFile('/etc/os-release', 'utf8');
  } catch {
    // Missing profile facts cannot establish support.
  }
  const value = (name: string) => {
    const match = osRelease.match(new RegExp(`^${name}=(?:"([^"\\n]*)"|([^\\n]*))$`, 'mu'));
    return match?.[1] ?? match?.[2] ?? null;
  };
  const report = process.report?.getReport() as
    | {header?: {glibcVersionRuntime?: string}}
    | undefined;
  const observed = {
    platform: platform(),
    architecture: arch(),
    distribution: value('ID'),
    distributionVersion: value('VERSION_ID'),
    libcVersion: report?.header?.glibcVersionRuntime ?? null,
    nodeMajor: Number(process.versions.node.split('.')[0]),
  };
  const profile = artifact.distribution.qualification.runtimeProfile;
  if (!runtimeProfileMatches(profile, observed))
    throw new CoordinatesRuntimeProfileError(profile.id);
}
