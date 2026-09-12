import {compareCodeUnits, hashTileflowIconPackageManifest, hashTileflowRenderedIconPixels, serializeCanonicalJson, sha256Hex, tileflowIconIdSchema, tileflowIconPackageLimits, tileflowIconPackageManifestSchema} from '@tileflow/core';
import type {CompiledTileflowIconPackage, CompiledTileflowIconPackageFile} from './icons';

export type TileflowRenderedIconCell = {height: number; width: number; rgba: Uint8Array};
export type TileflowRenderedIcon = {id: string; oneX: TileflowRenderedIconCell; twoX: TileflowRenderedIconCell};
export type TileflowSpriteIndex = Record<string, {height: number; pixelRatio: 1 | 2; width: number; x: number; y: number}>;

/** Pack independently rendered densities without scaling or re-rasterizing either input. */
export async function packTileflowRenderedIcons(input: readonly TileflowRenderedIcon[]): Promise<CompiledTileflowIconPackage> {
	const icons = [...input].sort((left, right) => compareCodeUnits(left.id, right.id));
	if (icons.length < 1 || icons.length > tileflowIconPackageLimits.maxIconCount || new Set(icons.map((icon) => icon.id)).size !== icons.length) throw new Error('Expected 1 through 256 unique rendered icons');
	const renderedIcons = [];
	for (const icon of icons) {
		tileflowIconIdSchema.parse(icon.id);
		if (icon.twoX.width !== icon.oneX.width * 2 || icon.twoX.height !== icon.oneX.height * 2) throw new Error('Rendered density geometry must double exactly');
		renderedIcons.push({name: icon.id, pixelSha256: {
			oneX: await hashTileflowRenderedIconPixels({...icon.oneX, pixelRatio: 1}),
			twoX: await hashTileflowRenderedIconPixels({...icon.twoX, pixelRatio: 2}),
		}});
	}
	const oneX = icons.map((icon) => ({...icon.oneX, name: icon.id}));
	const twoX = icons.map((icon) => ({...icon.twoX, name: icon.id}));
	const layoutOneX = createSpriteLayout(oneX, 1);
	const layoutTwoX = createSpriteLayout(twoX, 2);
	if (layoutTwoX.width !== layoutOneX.width * 2 || layoutTwoX.height !== layoutOneX.height * 2) throw new Error('Composed atlas exceeds the paired density geometry limit');
	const files: CompiledTileflowIconPackageFile[] = [
		{contentType: 'application/json', fileName: 'sprite.json', source: new TextEncoder().encode(`${serializeCanonicalJson(layoutOneX.index)}\n`)},
		{contentType: 'image/png', fileName: 'sprite.png', source: await createSpriteImage(oneX, layoutOneX)},
		{contentType: 'application/json', fileName: 'sprite@2x.json', source: new TextEncoder().encode(`${serializeCanonicalJson(layoutTwoX.index)}\n`)},
		{contentType: 'image/png', fileName: 'sprite@2x.png', source: await createSpriteImage(twoX, layoutTwoX)},
	];
	assertGeneratedFileLimits(files);
	const manifest = tileflowIconPackageManifestSchema.parse({
		format: 'tileflow-icon-package-v1',
		files: await Promise.all(files.map(async (file) => ({name: file.fileName, byteLength: file.source.byteLength, contentType: file.contentType, sha256: await sha256Hex(file.source)}))),
		iconNames: icons.map((icon) => icon.id),
		renderedIcons,
		sprites: {oneX: {width: layoutOneX.width, height: layoutOneX.height, pixelRatio: 1}, twoX: {width: layoutTwoX.width, height: layoutTwoX.height, pixelRatio: 2}},
	});
	return {contentHash: await hashTileflowIconPackageManifest(manifest), manifest, files};
}

/** Shared with the existing directory compiler; keep layout behavior byte-compatible. */
export function createSpriteLayout(icons: Array<{height: number; name: string; width: number}>, pixelRatio: 1 | 2) {
	const columns = Math.ceil(Math.sqrt(icons.length));
	const widest = Math.max(...icons.map((icon) => icon.width));
	const targetWidth = Math.min(tileflowIconPackageLimits.maxAtlasDimension, columns * widest);
	const placements: Array<{left: number; top: number}> = [];
	let left = 0;
	let rowHeight = 0;
	let top = 0;
	for (const icon of icons) {
		if (icon.width > tileflowIconPackageLimits.maxAtlasDimension) throw new Error(`Generated sprite exceeds ${tileflowIconPackageLimits.maxAtlasDimension} pixels per dimension`);
		if (left > 0 && left + icon.width > targetWidth) { top += rowHeight; left = 0; rowHeight = 0; }
		placements.push({left, top});
		left += icon.width;
		rowHeight = Math.max(rowHeight, icon.height);
	}
	const width = targetWidth;
	const height = top + rowHeight;
	if (width > tileflowIconPackageLimits.maxAtlasDimension || height > tileflowIconPackageLimits.maxAtlasDimension) throw new Error(`Generated sprite exceeds ${tileflowIconPackageLimits.maxAtlasDimension} pixels per dimension`);
	const index: TileflowSpriteIndex = Object.fromEntries(icons.map((icon, ordinal) => {
		const placement = placements[ordinal]!;
		return [icon.name, {height: icon.height, pixelRatio, width: icon.width, x: placement.left, y: placement.top}];
	}));
	return {height, index, width};
}

export async function createSpriteImage(icons: Array<{height: number; name: string; rgba: Uint8Array; width: number}>, layout: ReturnType<typeof createSpriteLayout>): Promise<Uint8Array> {
	const sharp = await loadSharp();
	const atlas = new Uint8Array(layout.width * layout.height * 4);
	for (const icon of icons) {
		const placement = layout.index[icon.name];
		if (!placement || icon.width !== placement.width || icon.height !== placement.height || icon.rgba.byteLength !== icon.width * icon.height * 4) throw new Error('Rendered icon dimensions do not match the sprite layout');
		const rowBytes = icon.width * 4;
		for (let row = 0; row < icon.height; row += 1) {
			const sourceStart = row * rowBytes;
			const targetStart = ((placement.y + row) * layout.width + placement.x) * 4;
			atlas.set(icon.rgba.subarray(sourceStart, sourceStart + rowBytes), targetStart);
		}
	}
	return sharp(atlas, {raw: {channels: 4, height: layout.height, width: layout.width}}).png({adaptiveFiltering: false, compressionLevel: 9, palette: false}).toBuffer();
}

export function assertGeneratedFileLimits(files: CompiledTileflowIconPackageFile[]): void {
	let totalBytes = 0;
	for (const file of files) {
		if (file.source.byteLength > tileflowIconPackageLimits.maxGeneratedFileBytes) throw new Error(`${file.fileName} exceeds ${tileflowIconPackageLimits.maxGeneratedFileBytes} generated bytes`);
		totalBytes += file.source.byteLength;
	}
	if (totalBytes > tileflowIconPackageLimits.maxGeneratedPackageBytes) throw new Error(`Generated package exceeds ${tileflowIconPackageLimits.maxGeneratedPackageBytes} bytes`);
}

export async function loadSharp(): Promise<(typeof import('sharp'))['default']> {
	try { return (await import('sharp')).default; }
	catch (cause) { throw new Error('Local icon sprites require the optional "sharp" package. Install sharp or disable local icons.', {cause}); }
}
