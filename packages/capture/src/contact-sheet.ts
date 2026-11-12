import type {Browser} from 'playwright';
import {TileflowCaptureError} from './errors';
import {readPngDimensions} from './standalone';

/** One captured image on a contact sheet, with the label printed under it. */
export type TileflowContactSheetImage = {label: string; png: Uint8Array};

export type TileflowContactSheetOptions = {
  /** Images per row; defaults to the square root of the count, at most 4. */
  columns?: number;
  /** Width of each image on the sheet in CSS pixels; defaults to 480. */
  cellWidth?: number;
};

export const tileflowContactSheetLimits = Object.freeze({
  cellWidth: {maximum: 1_024, minimum: 120},
  columns: {maximum: 8, minimum: 1},
  images: 64,
});

/**
 * Lays captured images out in one labelled grid PNG, for choosing between candidates at a glance.
 * The sheet renders offline in the given browser: it loads nothing but the images it is given.
 */
export async function renderTileflowContactSheet(
  browser: Browser,
  images: readonly TileflowContactSheetImage[],
  options: TileflowContactSheetOptions = {},
): Promise<Uint8Array> {
  const limits = tileflowContactSheetLimits;
  if (images.length === 0 || images.length > limits.images) {
    throw new TileflowCaptureError(
      'SCREENSHOT_FAILED',
      `A contact sheet holds from 1 to ${limits.images} images.`,
    );
  }
  const columns = Math.round(options.columns ?? Math.min(4, Math.ceil(Math.sqrt(images.length))));
  const cellWidth = Math.round(options.cellWidth ?? 480);
  if (
    !(columns >= limits.columns.minimum && columns <= limits.columns.maximum) ||
    !(cellWidth >= limits.cellWidth.minimum && cellWidth <= limits.cellWidth.maximum)
  ) {
    throw new TileflowCaptureError(
      'SCREENSHOT_FAILED',
      `Contact sheet columns must be ${limits.columns.minimum}-${limits.columns.maximum} and cell width ${limits.cellWidth.minimum}-${limits.cellWidth.maximum}.`,
    );
  }
  const cells = images.map(({label, png}) => {
    const {height, width} = readPngDimensions(png);
    return {
      height: Math.round((cellWidth * height) / width),
      label,
      src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    };
  });
  const gap = 12;
  const labelHeight = 22;
  const rows = Math.ceil(cells.length / columns);
  const rowHeights = Array.from({length: rows}, (_, row) =>
    Math.max(...cells.slice(row * columns, row * columns + columns).map((cell) => cell.height)),
  );
  const width = gap + columns * (cellWidth + gap);
  const height =
    gap + rowHeights.reduce((sum, rowHeight) => sum + rowHeight + labelHeight + gap, 0);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
    serviceWorkers: 'block',
    viewport: {height: Math.min(height, 16_384), width},
  });
  try {
    // Only the data: URLs below load; nothing reaches the network.
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.setContent(contactSheetHtml(cells, {cellWidth, columns, gap, labelHeight}), {
      waitUntil: 'load',
    });
    return new Uint8Array(await page.screenshot({fullPage: true, type: 'png'}));
  } catch (error) {
    throw new TileflowCaptureError(
      'SCREENSHOT_FAILED',
      'Tileflow could not render the contact sheet.',
      {
        cause: error,
        details: {phase: 'screenshot'},
      },
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

function contactSheetHtml(
  cells: readonly {height: number; label: string; src: string}[],
  layout: {cellWidth: number; columns: number; gap: number; labelHeight: number},
): string {
  const figures = cells
    .map(
      (cell) =>
        `<figure><img src="${cell.src}" width="${layout.cellWidth}" height="${cell.height}" alt=""><figcaption>${escapeHtml(cell.label)}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#f4f2ee;}
main{display:grid;grid-template-columns:repeat(${layout.columns},${layout.cellWidth}px);gap:${layout.gap}px;padding:${layout.gap}px;align-items:start;}
figure{margin:0;}
img{display:block;border-radius:4px;}
figcaption{height:${layout.labelHeight}px;line-height:${layout.labelHeight}px;font:500 13px/22px ui-monospace,Menlo,Consolas,monospace;color:#2b2824;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
</style></head><body><main>${figures}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]!,
  );
}
