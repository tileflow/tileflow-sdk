import {readFileSync, writeFileSync} from 'node:fs';
import './icon-set-foundations-stage.mjs';

function replace(path, before, after) {
	const source = readFileSync(path, 'utf8');
	if (source.includes(after)) return;
	if (source.split(before).length !== 2) throw new Error(`Expected one checked occurrence in ${path}: ${before.slice(0, 80)}`);
	writeFileSync(path, source.replace(before, after));
}

replace('packages/core/scripts/generate-config-reference.ts', "    asRecord(iconArray.items, 'icon directory items'),", "    asRecord(fontArray.items, 'font directory items'),");
replace('packages/core/scripts/generate-config-reference.ts', "    'Ordered icon directories. In authoring, omission inherits, declaration atomically replaces, [] selects no icons, and a later directory wins by exact canonical ID.';", "    'Ordered icon contributors: local/package directories or explicitly locked Team Icon Sets. Omission inherits, declaration atomically replaces, [] selects no icons, and a later contributor wins by exact canonical ID.';");
replace('packages/core/scripts/generate-config-reference.ts', "  const fontArray = dereferenceSchema(schema, fonts, 'fonts array');", "  iconArray.examples = [...(iconArray.examples as unknown[]), [{kind: 'icon-set', reference: '@acme/brand'}, './icons']];\n  iconArray['x-tileflow-refinements'] = ['An icon set reference may appear only once; exact revisions are resolved from the separate lockfile.'];\n  const fontArray = dereferenceSchema(schema, fonts, 'fonts array');");

const cachePath = 'packages/dev/src/icon-cache.ts';
let cache = readFileSync(cachePath, 'utf8');
if (!cache.includes('Locked manifest hash mismatch')) {
	cache = "import {hashTileflowIconPackageManifest} from '@tileflow/core';\n" + cache;
	cache = cache.replaceAll('const pin = tileflowIconSetPinSchema.parse(input);', "const pin = tileflowIconSetPinSchema.parse(input);\n\tif (await hashTileflowIconPackageManifest(pin.manifest) !== pin.contentHash) throw new TileflowIconSetError('ICON_LOCK_INVALID', 'Locked manifest hash mismatch');");
	writeFileSync(cachePath, cache);
}

const compositionPath = 'packages/dev/src/icon-composition.ts';
let composition = readFileSync(compositionPath, 'utf8');
if (!composition.includes('tileflowIconsLockfileName')) {
	composition = "import {resolve} from 'node:path';\nimport {tileflowIconsLockfileName} from '@tileflow/core';\n" + composition;
	composition = composition.replace('const watchPaths = new Set<string>();', 'const watchPaths = new Set<string>();\n\tif (references.length > 0 && options.lock === undefined) watchPaths.add(resolve(options.baseDirectory ?? options.cwd, tileflowIconsLockfileName));');
	writeFileSync(compositionPath, composition);
}

replace('packages/core/README.md', 'There is no built-in selector, source object, external\nsprite selector, icon mapping, icon-specific inheritance, additive command, or compatibility alias.', 'There is no built-in selector, mutable external sprite selector, icon mapping or icon-specific\ninheritance. Shared sets use the explicit locked descriptor described below; this is not a generic\nsource registry or an implicit additive operation.');

const artifactPath = 'packages/dev/src/icon-artifact.ts';
let artifact = readFileSync(artifactPath, 'utf8');
if (artifact.includes("import {z} from 'zod';")) {
	artifact = artifact.replace("import {z} from 'zod';", "import {tileflowIconSpriteIndexSchema as indexSchema, type TileflowIconSpriteIndexEntry as Rectangle} from '@tileflow/core';");
	artifact = artifact.replace('tileflowIconIdSchema, ', '');
	const first = artifact.indexOf('const entrySchema = z.object(');
	const last = artifact.indexOf('export type VerifiedTileflowIconArtifact', first);
	if (first < 0 || last < 0) throw new Error('Missing generated-index schema extraction boundary');
	artifact = artifact.slice(0, first) + artifact.slice(last);
	writeFileSync(artifactPath, artifact);
}
const indexPath = 'packages/core/src/index.ts';
const indexSource = readFileSync(indexPath, 'utf8');
if (!indexSource.includes("export * from './icon-sprite-index';")) writeFileSync(indexPath, `${indexSource}\nexport * from './icon-sprite-index';\n`);
console.log('Updated generated-reference handling, portable sprite schema and exact manifest preflight.');
