import assert from 'node:assert/strict';
import test from 'node:test';
import {z} from 'zod';
import {
	parseTileflowRuntimeManifest,
	safeParseTileflowRuntimeManifest,
	tileflowRuntimeManifestSchema,
} from '../src/manifest';
import type {TileflowRuntimeManifest} from '../src/manifest-types';
import {parseTileflowRuntimeManifest as parseNative} from '../src/native-manifest-schema';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from '../src/portable-identity';
import {manifest} from './native-manifest-fixture';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
	? true : false;
type Expect<T extends true> = T;
type ParseOutput = Expect<Equal<ReturnType<typeof parseTileflowRuntimeManifest>, TileflowRuntimeManifest>>;
type SafeOutput = Expect<Equal<ReturnType<typeof safeParseTileflowRuntimeManifest>, z.ZodSafeParseResult<TileflowRuntimeManifest>>>;
type SchemaOutput = Expect<Equal<z.output<typeof tileflowRuntimeManifestSchema>, TileflowRuntimeManifest>>;
const publicTypes: [ParseOutput, SafeOutput, SchemaOutput] = [true, true, true];

async function parity(value: unknown, success: boolean, issuePath?: PropertyKey[]): Promise<void> {
	const host = safeParseTileflowRuntimeManifest(value);
	assert.equal(host.success, success);
	const asynchronous = await tileflowRuntimeManifestSchema.safeParseAsync(value);
	assert.equal(asynchronous.success, success);
	if (host.success) {
		assert.deepEqual(parseNative(value), host.data);
		assert.deepEqual(parseTileflowRuntimeManifest(value), host.data);
		assert.deepEqual(await tileflowRuntimeManifestSchema.parseAsync(value), host.data);
		assert.deepEqual(asynchronous, host);
		return;
	}
	assert.ok(host.error instanceof z.ZodError);
	assert.ok(host.error instanceof Error);
	assert.equal(host.error.name, 'ZodError');
	assert.deepEqual(asynchronous.success ? [] : asynchronous.error.issues, host.error.issues);
	if (issuePath) assert.ok(host.error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(issuePath)));
	assert.throws(() => parseNative(value), (error: unknown) => {
		assert.deepEqual((error as {issues: unknown}).issues, host.error.issues);
		return true;
	});
	assert.throws(() => parseTileflowRuntimeManifest(value), (error: unknown) => {
		assert.ok(error instanceof z.ZodError);
		assert.deepEqual(error.issues, host.error.issues);
		assert.deepEqual(error.flatten(), host.error.flatten());
		assert.deepEqual(error.format(), host.error.format());
		return true;
	});
	await assert.rejects(tileflowRuntimeManifestSchema.parseAsync(value), z.ZodError);
}

test('preserves the public classic schema, errors and composition methods', async () => {
	assert.deepEqual(publicTypes, [true, true, true]);
	assert.ok(tileflowRuntimeManifestSchema instanceof z.ZodType);
	assert.equal(tileflowRuntimeManifestSchema.type, 'pipe');
	assert.ok(tileflowPortableIdSchema instanceof z.ZodString);
	assert.ok(tileflowThemeNameSchema instanceof z.ZodString);
	assert.equal(tileflowPortableIdSchema.max(2).safeParse('long').success, false);
	assert.equal(tileflowThemeNameSchema.regex(/^dark$/u).safeParse('light').success, false);
	assert.equal(tileflowRuntimeManifestSchema.optional().parse(undefined), undefined);
	const composed = tileflowRuntimeManifestSchema.refine(() => false, 'Composition failed.');
	assert.equal(composed.safeParse(manifest()).success, false);
	await parity(manifest(), true);
	await parity({...manifest(), unexpected: true}, false, []);
	await parity(undefined, false, []);
});

test('keeps strict nested objects and unsafe-input rejection identical', async () => {
	for (const path of [[], ['maps', 'streets'], ['maps', 'streets', 'themes', 'light'],
		['maps', 'streets', 'systemThemes'], ['maps', 'streets', 'view'],
		['maps', 'streets', 'themes', 'light', 'fontFaces', 0]] as const) {
		const value = manifest();
		Object.assign(value.maps.streets.themes.light, {fontFaces: [{family: 'Fixture', source: './a.ttf'}]});
		let target: object = value;
		for (const key of path) target = (target as Record<PropertyKey, object>)[key]!;
		Object.assign(target, {extra: true});
		await parity(value, false, [...path]);
	}
	await parity(Object.assign(Object.create(null), manifest()), true);
	await parity(Object.assign(Object.create({inherited: true}), manifest()), false, []);
	const inherited = manifest();
	inherited.maps.streets.view = Object.assign(Object.create({hidden: 1}), inherited.maps.streets.view);
	await parity(inherited, false, ['maps', 'streets', 'view']);
	const unsafe = manifest();
	Object.defineProperty(unsafe.maps.streets.themes.light, '__proto__', {value: {}, enumerable: true});
	await parity(unsafe, false, ['maps', 'streets', 'themes', 'light', '__proto__']);
});

test('retains identity checks, optional fields and cross-field refinement order', async () => {
	for (const [name, valid] of [['a', true], ['a'.repeat(64), true], ['a'.repeat(65), false],
		['constructor', false], ['prototype', false], ['CON', false], ['Upper', false], ['system', false]] as const) {
		await parity({version: 1, maps: {main: {defaultTheme: name,
			themes: {[name]: {colorScheme: 'light', styleUrl: './style.json'}}}}}, valid);
	}
	for (const change of [
		{themes: {}}, {defaultTheme: 'missing'}, {systemThemes: {light: 'dark', dark: 'light'}},
		{systemThemes: {light: 'absent', dark: 'dark'}}, {usageMode: 'session'}, {worldGeneration: 'v1'},
	]) {
		const value = manifest();
		Object.assign(value.maps.streets, change);
		await parity(value, false);
	}
	const valid = manifest();
	Object.assign(valid.maps.streets, {apiUrl: undefined, usageMode: 'session', worldGeneration: 'v1'});
	await parity(valid, true);
	for (const faces of [
		[{family: 'A', source: './a.ttf'}, {family: 'A', source: './b.ttf', style: 'normal', weight: '400'}],
		Array.from({length: 17}, (_, index) => ({family: `F${index}`, source: './a.ttf'})),
	]) {
		const value = manifest();
		Object.assign(value.maps.streets.themes.light, {fontFaces: faces});
		await parity(value, false);
	}
});

test('retains numeric, collection, UTF-8 byte and URL boundaries', async () => {
	for (const [pitch, valid] of [[0, true], [85, true], [-1, false], [86, false],
		[Infinity, false], [-Infinity, false], [NaN, false]] as const) {
		const value = manifest(); value.maps.streets.view.pitch = pitch;
		await parity(value, valid, valid ? undefined : ['maps', 'streets', 'view', 'pitch']);
	}
	for (const size of [64, 65]) {
		const themes = Object.fromEntries(Array.from({length: size}, (_, i) =>
			[`t${i}`, {colorScheme: 'light', styleUrl: './style.json'}]));
		await parity({version: 1, maps: {main: {defaultTheme: 't0', themes}}}, size === 64);
	}
	for (const count of [1000, 1001]) {
		const maps = Object.fromEntries(Array.from({length: count}, (_, i) => [`m${i}`, {
			defaultTheme: 'light', themes: {light: {colorScheme: 'light', styleUrl: './s.json'}},
		}]));
		await parity({version: 1, maps}, count === 1000);
	}
	const maps = Object.fromEntries(Array.from({length: 240}, (_, i) => [`m${i}`, {
		defaultTheme: 'light', themes: {light: {colorScheme: 'light', styleUrl: './' + '界'.repeat(1500)}},
	}]));
	await parity({version: 1, maps}, false, []);
	for (const [url, valid] of [['./a.json', true], ['../a.json', true], ['/a.json', true],
		['https://bücher.example.test/a.json', true], ['a.json', false], ['//host/a', false],
		['https://user:secret@host/a', false], ['https://host/a#fragment', false],
		['https://host/%2fsecret', false], ['file:///a', false]] as const) {
		const value = manifest(); value.maps.streets.themes.light.styleUrl = url;
		await parity(value, valid);
	}
	const original = manifest(); const before = JSON.stringify(original);
	const parsed = parseNative(original);
	assert.equal(JSON.stringify(original), before);
	assert.notEqual(parsed, original);
	assert.notEqual(parsed.maps.streets, original.maps.streets);
});
