import {lstat, mkdir, mkdtemp, open, rename, rm, rmdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parseTileflowIconsLockfile, serializeTileflowIconsLockfile, TileflowIconSetError, tileflowIconsLockfileMaximumBytes, tileflowIconsLockfileName, type TileflowIconsLockfileV1, type TileflowIconSource} from '@tileflow/core';
import {readSafeFile} from './icon-cache';

export async function readTileflowIconsLockfile(baseDirectory: string, sources?: readonly TileflowIconSource[]): Promise<TileflowIconsLockfileV1> {
	const text = await readLockText(join(resolve(baseDirectory), tileflowIconsLockfileName));
	if (text === null) throw new TileflowIconSetError('ICON_LOCK_MISSING', 'Missing tileflow.icons.lock.json; install exact icon set revisions explicitly');
	return parseTileflowIconsLockfile(text, sources);
}

/** Compare-and-swap the whole lock. Never rewrite executable config or lose another writer's pin. */
export async function writeTileflowIconsLockfile(baseDirectory: string, input: TileflowIconsLockfileV1, expectedContents: string | null): Promise<void> {
	const content = await serializeTileflowIconsLockfile(input);
	const directory = resolve(baseDirectory);
	const destination = join(directory, tileflowIconsLockfileName);
	const guard = join(directory, `.${tileflowIconsLockfileName}.writing`);
	try { await mkdir(guard, {mode: 0o700}); }
	catch (cause) {
		throw new TileflowIconSetError('ICON_LOCK_CONFLICT', 'Another icon lock writer is active; a stale .writing guard may be removed only after confirming its writer has exited', {cause});
	}
	let temporary: string | undefined;
	try {
		const actual = await readLockText(destination);
		if (actual !== expectedContents) throw new TileflowIconSetError('ICON_LOCK_CONFLICT', 'Icon lock changed since it was read; reload and retry without discarding other pins');
		if (actual === content) return;
		temporary = await mkdtemp(join(directory, '.tileflow-icons-lock-'));
		const file = join(temporary, 'lock');
		const handle = await open(file, 'wx', 0o600);
		try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
		if (await readLockText(destination) !== actual) throw new TileflowIconSetError('ICON_LOCK_CONFLICT', 'Icon lock changed while preparing an update');
		await rename(file, destination);
	} finally {
		if (temporary) await rm(temporary, {recursive: true, force: true});
		await rmdir(guard);
	}
}

async function readLockText(path: string): Promise<string | null> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new TileflowIconSetError('ICON_LOCK_INVALID', 'The icon lock must be a regular file, not a symlink');
		return new TextDecoder('utf-8', {fatal: true}).decode(await readSafeFile(path, tileflowIconsLockfileMaximumBytes, false));
	} catch (cause) {
		if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return null;
		throw cause;
	}
}
