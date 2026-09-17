import {realpath, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {assertHermesBytecode, assertMobilePlatform, MobileSmokeError, mobileVersions, requireMobile} from './mobile-smoke-contract.mjs';
import {parseCommandJson} from './mobile-smoke-pack.mjs';
import {assertOwnedPath, mobileFileIdentity, readMobileFile, readMobileJson} from './mobile-smoke-workspace.mjs';

export async function checkMobilePrerequisites(context, mode, packageManager, pnpm, platform = process.platform) {
	assertMobilePlatform(mode, platform);
	const requirePrerequisite = (condition, name, code = 'PREREQUISITE_MISSING') => {
		if (!condition) throw new MobileSmokeError(code, 'prerequisites', name);
	};
	requirePrerequisite(Number(process.versions.node.split('.')[0]) >= 22, 'node', 'TOOLCHAIN_MISMATCH');
	const probe = async (name, command, args) => {
		try {
			return await context.run(command, args, {step: 'prerequisites', timeoutMs: 30000, maxOutputBytes: 1024 * 1024});
		} catch (error) {
			throw new MobileSmokeError(error instanceof MobileSmokeError ? error.code : 'PREREQUISITE_MISSING', 'prerequisites', name);
		}
	};
	const pnpmVersion = (await probe('pnpm', pnpm.command, [...pnpm.prefix, '--version'])).stdout.toString().trim();
	const npmVersion = (await probe('npm', 'npm', ['--version'])).stdout.toString().trim();
	requirePrerequisite(packageManager === `pnpm@${pnpmVersion}`, 'pnpm', 'TOOLCHAIN_MISMATCH');
	requirePrerequisite(/^\d+\.\d+\.\d+$/u.test(npmVersion), 'npm', 'TOOLCHAIN_MISMATCH');
	await probe('tar', 'tar', ['--version']);
	const tools = {node: process.versions.node, pnpm: pnpmVersion, npm: npmVersion};
	if (mode === 'android') {
		const javaHome = context.env.JAVA_HOME;
		const sdk = context.env.ANDROID_HOME ?? context.env.ANDROID_SDK_ROOT;
		requirePrerequisite(javaHome && resolve(javaHome) === javaHome, 'java-21');
		requirePrerequisite(sdk && resolve(sdk) === sdk, 'android-sdk-36');
		if (context.env.ANDROID_HOME && context.env.ANDROID_SDK_ROOT) {
			try {
				requirePrerequisite(await realpath(context.env.ANDROID_HOME) === await realpath(context.env.ANDROID_SDK_ROOT), 'android-sdk-36', 'TOOLCHAIN_MISMATCH');
			} catch (error) {
				throw error instanceof MobileSmokeError ? error : new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', 'android-sdk-36');
			}
		}
		const inputs = [
			['java-21', join(javaHome, 'bin', 'java')],
			['java-21', join(javaHome, 'bin', 'javac')],
			['android-sdk-36', join(sdk, 'platforms', `android-${mobileVersions.compileSdk}`, 'android.jar')],
			['android-build-tools-36.0.0', join(sdk, 'build-tools', mobileVersions.buildTools, 'aapt2')],
			['android-ndk-27.1.12297006', join(sdk, 'ndk', mobileVersions.ndk, 'source.properties')],
			['android-sdk-licenses', join(sdk, 'licenses', 'android-sdk-license')],
		];
		for (const [name, path] of inputs) {
			try {
				const metadata = await stat(path);
				requirePrerequisite(metadata.isFile() && metadata.size > 0, name);
			} catch {
				throw new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', name);
			}
		}
		const java = await probe('java-21', join(javaHome, 'bin', 'java'), ['-version']);
		const javac = await probe('java-21', join(javaHome, 'bin', 'javac'), ['-version']);
		const javaVersion = Buffer.concat([java.stdout, java.stderr]).toString().match(/version "(21\.[\d.]+)(?:[^"\n]*)"/u)?.[1];
		requirePrerequisite(javaVersion && /^javac 21\./u.test(Buffer.concat([javac.stdout, javac.stderr]).toString().trim()), 'java-21', 'TOOLCHAIN_MISMATCH');
		await probe('unzip', 'unzip', ['-v']);
		Object.assign(tools, {java: javaVersion, compileSdk: mobileVersions.compileSdk, buildTools: mobileVersions.buildTools, ndk: mobileVersions.ndk});
	} else if (mode === 'ios') {
		await probe('xcode', 'xcode-select', ['-p']);
		const xcode = (await probe('xcode', 'xcodebuild', ['-version'])).stdout.toString().match(/^Xcode ([\d.]+)$/mu)?.[1];
		const simulatorSdk = (await probe('ios-simulator-sdk', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])).stdout.toString().trim();
		const cocoaPods = (await probe('cocoapods', 'pod', ['--version'])).stdout.toString().trim();
		requirePrerequisite(xcode, 'xcode', 'TOOLCHAIN_MISMATCH');
		requirePrerequisite(/^\d+(?:\.\d+)+$/u.test(simulatorSdk), 'ios-simulator-sdk', 'TOOLCHAIN_MISMATCH');
		requirePrerequisite(/^\d+\.\d+\.\d+$/u.test(cocoaPods), 'cocoapods', 'TOOLCHAIN_MISMATCH');
		Object.assign(tools, {xcode, simulatorSdk, cocoaPods});
	}
	return tools;
}

export function androidReleaseArguments() {
	return [':app:assembleRelease', '--no-daemon', '--console=plain', '--max-workers=2', '-PhermesEnabled=true', '-Pandroid.builder.sdkDownload=false', '-Dorg.gradle.java.installations.auto-download=false', '-Dorg.gradle.internal.http.connectionTimeout=120000', '-Dorg.gradle.internal.http.socketTimeout=120000'];
}
export function iosReleaseArguments(consumer, derived, packages) {
	return ['-workspace', join(consumer.directory, 'ios', `${consumer.scheme}.xcworkspace`), '-scheme', consumer.scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived, '-clonedSourcePackagesDirPath', packages, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY='];
}

export async function buildMobileAndroid(context, consumer) {
	const directory = join(consumer.directory, 'android');
	const step = `android-${consumer.kind}`;
	const wrapper = (await readMobileFile(context.root, join(directory, 'gradle', 'wrapper', 'gradle-wrapper.properties'))).toString();
	requireMobile(wrapper.includes(`gradle-${mobileVersions.gradle}-bin.zip`) && wrapper.includes('services.gradle.org/distributions/'), 'TEMPLATE_INVALID', step);
	await context.run(join(directory, 'gradlew'), androidReleaseArguments(), {cwd: directory, step, timeoutMs: 60 * 60 * 1000});
	const output = join(directory, 'app', 'build', 'outputs', 'apk', 'release');
	const metadata = await readMobileJson(context.root, join(output, 'output-metadata.json'));
	requireMobile(metadata.variantName === 'release' && Array.isArray(metadata.elements) && metadata.elements.length > 0 && metadata.elements.length <= 8, 'BINARY_INVALID', step);
	const names = metadata.elements.map((element) => element.outputFile);
	requireMobile(names.every((name) => typeof name === 'string' && /^[A-Za-z0-9._-]+\.apk$/u.test(name)) && new Set(names).size === names.length, 'BINARY_INVALID', step);
	const files = [];
	for (const name of names.sort()) {
		const apk = join(output, name);
		await assertOwnedPath(context.root, apk);
		const bundle = await context.run('unzip', ['-p', apk, 'assets/index.android.bundle'], {step, maxOutputBytes: 64 * 1024 * 1024});
		const hermes = assertHermesBytecode(bundle.stdout);
		files.push({...await mobileFileIdentity(context.root, apk, `${consumer.kind}/${name}`), hermes});
	}
	return {consumer: consumer.kind, platform: 'android', configuration: 'Release', gradle: mobileVersions.gradle, files};
}

export async function buildMobileIos(context, consumer) {
	const directory = join(consumer.directory, 'ios');
	const step = `ios-${consumer.kind}`;
	await context.run('pod', ['install'], {cwd: directory, step, timeoutMs: 30 * 60 * 1000, env: {USE_HERMES: '1'}});
	const lockPath = join(directory, 'Podfile.lock');
	const lock = (await readMobileFile(context.root, lockPath)).toString();
	requireMobile(/TileflowNativeAdmission \(/u.test(lock) && /MapLibreReactNative \(11\.3\.10\)/u.test(lock), 'AUTOLINK_INVALID', step);
	const derived = join(context.root, `derived-${consumer.kind}`);
	const packages = join(context.root, `spm-${consumer.kind}`);
	const args = iosReleaseArguments(consumer, derived, packages);
	await context.run('xcodebuild', [...args, '-quiet', 'build'], {cwd: directory, step, timeoutMs: 60 * 60 * 1000, env: {USE_HERMES: '1'}});
	const settings = parseCommandJson(await context.run('xcodebuild', [...args, '-quiet', '-showBuildSettings', '-json'], {cwd: directory, step, timeoutMs: 5 * 60 * 1000}));
	requireMobile(Array.isArray(settings), 'BINARY_INVALID', step);
	const targets = settings.filter((entry) => entry.target === consumer.scheme && entry.buildSettings?.WRAPPER_EXTENSION === 'app');
	requireMobile(targets.length === 1, 'BINARY_INVALID', step);
	const build = targets[0].buildSettings;
	requireMobile(build.CONFIGURATION === 'Release' && build.PLATFORM_NAME === 'iphonesimulator' && typeof build.TARGET_BUILD_DIR === 'string' && /^[A-Za-z0-9_-]+\.app$/u.test(build.WRAPPER_NAME) && /^[A-Za-z0-9_-]+$/u.test(build.EXECUTABLE_NAME), 'BINARY_INVALID', step);
	const app = join(build.TARGET_BUILD_DIR, build.WRAPPER_NAME);
	await assertOwnedPath(derived, app);
	const bundlePath = join(app, 'main.jsbundle');
	const hermes = assertHermesBytecode(await readMobileFile(context.root, bundlePath, 64 * 1024 * 1024));
	const executable = await mobileFileIdentity(context.root, join(app, build.EXECUTABLE_NAME), `${consumer.kind}/${build.WRAPPER_NAME}/${build.EXECUTABLE_NAME}`);
	const bundle = await mobileFileIdentity(context.root, bundlePath, `${consumer.kind}/${build.WRAPPER_NAME}/main.jsbundle`);
	return {consumer: consumer.kind, platform: 'ios', destination: 'simulator', configuration: 'Release', hermes, files: [executable, bundle], podsLock: await mobileFileIdentity(context.root, lockPath, `${consumer.kind}-Podfile.lock`)};
}
