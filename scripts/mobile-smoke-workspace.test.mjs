import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {access, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {MobileSmokeError, projectMobileFailure} from './mobile-smoke-contract.mjs';
import {runMobileCommand} from './mobile-smoke-process.mjs';
import {assertOwnedPath, copyMobileInputs, createMobileContext, createMobileWorkspace, withMobileWorkspace} from './mobile-smoke-workspace.mjs';

async function temporaryParent(t) {
	const parent = await mkdtemp(join(tmpdir(), 'tileflow-mobile-unit-'));
	t.after(() => rm(parent, {recursive: true, force: true}));
	return parent;
}
function fakeChild() {
	return Object.assign(new EventEmitter(), {pid: 123456, stdout: new PassThrough(), stderr: new PassThrough()});
}

test('success, partial installs and failed generators all remove their exact owned root', async (t) => {
	const parent = await temporaryParent(t);
	const outside = join(parent, 'unrelated');
	await writeFile(outside, 'retain');
	for (const failure of [false, true]) {
		let used;
		const work = withMobileWorkspace(async (root) => {
			used = root;
			await mkdir(join(root, 'partial-install'));
			await writeFile(join(root, 'partial-install', 'package.json'), '{}');
			if (failure) throw new MobileSmokeError('COMMAND_FAILED', 'bare');
			return 'done';
		}, {parent});
		if (failure) await assert.rejects(work, {code: 'COMMAND_FAILED'});
		else assert.equal(await work, 'done');
		await assert.rejects(access(used), {code: 'ENOENT'});
		assert.equal(await readFile(outside, 'utf8'), 'retain');
	}
});

test('preservation is deliberate, and replaced owner roots are never deleted', async (t) => {
	const parent = await temporaryParent(t);
	let preserved;
	await withMobileWorkspace(async (root) => writeFile(join(root, 'evidence'), 'log'), {parent, keep: true, onPreserved: (root) => { preserved = root; }});
	assert.equal(await readFile(join(preserved, 'evidence'), 'utf8'), 'log');
	const owner = await createMobileWorkspace(parent);
	const moved = `${owner.root}-moved`;
	const outside = join(parent, 'unrelated');
	await mkdir(outside);
	await writeFile(join(outside, 'retain'), 'safe');
	await rename(owner.root, moved);
	await symlink(outside, owner.root, 'dir');
	await assert.rejects(owner.cleanup(), {code: 'CLEANUP_FAILED'});
	assert.equal(await readFile(join(outside, 'retain'), 'utf8'), 'safe');
	await unlink(owner.root);
	await rename(moved, owner.root);
	await owner.cleanup();
	await owner.cleanup();
});

test('symlink/path escapes fail and cleanup unlinks an inner symlink without following it', async (t) => {
	const parent = await temporaryParent(t);
	const owner = await createMobileWorkspace(parent);
	const outside = join(parent, 'unrelated');
	await mkdir(outside);
	await writeFile(join(outside, 'retain'), 'safe');
	await symlink(outside, join(owner.root, 'escape'), 'dir');
	await assert.rejects(assertOwnedPath(owner.root, join(owner.root, 'escape', 'new-file')), {code: 'WORKSPACE_UNSAFE'});
	await assert.rejects(assertOwnedPath(owner.root, join(owner.root, '..', 'unrelated')), {code: 'WORKSPACE_UNSAFE'});
	await owner.cleanup();
	assert.equal(await readFile(join(outside, 'retain'), 'utf8'), 'safe');
});

test('source staging excludes old outputs and refuses source symlinks', async (t) => {
	const parent = await temporaryParent(t);
	const source = join(parent, 'source');
	await mkdir(join(source, 'dist'), {recursive: true});
	await writeFile(join(source, 'dist', 'stale.js'), 'stale');
	await writeFile(join(source, 'package.json'), '{"version":"0.0.0-development"}');
	const target = join(parent, 'stage');
	await copyMobileInputs(source, target, new Set(['dist']));
	await assert.rejects(access(join(target, 'dist')), {code: 'ENOENT'});
	await symlink(join(source, 'package.json'), join(source, 'alias'));
	await assert.rejects(copyMobileInputs(source, join(parent, 'other')), {code: 'WORKSPACE_UNSAFE'});
	assert.match(await readFile(join(source, 'package.json'), 'utf8'), /0\.0\.0-development/u);
});

test('owned command context ignores ambient credentials, npm config, Node options and project caches', async (t) => {
	const parent = await temporaryParent(t);
	await withMobileWorkspace(async (root) => {
		let captured;
		const context = await createMobileContext(root, {
			environment: {PATH: '/tools', JAVA_HOME: '/java', TILEFLOW_API_KEY: 'secret', NODE_OPTIONS: '--require unsafe', npm_config_userconfig: '/unrelated/.npmrc', GRADLE_USER_HOME: '/unrelated/gradle'},
			run: async (_command, _args, options) => { captured = options; return {stdout: Buffer.from('ok'), stderr: Buffer.alloc(0)}; },
		});
		await context.run('fake', [], {step: 'expo'});
		assert.equal(captured.env.TILEFLOW_API_KEY, undefined);
		assert.equal(captured.env.NODE_OPTIONS, undefined);
		assert.equal(captured.env.HOME, join(root, 'home'));
		assert.equal(captured.env.GRADLE_USER_HOME, join(root, 'gradle'));
		assert.equal(captured.env.npm_config_userconfig, join(root, 'npm-user.npmrc'));
		assert.equal(captured.env.COREPACK_ENABLE_NETWORK, '0');
		assert.equal(captured.env.npm_config_fetch_retries, '1');
		assert.equal(captured.env.TMPDIR, join(root, 'tmp'));
		await assert.rejects(context.run('fake', [], {cwd: parent}), {code: 'WORKSPACE_UNSAFE'});
	}, {parent});
});

test('command completion waits for close, capturing the final stdout bytes without a shell', async () => {
	const child = fakeChild();
	let options;
	let settled = false;
	const result = runMobileCommand('fake', ['literal;not-a-shell'], {spawnChild: (_command, _args, settings) => { options = settings; return child; }, killGroup: () => {}});
	result.then(() => { settled = true; });
	child.stdout.write('first');
	child.emit('exit', 0);
	await Promise.resolve();
	assert.equal(settled, false);
	child.stdout.write('-last');
	child.emit('close', 0);
	assert.equal((await result).stdout.toString(), 'first-last');
	assert.equal(options.shell, false);
	assert.equal(options.detached, true);
});

test('cancellation kills the owned process group, escalates, and rejects even a zero close code', async () => {
	const child = fakeChild();
	const controller = new AbortController();
	const signals = [];
	const result = runMobileCommand('fake', [], {
		signal: controller.signal, killGraceMs: 1,
		spawnChild: () => child,
		killGroup: (_pid, signal) => {
			signals.push(signal);
			if (signal === 'SIGKILL') child.emit('close', 0);
		},
	});
	const rejected = assert.rejects(result, {code: 'COMMAND_CANCELLED'});
	controller.abort();
	await rejected;
	assert.deepEqual(signals.slice(0, 2), ['SIGTERM', 'SIGKILL']);
	let spawned = false;
	await assert.rejects(runMobileCommand('fake', [], {signal: controller.signal, spawnChild: () => { spawned = true; }}), {code: 'COMMAND_CANCELLED'});
	assert.equal(spawned, false);
});

for (const failure of ['timeout', 'output', 'spawn']) {
	test(`bounded ${failure} failure does not project process output or paths`, async () => {
		const child = fakeChild();
		const result = runMobileCommand('fake', [], {
			timeoutMs: failure === 'timeout' ? 1 : 1000,
			maxOutputBytes: 8,
			spawnChild: () => child,
			killGroup: () => { child.emit('close', 0); },
		});
		const expected = {timeout: 'COMMAND_TIMEOUT', output: 'COMMAND_OUTPUT_LIMIT', spawn: 'PREREQUISITE_MISSING'}[failure];
		const rejected = assert.rejects(result, (error) => {
			assert.equal(error.code, expected);
			assert.doesNotMatch(JSON.stringify(projectMobileFailure(error)), /private|secret/u);
			assert.ok((error.stdout?.length ?? 0) + (error.stderr?.length ?? 0) <= 8);
			return true;
		});
		if (failure === 'output') child.stderr.write('/private/secret');
		if (failure === 'spawn') {
			child.emit('error', Object.assign(new Error('/private/secret'), {code: 'ENOENT'}));
			child.emit('close', -2);
		}
		await rejected;
	});
}
