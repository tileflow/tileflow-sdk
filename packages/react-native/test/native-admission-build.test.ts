import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {nativePackageFiles} from './native-admission-pack-files';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

test('native build metadata is explicit, pinned, and does not activate networking', async () => {
	const manifest = JSON.parse(await text('package.json'));
	assert.deepEqual(manifest.files, nativePackageFiles);
	assert.equal(manifest.private, true);
	assert.deepEqual(Object.keys(manifest.exports), ['.']);
	assert.equal(manifest.codegenConfig, undefined);
	const config = createRequire(import.meta.url)(fileURLToPath(new URL('react-native.config.cjs', root)));
	assert.deepEqual(Object.keys(config), ['dependency']);
	assert.deepEqual(config.dependency.platforms.ios, {});
	assert.equal(config.dependency.platforms.android.packageImportPath, 'import dev.tileflow.reactnative.TileflowNativeAdmissionPackage;');
	assert.equal(config.dependency.platforms.android.packageInstance, 'new TileflowNativeAdmissionPackage()');
	const gradle = await text('android/build.gradle');
	for (const pin of ['0.83.10', '13.2.0', '4.12.0']) assert.ok(gradle.includes(pin), pin);
	assert.match(gradle, /strictly/u);
	assert.match(gradle, /com\.android\.library/u);
	assert.match(await text('android/src/main/AndroidManifest.xml'), /android\.permission\.INTERNET/u);
	const podspec = await text('TileflowNativeAdmission.podspec');
	assert.match(podspec, /MapLibreReactNative['"],\s*['"]11\.3\.10/u);
	assert.match(podspec, /React-Core['"],\s*['"]0\.83\.10/u);
	assert.doesNotMatch(podspec, /dependency\s+['"]MapLibre['"]/u);
	assert.match(podspec, /install_modules_dependencies/u);
	const spm = await text('ios/tileflow_native_admission.rb');
	assert.match(spm, /6\.26\.0/u);
	assert.match(spm, /exactVersion/u);
	assert.match(spm, /package_product_dependencies/u);
	assert.match(spm, /frameworks_build_phase/u);
	assert.doesNotMatch(spm, /shell_script|script_phase|\bsystem\s*\(|\bexec\s*\(/u);
	const build = await text('tsup.config.ts');
	assert.match(build, /['"]internal\/native-admission['"]:\s*['"]src\/native-admission-owner\.ts['"]/u);
	assert.match(build, /['"]internal\/native-admission-bridge['"]:\s*['"]src\/native-admission-bridge\.ts['"]/u);
});

test('native adapters have no global protocol registration or grant logger', async () => {
	for (const path of [
		'android/src/main/java/dev/tileflow/reactnative/AdmissionBootstrap.kt',
		'android/src/main/java/dev/tileflow/reactnative/AdmissionBootstrapOkHttpNetwork.kt',
		'android/src/main/java/dev/tileflow/reactnative/AdmissionOkHttpNetwork.kt',
		'android/src/main/java/dev/tileflow/reactnative/TileflowNativeAdmissionModule.kt',
		'ios/TFAdmissionBootstrap.mm', 'ios/TFAdmissionNetwork.mm',
		'ios/TFAdmissionInstallation.mm', 'ios/TFNativeAdmissionURLProtocol.mm', 'ios/TileflowNativeAdmission.mm',
	]) {
		const source = await text(path);
		assert.doesNotMatch(source, /TransformRequestManager|HttpLoggingInterceptor|\bTimber\.|\bLog\.|\bprintln\s*\(|\bNSLog\s*\(|\bos_log\s*\(/u, path);
		assert.doesNotMatch(source, /registerClass\s*:/u, path);
	}
	const android = await text('android/src/main/java/dev/tileflow/reactnative/AdmissionBootstrapOkHttpNetwork.kt');
	assert.match(android, /followRedirects\(false\)/u);
	assert.match(android, /followSslRedirects\(false\)/u);
	const ios = await text('ios/TileflowNativeAdmission.mm');
	assert.match(ios, /responseByteLimit:65536\s+queueDepth:32\s+concurrency:4/u);
	assert.match(ios, /configuration\.protocolClasses\s*=\s*@\[\]/u);
	assert.match(ios, /RCT_REMAP_METHOD\(cancelBootstrap/u);
});
