import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createMobileConsumer, prepareMobileTemplates} from './mobile-smoke-consumers.mjs';
import {assertMobilePlatform, mobileConsumers, MobileSmokeError, mobileVersions, parseMobileArguments, projectMobileFailure, requireMobile, selectPnpm} from './mobile-smoke-contract.mjs';
import {buildMobileAndroid, buildMobileIos, checkMobilePrerequisites} from './mobile-smoke-native.mjs';
import {packMobilePackages} from './mobile-smoke-pack.mjs';
import {createMobileContext, withMobileWorkspace} from './mobile-smoke-workspace.mjs';

/** Stage-level injection tests ordering and failure propagation without native tools or installs. */
export async function runMobileSmokePlan(mode, operations) {
	requireMobile(['packed', 'android', 'ios'].includes(mode), 'INVALID_ARGUMENTS', 'arguments');
	const tools = await operations.prerequisites();
	const packages = await operations.pack();
	const templates = await operations.templates();
	const consumers = [];
	for (const kind of mobileConsumers) {
		consumers.push(await operations.consumer(kind, packages, templates));
	}
	const outputs = [];
	if (mode !== 'packed') {
		for (const consumer of consumers) {
			const output = await operations.native(mode, consumer);
			requireMobile(output?.consumer === consumer.kind && output.platform === mode && output.configuration === 'Release' && output.files?.length > 0, 'BINARY_INVALID');
			outputs.push(output);
		}
	}
	return {
		schemaVersion: 1,
		command: `smoke:mobile:${mode}`,
		ok: true,
		mode,
		versions: mobileVersions,
		tools,
		workspaceLock: packages.inputLock,
		packages: packages.tarballs.map(({name, version, identity}) => ({name, version, artifact: identity})),
		templates: mobileConsumers.map((kind) => ({package: templates[kind].name, version: templates[kind].version, artifact: templates[kind].identity})),
		generatorLock: templates.toolsLock,
		consumers: consumers.map(({receipt}) => receipt),
		outputs,
		qualification: {
			publicTypeScript: true,
			autolinkingPlatforms: ['android', 'ios'],
			nativeBinaryPlatforms: mode === 'packed' ? [] : [mode],
			launch: false, render: false, physicalDevice: false, hosted: false, registryPublication: false,
		},
	};
}

export async function runMobileSmoke(options, dependencies = {}) {
	const repository = dependencies.repository ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
	const platform = dependencies.platform ?? process.platform;
	assertMobilePlatform(options.mode, platform);
	const manifest = JSON.parse(await readFile(resolve(repository, 'package.json'), 'utf8'));
	const pnpm = selectPnpm(dependencies.environment ?? process.env);
	return withMobileWorkspace(async (root) => {
		const context = await createMobileContext(root, dependencies);
		const result = await runMobileSmokePlan(options.mode, {
			prerequisites: () => checkMobilePrerequisites(context, options.mode, manifest.packageManager, pnpm, platform),
			pack: () => packMobilePackages(context, repository, pnpm),
			templates: () => prepareMobileTemplates(context),
			consumer: (kind, packages, templates) => createMobileConsumer(context, kind, packages, templates),
			native: (mode, consumer) => mode === 'android' ? buildMobileAndroid(context, consumer) : buildMobileIos(context, consumer),
		});
		if (dependencies.signal?.aborted) throw new MobileSmokeError('COMMAND_CANCELLED');
		return result;
	}, {keep: options.keep, parent: dependencies.parent, onPreserved: dependencies.onPreserved});
}

async function main() {
	const controller = new AbortController();
	const abort = () => controller.abort();
	process.once('SIGINT', abort);
	process.once('SIGTERM', abort);
	let options;
	try {
		options = parseMobileArguments(process.argv.slice(2));
		const result = await runMobileSmoke(options, {
			signal: controller.signal,
			onPreserved: (root) => process.stderr.write(`Preserved diagnostic workspace (not a durable identity): ${root}\n`),
		});
		// Cleanup must finish before the only success document is emitted.
		if (controller.signal.aborted) throw new MobileSmokeError('COMMAND_CANCELLED');
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify({schemaVersion: 1, command: 'smoke:mobile', ok: false, ...(options ? {mode: options.mode} : {}), error: projectMobileFailure(error)})}\n`);
		process.exitCode = controller.signal.aborted ? 130 : 1;
	} finally {
		process.removeListener('SIGINT', abort);
		process.removeListener('SIGTERM', abort);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
