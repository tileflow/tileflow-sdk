import {randomUUID} from 'node:crypto';
import {lstat, mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {basename, dirname, relative, resolve, sep} from 'node:path';

const maximumAtomicArtifactBytes = 256 * 1024 * 1024;

export type WriteCapturePairInput = {
  boundaryPath?: string;
  force: boolean;
  managed: boolean;
  outputPath: string;
  png: Uint8Array;
  receipt: string;
  receiptPath: string;
};

export type WriteAtomicFileSetInput = {
  boundaryPath: string;
  files: Array<{path: string; source: string | Uint8Array}>;
  force: boolean;
  label: string;
  managed: boolean;
  removePaths?: string[];
};

export type WriteAtomicFileInput = {
  boundaryPath: string;
  force: boolean;
  label: string;
  managed: boolean;
  path: string;
  source: string | Uint8Array;
};

export async function writeCapturePair(input: WriteCapturePairInput): Promise<boolean> {
  const outputPath = resolve(input.outputPath);
  const receiptPath = resolve(input.receiptPath);
  const boundaryPath = resolve(input.boundaryPath ?? dirname(outputPath));

  if (outputPath === receiptPath) {
    throw new Error('Capture PNG and receipt paths must be different.');
  }

  return writeAtomicFileSet({
    boundaryPath,
    files: [
      {path: outputPath, source: input.png},
      {path: receiptPath, source: input.receipt},
    ],
    force: input.force,
    label: 'Capture output',
    managed: input.managed,
  });
}

export async function writeAtomicFileSet(input: WriteAtomicFileSetInput): Promise<boolean> {
  const boundaryPath = resolve(input.boundaryPath);
  const files = input.files.map((file) => ({
    path: resolve(file.path),
    source:
      typeof file.source === 'string'
        ? new TextEncoder().encode(file.source)
        : new Uint8Array(file.source),
  }));
  const removePaths = (input.removePaths ?? []).map((path) => resolve(path));
  const targets = [...files.map((file) => file.path), ...removePaths];

  if (new Set(targets).size !== targets.length || files.length === 0) {
    throw new Error(`${input.label} paths must be unique and include at least one file.`);
  }

  for (const path of targets) {
    await assertNoSymlinkComponents(dirname(path), boundaryPath);
    await assertNotSymlink(path);
  }

  const existing = new Map<string, Uint8Array | undefined>();
  await Promise.all(
    targets.map(async (path) => {
      existing.set(path, await readOptional(path));
    }),
  );
  const matches =
    files.every((file) => {
      const current = existing.get(file.path);
      return current !== undefined && Buffer.from(current).equals(Buffer.from(file.source));
    }) && removePaths.every((path) => existing.get(path) === undefined);

  if (matches) return false;
  if (
    [...existing.values()].some((value) => value !== undefined) &&
    !input.managed &&
    !input.force
  ) {
    throw new Error(
      `${input.label} already exists with different contents. Use --force to replace it.`,
    );
  }

  await Promise.all(
    [...new Set(files.map((file) => dirname(file.path)))].map((path) =>
      mkdir(path, {recursive: true}),
    ),
  );
  for (const path of targets) {
    await assertNoSymlinkComponents(dirname(path), boundaryPath);
    await assertNotSymlink(path);
  }

  const transaction = `${process.pid}.${randomUUID()}`;
  const states = targets.map((path) => ({
    path,
    backup: temporarySibling(path, transaction, 'previous'),
    backedUp: false,
    installed: false,
  }));
  const stateByPath = new Map(states.map((state) => [state.path, state]));
  const temporaries = files.map((file) => ({
    ...file,
    temporary: temporarySibling(file.path, transaction, 'new'),
  }));

  try {
    await Promise.all(temporaries.map((file) => writeSyncedExclusive(file.temporary, file.source)));

    for (const state of states) {
      if (existing.get(state.path) !== undefined) {
        await rename(state.path, state.backup);
        state.backedUp = true;
      }
    }
    for (const file of temporaries) {
      await rename(file.temporary, file.path);
      stateByPath.get(file.path)!.installed = true;
    }

    await Promise.all(
      [...new Set(targets.map((path) => dirname(path)))].map((path) => syncDirectory(path)),
    );
    const cleanup = await Promise.allSettled(states.map((state) => removeOptional(state.backup)));
    cleanup.forEach((result, index) => {
      if (result.status === 'fulfilled') states[index]!.backedUp = false;
      // A backup that cannot be removed remains beside the committed files for recovery.
    });
    return true;
  } catch (error) {
    for (const state of [...states].reverse()) {
      let canRestore = !state.installed;
      if (state.installed) {
        try {
          await removeOptional(state.path);
          canRestore = true;
        } catch {
          // Leave the sibling backup intact when the newly installed file cannot be removed.
        }
      }
      if (state.backedUp && canRestore) {
        try {
          await rename(state.backup, state.path);
          state.backedUp = false;
        } catch {
          // Preserve the backup for explicit recovery if restoration fails.
        }
      }
    }
    throw error;
  } finally {
    await Promise.allSettled([
      ...temporaries.map((file) => removeOptional(file.temporary)),
      ...states.filter((state) => !state.backedUp).map((state) => removeOptional(state.backup)),
    ]);
  }
}

/** Atomically replaces one file for readers using a same-directory temp + rename. */
export async function writeAtomicFile(input: WriteAtomicFileInput): Promise<boolean> {
  const boundaryPath = resolve(input.boundaryPath);
  const path = resolve(input.path);
  const source =
    typeof input.source === 'string'
      ? new TextEncoder().encode(input.source)
      : new Uint8Array(input.source);

  await assertNoSymlinkComponents(dirname(path), boundaryPath);
  await assertNotSymlink(path);
  const existing = await readOptional(path);
  if (existing !== undefined && Buffer.from(existing).equals(Buffer.from(source))) return false;
  if (existing !== undefined && !input.managed && !input.force) {
    throw new Error(
      `${input.label} already exists with different contents. Use --force to replace it.`,
    );
  }

  await mkdir(dirname(path), {recursive: true});
  await assertNoSymlinkComponents(dirname(path), boundaryPath);
  await assertNotSymlink(path);
  const temporary = temporarySibling(path, `${process.pid}.${randomUUID()}`, 'new');

  try {
    await writeSyncedExclusive(temporary, source);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
    return true;
  } finally {
    await removeOptional(temporary);
  }
}

export function captureReceiptPath(outputPath: string): string {
  return outputPath.toLowerCase().endsWith('.png')
    ? `${outputPath.slice(0, -4)}.receipt.json`
    : `${outputPath}.receipt.json`;
}

export async function assertNoSymlinkComponents(path: string, boundary = path): Promise<void> {
  const absolute = resolve(path);
  const absoluteBoundary = resolve(boundary);
  const relativePath = relative(absoluteBoundary, absolute);

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('Capture output escaped its resolved path boundary.');
  }

  const segments = relativePath.split(sep).filter(Boolean);
  let current = absoluteBoundary;
  await assertBoundaryOrNearestExistingAncestorIsNotSymlink(absoluteBoundary);

  for (const segment of segments) {
    current = resolve(current, segment);
    const info = await lstatOptional(current);

    if (info?.isSymbolicLink()) {
      throw new Error('Capture paths cannot contain symbolic links.');
    }
  }
}

async function assertBoundaryOrNearestExistingAncestorIsNotSymlink(path: string): Promise<void> {
  let current = path;
  while (true) {
    const info = await lstatOptional(current);
    if (info?.isSymbolicLink()) {
      throw new Error('Capture paths cannot contain symbolic links.');
    }
    if (info) return;
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function assertNotSymlink(path: string): Promise<void> {
  const info = await lstatOptional(path);

  if (info?.isSymbolicLink()) {
    throw new Error('Capture output cannot be a symbolic link.');
  }

  if (info && !info.isFile()) {
    throw new Error('Capture output must be a regular file.');
  }
}

async function writeSyncedExclusive(path: string, source: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o644);

  try {
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every supported platform.
  }
}

function temporarySibling(path: string, transaction: string, role: string): string {
  return resolve(dirname(path), `.${basename(path)}.${transaction}.${role}.tmp`);
}

async function readOptional(path: string): Promise<Uint8Array | undefined> {
  const info = await lstatOptional(path);
  if (!info) return undefined;
  if (info.size > maximumAtomicArtifactBytes) {
    throw new Error('An existing visual artifact exceeds the bounded byte limit.');
  }
  return new Uint8Array(await readFile(path));
}

async function lstatOptional(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function removeOptional(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isMissingFile(error)) {
      throw error;
    }
  });
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
