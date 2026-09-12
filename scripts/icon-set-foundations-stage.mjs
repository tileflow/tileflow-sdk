import {readFileSync, writeFileSync} from 'node:fs';

function replace(path, before, after) {
	const source = readFileSync(path, 'utf8');
	if (source.includes(after)) return;
	if (source.split(before).length !== 2) throw new Error(`Expected one checked baseline occurrence in ${path}: ${before.slice(0, 80)}`);
	writeFileSync(path, source.replace(before, after));
}
function append(path, text) {
	const source = readFileSync(path, 'utf8');
	if (!source.includes(text.trim())) writeFileSync(path, `${source.trimEnd()}\n\n${text.trim()}\n`);
}

append('packages/core/src/index.ts', `export * from './icon-set';\nexport * from './icon-lock';\nexport * from './icon-json';\nexport * from './icon-composition';`);
replace('packages/core/src/maps/types.ts', "import type {TileflowFontDirectory, TileflowGlyphs, TileflowIconDirectory} from './assets';", "import type {TileflowFontDirectory, TileflowGlyphs} from './assets';\nimport type {TileflowIconSource} from '../icon-set';");
replace('packages/core/src/maps/types.ts', '  /** Ordered icon directories. Omission inherits; declaration replaces; [] means no icons. */\n  icons?: readonly TileflowIconDirectory[];', '  /** Ordered icon contributors. Omission inherits; declaration replaces; [] means no icons. */\n  icons?: readonly TileflowIconSource[];');
append('packages/core/src/maps/index.ts', "export {iconSet, type TileflowIconSource, type TileflowIconSetSource, type TileflowIconSetReference} from '../icon-set';");
replace('packages/core/src/resolved-map-schema.ts', "import {z} from 'zod';", "import {z} from 'zod';\nimport {collectTileflowIconSetReferences, tileflowIconSetSourceSchema, tileflowIconSourceLimit, type TileflowIconSource} from './icon-set';");
replace('packages/core/src/resolved-map-schema.ts', 'const iconDirectoriesSchema = z.array(assetDirectorySchema).max(32);', `const iconDirectoriesSchema = z.array(z.union([assetDirectorySchema, tileflowIconSetSourceSchema])).max(tileflowIconSourceLimit).superRefine((sources, context) => {
	try { collectTileflowIconSetReferences(sources as TileflowIconSource[]); }
	catch (cause) { context.addIssue({code: 'custom', message: cause instanceof Error ? cause.message : 'Invalid icon contributors'}); }
});`);

const manifestPath = 'packages/core/src/map-build-manifest.ts';
replace(manifestPath, "import {tileflowSemanticCompilerIdentity} from './cartography/semantic-compiler';", "import {tileflowSemanticCompilerIdentity} from './cartography/semantic-compiler';\nimport {parseTileflowIconComposition, tileflowRenderedIconIdentitySchema, type TileflowIconCompositionV1, type TileflowRenderedIconIdentity} from './icon-composition';\nimport {collectTileflowIconSetReferences} from './icon-set';");
replace(manifestPath, 'export type TileflowEffectiveIconSourceIdentity = {', 'export type TileflowEffectiveIconSourceIdentity = TileflowRenderedIconIdentity | {');
replace(manifestPath, '  icons: readonly TileflowEffectiveIconSourceIdentity[];\n};', '  icons: readonly TileflowEffectiveIconSourceIdentity[];\n  /** Exact ordered shared dependencies, separate from original-source history and output bytes. */\n  iconComposition?: TileflowIconCompositionV1;\n};');
replace(manifestPath, '  mapRevisionSha256: string;\n  mapVersion: number;', '  mapRevisionSha256: string;\n  /** Omission means the unchanged legacy v1 source contract. Shared sets use explicit v2. */\n  mapRevisionSchemaVersion?: 2;\n  mapVersion: number;');
replace(manifestPath, '            mapRevisionSha256,\n            mapVersion: map.version,', '            mapRevisionSha256,\n            ...(sourceAssets.iconComposition ? {mapRevisionSchemaVersion: 2 as const} : {}),\n            mapVersion: map.version,');
replace(manifestPath, 'export const tileflowMapRevisionSchemaVersion = 1 as const;', 'export const tileflowMapRevisionSchemaVersion = 1 as const;\nexport const tileflowSharedIconMapRevisionSchemaVersion = 2 as const;');
replace(manifestPath, '  const revisionDocument = {\n    canonicalization: tileflowMapRevisionCanonicalization,', '  const normalizedSources = normalizeSourceAssets(sourceAssets);\n  assertIconCompositionMatchesMap(map, normalizedSources);\n  const revisionDocument = {\n    canonicalization: tileflowMapRevisionCanonicalization,');
replace(manifestPath, '    schemaVersion: tileflowMapRevisionSchemaVersion,\n    sourceAssets: normalizeSourceAssets(sourceAssets),', '    schemaVersion: normalizedSources.iconComposition ? tileflowSharedIconMapRevisionSchemaVersion : tileflowMapRevisionSchemaVersion,\n    sourceAssets: normalizedSources,');
replace(manifestPath, '  return sha256Hex(`${tileflowMapRevisionDomain}${serializeCanonicalJson(revisionDocument)}`);', '  const domain = normalizedSources.iconComposition ? "tileflow-map-revision-v2\\0" : tileflowMapRevisionDomain;\n  return sha256Hex(`${domain}${serializeCanonicalJson(revisionDocument)}`);');
replace(manifestPath, '    .map((icon) => {\n      assertSha256(icon.sha256, `icon ${icon.id}`);', "    .map((icon) => {\n      if (icon.kind === 'rendered-icon') return tileflowRenderedIconIdentitySchema.parse(icon);\n      assertSha256(icon.sha256, `icon ${icon.id}`);");
replace(manifestPath, '  return {fonts, icons};', `  const iconComposition = input.iconComposition === undefined ? undefined : parseTileflowIconComposition(input.iconComposition);
	if (icons.some((icon) => icon.kind === 'rendered-icon') && !iconComposition) throw new Error('Rendered icon identities require an explicit composition receipt');
	return {fonts, icons, ...(iconComposition ? {iconComposition} : {})};`);
append(manifestPath, `function assertIconCompositionMatchesMap(map: ResolvedTileflowMap, sources: TileflowEffectiveMapSourceAssets): void {
	const declared = map.icons ?? [];
	const references = collectTileflowIconSetReferences(declared);
	const receipt = sources.iconComposition;
	if (references.length === 0 && receipt === undefined) return;
	if (!receipt || receipt.contributors.length !== declared.length) throw new Error('Shared icon dependencies require their complete ordered composition receipt');
	for (const [ordinal, source] of declared.entries()) {
		const contributor = receipt.contributors[ordinal]!;
		if (typeof source === 'string') {
			if (contributor.kind !== 'local') throw new Error('Icon contributor kind mismatch');
		} else if (source.kind === 'icon-set') {
			if (contributor.kind !== 'icon-set' || contributor.reference !== source.reference) throw new Error('Icon dependency reference mismatch');
		} else if (contributor.kind !== 'package' || contributor.package !== source.package) throw new Error('Package icon contributor mismatch');
	}
	if (sources.icons.length !== receipt.winners.length) throw new Error('Effective icon identities must cover the entire winner closure');
	for (const [ordinal, winner] of receipt.winners.entries()) {
		const identity = sources.icons[ordinal]!;
		if (identity.id !== winner.id) throw new Error('Effective icon identity mismatch');
		if (receipt.contributors[winner.contributor]!.kind === 'icon-set') {
			if (identity.kind !== 'rendered-icon' || identity.width !== winner.width || identity.height !== winner.height || identity.pixelSha256.oneX !== winner.pixelSha256.oneX || identity.pixelSha256.twoX !== winner.pixelSha256.twoX) throw new Error('Shared icon identity must match verified rendered pixels, not original-source hashes');
		} else if (identity.kind === 'rendered-icon') throw new Error('Local originals must retain their existing source identity');
	}
}`);
append('packages/core/src/build.ts', "export {tileflowSharedIconMapRevisionSchemaVersion} from './map-build-manifest';");

const iconsPath = 'packages/dev/src/icons.ts';
let icons = readFileSync(iconsPath, 'utf8');
if (!icons.includes('export async function readTileflowIconDirectory')) {
	icons = `import {isTileflowIconSetSource, TileflowIconSetError, type TileflowIconDirectory} from '@tileflow/core';\nimport {assertGeneratedFileLimits, createSpriteImage, createSpriteLayout, loadSharp, type TileflowSpriteIndex as SpriteIndex, type TileflowRenderedIcon} from './icon-sprite';\n${icons}`;
	function removeSection(start, end) {
		const first = icons.indexOf(start); const last = icons.indexOf(end, first + start.length);
		if (first < 0 || last < 0) throw new Error(`Missing sprite extraction boundary: ${start}`);
		icons = icons.slice(0, first) + icons.slice(last);
	}
	removeSection('type SpriteIndex = Record<', 'const iconFileExtensions');
	removeSection('function createSpriteLayout(', 'async function validateDecodedDimensions(');
	removeSection('async function createSpriteImage(', 'function validateHostedSvg(');
	removeSection('async function loadSharp()', 'function atlasRectangle(');
	const compileStart = icons.indexOf('async function compileInspectedIconSource(');
	const renderStart = icons.indexOf('  const rendered = await mapWithConcurrency(', compileStart);
	const layoutStart = icons.indexOf('  const layoutOneX = createSpriteLayout(', renderStart);
	if (renderStart < 0 || layoutStart < 0) throw new Error('Missing checked render extraction boundary');
	const renderBody = icons.slice(renderStart, layoutStart).replace('  const rendered = await mapWithConcurrency(', '  return mapWithConcurrency(').replace('    inspected.icons,', '    inputs,');
	icons = icons.slice(0, renderStart) + '  const rendered = await renderIconInputs(inspected.icons);\n' + icons.slice(layoutStart);
	icons += `\nasync function renderIconInputs(inputs: IconInput[]): Promise<CompiledIcon[]> {\n${renderBody}}\n`;
	const before = '      const directories = await resolveTileflowAssetDirectories(resolvedMap.icons ?? [], {';
	if (!icons.includes(before)) throw new Error('Missing directory request boundary');
	icons = icons.replace(before, `      const sourceDirectories = resolvedMap.icons ?? [];
			if (sourceDirectories.some(isTileflowIconSetSource)) throw new TileflowIconSetError('ICON_SET_INVALID', 'Shared icon sets require the explicit composeTileflowIconSources build port; command integration is not installed');
			const directories = await resolveTileflowAssetDirectories(sourceDirectories as readonly TileflowIconDirectory[], {`);
	icons += `
/** A bounded local source snapshot used by the explicit shared-composition build port. */
export async function readTileflowIconDirectory(source: TileflowIconDirectory, options: {cwd: string; baseDirectory: string; target: TileflowIconCompilationTarget}): Promise<{
	iconIds: string[];
	watchPath?: string;
	render: (ids: readonly string[]) => Promise<Array<{icon: TileflowRenderedIcon; identity: TileflowEffectiveIconSourceIdentity; sourceBytes: number}>>;
}> {
	const directory = (await resolveTileflowAssetDirectories([source], {...options, configPath: 'icons', kind: 'icons'}))[0];
	if (!directory) throw new TileflowIconCompilationError([{path: 'icons', message: 'Missing icon directory'}]);
	const issues: TileflowIconCompilationIssue[] = [];
	const inspected = await inspectIconSource(directory, options.target, issues);
	if (!inspected || issues.length) throw new TileflowIconCompilationError(issues);
	if (inspected.icons.length > tileflowIconPackageLimits.maxIconCount) throw new TileflowIconCompilationError([{path: 'icons', message: 'One icon contributor supports at most 256 exports'}]);
	return {
		iconIds: inspected.icons.map((icon) => icon.name),
		...(directory.watch ? {watchPath: directory.realPath} : {}),
		render: async (ids) => {
			const selected = new Set(ids);
			const inputs = inspected.icons.filter((icon) => selected.has(icon.name));
			if (inputs.length !== ids.length || inputs.reduce((sum, icon) => sum + icon.source.byteLength, 0) > tileflowIconPackageLimits.maxSourceBytes) throw new TileflowIconCompilationError([{path: 'icons', message: 'Selected icon inputs exceed their source budget or have invalid IDs'}]);
			return (await renderIconInputs(inputs)).map((rendered) => ({
				icon: {id: rendered.input.name, oneX: {height: rendered.oneX.height, width: rendered.oneX.width, rgba: rendered.oneX.rgba}, twoX: {height: rendered.twoX.height, width: rendered.twoX.width, rgba: rendered.twoX.rgba}},
				identity: {id: rendered.input.name, kind: rendered.input.kind, format: rendered.input.format, sha256: rendered.sourceSha256},
				sourceBytes: rendered.input.source.byteLength,
			}));
		},
	};
}
`;
	writeFileSync(iconsPath, icons);
}
append('packages/dev/src/index.ts', `export {composeTileflowIconSources, type ComposeTileflowIconSourcesOptions, type TileflowComposedIconSources} from './icon-composition';
export {verifyTileflowIconArtifact, type VerifiedTileflowIconArtifact} from './icon-artifact';
export {getTileflowIconCacheDirectory, loadTileflowIconSetArtifact, storeTileflowIconSetArtifact, type TileflowIconCacheOptions} from './icon-cache';
export {readTileflowIconsLockfile, writeTileflowIconsLockfile} from './icon-lockfile';
export {packTileflowRenderedIcons, type TileflowRenderedIcon, type TileflowRenderedIconCell} from './icon-sprite';`);

append('packages/core/README.md', `## Team Icon Sets: foundational contracts

\`iconSet('@team/set')\` is an explicit icon contributor alongside local and package-owned
directories. It performs no I/O. Omission still inherits; an explicit array replaces; later
contributors override earlier IDs. A resolved map accepts at most 32 contributors, and a set may
appear only once. Font directories are unchanged.

An exact \`tileflow.icons.lock.json\` identifies immutable set revisions and generated artifacts.
The lock parser rejects duplicate JSON keys, stale reference sets, mixed Teams, invalid IDs,
floating versions, unsafe URLs and manifest/hash mismatches. Serialization is canonical.
Hashes are internal integrity machinery, not identifiers that application authors must manage.

Shared-set content identifies the effective published artifact. Git owns original artwork history;
source-only SVG edits producing the same artifact are not shared content changes. No original-source
hash, source format or filesystem path is added to a shared package. Local/package originals retain
their existing source identity. Shared winners use the explicit \`rendered-icon\` identity, and an
ordered \`tileflow-icon-composition-v1\` receipt records consumed revisions separately, including
fully shadowed sets and equal-pixel updates.

Map revision hashing preserves the existing v1 result for maps without shared sets. Maps with sets
require a complete receipt and use the domain-separated v2 revision contract. Build manifest map
entries identify that contract with \`mapRevisionSchemaVersion: 2\`; omission means legacy v1.
The generated icon package remains \`tileflow-icon-package-v1\` and the asset-set hash is unchanged.

These are SDK foundation APIs. The explicit \`@tileflow/dev\` composition port can consume verified
fixture or cached artifacts without a registry. Registry publication, managed deployment and
normal CLI/framework wiring are separate integrations, not implied by importing \`iconSet\`.
`);
append('packages/dev/README.md', `## Locked Icon Set composition foundations

\`composeTileflowIconSources(sources, {cwd, lock, cacheRoot, offline: true})\` combines local/package
directories and \`iconSet('@team/set')\` contributors into one effective sprite. Without an explicit
lock object, it reads \`tileflow.icons.lock.json\` beside \`baseDirectory\` (default: \`cwd\`).
It never resolves latest or writes the lock. The result contains the generated \`package\`,
ordered \`composition\` receipt, effective \`sourceIdentities\`, replacement ordinals and local watch
paths. Pass both the source identities and receipt to Core map-revision hashing.

The reader verifies each file length/checksum, PNG/index geometry, names, density pairing and both
per-icon pixel hashes. It copies decoded 1x and 2x cells independently, without resampling either.
The existing directory compiler and this port share the same sprite packer. A sole shared set
reuses its exact artifact; mixed inputs are packed deterministically. Later contributors win and
all dependencies remain in the receipt, even when entirely shadowed. Shared inputs never pretend
to contain original SVG/source identities. Existing local-only compilation remains unchanged.

\`storeTileflowIconSetArtifact\` seeds an exact verified cache entry. \`loadTileflowIconSetArtifact\`
uses the cache or hydrates only the selected artifact's four public files. Hydration defaults to
the trusted \`https://api.tileflow.dev\` origin, sends no credentials and follows no redirects.
Applications may explicitly configure trusted \`deliveryOrigins\`; locks cannot add them.
\`offline\` forbids all fetches and fails on missing or corrupt entries. Complete-map offline
rendering still depends on unrelated tiles, glyphs and other external resources.

The cache lives under the OS user cache with \`tileflow/icons/v1/<contentHash>\`. \`cacheRoot\` or
\`TILEFLOW_ICON_CACHE_DIR\` overrides its parent. Atomic directory installation and exact-entry
retirement support concurrent writers and corruption repair. Symlink entries are rejected. This
is a disposable cache, not a security sandbox against another process controlling the same user
account. Incomplete temporary entries are never accepted as published cache entries.

\`writeTileflowIconsLockfile(directory, lock, expectedContents)\` uses a whole-file compare-and-swap
and atomic rename. A conflicting writer fails without overwriting pins. An interrupted writer
leaves the previous complete lock intact; remove a stale \`.writing\` guard only after confirming
that its writer has exited. Ordinary reads and Core validation never acquire write guards.

The existing 256-effective-icon, 2048-atlas-dimension, 4 MiB/file and 8 MiB/package bounds still
apply. Several individually valid sets can exceed the effective map limit; composition fails
explicitly instead of clipping. Cache and composition do not create Team resources or publish
anything. Normal CLI/build/framework and Hosted command integration follows separately; those
existing entry points currently reject shared descriptors rather than silently dropping them.
`);
console.log('Applied explicit artifact-identity SDK foundations without registry, release or platform changes.');
