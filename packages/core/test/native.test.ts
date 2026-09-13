import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveTileflowNativeManifestUrl,
	resolveTileflowNativeResourceUrl,
	type TileflowNativeResourceUrlOptions,
	TileflowNativeUrlError,
	type TileflowNativeUrlErrorCode,
	type TileflowNativeUrlField,
	tileflowNativeUrlLimits,
} from '../src/native.js';

const documentUrl = 'https://maps.example.test/app/generations/123/manifest.json';

function expectError(
	operation: () => unknown,
	code: TileflowNativeUrlErrorCode,
	field: TileflowNativeUrlField,
): void {
	assert.throws(operation, (error: unknown) => {
		assert.ok(error instanceof TileflowNativeUrlError);
		assert.ok(error instanceof TypeError);
		assert.equal(error.name, 'TileflowNativeUrlError');
		assert.equal(error.code, code);
		assert.equal(error.field, field);
		return true;
	});
}

test('requires an explicit manifest URL rather than a browser or Metro default', () => {
	for (const value of [
		'/tileflow/manifest.json',
		'./manifest.json',
		'manifest.json',
		'//maps.example.test/a',
	]) {
		expectError(
			() => resolveTileflowNativeManifestUrl(value),
			'NATIVE_URL_ABSOLUTE_REQUIRED',
			'manifestUrl',
		);
	}
});

test('canonicalizes an HTTPS manifest without rebuilding its query string', () => {
	assert.equal(
		resolveTileflowNativeManifestUrl(
			'HTTPS://MAPS.EXAMPLE.TEST:443/a/../manifest.json?a=1+2&b=%2f&b=3',
		),
		'https://maps.example.test/manifest.json?a=1+2&b=%2f&b=3',
	);
});

for (const [label, value] of [
	['missing', undefined],
	['null', null],
	['number', 12],
	['array', []],
	['object', {}],
	['empty', ''],
	['leading space', ' https://maps.example.test/a'],
	['trailing space', 'https://maps.example.test/a '],
	['newline', 'https://maps.example.test/\na'],
	['tab', 'https://maps.example.test/\ta'],
	['control', 'https://maps.example.test/\u0085a'],
	['backslash', 'https://maps.example.test\\evil.test/a'],
	['fragment', 'https://maps.example.test/a#section'],
	['empty fragment', 'https://maps.example.test/a#'],
	['malformed percent', 'https://maps.example.test/a%'],
	['invalid percent', 'https://maps.example.test/a%GG'],
	['username', 'https://user@maps.example.test/a'],
	['password', 'https://user:secret@maps.example.test/a'],
	['empty userinfo', 'https://@maps.example.test/a'],
	['encoded userinfo', 'https://%75ser@maps.example.test/a'],
	['incomplete HTTPS', 'https:maps.example.test/a'],
	['extra slash', 'https:///maps.example.test/a'],
	['invalid port', 'https://maps.example.test:99999/a'],
	['file', 'file:///private/map.json'],
	['data', 'data:application/json,{}'],
	['JavaScript', 'javascript:alert(1)'],
	['blob', 'blob:https://maps.example.test/id'],
	['PMTiles', 'tileflow-pmtiles://https://maps.example.test/a.pmtiles'],
	['contours', 'tileflow-contour://https://maps.example.test/{z}/{x}/{y}'],
] as const) {
	test(`rejects ${label} manifest input`, () => {
		expectError(() => resolveTileflowNativeManifestUrl(value), 'NATIVE_URL_INVALID', 'manifestUrl');
	});
}

test('applies HTTPS by default even to development-looking addresses', () => {
	for (const host of ['localhost', '127.0.0.1', '[::1]', '192.168.1.5', 'maps.example.test']) {
		expectError(
			() => resolveTileflowNativeManifestUrl(`http://${host}/manifest.json`),
			'NATIVE_URL_HTTPS_REQUIRED',
			'manifestUrl',
		);
	}
});

test('allows only the selected development scheme, host and port', () => {
	const options = Object.freeze({developmentOrigin: 'HTTP://LOCALHOST:8080/'});
	assert.equal(
		resolveTileflowNativeManifestUrl('http://localhost:8080/maps/manifest.json', options),
		'http://localhost:8080/maps/manifest.json',
	);
	for (const url of [
		'http://localhost/a',
		'http://localhost:8081/a',
		'http://127.0.0.1:8080/a',
		'http://localhost.evil.test:8080/a',
	]) {
		expectError(
			() => resolveTileflowNativeManifestUrl(url, options),
			'NATIVE_URL_HTTPS_REQUIRED',
			'manifestUrl',
		);
	}
	assert.equal(resolveTileflowNativeManifestUrl(documentUrl, options), documentUrl);
});

test('normalizes default ports and IPv6 development origins through URL parsing', () => {
	assert.equal(
		resolveTileflowNativeManifestUrl('http://localhost/a', {
			developmentOrigin: 'http://localhost:80',
		}),
		'http://localhost/a',
	);
	assert.equal(
		resolveTileflowNativeManifestUrl('http://[::1]:8080/a', {
			developmentOrigin: 'http://[0:0:0:0:0:0:0:1]:8080',
		}),
		'http://[::1]:8080/a',
	);
});

for (const origin of [
	'',
	'*',
	'http://*.example.test',
	'localhost:8080',
	'//localhost:8080',
	'https://localhost:8080',
	'http://localhost/path',
	'http://localhost/.',
	'http://localhost/a/..',
	'http://localhost?x=1',
	'http://localhost?',
	'http://localhost#',
	'http://user:secret@localhost',
	'http://@localhost',
	' http://localhost',
	'http://localhost\\a',
]) {
	test(`rejects ambiguous development origin ${JSON.stringify(origin)}`, () => {
		expectError(
			() => resolveTileflowNativeManifestUrl(documentUrl, {developmentOrigin: origin}),
			'NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID',
			'developmentOrigin',
		);
	});
}

test('resolves style URLs against the manifest without inheriting its access query', () => {
	assert.equal(
		resolveTileflowNativeResourceUrl('styles/main/light.json', {
			documentUrl: `${documentUrl}?key=manifest-only`,
		}),
		'https://maps.example.test/app/generations/123/styles/main/light.json',
	);
	assert.equal(
		resolveTileflowNativeResourceUrl('/shared/style.json', {documentUrl}),
		'https://maps.example.test/shared/style.json',
	);
	assert.equal(
		resolveTileflowNativeResourceUrl('../manifest.json', {documentUrl}),
		'https://maps.example.test/app/generations/manifest.json',
	);
});

test('resolves each nested resource from its actual owning document', () => {
	const style = resolveTileflowNativeResourceUrl('styles/main/light.json', {documentUrl});
	const tilejson = resolveTileflowNativeResourceUrl('../../data/streets/tiles.json', {
		documentUrl: style,
	});
	const tile = resolveTileflowNativeResourceUrl('./{z}/{x}/{y}.pbf', {
		documentUrl: tilejson,
		template: 'tile',
	});
	assert.equal(tile, 'https://maps.example.test/app/generations/123/data/streets/{z}/{x}/{y}.pbf');
	assert.equal(
		resolveTileflowNativeResourceUrl('../../fonts/face.ttf', {documentUrl: style}),
		'https://maps.example.test/app/generations/123/fonts/face.ttf',
	);
});

test('leaves external HTTPS resources external without adding delivery parameters', () => {
	const resource = 'https://cdn.example.test/tiles?a=2+3&b=%2F&b=4';
	assert.equal(resolveTileflowNativeResourceUrl(resource, {documentUrl}), resource);
});

test('supports names containing spaces and percent-encoded literal delimiters', () => {
	assert.equal(
		resolveTileflowNativeResourceUrl('fonts/Noto Sans.ttf', {documentUrl}),
		'https://maps.example.test/app/generations/123/fonts/Noto%20Sans.ttf',
	);
	assert.equal(
		resolveTileflowNativeResourceUrl('./icons/a%23b%40c.png', {documentUrl}),
		'https://maps.example.test/app/generations/123/icons/a%23b%40c.png',
	);
});

test('validates the owner even when the resource URL is absolute', () => {
	expectError(
		() =>
			resolveTileflowNativeResourceUrl('https://cdn.example.test/a', {
				documentUrl: '/manifest.json',
			}),
		'NATIVE_URL_ABSOLUTE_REQUIRED',
		'documentUrl',
	);
	expectError(
		() =>
			resolveTileflowNativeResourceUrl('https://cdn.example.test/a', {
				documentUrl: 'http://localhost/a',
			}),
		'NATIVE_URL_HTTPS_REQUIRED',
		'documentUrl',
	);
});

test('does not let a development document authorize another insecure resource origin', () => {
	const options = {
		documentUrl: 'http://192.168.1.5:8080/manifest.json',
		developmentOrigin: 'http://192.168.1.5:8080',
	};
	assert.equal(
		resolveTileflowNativeResourceUrl('style.json', options),
		'http://192.168.1.5:8080/style.json',
	);
	expectError(
		() => resolveTileflowNativeResourceUrl('http://192.168.1.6:8080/style.json', options),
		'NATIVE_URL_HTTPS_REQUIRED',
		'resourceUrl',
	);
});

test('does not authorize HTTP merely because the declaring document uses HTTPS', () => {
	expectError(
		() => resolveTileflowNativeResourceUrl('http://maps.example.test/a', {documentUrl}),
		'NATIVE_URL_HTTPS_REQUIRED',
		'resourceUrl',
	);
});

test('rejects network-path references, credentials and unsafe resource schemes', () => {
	for (const resource of [
		'//cdn.example.test/a',
		'///cdn.example.test/a',
		'file:///a',
		'https://user:password@cdn.example.test/a',
		'a#',
		'a\\b',
		'a%0',
		'',
	]) {
		expectError(
			() => resolveTileflowNativeResourceUrl(resource, {documentUrl}),
			'NATIVE_URL_INVALID',
			'resourceUrl',
		);
	}
});

test('preserves tile placeholders in paths and queries without expanding or encoding them', () => {
	const resource = './{z}/{x}/{y}{ratio}.pbf?q={quadkey}&bbox={bbox-epsg-3857}&prefix={prefix}';
	assert.equal(
		resolveTileflowNativeResourceUrl(resource, {documentUrl, template: 'tile'}),
		`https://maps.example.test/app/generations/123/${resource.slice(2)}`,
	);
});

test('preserves glyph placeholders without inventing font stacks', () => {
	assert.equal(
		resolveTileflowNativeResourceUrl('/glyphs/{fontstack}/{range}.pbf', {
			documentUrl,
			template: 'glyphs',
		}),
		'https://maps.example.test/glyphs/{fontstack}/{range}.pbf',
	);
});

test('preserves encoded braces as literal bytes, including beside real placeholders', () => {
	assert.equal(
		resolveTileflowNativeResourceUrl('/%7Bz%7D/{x}/%7by%7d?value=%7Brange%7D', {
			documentUrl,
			template: 'tile',
		}),
		'https://maps.example.test/%7Bz%7D/{x}/%7by%7d?value=%7Brange%7D',
	);
	assert.equal(
		resolveTileflowNativeResourceUrl('/%7Bz%7D', {documentUrl}),
		'https://maps.example.test/%7Bz%7D',
	);
});

test('avoids placeholder-marker collisions in the resource and its owner', () => {
	const owner = 'https://maps.example.test/__tileflow_native_template_0__/manifest.json';
	const resource = './__tileflow_native_template__0__/{z}/{x}/{y}.pbf';
	assert.equal(
		resolveTileflowNativeResourceUrl(resource, {documentUrl: owner, template: 'tile'}),
		`https://maps.example.test/__tileflow_native_template_0__/${resource.slice(2)}`,
	);
});

for (const resource of [
	'/tiles/{unknown}.pbf',
	'/tiles/{fontstack}.pbf',
	'/tiles/{Z}.pbf',
	'/tiles/{}.pbf',
	'/tiles/{z.pbf',
	'/tiles/z}.pbf',
	'/tiles/{{z}}.pbf',
	'https://{x}.example.test/{z}.pbf',
	'https://example.test:{x}/{z}.pbf',
]) {
	test(`rejects unsupported or authority-changing tile template ${resource}`, () => {
		expectError(
			() => resolveTileflowNativeResourceUrl(resource, {documentUrl, template: 'tile'}),
			'NATIVE_URL_TEMPLATE_INVALID',
			'resourceUrl',
		);
	});
}

test('requires an explicit template mode and keeps glyph and tile tokens separate', () => {
	expectError(
		() => resolveTileflowNativeResourceUrl('/{z}', {documentUrl}),
		'NATIVE_URL_TEMPLATE_INVALID',
		'resourceUrl',
	);
	expectError(
		() => resolveTileflowNativeResourceUrl('/{z}', {documentUrl, template: 'glyphs'}),
		'NATIVE_URL_TEMPLATE_INVALID',
		'resourceUrl',
	);
	expectError(
		() => resolveTileflowNativeResourceUrl('/a', {documentUrl, template: 'invalid' as 'tile'}),
		'NATIVE_URL_TEMPLATE_INVALID',
		'resourceUrl',
	);
});

test('never accepts template-bearing manifest or owner documents', () => {
	expectError(
		() => resolveTileflowNativeManifestUrl('https://maps.example.test/{z}/manifest.json'),
		'NATIVE_URL_TEMPLATE_INVALID',
		'manifestUrl',
	);
	expectError(
		() =>
			resolveTileflowNativeResourceUrl('/a', {
				documentUrl: 'https://maps.example.test/{z}/style.json',
				template: 'tile',
			}),
		'NATIVE_URL_TEMPLATE_INVALID',
		'documentUrl',
	);
});

test('bounds both supplied and fully resolved URL lengths', () => {
	const origin = 'https://maps.example.test/';
	const boundary = origin + 'a'.repeat(tileflowNativeUrlLimits.maximumLength - origin.length);
	assert.equal(resolveTileflowNativeManifestUrl(boundary), boundary);
	expectError(
		() => resolveTileflowNativeManifestUrl(boundary + 'a'),
		'NATIVE_URL_INVALID',
		'manifestUrl',
	);
	expectError(
		() => resolveTileflowNativeResourceUrl('a'.repeat(2_048), {documentUrl}),
		'NATIVE_URL_INVALID',
		'resourceUrl',
	);
	expectError(
		() => resolveTileflowNativeManifestUrl(origin + 'é'.repeat(400)),
		'NATIVE_URL_INVALID',
		'manifestUrl',
	);
});

test('does not charge the temporary placeholder encoding against the URL limit', () => {
	const origin = 'https://maps.example.test/';
	const template = origin + 'a'.repeat(2_048 - origin.length - 4) + '/{z}';
	assert.equal(
		resolveTileflowNativeResourceUrl(template, {documentUrl, template: 'tile'}),
		template,
	);
});

test('does not mutate caller-owned options', () => {
	const options: TileflowNativeResourceUrlOptions = Object.freeze({documentUrl, template: 'tile'});
	resolveTileflowNativeResourceUrl('./{z}/{x}/{y}.pbf', options);
	assert.deepEqual(options, {documentUrl, template: 'tile'});
});

test('keeps rejected URLs and original parser errors out of diagnostics', () => {
	const secret = 'do-not-print-this-secret';
	const developmentOrigin = `http://user:${secret}@localhost`;
	for (const operation of [
		() => resolveTileflowNativeManifestUrl(`https://user:${secret}@maps.example.test/a`),
		() => resolveTileflowNativeResourceUrl(`file:///private/${secret}`, {documentUrl}),
		() => resolveTileflowNativeManifestUrl(documentUrl, {developmentOrigin}),
	]) {
		assert.throws(operation, (error: unknown) => {
			assert.ok(error instanceof TileflowNativeUrlError);
			assert.equal(String(error).includes(secret), false);
			assert.equal(JSON.stringify(error).includes(secret), false);
			assert.equal(error.cause, undefined);
			return true;
		});
	}
});
