import {spawn} from 'node:child_process';
import {lstat, mkdir, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {hashFile} from './identity';

const commandTimeoutMs = 15_000;
const copyTimeoutMs = 15 * 60 * 1000;
const cleanupTimeoutMs = 2_000;
const sha256 = /^[a-f0-9]{64}$/u;
const safePath = /^[A-Za-z0-9_./=+-]+$/u;

export type CoordinatesDmgFile = Readonly<{
  bytes: number;
  executable: boolean;
  path: string;
  sha256: string;
}>;

export type CoordinatesDmgTrust =
  | Readonly<{kind: 'development'}>
  | Readonly<{kind: 'apple-notarized-dmg'; teamIdentifier: string}>;

export type CoordinatesDmgCommand = Readonly<{
  args: readonly string[];
  file: string;
  signal: AbortSignal;
  timeoutMs: number;
}>;

export type CoordinatesDmgCommandResult = Readonly<{
  code: number | null;
  stderr: string;
  stdout: string;
}>;

export type CoordinatesDmgCommandRunner = (
  command: CoordinatesDmgCommand,
) => Promise<CoordinatesDmgCommandResult>;

export class CoordinatesDmgError extends Error {
  constructor(
    readonly code:
      | 'DMG_ABORTED'
      | 'DMG_ATTACH_FAILED'
      | 'DMG_COMMAND_TIMEOUT'
      | 'DMG_COPY_FAILED'
      | 'DMG_DESTINATION_UNAVAILABLE'
      | 'DMG_DETACH_FAILED'
      | 'DMG_INVALID_INPUT'
      | 'DMG_PAYLOAD_INVALID'
      | 'DMG_TRUST_INVALID'
      | 'DMG_VERIFY_FAILED',
  ) {
    super('Coordinates DMG extraction failed.');
    this.name = 'CoordinatesDmgError';
  }

  toJSON() {
    return {code: this.code};
  }
}

/** Copies a manifest-bound DMG payload into a new staging directory. */
export function createCoordinatesDmgExtractor(run: CoordinatesDmgCommandRunner = runCommand) {
  return async function extractCoordinatesDmg(input: {
    artifactPath: string;
    destination: string;
    files: readonly CoordinatesDmgFile[];
    signal?: AbortSignal;
    trust: CoordinatesDmgTrust;
  }): Promise<void> {
    validateInput(input);
    const manifest = validateManifest(input.files);
    throwIfAborted(input.signal);

    let mountpoint: string | undefined;
    let destinationCreated = false;
    let attachStarted = false;
    let completed = false;
    let failure: CoordinatesDmgError | undefined;
    try {
      await verifyTrust(run, input.artifactPath, input.trust, input.signal);
      await checked(
        run,
        '/usr/bin/hdiutil',
        ['verify', input.artifactPath],
        input.signal,
        'DMG_VERIFY_FAILED',
      );

      mountpoint = await mkdirMountpoint();
      try {
        await mkdir(input.destination, {mode: 0o700});
        destinationCreated = true;
      } catch {
        throw new CoordinatesDmgError('DMG_DESTINATION_UNAVAILABLE');
      }

      attachStarted = true;
      await checked(
        run,
        '/usr/bin/hdiutil',
        [
          'attach',
          input.artifactPath,
          '-readonly',
          '-nobrowse',
          '-noautoopen',
          '-mountpoint',
          mountpoint,
        ],
        input.signal,
        'DMG_ATTACH_FAILED',
      );

      const payload = join(mountpoint, 'payload');
      await verifyPayload(payload, manifest, input.signal);
      await checked(
        run,
        '/usr/bin/ditto',
        ['--rsrc', '--extattr', '--qtn', payload, input.destination],
        input.signal,
        'DMG_COPY_FAILED',
        copyTimeoutMs,
      );
      await verifyPayload(input.destination, manifest, input.signal);
      completed = true;
    } catch (error) {
      failure = normalizeError(error, input.signal);
    } finally {
      const detached = !attachStarted || !mountpoint || (await detach(run, mountpoint));
      if (mountpoint && detached)
        await rm(mountpoint, {force: true, recursive: true}).catch(() => undefined);
      if (destinationCreated && !completed)
        await rm(input.destination, {force: true, recursive: true}).catch(() => undefined);
      if (!detached) failure = new CoordinatesDmgError('DMG_DETACH_FAILED');
    }
    if (failure) throw failure;
  };
}

export const extractCoordinatesDmg = createCoordinatesDmgExtractor();

async function verifyTrust(
  run: CoordinatesDmgCommandRunner,
  artifactPath: string,
  trust: CoordinatesDmgTrust,
  signal: AbortSignal | undefined,
) {
  if (trust.kind === 'development') return;
  if (!/^[A-Z0-9]{10}$/u.test(trust.teamIdentifier))
    throw new CoordinatesDmgError('DMG_INVALID_INPUT');

  await checked(
    run,
    '/usr/bin/codesign',
    ['--verify', '--strict', artifactPath],
    signal,
    'DMG_TRUST_INVALID',
  );
  const signature = await checked(
    run,
    '/usr/bin/codesign',
    ['--display', '--verbose=4', artifactPath],
    signal,
    'DMG_TRUST_INVALID',
  );
  const output = `${signature.stdout}\n${signature.stderr}`;
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/mu.exec(output)?.[1];
  if (team !== trust.teamIdentifier || !/^Authority=Developer ID /mu.test(output))
    throw new CoordinatesDmgError('DMG_TRUST_INVALID');
  await checked(
    run,
    '/usr/sbin/spctl',
    [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      '--verbose=4',
      artifactPath,
    ],
    signal,
    'DMG_TRUST_INVALID',
  );
}

async function checked(
  run: CoordinatesDmgCommandRunner,
  file: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  failure: CoordinatesDmgError['code'],
  timeoutMs = commandTimeoutMs,
) {
  let result: CoordinatesDmgCommandResult;
  try {
    result = await bounded(run, file, args, signal, timeoutMs);
  } catch (error) {
    if (
      error instanceof CoordinatesDmgError &&
      (error.code === 'DMG_ABORTED' || error.code === 'DMG_COMMAND_TIMEOUT')
    ) {
      throw error;
    }
    throw new CoordinatesDmgError(failure);
  }
  if (result.code !== 0) throw new CoordinatesDmgError(failure);
  return result;
}

async function detach(run: CoordinatesDmgCommandRunner, mountpoint: string): Promise<boolean> {
  try {
    const result = await bounded(
      run,
      '/usr/bin/hdiutil',
      ['detach', mountpoint, '-force'],
      undefined,
      cleanupTimeoutMs,
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

async function bounded(
  run: CoordinatesDmgCommandRunner,
  file: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<CoordinatesDmgCommandResult> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let pending: Promise<CoordinatesDmgCommandResult>;
  try {
    pending = Promise.resolve(run({args, file, signal: controller.signal, timeoutMs}));
  } catch {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    throw new CoordinatesDmgError('DMG_VERIFY_FAILED');
  }
  const stopped = new Promise<never>((_, reject) => {
    const stop = () => {
      void pending.catch(() => undefined);
      reject(new CoordinatesDmgError(signal?.aborted ? 'DMG_ABORTED' : 'DMG_COMMAND_TIMEOUT'));
    };
    controller.signal.addEventListener('abort', stop, {once: true});
  });
  try {
    return await Promise.race([pending, stopped]);
  } catch (error) {
    if (error instanceof CoordinatesDmgError) throw error;
    if (signal?.aborted) throw new CoordinatesDmgError('DMG_ABORTED');
    throw new CoordinatesDmgError('DMG_VERIFY_FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function verifyPayload(root: string, manifest: Manifest, signal: AbortSignal | undefined) {
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch {
    throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');

  const seen = new Set<string>();
  async function visit(relative: string): Promise<void> {
    throwIfAborted(signal);
    let entries;
    try {
      entries = await readdir(join(root, relative), {withFileTypes: true});
    } catch {
      throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
    }
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
      if (entry.isDirectory()) {
        if (!manifest.directories.has(path)) throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
        await visit(path);
        continue;
      }
      const expected = manifest.files.get(path);
      if (!expected || !entry.isFile()) throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
      let info;
      try {
        info = await lstat(join(root, path));
      } catch {
        throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
      }
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size !== expected.bytes ||
        Boolean(info.mode & 0o111) !== expected.executable ||
        (await hashFile(join(root, path), signal)) !== expected.sha256
      ) {
        throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
      }
      seen.add(path);
    }
  }
  try {
    await visit('');
  } catch (error) {
    if (error instanceof CoordinatesDmgError) throw error;
    if (signal?.aborted) throw new CoordinatesDmgError('DMG_ABORTED');
    throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
  }
  if (seen.size !== manifest.files.size) throw new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
}

function validateManifest(files: readonly CoordinatesDmgFile[]): Manifest {
  if (!Array.isArray(files) || files.length === 0)
    throw new CoordinatesDmgError('DMG_INVALID_INPUT');
  const expected = new Map<string, CoordinatesDmgFile>();
  const directories = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.executable !== 'boolean' ||
      typeof file.sha256 !== 'string' ||
      !sha256.test(file.sha256) ||
      !isSafePath(file.path) ||
      expected.has(file.path)
    ) {
      throw new CoordinatesDmgError('DMG_INVALID_INPUT');
    }
    expected.set(file.path, file);
    for (let directory = dirname(file.path); directory !== '.'; directory = dirname(directory))
      directories.add(directory);
  }
  return {directories, files: expected};
}

function validateInput(input: {
  artifactPath: string;
  destination: string;
  signal?: AbortSignal;
  trust: CoordinatesDmgTrust;
}) {
  if (
    !input ||
    typeof input.artifactPath !== 'string' ||
    !input.artifactPath ||
    typeof input.destination !== 'string' ||
    !input.destination ||
    !input.trust ||
    !isAbortSignal(input.signal) ||
    (input.trust.kind !== 'development' && input.trust.kind !== 'apple-notarized-dmg')
  ) {
    throw new CoordinatesDmgError('DMG_INVALID_INPUT');
  }
}

function isAbortSignal(value: unknown): value is AbortSignal | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  try {
    const signal = value as AbortSignal;
    return (
      typeof signal.aborted === 'boolean' &&
      typeof signal.addEventListener === 'function' &&
      typeof signal.removeEventListener === 'function'
    );
  } catch {
    return false;
  }
}

function isSafePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 240 &&
    safePath.test(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function normalizeError(error: unknown, signal: AbortSignal | undefined): CoordinatesDmgError {
  if (error instanceof CoordinatesDmgError) return error;
  if (signal?.aborted) return new CoordinatesDmgError('DMG_ABORTED');
  return new CoordinatesDmgError('DMG_PAYLOAD_INVALID');
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new CoordinatesDmgError('DMG_ABORTED');
}

async function mkdirMountpoint(): Promise<string> {
  const {mkdtemp} = await import('node:fs/promises');
  try {
    return await mkdtemp(join(tmpdir(), 'tileflow-coordinates-dmg-'));
  } catch {
    throw new CoordinatesDmgError('DMG_ATTACH_FAILED');
  }
}

function runCommand(command: CoordinatesDmgCommand): Promise<CoordinatesDmgCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {stdio: ['ignore', 'pipe', 'pipe']});
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const abort = () => child.kill('SIGKILL');
    command.signal.addEventListener('abort', abort, {once: true});
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 256 * 1024) child.kill('SIGKILL');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', (error) => {
      command.signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      command.signal.removeEventListener('abort', abort);
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      });
    });
  });
}

type Manifest = Readonly<{
  directories: ReadonlySet<string>;
  files: ReadonlyMap<string, CoordinatesDmgFile>;
}>;
