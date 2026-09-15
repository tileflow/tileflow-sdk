import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

function runtimeImports(text: string): string[] {
	const imports: string[] = [];
	const source = ts.createSourceFile('session.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const visit = (node: ts.Node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push(node.getText());
		ts.forEachChild(node, visit);
	};
	visit(source);
	return imports;
}

test('session state stays internal and the public package entry remains type-only', async () => {
	const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
	assert.deepEqual(Object.keys(manifest.exports), ['.']);
	const publicRuntime = await readFile(new URL('dist/index.js', root), 'utf8');
	assert.deepEqual(runtimeImports(publicRuntime), []);
	assert.equal(publicRuntime.includes('session'), false);
	const declarations = await readFile(new URL('dist/index.d.ts', root), 'utf8');
	for (const name of ['HostedNativeSession', 'NativeSessionAuthority', 'X-Tileflow-Native-Grant']) {
		assert.equal(declarations.includes(name), false, name);
	}
});

test('the internal session entry has no renderer, React Native, Node or browser-global runtime dependency', async () => {
	const source = await readFile(new URL('dist/internal/session.js', root), 'utf8');
	const imports = runtimeImports(source);
	assert.deepEqual(imports, ['@tileflow/core/native']);
	for (const forbidden of ['react', 'react-native', 'maplibre', 'node:', 'window', 'document', 'navigator', 'globalThis.fetch', 'crypto.randomUUID']) {
		assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
	}
	const declaration = await readFile(new URL('dist/internal/session.d.ts', root), 'utf8');
	assert.match(declaration, /createHostedNativeSessionController/u);
	assert.match(declaration, /HostedNativeSessionFetch/u);
	assert.match(declaration, /HostedNativeSessionAuthority/u);
});

test('build wiring emits the session controller only as an internal artifact', async () => {
	const config = await readFile(new URL('tsup.config.ts', root), 'utf8');
	assert.match(config, /['"]internal\/session['"]:\s*['"]src\/session-controller\.ts['"]/u);
	const packageTest = await readFile(new URL('test/package.test.ts', root), 'utf8');
	assert.match(packageTest, /dist\/internal\/session\.js/u);
	assert.match(packageTest, /dist\/internal\/session\.d\.ts/u);
});
