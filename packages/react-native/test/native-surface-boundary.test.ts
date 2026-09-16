import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFile(new URL(path, root), 'utf8');

test('native surface adapters observe only their owned view and redact all native errors', async () => {
	for (const path of [
		'android/src/main/java/dev/tileflow/reactnative/TileflowNativeSurfaceModule.kt',
		'ios/TileflowNativeSurface.mm',
	]) {
		const value = await source(path);
		assert.match(value, /handleImperativeStop/u);
		assert.doesNotMatch(value, /\bLog\.|\bLogger\.|\bTimber\.|\bNSLog\s*\(|\bos_log\s*\(|registerClass|method_exchangeImplementations/u);
		assert.doesNotMatch(value, /X-Tileflow-Native-Grant|X-Tileflow-Mobile-Client|tf_public_[0-9a-f]{48}/u);
	}
	const android = await source('android/src/main/java/dev/tileflow/reactnative/TileflowNativeSurfaceModule.kt');
	assert.match(android, /OnPreDrawListener/u);
	assert.match(android, /REASON_API_GESTURE/u);
	assert.match(android, /removeOnDidFinishRenderingFrameListener/u);
	assert.match(android, /UIManagerHelper/u);
	assert.match(android, /current\(id, allowFailed = true\)/u);
	const ios = await source('ios/TileflowNativeSurface.mm');
	assert.match(ios, /viewRegistry_DEPRECATED/u);
	assert.match(ios, /addUIBlock/u);
	assert.match(ios, /regionWillChangeWithReason/u);
	assert.match(ios, /CATransaction/u);
	assert.match(ios, /delegate ==/u);
	assert.match(ios, /@try\s*\{\s*return TFSurfaceMap\(self\.root\) == self\.map;/u);
	assert.match(ios, /\[attachment\.state close\];\s*return;/u);
	assert.match(ios, /NSMutableDictionary \*pitchStop = \[target mutableCopy\]/u);
	assert.match(ios, /\[pitchStop removeObjectForKey:@"zoom"\]/u);
	assert.match(ios, /\[camera handleImperativeStop:pitchStop\][\s\S]*\[camera handleImperativeStop:stop\]/u);
});

test('surface code has private build wiring without widening peers or publishing a native handle', async () => {
	const gradle = await source('android/build.gradle');
	assert.match(gradle, /implementation project\(':maplibre_maplibre-react-native'\)/u);
	const registration = await source('android/src/main/java/dev/tileflow/reactnative/TileflowNativeAdmissionPackage.kt');
	assert.match(registration, /TileflowNativeSurfaceModule\(context\)/u);
	const podspec = await source('TileflowNativeAdmission.podspec');
	assert.match(podspec, /Headers\/Private\/MapLibreReactNative/u);
	assert.match(podspec, /dependency 'MapLibreReactNative', '11\.3\.10'/u);
	assert.doesNotMatch(podspec, /public_header_files/u);
	const contract = await source('src/contract.ts');
	assert.doesNotMatch(contract, /NativeSurface|SurfaceHandle|attachSurface|applyCamera|prepare\(/u);
	const manifest = JSON.parse(await source('package.json'));
	assert.equal(manifest.private, true);
	assert.deepEqual(manifest.peerDependencies, {
		'@maplibre/maplibre-react-native': '11.3.10', react: '19.2.0', 'react-native': '0.83.10',
	});
});
