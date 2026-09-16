import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const packages = fileURLToPath(new URL('../../', import.meta.url));
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.svelte']);
const mobileImport = /^(?:react-native(?:\/|$)|@maplibre\/maplibre-react-native(?:\/|$)|@tileflow\/react-native(?:\/|$))/u;

async function sourceFiles(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await sourceFiles(path));
		else if (extensions.has(extname(path))) result.push(path);
	}
	return result;
}

function imports(source: string): string[] {
	const result: string[] = [];
	for (const pattern of [/\bfrom\s+['"]([^'"]+)['"]/gu, /\bimport\s+['"]([^'"]+)['"]/gu, /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/gu]) {
		for (const match of source.matchAll(pattern)) result.push(match[1]!);
	}
	return result;
}

test('existing workspace packages have no mobile dependencies or source imports', async () => {
	for (const directory of await readdir(packages, {withFileTypes: true})) {
		if (!directory.isDirectory() || directory.name === 'react-native') continue;
		const root = join(packages, directory.name);
		const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
		for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
			for (const dependency of Object.keys(manifest[section] ?? {})) assert.equal(mobileImport.test(dependency), false, `${directory.name}: ${dependency}`);
		}
		for (const file of await sourceFiles(join(root, 'src'))) {
			for (const specifier of imports(await readFile(file, 'utf8'))) assert.equal(mobileImport.test(specifier), false, `${file}: ${specifier}`);
		}
	}
});

test('contract source imports are type-only and runtime responsibilities remain isolated', async () => {
	const root = fileURLToPath(new URL('../src/', import.meta.url));
	for (const name of ['contract.ts', 'index.ts']) {
		const content = await readFile(join(root, name), 'utf8');
		const syntax = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		for (const statement of syntax.statements) {
			if (ts.isImportDeclaration(statement)) assert.equal(statement.importClause?.isTypeOnly, true, name);
			if (ts.isExportDeclaration(statement)) assert.equal(statement.isTypeOnly, true, name);
			assert.equal(ts.isExpressionStatement(statement), false, name);
			assert.equal(ts.isVariableStatement(statement), false, name);
			assert.equal(ts.isFunctionDeclaration(statement), false, name);
		}
	}
	for (const file of await sourceFiles(root)) {
		const content = await readFile(file, 'utf8');
		for (const specifier of imports(content)) {
			assert.equal(specifier.startsWith('node:'), false, file);
			if (specifier.startsWith('@tileflow/')) assert.equal(specifier, '@tileflow/core/native', file);
		}
		const syntax = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		for (const statement of syntax.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
			const specifier = statement.moduleSpecifier.text;
			if (specifier === '@maplibre/maplibre-react-native') assert.equal(statement.importClause?.isTypeOnly, true, file);
			const privatePlatformEntry = file === join(root, 'native-appearance.ts') || file === join(root, 'native-admission-bridge.ts');
			if (specifier === 'react-native' && !privatePlatformEntry) assert.equal(statement.importClause?.isTypeOnly, true, file);
		}
		assert.doesNotMatch(content, /import\s*\(\s*['"]@maplibre\/maplibre-react-native/u, file);
	}
});
