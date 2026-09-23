import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const loader = import.meta.resolve('tsx');
function command(cwd: string, args: string[]) {
	return new Promise<{code: number | null; output: string}>((resolve, reject) => {
		const child = spawn(process.execPath, ['--import', loader, entry, ...args], {
			cwd, env: {...process.env, TILEFLOW_API_KEY: '', TILEFLOW_API_URL: 'https://unused.invalid'},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let overflow = false;
		const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
		const receive = (bytes: Buffer) => {
			if (output.length + bytes.length > 128_000) { overflow = true; child.kill('SIGKILL'); return; }
			output += bytes.toString('utf8');
		};
		child.stdout.on('data', receive);
		child.stderr.on('data', receive);
		child.once('error', (error) => { clearTimeout(timer); reject(error); });
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (signal || overflow) reject(new Error('CLI fixture did not complete within its bounds.'));
			else resolve({code, output});
		});
	});
}
async function fixture(t: {after(callback: () => Promise<void>): void}) {
	const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dual-deploy-'));
	t.after(() => rm(cwd, {recursive: true, force: true}));
	await linkWorkspacePackages(cwd, ['core', 'maps']);
	await writeFile(join(cwd, 'tileflow.manifest.json'), 'PRESERVE_EXISTING_MANIFEST\n');
	return cwd;
}

test('deploy exposes explicit opt-in Native publication without widening build targets', async (t) => {
	const cwd = await fixture(t);
	const result = await command(cwd, ['deploy', '--help']);
	assert.equal(result.code, 0);
	assert.match(result.output, /--with-native/u);
	assert.match(result.output, /--map-id/u);
	assert.doesNotMatch(result.output, /mobile-client|credential-prop|native-provider/u);
});

test('Native deploy requires the managed target before executing repository configuration', async (t) => {
	const cwd = await fixture(t);
	await writeFile(join(cwd, 'tileflow.config.ts'), "throw new Error('CONFIG_EXECUTED');\n");
	for (const args of [[], ['--map-id', 'tf_public_do_not_reflect']]) {
		const result = await command(cwd, ['deploy', '--with-native', ...args]);
		assert.equal(result.code, 1);
		assert.match(result.output, /--with-native requires one valid --map-id/u);
		assert.doesNotMatch(result.output, /CONFIG_EXECUTED|do_not_reflect/u);
	}
	assert.equal(await readFile(join(cwd, 'tileflow.manifest.json'), 'utf8'), 'PRESERVE_EXISTING_MANIFEST\n');
});

test('Native incompatibility is detected before credential discovery or manifest replacement', async (t) => {
	const cwd = await fixture(t);
	await writeFile(join(cwd, 'tileflow.config.ts'), `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main', version:1, extends:streets, terrain:'3d'});
`);
	const result = await command(cwd, ['deploy', '--with-native', '--map-id', 'map_0123456789abcdef']);
	assert.equal(result.code, 1);
	assert.match(result.output, /Native artifact validation failed/u);
	assert.doesNotMatch(result.output, /account session|Published|Uploaded|fetch failed/u);
	assert.equal(await readFile(join(cwd, 'tileflow.manifest.json'), 'utf8'), 'PRESERVE_EXISTING_MANIFEST\n');
});
