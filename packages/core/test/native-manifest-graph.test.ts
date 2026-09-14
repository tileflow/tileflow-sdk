import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build, type Options} from 'tsup';
import nativeConfig from '../tsup.native.config';

test('the native bundle emits Mini validation without the classic Zod method graph', async (t) => {
	const outDir = await mkdtemp(join(tmpdir(), 'tileflow-native-schema-graph-'));
	t.after(() => rm(outDir, {recursive: true, force: true}));
	const config = nativeConfig as Options;
	const emitted = new Set<string>();
	let inspected = false;
	const observer: NonNullable<Options['esbuildPlugins']>[number] = {
		name: 'native-manifest-graph-test',
		setup(builder) {
			builder.onEnd((result) => {
				if (result.errors.length) return;
				assert.ok(result.metafile, 'The native build must expose its input graph.');
				inspected = true;
				for (const output of Object.values(result.metafile.outputs)) {
					for (const [input, contribution] of Object.entries(output.inputs)) {
						if (contribution.bytesInOutput > 0) emitted.add(input.replaceAll('\\', '/'));
					}
				}
			});
		},
	};
	// Use the actual native config and provider plugin, but never clean or overwrite dist.
	await build({
		...config,
		entry: [fileURLToPath(new URL('../src/native.ts', import.meta.url))],
		outDir,
		clean: false,
		dts: false,
		silent: true,
		esbuildPlugins: [...(config.esbuildPlugins ?? []), observer],
	});
	assert.ok(inspected);
	const files = [...emitted].sort();
	assert.deepEqual(files.filter((path) => /\/zod\/(?:src\/)?v4\/classic\//u.test(path)), []);
	assert.ok(files.some((path) => /\/zod\/(?:src\/)?v4\/mini\/schemas\.[cm]?js$/u.test(path)));
	assert.equal(files.some((path) => /manifest-schema-classic\.[cm]?ts$/u.test(path)), false);
});


test('keeps the Mini adapter and internal grammar construction out of public declarations', async () => {
	for (const name of ['index', 'manifest', 'native']) {
		const declaration = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), 'utf8');
		assert.doesNotMatch(declaration, /zod\/mini|ManifestSchemaOperations|createTileflowRuntimeManifestSchema/u);
	}
});
