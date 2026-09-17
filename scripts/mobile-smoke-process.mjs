import {spawn} from 'node:child_process';
import {MobileSmokeError} from './mobile-smoke-contract.mjs';

/** Opt-in runner: unlike ordinary run-command callers, native work needs process-group cancellation. */
export function runMobileCommand(command, args, options = {}) {
	const spawnChild = options.spawnChild ?? spawn;
	const killGroup = options.killGroup ?? ((pid, signal) => process.kill(-pid, signal));
	if (options.signal?.aborted) return Promise.reject(new MobileSmokeError('COMMAND_CANCELLED', options.step));
	return new Promise((resolveRun, rejectRun) => {
		let child;
		let failure;
		let settled = false;
		let escalation;
		let timeout;
		let length = 0;
		const stdout = [];
		const stderr = [];
		const stop = (code) => {
			failure ??= new MobileSmokeError(code, options.step);
			if (!child?.pid || escalation || settled) return;
			try { killGroup(child.pid, 'SIGTERM'); } catch { /* The group may already have exited. */ }
			if (settled) return;
			escalation = setTimeout(() => {
				try { killGroup(child.pid, 'SIGKILL'); } catch { /* close remains the cleanup barrier. */ }
			}, options.killGraceMs ?? 2000);
		};
		const onAbort = () => stop('COMMAND_CANCELLED');
		const finish = (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			clearTimeout(escalation);
			options.signal?.removeEventListener('abort', onAbort);
			// Do not leave descendants behind even when the direct child exits successfully.
			if (child?.pid) {
				try { killGroup(child.pid, 'SIGKILL'); } catch { /* No remaining owned group. */ }
			}
			const output = {stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)};
			if (failure || code !== 0) {
				const error = failure ?? new MobileSmokeError('COMMAND_FAILED', options.step);
				// Private bounded log material; projectMobileFailure never serializes these fields.
				Object.assign(error, output);
				rejectRun(error);
			} else resolveRun(output);
		};
		try {
			child = spawnChild(command, args, {cwd: options.cwd, env: options.env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
		} catch {
			rejectRun(new MobileSmokeError('PREREQUISITE_MISSING', options.step));
			return;
		}
		const collect = (target, chunk) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			const remaining = (options.maxOutputBytes ?? 32 * 1024 * 1024) - length;
			if (remaining > 0) target.push(bytes.subarray(0, remaining));
			length += bytes.length;
			if (length > (options.maxOutputBytes ?? 32 * 1024 * 1024)) stop('COMMAND_OUTPUT_LIMIT');
		};
		child.stdout.on('data', (chunk) => collect(stdout, chunk));
		child.stderr.on('data', (chunk) => collect(stderr, chunk));
		child.once('error', (error) => {
			failure ??= new MobileSmokeError(error.code === 'ENOENT' ? 'PREREQUISITE_MISSING' : 'COMMAND_FAILED', options.step);
			// Failed spawns still emit close; do not delete files while pipes remain open.
		});
		child.once('close', finish);
		timeout = setTimeout(() => stop('COMMAND_TIMEOUT'), options.timeoutMs ?? 15 * 60 * 1000);
		options.signal?.addEventListener('abort', onAbort, {once: true});
		if (options.signal?.aborted) onAbort();
	});
}
