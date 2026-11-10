import {
  assertTileflowIconLayoutBounds,
  assertTileflowSdfPixels,
  compareCodeUnits,
  hashTileflowIconPackageManifest,
  hashTileflowRenderedIconPixels,
  scaleTileflowIconLayout,
  serializeCanonicalJson,
  sha256Hex,
  type TileflowIconAppearance,
  tileflowIconIdSchema,
  type TileflowIconLayoutMetadata,
  tileflowIconPackageLimits,
  tileflowIconPackageManifestSchema,
  type TileflowIconSpriteIndex,
} from '@tileflow/core';
import type {CompiledTileflowIconPackage, CompiledTileflowIconPackageFile} from './icons';

export type TileflowRenderedIconCell = {height: number; width: number; rgba: Uint8Array};
export type TileflowRenderedIcon = {
  id: string;
  appearance?: TileflowIconAppearance;
  layout?: TileflowIconLayoutMetadata;
  oneX: TileflowRenderedIconCell;
  twoX: TileflowRenderedIconCell;
};
export type TileflowSpriteIndex = TileflowIconSpriteIndex;

/** Pack independently rendered densities without scaling or re-rasterizing either input. */
export async function packTileflowRenderedIcons(
  input: readonly TileflowRenderedIcon[],
): Promise<CompiledTileflowIconPackage> {
  const icons = [...input].sort((left, right) => compareCodeUnits(left.id, right.id));
  if (
    icons.length < 1 ||
    icons.length > tileflowIconPackageLimits.maxIconCount ||
    new Set(icons.map((icon) => icon.id)).size !== icons.length
  )
    throw new Error(
      `Expected 1 through ${tileflowIconPackageLimits.maxIconCount} unique rendered icons`,
    );
  const renderedIcons = [];
  for (const icon of icons) {
    tileflowIconIdSchema.parse(icon.id);
    if (icon.layout) assertTileflowIconLayoutBounds(icon.layout, icon.oneX.width, icon.oneX.height);
    if (icon.appearance) {
      assertTileflowSdfPixels({...icon.oneX, pixelRatio: 1});
      assertTileflowSdfPixels({...icon.twoX, pixelRatio: 2});
    }
    if (icon.twoX.width !== icon.oneX.width * 2 || icon.twoX.height !== icon.oneX.height * 2)
      throw new Error('Rendered density geometry must double exactly');
    renderedIcons.push({
      name: icon.id,
      ...(icon.appearance ? {appearance: icon.appearance} : {}),
      ...(icon.layout ? {layout: icon.layout} : {}),
      pixelSha256: {
        oneX: await hashTileflowRenderedIconPixels({...icon.oneX, pixelRatio: 1}),
        twoX: await hashTileflowRenderedIconPixels({...icon.twoX, pixelRatio: 2}),
      },
    });
  }
  const oneX = icons.map((icon) => ({
    ...icon.oneX,
    name: icon.id,
    appearance: icon.appearance,
    layout: icon.layout,
  }));
  const twoX = icons.map((icon) => ({
    ...icon.twoX,
    name: icon.id,
    appearance: icon.appearance,
    layout: icon.layout,
  }));
  const layoutOneX = createSpriteLayout(oneX, 1);
  const layoutTwoX = createSpriteLayout(twoX, 2);
  if (layoutTwoX.width !== layoutOneX.width * 2 || layoutTwoX.height !== layoutOneX.height * 2)
    throw new Error('Composed atlas exceeds the paired density geometry limit');
  const files: CompiledTileflowIconPackageFile[] = [
    {
      contentType: 'application/json',
      fileName: 'sprite.json',
      source: new TextEncoder().encode(`${serializeCanonicalJson(layoutOneX.index)}\n`),
    },
    {
      contentType: 'image/png',
      fileName: 'sprite.png',
      source: await createSpriteImage(oneX, layoutOneX),
    },
    {
      contentType: 'application/json',
      fileName: 'sprite@2x.json',
      source: new TextEncoder().encode(`${serializeCanonicalJson(layoutTwoX.index)}\n`),
    },
    {
      contentType: 'image/png',
      fileName: 'sprite@2x.png',
      source: await createSpriteImage(twoX, layoutTwoX),
    },
  ];
  assertGeneratedFileLimits(files);
  const manifest = tileflowIconPackageManifestSchema.parse({
    format: icons.some((icon) => icon.appearance || icon.layout)
      ? 'tileflow-icon-package-v2'
      : 'tileflow-icon-package-v1',
    files: await Promise.all(
      files.map(async (file) => ({
        name: file.fileName,
        byteLength: file.source.byteLength,
        contentType: file.contentType,
        sha256: await sha256Hex(file.source),
      })),
    ),
    iconNames: icons.map((icon) => icon.id),
    renderedIcons,
    sprites: {
      oneX: {width: layoutOneX.width, height: layoutOneX.height, pixelRatio: 1},
      twoX: {width: layoutTwoX.width, height: layoutTwoX.height, pixelRatio: 2},
    },
  });
  return {contentHash: await hashTileflowIconPackageManifest(manifest), manifest, files};
}

type SpriteLayoutIcon = {
  height: number;
  name: string;
  width: number;
  appearance?: TileflowIconAppearance;
  layout?: TileflowIconLayoutMetadata;
};

/** Rows of icons in the given order; returns each icon's placement and the rows' total height. */
function shelfPlacements(
  icons: readonly SpriteLayoutIcon[],
  order: readonly number[],
  width: number,
) {
  const placements: Array<{left: number; top: number}> = Array.from({length: icons.length});
  let left = 0;
  let rowHeight = 0;
  let top = 0;
  for (const ordinal of order) {
    const icon = icons[ordinal]!;
    if (left > 0 && left + icon.width > width) {
      top += rowHeight;
      left = 0;
      rowHeight = 0;
    }
    placements[ordinal] = {left, top};
    left += icon.width;
    rowHeight = Math.max(rowHeight, icon.height);
  }
  return {height: top + rowHeight, placements};
}

/**
 * Use proportional density bounds; preserve layouts that already fit the paired limit. Icons are
 * placed in ID order. When that order overflows the atlas, as when large artwork falls between
 * runs of small icons and every such row takes the large height, rows are filled tallest first
 * instead. Both orders are deterministic and scale exactly with density, so the paired 1x and 2x
 * atlases choose the same one.
 */
export function createSpriteLayout(icons: SpriteLayoutIcon[], pixelRatio: 1 | 2) {
  const columns = Math.ceil(Math.sqrt(icons.length));
  const widest = Math.max(...icons.map((icon) => icon.width));
  const maxDimension = (tileflowIconPackageLimits.maxAtlasDimension / 2) * pixelRatio;
  const targetWidth = Math.min(maxDimension, columns * widest);

  for (const icon of icons)
    if (icon.width > maxDimension)
      throw new Error(
        `Generated sprite exceeds ${maxDimension} pixels per dimension at ${pixelRatio}x`,
      );
  const idOrder = icons.map((_, ordinal) => ordinal);
  let shelves = shelfPlacements(icons, idOrder, targetWidth);
  if (shelves.height > maxDimension) {
    const tallestFirst = [...idOrder].sort(
      (left, right) =>
        icons[right]!.height - icons[left]!.height ||
        icons[right]!.width - icons[left]!.width ||
        compareCodeUnits(icons[left]!.name, icons[right]!.name),
    );
    shelves = shelfPlacements(icons, tallestFirst, targetWidth);
  }
  const {placements} = shelves;
  const width = targetWidth;
  const height = shelves.height;
  if (width > maxDimension || height > maxDimension)
    throw new Error(
      `Generated sprite exceeds ${maxDimension} pixels per dimension at ${pixelRatio}x`,
    );
  const index: TileflowSpriteIndex = Object.fromEntries(
    icons.map((icon, ordinal) => {
      const placement = placements[ordinal]!;
      return [
        icon.name,
        {
          height: icon.height,
          pixelRatio,
          width: icon.width,
          x: placement.left,
          y: placement.top,
          ...(icon.appearance ? {sdf: true as const, tileflow: icon.appearance} : {}),
          ...(icon.layout ? scaleTileflowIconLayout(icon.layout, pixelRatio) : {}),
        },
      ];
    }),
  );
  return {height, index, width};
}

export async function createSpriteImage(
  icons: Array<{height: number; name: string; rgba: Uint8Array; width: number}>,
  layout: ReturnType<typeof createSpriteLayout>,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const atlas = new Uint8Array(layout.width * layout.height * 4);
  for (const icon of icons) {
    const placement = layout.index[icon.name];
    if (
      !placement ||
      icon.width !== placement.width ||
      icon.height !== placement.height ||
      icon.rgba.byteLength !== icon.width * icon.height * 4
    )
      throw new Error('Rendered icon dimensions do not match the sprite layout');
    const rowBytes = icon.width * 4;
    for (let row = 0; row < icon.height; row += 1) {
      const sourceStart = row * rowBytes;
      const targetStart = ((placement.y + row) * layout.width + placement.x) * 4;
      atlas.set(icon.rgba.subarray(sourceStart, sourceStart + rowBytes), targetStart);
    }
  }
  return sharp(atlas, {raw: {channels: 4, height: layout.height, width: layout.width}})
    .png({adaptiveFiltering: false, compressionLevel: 9, palette: false})
    .toBuffer();
}

export function assertGeneratedFileLimits(files: CompiledTileflowIconPackageFile[]): void {
  let totalBytes = 0;
  for (const file of files) {
    if (file.source.byteLength > tileflowIconPackageLimits.maxGeneratedFileBytes)
      throw new Error(
        `${file.fileName} exceeds ${tileflowIconPackageLimits.maxGeneratedFileBytes} generated bytes`,
      );
    totalBytes += file.source.byteLength;
  }
  if (totalBytes > tileflowIconPackageLimits.maxGeneratedPackageBytes)
    throw new Error(
      `Generated package exceeds ${tileflowIconPackageLimits.maxGeneratedPackageBytes} bytes`,
    );
}

export async function loadSharp(): Promise<(typeof import('sharp'))['default']> {
  try {
    return (await import('sharp')).default;
  } catch (cause) {
    throw new Error(
      'Local icon sprites require the optional "sharp" package. Install sharp or disable local icons.',
      {cause},
    );
  }
}
