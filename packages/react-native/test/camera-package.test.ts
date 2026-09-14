import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

test('private built camera runs with global traps and never invokes a renderer or acquisition', async () => {
	const script = `
		import assert from 'node:assert/strict';
		for (const name of ['window', 'document', 'navigator', 'URL', 'URLSearchParams', 'fetch',
			'TextEncoder', 'TextDecoder', 'crypto', 'FontFace', 'Appearance', 'ReactNative', 'MapLibre']) {
			Object.defineProperty(globalThis, name, {configurable: true, get() { throw new Error(name); }});
		}
		const contract = await import('@tileflow/react-native');
		assert.deepEqual(Object.keys(contract), []);
		const {createMapCameraController} = await import('./dist/internal/camera.js');
		const commands = [];
		const events = [];
		const camera = createMapCameraController({apply(command) {
			commands.push(command); return {finished: Promise.resolve(), cancel() {}};
		}});
		camera.mount({initialView: {zoom: 4}, onViewChange: (event) => events.push(event)});
		const token = camera.startGesture();
		camera.endGesture(token, {center: [10, 20], zoom: 7, bearing: 0, pitch: 0});
		camera.settleGesture(token);
		camera.restoreAfterStyleChange();
		assert.equal(commands.length, 2);
		assert.equal(commands[1].view.zoom, 7);
		assert.equal(events.length, 1);
		assert.ok(Object.isFrozen(events[0].view.center));
		camera.dispose(); camera.dispose();

		const controlledCommands = [];
		let emitted;
		const controlled = createMapCameraController({apply(command) {
			controlledCommands.push(command); return {finished: Promise.resolve(), cancel() {}};
		}});
		const initial = {center: [0, 20], zoom: 2, bearing: 0, pitch: 0};
		const onViewChange = (event) => { emitted = event.view; };
		controlled.mount({view: initial, onViewChange});
		await Promise.resolve();
		const gesture = controlled.startGesture();
		controlled.endGesture(gesture, {...initial, zoom: 9});
		assert.deepEqual(controlledCommands.map((command) => command.view.zoom), [2]);
		controlled.update({view: emitted, onViewChange});
		controlled.settleGesture(gesture);
		assert.deepEqual(controlledCommands.map((command) => command.view.zoom), [2]);
		controlled.update({view: {...initial, zoom: 10}, onViewChange});
		controlled.settleGesture(gesture);
		assert.deepEqual(controlledCommands.map((command) => command.view.zoom), [2, 10]);
		controlled.dispose(); controlled.dispose();
	`;
	const {stdout, stderr} = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], {
		cwd: fileURLToPath(root), timeout: 10_000,
	});
	assert.equal(stdout, '');
	assert.equal(stderr, '');
});

test('camera is packaged privately while root, peers, exports and existing adapters stay unchanged', async () => {
	const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
	assert.equal(manifest.private, true);
	assert.deepEqual(Object.keys(manifest.exports), ['.']);
	const code = await readFile(new URL('dist/internal/camera.js', root), 'utf8');
	const imports: string[] = [];
	function visit(node: ts.Node): void {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
			imports.push(node.moduleSpecifier.text);
		}
		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
			(ts.isIdentifier(node.expression) && ['require', '__require'].includes(node.expression.text)))) imports.push(node.getText());
		ts.forEachChild(node, visit);
	}
	visit(ts.createSourceFile('camera.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
	assert.deepEqual([...new Set(imports)], ['@tileflow/core/native']);
	assert.doesNotMatch(code, /react-native|maplibre|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|createTileflowNativeSourceController/u);
	const internalDeclarations = await readFile(new URL('dist/internal/camera.d.ts', root), 'utf8');
	assert.match(internalDeclarations, /settleGesture/u);
	const declarations = await readFile(new URL('dist/index.d.ts', root), 'utf8');
	for (const name of ['MapProps', 'MapCameraProps', 'MapViewChangeEvent']) assert.ok(declarations.includes(name), name);
	assert.doesNotMatch(declarations, /declare (?:function|const|class) Map\b|createMapCameraController|CameraCommand|CameraToken|settleGesture/u);
	for (const entry of ['native', 'index', 'browser', 'native-profile']) {
		const core = await readFile(new URL(`../core/dist/${entry}.js`, root), 'utf8');
		assert.doesNotMatch(core, /createMapCameraController|CAMERA_MODE_CHANGE|restoreAfterStyleChange|settleGesture/u);
	}
	const readme = await readFile(new URL('README.md', root), 'utf8');
	assert.match(readme, /private workspace/u);
	assert.match(readme, /does not export a `Map` component/u);
	assert.match(readme, /initialView/u);
	assert.match(readme, /onViewChange/u);
	assert.doesNotMatch(readme, /not a complete `MapProps` interface|ownership is not part of `MapBaseProps`/u);
});
