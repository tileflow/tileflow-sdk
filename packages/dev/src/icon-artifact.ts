import {z} from 'zod';
import {compareCodeUnits, hashTileflowIconPackageManifest, hashTileflowRenderedIconPixels, parseTileflowIconJson, sha256Hex, TileflowIconSetError, tileflowIconIdSchema, tileflowIconPackageLimits, tileflowIconPackageManifestSchema} from '@tileflow/core';
import type {CompiledTileflowIconPackage} from './icons';
import {loadSharp, type TileflowRenderedIcon, type TileflowRenderedIconCell} from './icon-sprite';

const entrySchema = z.object({
	height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
	width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
	pixelRatio: z.union([z.literal(1), z.literal(2)]),
	x: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
	y: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
}).strict();
const indexSchema = z.record(tileflowIconIdSchema, entrySchema);
type Rectangle = z.infer<typeof entrySchema>;

export type VerifiedTileflowIconArtifact = {package: CompiledTileflowIconPackage; icons: TileflowRenderedIcon[]};

/** Verify exact compressed bytes and independently decode/hash every cell at both densities. */
export async function verifyTileflowIconArtifact(input: CompiledTileflowIconPackage): Promise<VerifiedTileflowIconArtifact> {
	try {
		const manifest = tileflowIconPackageManifestSchema.parse(input.manifest);
		const contentHash = input.contentHash;
		if (input.files.length !== 4 || new Set(input.files.map((file) => file.fileName)).size !== 4) throw new Error('An artifact must contain exactly the four generated files');
		const files = manifest.files.map((expected) => {
			const source = input.files.find((file) => file.fileName === expected.name);
			if (!source || source.contentType !== expected.contentType || source.source.byteLength !== expected.byteLength) throw new Error('Generated file identity does not match the manifest');
			return {contentType: source.contentType, fileName: source.fileName, source: new Uint8Array(source.source)};
		});
		if (await hashTileflowIconPackageManifest(manifest) !== contentHash) throw new Error('Artifact manifest hash mismatch');
		for (const [index, file] of files.entries()) {
			if (await sha256Hex(file.source) !== manifest.files[index]!.sha256) throw new Error(`Generated ${file.fileName} checksum mismatch`);
		}
		const decoder = new TextDecoder('utf-8', {fatal: true});
		const oneIndex = indexSchema.parse(parseTileflowIconJson(decoder.decode(files[0]!.source), tileflowIconPackageLimits.maxGeneratedFileBytes));
		const twoIndex = indexSchema.parse(parseTileflowIconJson(decoder.decode(files[2]!.source), tileflowIconPackageLimits.maxGeneratedFileBytes));
		for (const index of [oneIndex, twoIndex]) {
			const names = Object.keys(index).sort(compareCodeUnits);
			if (names.length !== manifest.iconNames.length || names.some((name, ordinal) => name !== manifest.iconNames[ordinal])) throw new Error('Sprite index does not exactly match the manifest icon names');
		}
		for (const [index, dimensions, ratio] of [[oneIndex, manifest.sprites.oneX, 1], [twoIndex, manifest.sprites.twoX, 2]] as const) {
			const rectangles = Object.values(index);
			for (const [ordinal, rect] of rectangles.entries()) {
				if (rect.pixelRatio !== ratio || rect.x + rect.width > dimensions.width || rect.y + rect.height > dimensions.height) throw new Error('Sprite rectangle is outside the atlas or has the wrong density');
				for (const other of rectangles.slice(0, ordinal)) {
					if (rect.x < other.x + other.width && other.x < rect.x + rect.width && rect.y < other.y + other.height && other.y < rect.y + rect.height) throw new Error('Sprite rectangles must not overlap');
				}
			}
		}
		for (const name of manifest.iconNames) {
			const one = oneIndex[name]!;
			const two = twoIndex[name]!;
			if (two.x !== one.x * 2 || two.y !== one.y * 2 || two.width !== one.width * 2 || two.height !== one.height * 2) throw new Error('Sprite densities must have exactly doubled geometry');
		}
		const oneAtlas = await decodeAtlas(files[1]!.source, manifest.sprites.oneX);
		const twoAtlas = await decodeAtlas(files[3]!.source, manifest.sprites.twoX);
		const icons: TileflowRenderedIcon[] = [];
		for (const [ordinal, id] of manifest.iconNames.entries()) {
			const oneX = extractCell(oneAtlas, oneIndex[id]!);
			const twoX = extractCell(twoAtlas, twoIndex[id]!);
			const expected = manifest.renderedIcons[ordinal]!.pixelSha256;
			if (await hashTileflowRenderedIconPixels({...oneX, pixelRatio: 1}) !== expected.oneX || await hashTileflowRenderedIconPixels({...twoX, pixelRatio: 2}) !== expected.twoX) throw new Error(`Rendered pixels do not match the manifest for ${id}`);
			icons.push({id, oneX, twoX});
		}
		return {package: {contentHash, manifest, files}, icons};
	} catch (cause) {
		throw new TileflowIconSetError('ICON_PACKAGE_INTEGRITY', 'Generated icon artifact verification failed', {cause});
	}
}

async function decodeAtlas(bytes: Uint8Array, dimensions: {width: number; height: number}): Promise<TileflowRenderedIconCell> {
	if ([137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)) throw new Error('Expected PNG bytes');
	const sharp = await loadSharp();
	const image = sharp(bytes, {failOn: 'error', limitInputPixels: tileflowIconPackageLimits.maxAtlasDimension ** 2});
	const metadata = await image.metadata();
	if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 || metadata.width !== dimensions.width || metadata.height !== dimensions.height) throw new Error('PNG geometry does not match the manifest');
	const {data, info} = await image.ensureAlpha().raw().toBuffer({resolveWithObject: true});
	if (info.channels !== 4 || info.width !== dimensions.width || info.height !== dimensions.height || data.length !== dimensions.width * dimensions.height * 4) throw new Error('Expected bounded RGBA atlas pixels');
	return {...dimensions, rgba: new Uint8Array(data)};
}

function extractCell(atlas: TileflowRenderedIconCell, rect: Rectangle): TileflowRenderedIconCell {
	const rgba = new Uint8Array(rect.width * rect.height * 4);
	const rowBytes = rect.width * 4;
	for (let row = 0; row < rect.height; row += 1) {
		const start = ((rect.y + row) * atlas.width + rect.x) * 4;
		rgba.set(atlas.rgba.subarray(start, start + rowBytes), row * rowBytes);
	}
	return {height: rect.height, width: rect.width, rgba};
}
