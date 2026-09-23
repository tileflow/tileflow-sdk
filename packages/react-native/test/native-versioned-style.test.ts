import assert from 'node:assert/strict';
import test from 'node:test';
import {authorityAllowsResource, nativeVersionedStyleMatchesMap} from '../src/native-admission-url';
import {projectNativeResources} from '../src/native-resource-projection';
import type {NativeAdmissionResource} from '../src/native-admission-contract';
import type {HostedNativeSessionAuthority} from '../src/session-controller';
import {apiOrigin, grant, mapId} from './session-fixture';

const url = `${apiOrigin}/maps/${mapId}/native/v7/light.json`;
const policy = {mapId, resourceOrigins: [apiOrigin], resourceScopes: ['style'] as const, tilesetIds: []};
const authority: HostedNativeSessionAuthority = {
	...policy, grant, sessionId: 'ses_fixture', surfaceId: 'fixture', credentialId: 'key_fixture',
	credentialRevision: 1, deliveryPolicyRevision: 1,
	issuedAt: '2026-09-15T20:00:00.000Z', serverTime: '2026-09-15T20:00:00.000Z',
	expiresAt: '2026-09-15T20:15:00.000Z', meterMode: 'disabled', disposition: 'unmetered',
};

test('the exact versioned style route admits safe positive versions and no aliases', () => {
	for (const version of [1, 7, Number.MAX_SAFE_INTEGER]) {
		assert.equal(nativeVersionedStyleMatchesMap(`${apiOrigin}/maps/${mapId}/native/v${version}/light.json`, mapId), true);
	}
	for (const invalid of [
		url.replace('/v7/', '/v0/'), url.replace('/v7/', '/v07/'),
		url.replace('/v7/', '/v9007199254740992/'), url.replace('/v7/', '/v-1/'),
		url.replace('/native/', '/%6eative/'), url.replace('light.json', '%6cight.json'),
		`${url}?map=${mapId}`, `${url}#fragment`,
		url.replace(mapId, 'map_abcdefghijklmnop'),
		`${apiOrigin}/maps/${mapId}/native/manifest.json`,
	]) {
		assert.equal(nativeVersionedStyleMatchesMap(invalid, mapId), false);
		assert.equal(authorityAllowsResource(authority, {url: invalid, scope: 'style'}, mapId), false);
	}
	assert.equal(authorityAllowsResource(authority, {url, scope: 'style'}, mapId), true);
});

test('projection acknowledges the exact versioned style before reading protected bytes', async () => {
	const accepted: NativeAdmissionResource[] = [];
	let reads = 0;
	const result = await projectNativeResources({
		styleUrl: url, policy, current: () => true, discriminate: (value) => value,
		async accept(resources) { accepted.push(...resources); },
		async read(value, _maximum, resource) {
			reads++;
			assert.equal(value, url);
			assert.deepEqual(resource, {url, scope: 'style'});
			assert.ok(accepted.some((entry) => entry.url === value));
			return {url, bytes: 44, value: {version: 8, sources: {}, layers: []}};
		},
	});
	assert.equal(reads, 1);
	assert.deepEqual(result.resources, [{url, scope: 'style'}]);
	for (const invalid of [url.replace(mapId, 'map_abcdefghijklmnop'), `${url}?alias=1`]) {
		await assert.rejects(projectNativeResources({
			styleUrl: invalid, policy, current: () => true, discriminate: (value) => value,
			async accept() { assert.fail('Invalid style cannot enter the catalog.'); },
			async read() { assert.fail('Invalid style cannot acquire authority.'); },
		}));
	}
});
