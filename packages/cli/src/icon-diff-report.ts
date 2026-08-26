import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {z} from 'zod';
import {
  compareCodeUnits,
  sha256Hex,
  tileflowIconIdSchema,
  tileflowIconPackageLimits,
} from '@tileflow/core';
import type {CompiledTileflowIconPackage} from '@tileflow/dev/icons';
import type {IconPackageBaselineResponse, TileflowIconDiffDocument} from './icon-diff-command';

const spriteEntrySchema = z
  .object({
    height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    pixelRatio: z.union([z.literal(1), z.literal(2)]),
    width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    x: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
    y: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
  })
  .strict();
const spriteIndexSchema = z.record(tileflowIconIdSchema, spriteEntrySchema);
type SpriteIndex = z.infer<typeof spriteIndexSchema>;

type ReportSprite = {
  indexOneX: SpriteIndex;
  indexTwoX: SpriteIndex;
  oneXDataUrl: string;
  oneXHeight: number;
  oneXWidth: number;
  twoXDataUrl: string;
  twoXHeight: number;
  twoXWidth: number;
};

export async function writeIconDiffReport(input: {
  baseline: IconPackageBaselineResponse['baseline'];
  document: TileflowIconDiffDocument;
  force: boolean;
  mapName?: string | null;
  outputPath: string;
  proposedPackage: CompiledTileflowIconPackage | null;
}): Promise<void> {
  const [before, after] = await Promise.all([
    input.baseline?.package ? loadRemoteSprite(input.baseline.package) : null,
    input.proposedPackage ? loadCompiledSprite(input.proposedPackage) : null,
  ]);
  const html = renderReport(input.document, before, after, input.mapName ?? null);
  await writeAtomicReport(input.outputPath, html, input.force);
}

async function loadRemoteSprite(
  iconPackage: NonNullable<NonNullable<IconPackageBaselineResponse['baseline']>['package']>,
): Promise<ReportSprite> {
  const base = iconPackage.spriteUrl;
  const files = await Promise.all(
    iconPackage.manifest.files.map(async (manifestFile) => {
      const suffix = manifestFile.name.slice('sprite'.length);
      const response = await fetch(`${base}${suffix}`);

      if (!response.ok) {
        throw new Error(`Could not fetch baseline ${manifestFile.name}: HTTP ${response.status}`);
      }

      const bytes = await readBoundedResponse(response, manifestFile.byteLength);

      if (
        bytes.byteLength !== manifestFile.byteLength ||
        (await sha256Hex(bytes)) !== manifestFile.sha256
      ) {
        throw new Error(`Baseline ${manifestFile.name} does not match its immutable manifest`);
      }

      return [manifestFile.name, bytes] as const;
    }),
  );

  return reportSpriteFromFiles(
    Object.fromEntries(files),
    iconPackage.manifest.sprites.oneX,
    iconPackage.manifest.sprites.twoX,
  );
}

function loadCompiledSprite(iconPackage: CompiledTileflowIconPackage): ReportSprite {
  return reportSpriteFromFiles(
    Object.fromEntries(iconPackage.files.map((file) => [file.fileName, file.source])),
    iconPackage.manifest.sprites.oneX,
    iconPackage.manifest.sprites.twoX,
  );
}

function reportSpriteFromFiles(
  files: Partial<
    Record<'sprite.json' | 'sprite.png' | 'sprite@2x.json' | 'sprite@2x.png', Uint8Array>
  >,
  oneX: {height: number; width: number},
  twoX: {height: number; width: number},
): ReportSprite {
  const oneXJson = requiredFile(files, 'sprite.json');
  const oneXPng = requiredFile(files, 'sprite.png');
  const twoXJson = requiredFile(files, 'sprite@2x.json');
  const twoXPng = requiredFile(files, 'sprite@2x.png');

  return {
    indexOneX: parseIndex(oneXJson, 1, oneX.width, oneX.height),
    indexTwoX: parseIndex(twoXJson, 2, twoX.width, twoX.height),
    oneXDataUrl: pngDataUrl(oneXPng),
    oneXHeight: oneX.height,
    oneXWidth: oneX.width,
    twoXDataUrl: pngDataUrl(twoXPng),
    twoXHeight: twoX.height,
    twoXWidth: twoX.width,
  };
}

function parseIndex(
  source: Uint8Array,
  pixelRatio: 1 | 2,
  atlasWidth: number,
  atlasHeight: number,
): SpriteIndex {
  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(source));
  } catch {
    throw new Error('Sprite report index is not valid UTF-8 JSON');
  }

  const parsed = spriteIndexSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error('Sprite report index does not match the MapLibre schema');
  }

  for (const entry of Object.values(parsed.data)) {
    if (
      entry.pixelRatio !== pixelRatio ||
      entry.x + entry.width > atlasWidth ||
      entry.y + entry.height > atlasHeight
    ) {
      throw new Error('Sprite report index points outside its atlas');
    }
  }

  return parsed.data;
}

async function readBoundedResponse(response: Response, exactMaximum: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('Content-Length'));

  if (Number.isFinite(declaredLength) && declaredLength > exactMaximum) {
    throw new Error('Baseline sprite response exceeds its manifest size');
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > exactMaximum) throw new Error('Baseline sprite response is too large');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;

      if (length > exactMaximum) {
        await reader.cancel();
        throw new Error('Baseline sprite response exceeds its manifest size');
      }

      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function renderReport(
  document: TileflowIconDiffDocument,
  before: ReportSprite | null,
  after: ReportSprite | null,
  mapName: string | null,
): string {
  const changeGroups: Array<{id: string; label: IconChangeKind; names: string[]}> = [
    {id: 'added', label: 'Added', names: [...document.icons.added].sort(compareCodeUnits)},
    {id: 'modified', label: 'Modified', names: [...document.icons.modified].sort(compareCodeUnits)},
    {id: 'removed', label: 'Removed', names: [...document.icons.removed].sort(compareCodeUnits)},
  ];
  const changedCount = changeGroups.reduce((total, group) => total + group.names.length, 0);
  const beforeIconCount =
    document.icons.unchangedCount + document.icons.modified.length + document.icons.removed.length;
  const afterIconCount =
    document.icons.unchangedCount + document.icons.modified.length + document.icons.added.length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(mapName ? `Tileflow Icon Diff — ${mapName}` : 'Tileflow Icon Diff')}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --background: #f7f8fa;
      --surface: #ffffff;
      --surface-subtle: #f1f3f6;
      --text: #15171a;
      --muted: #626a73;
      --border: #d9dde3;
      --accent: #2563eb;
      --accent-soft: #e8efff;
      --success: #166534;
      --success-soft: #dcfce7;
      --danger: #b42318;
      --danger-soft: #fee4e2;
      --warning: #92400e;
      --checker-light: #f8f9fb;
      --checker-dark: #e7eaf0;
      --shadow: 0 1px 2px rgb(16 24 40 / 5%);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: #0d0f12;
        --surface: #15181d;
        --surface-subtle: #1d2128;
        --text: #f5f7fa;
        --muted: #a7afb9;
        --border: #343a44;
        --accent: #8bb4ff;
        --accent-soft: #1e3764;
        --success: #86efac;
        --success-soft: #153c27;
        --danger: #fda29b;
        --danger-soft: #4a211f;
        --warning: #fcd34d;
        --checker-light: #20242b;
        --checker-dark: #292e37;
        --shadow: none;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--background);
      color: var(--text);
      font-size: 15px;
      line-height: 1.5;
    }
    main { width: min(1120px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 80px; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 0; font-size: clamp(32px, 5vw, 46px); line-height: 1.05; letter-spacing: -.035em; }
    h2 { margin-bottom: 4px; font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .report-header { margin-bottom: 40px; }
    .title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
    .map-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 13px;
      box-shadow: var(--shadow);
    }
    .map-pill strong { color: var(--text); font-weight: 600; }
    .lede { margin: 14px 0 0; color: var(--muted); font-size: 16px; }
    .technical-details {
      margin-top: 24px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .technical-details summary {
      padding: 12px 16px;
      cursor: pointer;
      color: var(--muted);
      font-weight: 600;
      user-select: none;
    }
    .details-content { padding: 0 16px 16px; overflow-x: auto; }
    .details-context { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
    .details-table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
    tbody tr:last-child td { border-bottom: 0; }
    .asset-definitions { position: absolute; width: 0; height: 0; overflow: hidden; }
    .icon-changes { margin-top: 40px; }
    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
    .section-summary { margin: 0; color: var(--muted); }
    .section-description { max-width: 720px; margin: 4px 0 16px; color: var(--muted); font-size: 14px; }
    .density-control {
      position: relative;
      display: grid;
      flex: 0 0 auto;
      grid-template-columns: repeat(2, 42px);
      height: 36px;
      margin: 0;
      padding: 3px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--surface-subtle);
    }
    .density-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    .density-control label {
      position: relative;
      z-index: 1;
      display: grid;
      place-items: center;
      min-width: 42px;
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    .density-thumb {
      position: absolute;
      top: 3px;
      bottom: 3px;
      left: 3px;
      width: 42px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: var(--shadow);
      transition: transform 140ms ease;
    }
    #icon-density-2x:checked ~ .section-heading .density-thumb { transform: translateX(42px); }
    #icon-density-1x:checked ~ .section-heading label[for="icon-density-1x"],
    #icon-density-2x:checked ~ .section-heading label[for="icon-density-2x"] { color: var(--text); }
    #icon-density-1x:focus-visible ~ .section-heading label[for="icon-density-1x"],
    #icon-density-2x:focus-visible ~ .section-heading label[for="icon-density-2x"] { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 6px; }
    .change-groups { display: grid; gap: 32px; }
    .change-group-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .change-group-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .change-group-title::before { width: 8px; height: 8px; border-radius: 50%; background: currentColor; content: ""; }
    .change-group-added .change-group-title { color: var(--success); }
    .change-group-modified .change-group-title { color: var(--warning); }
    .change-group-removed .change-group-title { color: var(--danger); }
    .change-count { display: inline-grid; min-width: 24px; height: 24px; place-items: center; padding: 0 7px; border-radius: 999px; background: var(--surface-subtle); color: var(--muted); font-size: 12px; font-weight: 650; }
    .change-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
    .change-card {
      min-width: 0;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .change-card-header { margin-bottom: 18px; }
    .icon-name { min-width: 0; font-size: 14px; font-weight: 650; }
    .icon-comparison { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr); align-items: start; }
    .icon-single { display: grid; place-items: center; }
    .icon-sample { display: grid; justify-items: center; min-width: 0; margin: 0; }
    .icon-frame {
      display: grid;
      place-items: center;
      width: 112px;
      height: 112px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: repeating-conic-gradient(var(--checker-light) 0 25%, var(--checker-dark) 0 50%) 50% / 16px 16px;
      overflow: hidden;
    }
    .icon-preview { display: block; overflow: hidden; clip-path: inset(0); }
    .preview-1x { display: none; width: 48px; height: 48px; }
    .preview-2x { width: 96px; height: 96px; }
    #icon-density-1x:checked ~ .change-groups .preview-1x { display: block; }
    #icon-density-1x:checked ~ .change-groups .preview-2x { display: none; }
    .icon-missing { border-style: dashed; background: transparent; }
    .icon-sample figcaption { display: grid; justify-items: center; gap: 1px; margin-top: 9px; color: var(--text); font-size: 13px; font-weight: 650; text-align: center; }
    .change-arrow { align-self: center; margin-top: 46px; color: var(--muted); text-align: center; }
    .empty-state { padding: 28px; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); text-align: center; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 600px) {
      main { width: min(100% - 24px, 1120px); padding-top: 32px; }
      .report-header { margin-bottom: 32px; }
      .section-heading { align-items: flex-end; }
      .change-card { padding: 14px; }
      .icon-frame { width: 96px; height: 96px; }
      .preview-1x { width: 40px; height: 40px; }
      .preview-2x { width: 80px; height: 80px; }
      .change-arrow { margin-top: 38px; }
      th, td { padding-inline: 10px; }
    }
    @media (prefers-reduced-motion: reduce) { .density-thumb { transition: none; } }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <div class="title-row">
        <h1>Tileflow Icon Diff</h1>
        ${mapName ? `<span class="map-pill">Map: <strong>${escapeHtml(mapName)}</strong></span>` : ''}
      </div>
      <p class="lede">${escapeHtml(
        document.baseline
          ? `Local icon changes compared with the current hosted version (v${document.baseline.version}).`
          : 'Local icons without a hosted version yet.',
      )}</p>
      ${technicalDetails(document, beforeIconCount, afterIconCount)}
    </header>
    ${imageDefinitions(before, after)}
    <section class="icon-changes" aria-labelledby="changed-icons-title">
      ${changedCount ? densityInputs() : ''}
      <div class="section-heading">
        <div>
          <h2 id="changed-icons-title">Changed icons</h2>
          <p class="section-summary">${escapeHtml(
            changedCount
              ? `${changedCount} ${pluralize(changedCount, 'icon')} changed`
              : 'No visual icon changes.',
          )}</p>
        </div>
        ${changedCount ? densityControl() : ''}
      </div>
      <div class="change-groups">
        ${changedCount ? changeGroups.map((group) => iconChangeGroup(group, before, after)).join('\n') : '<p class="empty-state">Before and next icons are visually identical.</p>'}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function technicalDetails(
  document: TileflowIconDiffDocument,
  beforeIconCount: number,
  afterIconCount: number,
): string {
  const context = document.baseline
    ? `Before is hosted revision v${document.baseline.version}. Next is your local icon package.`
    : 'There is no hosted package yet. Next is your local icon package.';
  const rows = [
    [
      'Package hash',
      document.baseline?.package?.contentHash ?? 'None',
      document.proposed.package?.contentHash ?? 'None',
    ],
    [
      'Generated size',
      formatBytes(document.generatedBytes.before),
      formatBytes(document.generatedBytes.after),
    ],
    ['Icon count', String(beforeIconCount), String(afterIconCount)],
  ];

  return `<details class="technical-details"><summary>Details</summary><div class="details-content"><p class="details-context">${escapeHtml(context)}</p><table class="details-table"><thead><tr><th>Metric</th><th>Before</th><th>Next</th></tr></thead><tbody>${rows
    .map(
      ([metric, previous, proposed]) =>
        `<tr><td>${escapeHtml(metric ?? '')}</td><td><code>${escapeHtml(previous ?? '')}</code></td><td><code>${escapeHtml(proposed ?? '')}</code></td></tr>`,
    )
    .join('')}</tbody></table></div></details>`;
}

function imageDefinitions(before: ReportSprite | null, after: ReportSprite | null): string {
  const definitions = [
    imageDefinition(
      'tileflow-before-1x',
      before?.oneXDataUrl,
      before?.oneXWidth,
      before?.oneXHeight,
    ),
    imageDefinition(
      'tileflow-before-2x',
      before?.twoXDataUrl,
      before?.twoXWidth,
      before?.twoXHeight,
    ),
    imageDefinition(
      'tileflow-proposed-1x',
      after?.oneXDataUrl,
      after?.oneXWidth,
      after?.oneXHeight,
    ),
    imageDefinition(
      'tileflow-proposed-2x',
      after?.twoXDataUrl,
      after?.twoXWidth,
      after?.twoXHeight,
    ),
  ].join('');

  return definitions
    ? `<svg class="asset-definitions" aria-hidden="true"><defs>${definitions}</defs></svg>`
    : '';
}

function imageDefinition(
  id: string,
  dataUrl: string | undefined,
  width: number | undefined,
  height: number | undefined,
): string {
  if (!dataUrl || !width || !height) return '';
  return `<image id="${id}" href="${dataUrl}" width="${width}" height="${height}"></image>`;
}

function densityControl(): string {
  return `<div class="density-control" role="radiogroup" aria-label="Icon preview density" aria-owns="icon-density-1x icon-density-2x"><span class="density-thumb" aria-hidden="true"></span><label for="icon-density-1x">1x</label><label for="icon-density-2x">2x</label></div>`;
}

function densityInputs(): string {
  return `<input class="density-input" id="icon-density-1x" name="icon-density" type="radio" aria-label="Show 1x icon previews"><input class="density-input" id="icon-density-2x" name="icon-density" type="radio" aria-label="Show 2x icon previews" checked>`;
}

type IconChangeKind = 'Added' | 'Modified' | 'Removed';

function iconChangeGroup(
  group: {id: string; label: IconChangeKind; names: string[]},
  before: ReportSprite | null,
  after: ReportSprite | null,
): string {
  if (group.names.length === 0) return '';

  const titleId = `change-group-${group.id}-title`;
  return `<section class="change-group change-group-${group.id}" aria-labelledby="${titleId}"><div class="change-group-header"><h3 class="change-group-title" id="${titleId}">${group.label}</h3><span class="change-count" aria-label="${group.names.length} ${pluralize(group.names.length, 'icon')}">${group.names.length}</span></div><div class="change-grid">${group.names.map((name) => iconChangeCard(group.label, name, before, after)).join('\n')}</div></section>`;
}

function iconChangeCard(
  kind: IconChangeKind,
  name: string,
  before: ReportSprite | null,
  after: ReportSprite | null,
): string {
  if (kind === 'Added') {
    return `<article class="change-card"><header class="change-card-header"><code class="icon-name">${escapeHtml(name)}</code></header><div class="icon-single">${iconArtwork('Added', name, after, 'tileflow-proposed')}</div></article>`;
  }

  if (kind === 'Removed') {
    return `<article class="change-card"><header class="change-card-header"><code class="icon-name">${escapeHtml(name)}</code></header><div class="icon-single">${iconArtwork('Removed', name, before, 'tileflow-before')}</div></article>`;
  }

  return `<article class="change-card"><header class="change-card-header"><code class="icon-name">${escapeHtml(name)}</code></header><div class="icon-comparison">${iconSample('Before', name, before, 'tileflow-before')}<span class="change-arrow" aria-hidden="true">→</span>${iconSample('Next', name, after, 'tileflow-proposed')}</div></article>`;
}

function iconSample(
  label: 'Before' | 'Next',
  name: string,
  sprite: ReportSprite | null,
  definitionPrefix: 'tileflow-before' | 'tileflow-proposed',
): string {
  return `<figure class="icon-sample">${iconArtwork(label, name, sprite, definitionPrefix)}<figcaption>${label}</figcaption></figure>`;
}

function iconArtwork(
  label: IconChangeKind | 'Before' | 'Next',
  name: string,
  sprite: ReportSprite | null,
  definitionPrefix: 'tileflow-before' | 'tileflow-proposed',
): string {
  const entryOneX = sprite?.indexOneX[name];
  const entryTwoX = sprite?.indexTwoX[name];

  if (!sprite || (!entryOneX && !entryTwoX)) {
    return `<div class="icon-frame icon-missing" role="img" aria-label="${label} icon preview unavailable"></div>`;
  }

  return `<div class="icon-frame">${iconPreview(label, name, entryOneX, `${definitionPrefix}-1x`, '1x')}${iconPreview(label, name, entryTwoX, `${definitionPrefix}-2x`, '2x')}</div>`;
}

function iconPreview(
  label: string,
  name: string,
  entry: SpriteIndex[string] | undefined,
  definitionId: string,
  density: '1x' | '2x',
): string {
  if (!entry) return '';

  return `<svg class="icon-preview preview-${density}" role="img" aria-label="${escapeHtml(`${label} ${name} at ${density}`)}" viewBox="0 0 ${entry.width} ${entry.height}" overflow="hidden" preserveAspectRatio="xMidYMid meet"><use href="#${definitionId}" x="${-entry.x}" y="${-entry.y}"></use></svg>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024)} KiB`;
  return `${formatDecimal(bytes / (1024 * 1024))} MiB`;
}

function formatDecimal(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

async function writeAtomicReport(path: string, html: string, force: boolean): Promise<void> {
  const source = new TextEncoder().encode(html);

  try {
    const existing = await readFile(path);
    if (Buffer.from(existing).equals(Buffer.from(source))) return;
    if (!force) throw new Error(`Report already exists with different contents: ${path}`);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  await mkdir(dirname(path), {recursive: true});
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, source, {flag: 'wx'});
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

function requiredFile<T extends string>(
  files: Partial<Record<T, Uint8Array>>,
  name: T,
): Uint8Array {
  const source = files[name];
  if (!source) throw new Error(`Missing generated report file: ${name}`);
  return source;
}

function pngDataUrl(source: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
