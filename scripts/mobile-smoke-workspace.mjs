import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {isWithin, MobileSmokeError, requireMobile} from './mobile-smoke-contract.mjs';
import {runMobileCommand} from './mobile-smoke-process.mjs';

export async function assertOwnedPath(root, candidate) {
	const path = resolve(candidate);
	requireMobile(isWithin(root, path), 'WORKSPACE_UNSAFE');
	let existing = path;
	for (;;) {
		try {
			const physical = await realpath(existing);
			requireMobile(isWithin(root, physical), 'WORKSPACE_UNSAFE');
			return path;
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			requireMobile(existing !== root, 'WORKSPACE_UNSAFE');
			existing = dirname(existing);
		}
	}
}

/** Delete only the exact mkdtemp inode we created, never a caller-selected directory. */
export async function createMobileWorkspace(parent = tmpdir()) {
	const parentPath = await realpath(parent);
	const root = await mkdtemp(join(parentPath, 'tileflow-mobile-smoke-'));
	const identity = await lstat(root);
	const token = randomUUID();
	const marker = join(root, '.tileflow-mobile-owner');
	await writeFile(marker, token, {flag: 'wx', mode: 0o600});
	let disposed = false;
	const verifyOwner = async () => {
		const current = await lstat(root);
		requireMobile(!current.isSymbolicLink() && current.isDirectory() && current.ino === identity.ino && current.dev === identity.dev && await realpath(root) === root, 'WORKSPACE_UNSAFE', 'cleanup');
		const markerStat = await lstat(marker);
		requireMobile(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.size === token.length && await readFile(marker, 'utf8') === token, 'WORKSPACE_UNSAFE', 'cleanup');
	};
	return {
		root,
		async verify() { await verifyOwner(); },
		async cleanup() {
			if (disposed) return;
			try {
				await verifyOwner();
				await rm(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
				disposed = true;
			} catch {
				throw new MobileSmokeError('CLEANUP_FAILED', 'cleanup');
			}
		},
	};
}
export async function withMobileWorkspace(work, options = {}) {
	const owner = await createMobileWorkspace(options.parent);
	try {
		return await work(owner.root);
	} finally {
		if (options.keep) {
			await owner.verify();
			options.onPreserved?.(owner.root);
		} else await owner.cleanup();
	}
}

/** Copy inputs without following symlinks or borrowing a developer's build/cache directories. */
export async function copyMobileInputs(source, destination, excluded = new Set()) {
	const metadata = await lstat(source);
	requireMobile(!metadata.isSymbolicLink(), 'WORKSPACE_UNSAFE', 'stage');
	if (metadata.isDirectory()) {
		await mkdir(destination, {recursive: true});
		for (const entry of await readdir(source, {withFileTypes: true})) {
			if (excluded.has(entry.name)) continue;
			await copyMobileInputs(join(source, entry.name), join(destination, entry.name), excluded);
		}
	} else {
		requireMobile(metadata.isFile() && metadata.size <= 128 * 1024 * 1024, 'WORKSPACE_UNSAFE', 'stage');
		await mkdir(dirname(destination), {recursive: true});
		await copyFile(source, destination);
	}
}
export async function readMobileFile(root, path, maximumBytes = 32 * 1024 * 1024) {
	await assertOwnedPath(root, path);
	const metadata = await lstat(path);
	requireMobile(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= maximumBytes, 'WORKSPACE_UNSAFE');
	const bytes = await readFile(path);
	requireMobile(bytes.length <= maximumBytes, 'WORKSPACE_UNSAFE');
	return bytes;
}
export async function readMobileJson(root, path) {
	try { return JSON.parse((await readMobileFile(root, path, 8 * 1024 * 1024)).toString('utf8')); }
	catch (error) {
		if (error instanceof MobileSmokeError) throw error;
		throw new MobileSmokeError('COMMAND_FAILED');
	}
}
export async function writeMobileFile(root, path, content) {
	await assertOwnedPath(root, path);
	await mkdir(dirname(path), {recursive: true});
	await writeFile(path, content);
}
export function writeMobileJson(root, path, value) {
	return writeMobileFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
}
export async function mobileFileIdentity(root, path, name) {
	await assertOwnedPath(root, path);
	const metadata = await lstat(path);
	requireMobile(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= 1024 * 1024 * 1024, 'BINARY_INVALID');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return {name, bytes: metadata.size, sha256: hash.digest('hex')};
}

export async function createMobileContext(root, options = {}) {
	const inherited = options.environment ?? process.env;
	const env = {};
	for (const key of ['PATH', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'DEVELOPER_DIR']) {
		if (inherited[key]) env[key] = inherited[key];
	}
	for (const directory of ['home', 'tmp', 'logs', 'cache', 'gradle']) await mkdir(join(root, directory), {recursive: true});
	await writeFile(join(root, 'npm-user.npmrc'), '');
	await writeFile(join(root, 'npm-global.npmrc'), '');
	Object.assign(env, {
		HOME: join(root, 'home'),
		TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'),
		XDG_CACHE_HOME: join(root, 'cache'), XDG_CONFIG_HOME: join(root, 'home', '.config'),
		GRADLE_USER_HOME: join(root, 'gradle'),
		CP_HOME_DIR: join(root, 'home', '.cocoapods'), CP_CACHE_DIR: join(root, 'cache', 'cocoapods'),
		CI: '1', NO_COLOR: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOCTOR: '1',
		COCOAPODS_DISABLE_STATS: 'true', COREPACK_ENABLE_NETWORK: '0',
		COREPACK_ENABLE_PROJECT_SPEC: '0', NODE_BINARY: process.execPath,
		npm_config_userconfig: join(root, 'npm-user.npmrc'),
		npm_config_globalconfig: join(root, 'npm-global.npmrc'),
		npm_config_cache: join(root, 'cache', 'npm'),
		npm_config_store_dir: join(root, 'cache', 'pnpm'),
		npm_config_registry: 'https://registry.npmjs.org/',
		npm_config_fetch_retries: '1', npm_config_fetch_timeout: '120000',
		npm_config_fetch_retry_mintimeout: '1000', npm_config_fetch_retry_maxtimeout: '5000',
		npm_config_audit: 'false', npm_config_fund: 'false',
		npm_config_manage_package_manager_versions: 'false',
	});
	const execute = options.run ?? runMobileCommand;
	let sequence = 0;
	return {
		root, env,
		async run(command, args, settings = {}) {
			const cwd = await assertOwnedPath(root, settings.cwd ?? root);
			if (options.signal?.aborted) throw new MobileSmokeError('COMMAND_CANCELLED', settings.step);
			const log = join(root, 'logs', `${String(++sequence).padStart(4, '0')}.log`);
			try {
				const result = await execute(command, args, {...settings, cwd, env: {...env, ...settings.env}, signal: options.signal});
				await writeMobileFile(root, log, Buffer.concat([Buffer.from(result.stdout), Buffer.from('\n'), Buffer.from(result.stderr)]));
				return result;
			} catch (error) {
				await writeMobileFile(root, log, Buffer.concat([Buffer.from(error.stdout ?? ''), Buffer.from('\n'), Buffer.from(error.stderr ?? '')]));
				throw error instanceof MobileSmokeError ? error : new MobileSmokeError('COMMAND_FAILED', settings.step);
			}
		},
	};
}
