import {createHash} from 'node:crypto';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {digest, hashFile} from './identity';
import {nativeRuntimeProfile} from './qualification';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const sha512Integrity = z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const sourceRevision = z.string().regex(/^[a-f0-9]{40}$/u);
const packageVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);

const path = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9_./=+-]+$/u)
  .refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..'));

const file = z
  .object({
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    executable: z.boolean(),
    path,
    sha256,
  })
  .strict();

const sourceFile = file.pick({path: true, sha256: true}).strict();

const runtimeProfile = z
  .object({
    architecture: z.literal(nativeRuntimeProfile.architecture),
    distribution: z.literal(nativeRuntimeProfile.distribution),
    distributionVersion: z.literal(nativeRuntimeProfile.distributionVersion),
    id: z.literal(nativeRuntimeProfile.id),
    libcVersion: z.literal(nativeRuntimeProfile.libcVersion),
    nodeMajor: z.literal(nativeRuntimeProfile.nodeMajor),
    platform: z.literal(nativeRuntimeProfile.platform),
  })
  .strict();

/** The source inventory carried by a runtime package without carrying native payload bytes. */
export const coordinatesBuilderInputSourceSchema = z
  .object({
    files: z.array(sourceFile).min(1).max(10000),
    kind: z.literal('tileflow-coordinates-builder-source'),
    schemaVersion: z.literal(1),
    sourceDigest: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (!isOrderedUnique(value.files)) {
      context.addIssue({
        code: 'custom',
        message: 'Builder source files must be ordered and unique',
      });
    }
    if (
      value.sourceDigest !==
      digest({kind: value.kind, schemaVersion: value.schemaVersion, files: value.files})
    ) {
      context.addIssue({code: 'custom', message: 'Builder source identity mismatch'});
    }
  });

export type CoordinatesBuilderInputSource = z.infer<typeof coordinatesBuilderInputSourceSchema>;

export const coordinatesBuilderInputSchema = z
  .object({
    adapter: z
      .object({
        buildConfiguration: sourceFile,
        engineBundle: sourceFile,
        files: z.array(sourceFile).min(1).max(10000),
        nativeSource: sourceFile,
        sourceDigest: sha256,
        sourceRevision,
        verifiers: z.array(sourceFile).min(4).max(32),
      })
      .strict(),
    admission: z.enum(['development', 'native-qualified-eligible']),
    files: z.array(file).min(1).max(10000),
    inputId: z.string().regex(/^cbi_[a-f0-9]{64}$/u),
    kind: z.literal('tileflow-coordinates-builder-input'),
    proofs: z.array(z.object({path, sha256}).strict()).min(1).max(32),
    provenance: z
      .object({
        toolchain: z
          .object({
            nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
            tsupVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
          })
          .strict(),
        verificationReport: sourceFile,
      })
      .strict(),
    runtimePackage: z
      .object({
        archive: file,
        files: z.array(file).min(1).max(10000),
        integrity: sha512Integrity,
        name: z.literal('@tileflow/coordinates-runtime'),
        sourceDescriptor: z.object({digest: sha256, path}).strict(),
        version: packageVersion,
      })
      .strict(),
    runtimeProfile,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    const {inputId, ...identity} = value;
    if (inputId !== `cbi_${digest(identity)}`)
      context.addIssue({code: 'custom', message: 'Builder input identity mismatch'});
    if (!isOrderedUnique(value.files))
      context.addIssue({code: 'custom', message: 'Builder input files must be ordered and unique'});
    if (!isOrderedUnique(value.runtimePackage.files)) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime package files must be ordered and unique',
      });
    }
    if (!isOrderedUnique(value.adapter.files)) {
      context.addIssue({code: 'custom', message: 'Adapter files must be ordered and unique'});
    }

    const files = new Map(value.files.map((entry) => [entry.path, entry]));
    const matchesFile = (entry: z.infer<typeof sourceFile>) => {
      const candidate = files.get(entry.path);
      return candidate?.sha256 === entry.sha256;
    };
    for (const entry of [
      value.runtimePackage.archive,
      value.adapter.buildConfiguration,
      value.adapter.engineBundle,
      value.adapter.nativeSource,
      value.provenance.verificationReport,
      ...value.adapter.files,
      ...value.adapter.verifiers,
      ...value.proofs,
    ]) {
      if (!matchesFile(entry))
        context.addIssue({code: 'custom', message: `Builder input file is unbound: ${entry.path}`});
    }

    const expectedSourceDigest = digest({
      kind: 'tileflow-coordinates-builder-source',
      schemaVersion: 1,
      files: value.adapter.files,
    });
    if (value.adapter.sourceDigest !== expectedSourceDigest)
      context.addIssue({code: 'custom', message: 'Adapter source identity mismatch'});
    if (
      !value.adapter.files.some(
        (entry) =>
          entry.path === value.adapter.nativeSource.path &&
          entry.sha256 === value.adapter.nativeSource.sha256,
      ) ||
      !value.adapter.files.some(
        (entry) =>
          entry.path === value.adapter.buildConfiguration.path &&
          entry.sha256 === value.adapter.buildConfiguration.sha256,
      )
    ) {
      context.addIssue({code: 'custom', message: 'Adapter entry points must be source-bound'});
    }
    if (
      value.adapter.engineBundle.path !== 'artifacts/engine.mjs' ||
      value.adapter.verifiers.some((entry) => !entry.path.startsWith('artifacts/verifiers/'))
    ) {
      context.addIssue({code: 'custom', message: 'Builder artifacts are invalid'});
    }
    if (value.proofs.some((entry) => !entry.path.startsWith('proofs/')))
      context.addIssue({code: 'custom', message: 'Proof path is invalid'});
    if (
      value.admission === 'native-qualified-eligible' &&
      (!/^\d+\.\d+\.\d+-alpha\.\d+$/u.test(value.runtimePackage.version) ||
        value.runtimePackage.version === '0.0.0-development')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qualified inputs require a published alpha package',
      });
    }
  });

export type CoordinatesBuilderInput = z.infer<typeof coordinatesBuilderInputSchema>;

/** A release-bundle record that binds a trusted input identity to its exact SDK release inputs. */
export const coordinatesBuilderInputReceiptSchema = z
  .object({
    builderInput: z
      .object({
        id: z.string().regex(/^cbi_[a-f0-9]{64}$/u),
        runtimePackage: z
          .object({
            archiveSha256: sha256,
            integrity: sha512Integrity,
            name: z.literal('@tileflow/coordinates-runtime'),
            version: z.string().regex(/^\d+\.\d+\.\d+-alpha\.\d+$/u),
          })
          .strict(),
        sourceDigest: sha256,
      })
      .strict(),
    kind: z.literal('tileflow-coordinates-builder-input-release-receipt'),
    schemaVersion: z.literal(1),
    sourceRevision,
  })
  .strict();

export type CoordinatesBuilderInputReceipt = z.infer<typeof coordinatesBuilderInputReceiptSchema>;

export class CoordinatesBuilderInputError extends Error {
  constructor(readonly code: string) {
    super('Coordinates builder input verification failed.');
    this.name = 'CoordinatesBuilderInputError';
  }
}

/**
 * Match an offline-verified input to the identity selected from a trusted SDK release bundle.
 * The caller owns the receipt transport and supplies the independently trusted input ID.
 */
export function verifyCoordinatesBuilderInputReceipt(options: {
  expectedInputId: string;
  input: CoordinatesBuilderInput;
  receipt: unknown;
}): CoordinatesBuilderInputReceipt {
  if (options.expectedInputId !== options.input.inputId)
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_EXPECTED_ID_MISMATCH');

  let receipt: CoordinatesBuilderInputReceipt;
  try {
    receipt = coordinatesBuilderInputReceiptSchema.parse(options.receipt);
  } catch {
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_RECEIPT_INVALID');
  }

  if (
    receipt.sourceRevision !== options.input.adapter.sourceRevision ||
    receipt.builderInput.id !== options.input.inputId ||
    receipt.builderInput.sourceDigest !== options.input.adapter.sourceDigest ||
    receipt.builderInput.runtimePackage.archiveSha256 !==
      options.input.runtimePackage.archive.sha256 ||
    receipt.builderInput.runtimePackage.integrity !== options.input.runtimePackage.integrity ||
    receipt.builderInput.runtimePackage.name !== options.input.runtimePackage.name ||
    receipt.builderInput.runtimePackage.version !== options.input.runtimePackage.version
  ) {
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_RECEIPT_MISMATCH');
  }

  return receipt;
}

export async function verifyCoordinatesBuilderInput(options: {
  directory: string;
  runtimePackageDirectory?: string;
}): Promise<{
  manifest: CoordinatesBuilderInput;
  paths: {
    buildConfiguration: string;
    engineBundle: string;
    nativeSource: string;
    proofs: ReadonlyMap<string, string>;
    verifiers: ReadonlyMap<string, string>;
    verificationReport: string;
  };
}> {
  const manifest = await readManifest(options.directory);
  await verifyDirectory(options.directory, manifest.files, new Set(['builder-input.json']));

  const archive = join(options.directory, manifest.runtimePackage.archive.path);
  if (
    (await hashFile(archive)) !== manifest.runtimePackage.archive.sha256 ||
    (await integrity(archive)) !== manifest.runtimePackage.integrity
  ) {
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
  }

  if (options.runtimePackageDirectory)
    await verifyRuntimePackage(options.runtimePackageDirectory, manifest);

  return {
    manifest,
    paths: {
      buildConfiguration: join(options.directory, manifest.adapter.buildConfiguration.path),
      engineBundle: join(options.directory, manifest.adapter.engineBundle.path),
      nativeSource: join(options.directory, manifest.adapter.nativeSource.path),
      proofs: new Map(
        manifest.proofs.map((proof) => [proof.path, join(options.directory, proof.path)]),
      ),
      verifiers: new Map(
        manifest.adapter.verifiers.map((verifier) => [
          verifier.path.slice('artifacts/verifiers/'.length),
          join(options.directory, verifier.path),
        ]),
      ),
      verificationReport: join(options.directory, manifest.provenance.verificationReport.path),
    },
  };
}

async function readManifest(directory: string): Promise<CoordinatesBuilderInput> {
  const path = join(directory, 'builder-input.json');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      throw new CoordinatesBuilderInputError('BUILDER_INPUT_MANIFEST_INVALID');
    return coordinatesBuilderInputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error instanceof CoordinatesBuilderInputError) throw error;
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_MANIFEST_INVALID');
  }
}

async function verifyRuntimePackage(directory: string, manifest: CoordinatesBuilderInput) {
  try {
    await verifyDirectory(directory, manifest.runtimePackage.files, new Set(['node_modules']));
    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (
      packageJson?.name !== manifest.runtimePackage.name ||
      packageJson?.version !== manifest.runtimePackage.version
    ) {
      throw new CoordinatesBuilderInputError('BUILDER_INPUT_RUNTIME_PACKAGE_MISMATCH');
    }
    const source = coordinatesBuilderInputSourceSchema.parse(
      JSON.parse(
        await readFile(join(directory, manifest.runtimePackage.sourceDescriptor.path), 'utf8'),
      ),
    );
    if (
      source.sourceDigest !== manifest.runtimePackage.sourceDescriptor.digest ||
      source.sourceDigest !== manifest.adapter.sourceDigest ||
      JSON.stringify(source.files) !== JSON.stringify(manifest.adapter.files)
    ) {
      throw new CoordinatesBuilderInputError('BUILDER_INPUT_RUNTIME_PACKAGE_MISMATCH');
    }
  } catch (error) {
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_RUNTIME_PACKAGE_MISMATCH');
  }
}

async function verifyDirectory(
  directory: string,
  expectedFiles: readonly z.infer<typeof file>[],
  ignored: Set<string>,
) {
  const expected = new Map(expectedFiles.map((entry) => [entry.path, entry]));
  const seen = new Set<string>();
  let root;
  try {
    root = await lstat(directory);
  } catch {
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
  }
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');

  async function visit(relative = ''): Promise<void> {
    const entries = await readdir(join(directory, relative), {withFileTypes: true});
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && ignored.has(entry.name)) continue;
      if (entry.isSymbolicLink())
        throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
      if (entry.isDirectory()) {
        if (!hasDescendant(expected, path))
          throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
        await visit(path);
        continue;
      }
      const expectedFile = expected.get(path);
      const info = await lstat(join(directory, path));
      if (
        !entry.isFile() ||
        !expectedFile ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== expectedFile.bytes ||
        Boolean(info.mode & 0o111) !== expectedFile.executable ||
        (await hashFile(join(directory, path))) !== expectedFile.sha256
      ) {
        throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
      }
      seen.add(path);
    }
  }

  try {
    await visit();
  } catch (error) {
    if (error instanceof CoordinatesBuilderInputError) throw error;
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
  }
  if (seen.size !== expected.size)
    throw new CoordinatesBuilderInputError('BUILDER_INPUT_FILE_INVALID');
}

function hasDescendant(files: ReadonlyMap<string, unknown>, directory: string) {
  return [...files.keys()].some((path) => path.startsWith(`${directory}/`));
}

async function integrity(path: string) {
  const value = await readFile(path);
  return `sha512-${createHash('sha512').update(value).digest('base64')}`;
}

function isOrderedUnique(entries: readonly {path: string}[]) {
  return entries.every((entry, index) => index === 0 || entries[index - 1]!.path < entry.path);
}
