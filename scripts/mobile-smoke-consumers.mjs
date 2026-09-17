import {mkdir, realpath, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {addIosPostInstallHooks, assertAutolinking, assertTemplateManifest, createConsumerManifest, mobileAppSource, mobilePackages, mobileVersions, requireMobile} from './mobile-smoke-contract.mjs';
import {packMobileTemplate, parseCommandJson} from './mobile-smoke-pack.mjs';
import {assertOwnedPath, copyMobileInputs, mobileFileIdentity, readMobileFile, readMobileJson, writeMobileFile, writeMobileJson} from './mobile-smoke-workspace.mjs';

export async function prepareMobileTemplates(context) {
	const expo = await packMobileTemplate(context, 'expo-template-bare-minimum', mobileVersions.expoTemplate, 'expo');
	const bare = await packMobileTemplate(context, '@react-native-community/template', mobileVersions.communityTemplate, 'bare');
	assertTemplateManifest('expo', await readMobileJson(context.root, join(expo.directory, 'package.json')));
	const bareMetadata = await readMobileJson(context.root, join(bare.directory, 'package.json'));
	requireMobile(bareMetadata.name === bare.name && bareMetadata.version === bare.version, 'TEMPLATE_INVALID', 'templates');
	assertTemplateManifest('bare', await readMobileJson(context.root, join(bare.directory, 'template', 'package.json')));
	const tools = join(context.root, 'tools');
	await mkdir(tools);
	await writeMobileJson(context.root, join(tools, 'package.json'), {
		name: 'tileflow-mobile-smoke-tools', private: true, version: '0.0.0',
		dependencies: {'@react-native-community/cli': mobileVersions.generatorCli},
	});
	await context.run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: tools, step: 'templates'});
	const cli = join(tools, 'node_modules', '@react-native-community', 'cli');
	const installed = await readMobileJson(context.root, join(cli, 'package.json'));
	requireMobile(installed.version === mobileVersions.generatorCli && typeof installed.bin?.['rnc-cli'] === 'string', 'INSTALL_INVALID', 'templates');
	const generator = resolve(cli, installed.bin['rnc-cli']);
	await readMobileFile(context.root, generator);
	return {expo, bare, generator, toolsLock: await mobileFileIdentity(context.root, join(tools, 'package-lock.json'), 'generator-package-lock.json')};
}

export function bareGeneratorArguments(template, directory) {
	return ['init', 'TileflowBareSmoke', '--version', mobileVersions.reactNative, '--template', `file:${template}`, '--directory', directory, '--pm', 'npm', '--skip-install', '--skip-git-init', '--install-pods', 'false', '--replace-directory', 'false'];
}
export function expoAutolinkingArguments(platform) {
	return ['--no-warnings', '--eval', "require('expo/bin/autolinking')", 'expo-modules-autolinking', 'react-native-config', '--json', '--platform', platform];
}

export async function createMobileConsumer(context, kind, packages, templates) {
	const directory = join(context.root, 'consumers', kind);
	await mkdir(join(context.root, 'consumers'), {recursive: true});
	if (kind === 'expo') {
		await copyMobileInputs(templates.expo.directory, directory);
	} else {
		await context.run(process.execPath, [templates.generator, ...bareGeneratorArguments(templates.bare.path, directory)], {step: 'bare'});
	}
	await assertOwnedPath(context.root, directory);
	const template = await readMobileJson(context.root, join(directory, 'package.json'));
	assertTemplateManifest(kind, template);
	const manifest = createConsumerManifest(kind, template, packages.tarballs, directory);
	await writeMobileJson(context.root, join(directory, 'package.json'), manifest);
	if (kind === 'expo') {
		await assertOwnedPath(context.root, join(directory, 'App.js'));
		await rm(join(directory, 'App.js'), {force: true});
	}
	await writeMobileFile(context.root, join(directory, 'App.tsx'), mobileAppSource);
	await writeMobileJson(context.root, join(directory, 'tsconfig.json'), {
		compilerOptions: {target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: ['react']},
		files: ['App.tsx'],
	});
	const podfile = join(directory, 'ios', 'Podfile');
	await writeMobileFile(context.root, podfile, addIosPostInstallHooks((await readMobileFile(context.root, podfile)).toString()));
	// Verify native template inputs even in packed mode, without invoking either native toolchain.
	await readMobileFile(context.root, join(directory, 'android', 'gradlew'));
	const properties = (await readMobileFile(context.root, join(directory, 'android', 'gradle.properties'))).toString();
	requireMobile(/^hermesEnabled=true\s*$/mu.test(properties), 'TEMPLATE_INVALID', kind);
	await context.run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: directory, step: kind});
	await assertInstalledMobilePackages(context, directory, manifest, packages.tarballs, kind);
	await context.run(process.execPath, [join(directory, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], {cwd: directory, step: kind});

	const installedRoot = await realpath(join(directory, 'node_modules', '@tileflow', 'react-native'));
	if (kind === 'expo') {
		for (const platform of ['android', 'ios']) {
			const document = parseCommandJson(await context.run(process.execPath, expoAutolinkingArguments(platform), {cwd: directory, step: kind, maxOutputBytes: 8 * 1024 * 1024}));
			assertAutolinking(document, platform, installedRoot, kind);
		}
	} else {
		const cli = join(directory, 'node_modules', '@react-native-community', 'cli');
		const metadata = await readMobileJson(context.root, join(cli, 'package.json'));
		requireMobile(metadata.version === mobileVersions.consumerCli && metadata.bin?.['rnc-cli'], 'INSTALL_INVALID', kind);
		const entry = resolve(cli, metadata.bin['rnc-cli']);
		await readMobileFile(context.root, entry);
		const document = parseCommandJson(await context.run(process.execPath, [entry, 'config'], {cwd: directory, step: kind, maxOutputBytes: 8 * 1024 * 1024}));
		for (const platform of ['android', 'ios']) assertAutolinking(document, platform, installedRoot, kind);
	}
	return {
		kind, directory, scheme: kind === 'expo' ? 'HelloWorld' : 'TileflowBareSmoke',
		receipt: {
			consumer: kind,
			typeScript: 'compiled',
			autolinking: {provider: kind === 'expo' ? 'expo' : 'community-cli', android: 'discovered', ios: 'discovered'},
			lock: await mobileFileIdentity(context.root, join(directory, 'package-lock.json'), `${kind}-package-lock.json`),
			directVersions: {...manifest.dependencies, ...manifest.devDependencies, ...Object.fromEntries(packages.tarballs.map(({name, version}) => [name, version]))},
		},
	};
}

async function assertInstalledMobilePackages(context, directory, manifest, tarballs, kind) {
	for (const [name, expected] of Object.entries({...manifest.dependencies, ...manifest.devDependencies})) {
		const packageRoot = join(directory, 'node_modules', ...name.split('/'));
		await assertOwnedPath(directory, packageRoot);
		const installed = await readMobileJson(context.root, join(packageRoot, 'package.json'));
		requireMobile(installed.name === name && installed.version === (expected.startsWith('file:') ? mobileVersions.package : expected), 'INSTALL_INVALID', kind);
	}
	for (const tarball of tarballs) {
		const packageRoot = join(directory, 'node_modules', ...tarball.name.split('/'));
		for (const file of tarball.files) {
			const expected = await readMobileFile(context.root, join(tarball.directory, file), 128 * 1024 * 1024);
			const actual = await readMobileFile(context.root, join(packageRoot, file), 128 * 1024 * 1024);
			requireMobile(actual.equals(expected), 'INSTALL_INVALID', kind);
		}
	}
	const resolver = `const {createRequire} = require('node:module');
const names = ${JSON.stringify(mobilePackages.map((name) => `@tileflow/${name}`))};
const direct = names.map((name) => require.resolve(name));
const fromNative = createRequire(direct[2]);
process.stdout.write(JSON.stringify([...direct, fromNative.resolve(names[0]), fromNative.resolve(names[1])]));`;
	const resolved = parseCommandJson(await context.run(process.execPath, ['-e', resolver], {cwd: directory, step: kind}));
	const expected = mobilePackages.map((name) => join(directory, 'node_modules', '@tileflow', name, 'dist', 'index.js'));
	requireMobile(JSON.stringify(resolved) === JSON.stringify([...expected, expected[0], expected[1]]), 'INSTALL_INVALID', kind);
}
