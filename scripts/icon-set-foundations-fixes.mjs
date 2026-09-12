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

replace('packages/dev/src/icons.ts', 'async function renderIconInputs(inputs: IconInput[]): Promise<CompiledIcon[]> {\n  return mapWithConcurrency(', 'async function renderIconInputs(inputs: IconInput[]): Promise<CompiledIcon[]> {\n  let renderedOneXPixels = 0;\n  return mapWithConcurrency(');
replace('packages/dev/src/icons.ts', '      const dimensions = await validateDecodedDimensions(icon);', `      const dimensions = await validateDecodedDimensions(icon);
      const oneXWidth = icon.kind === 'pattern' ? dimensions.width : iconSpriteSize;
      const oneXHeight = icon.kind === 'pattern' ? dimensions.height : iconSpriteSize;
      const maximumOneXDimension = tileflowIconPackageLimits.maxAtlasDimension / 2;
      renderedOneXPixels += oneXWidth * oneXHeight;
      if (oneXWidth > maximumOneXDimension || oneXHeight > maximumOneXDimension || renderedOneXPixels > maximumOneXDimension ** 2) {
        throw new Error('Rendered icon inputs exceed the paired sprite capacity before rasterization');
      }`);

replace('docs/contracts/map-inheritance.md', '`icons` is one ordered array of `TileflowIconDirectory` values:', '`icons` is one ordered array of `TileflowIconSource` values. Existing `TileflowIconDirectory`\nvalues remain valid; the additional `iconSet(\'@team/set\')` descriptor declares an exact locked\ndependency, not a mutable sprite URL or source registry:');
replace('docs/contracts/map-inheritance.md', '## Text assets', `Shared sets use immutable revisions selected by a separate \`tileflow.icons.lock.json\`.
They obey the same explicit array order and inheritance rules as directories. The complete
sequence allows at most 32 contributors, with no repeated set reference. Their effective content
is the generated artifact, not its original artwork: Git retains source history. Changing only
an SVG comment without changing generated bytes does not change shared-set content. No original
source hashes or private source paths are added to shared packages.

The foundational \`@tileflow/dev\` composition port consumes verified locked artifacts and local
sources into one effective 1x/2x sprite. Normal CLI/framework and managed deployment wiring are
separate integrations; existing unintegrated entrypoints reject shared descriptors explicitly.
See the Core and Dev package READMEs for these foundational APIs and their scope.

## Text assets`);
replace('docs/contracts/map-inheritance.md', 'Browser clients never import `tileflow.config.ts`, resolve `extends`, or infer a development URL.', `Maps without shared sets preserve the existing v1 revision hash. Shared-set maps require an
ordered composition receipt and use the explicit, domain-separated v2 revision contract; their
build-manifest map entry includes \`mapRevisionSchemaVersion: 2\`. Shared winner identities record
verified rendered pixels, while the receipt separately records exact dependency revisions and
order, including completely shadowed inputs. Source history, set revisions and served artifacts
remain distinct. The generated icon package and runtime asset-set formats remain unchanged.

Browser clients never import \`tileflow.config.ts\`, resolve \`extends\`, or infer a development URL.`);
console.log('Updated reference generation, portable sprite validation, bounded rendering and artifact identity contracts.');
