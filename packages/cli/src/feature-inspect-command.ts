import type {Command} from 'commander';
import {
  getFirstTileflowMapName,
  inspectTileflowFeatures,
  loadValidTileflowConfig,
  type TileflowFeatureInspection,
  TileflowValidationError,
} from '@tileflow/dev';

type FeatureInspectCommandOptions = {
  center: string;
  config: string;
  height: string;
  json?: boolean;
  layers: string;
  limit: string;
  map?: string;
  properties: string;
  timeout: string;
  width: string;
  zoom: string;
};

export function registerFeatureInspectCommand(
  inspect: Command,
  dependencies: {defaultConfigPath: string},
): void {
  inspect
    .command('features')
    .description('Inspect bounded vector features near a map camera')
    .requiredOption('--center <longitude,latitude>', 'camera center')
    .requiredOption('--zoom <number>', 'camera zoom from 0 to 24')
    .requiredOption('--layers <names>', 'comma-separated source-layer names')
    .option(
      '--properties <names>',
      'comma-separated properties to project',
      'name,class,subclass,rank',
    )
    .option('--map <name>', 'exact configured map; defaults to the first map')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--width <pixels>', 'viewport width from 64 to 2048', '512')
    .option('--height <pixels>', 'viewport height from 64 to 2048', '512')
    .option('--limit <count>', 'maximum returned features from 1 to 500', '200')
    .option('--timeout <milliseconds>', 'per-request timeout from 100 to 60000', '10000')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: FeatureInspectCommandOptions) => {
      try {
        await runFeatureInspect(options);
      } catch (error) {
        printFeatureInspectError(error);
        process.exitCode = 1;
      }
    });
}

export function serializeTileflowFeatureInspection(value: TileflowFeatureInspection): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runFeatureInspect(options: FeatureInspectCommandOptions): Promise<void> {
  const center = parseCenter(options.center);
  const zoom = parseNumber(options.zoom, 'zoom');
  const width = parseInteger(options.width, 'width');
  const height = parseInteger(options.height, 'height');
  const limit = parseInteger(options.limit, 'limit');
  const timeoutMs = parseInteger(options.timeout, 'timeout');
  const sourceLayers = parseCsv(options.layers, 'layers');
  const properties = parseCsv(options.properties, 'properties', true);

  delete process.env.TILEFLOW_API_KEY;
  const project = await loadValidTileflowConfig(options.config);
  const mapName = options.map ?? getFirstTileflowMapName(project);
  const inspection = await inspectTileflowFeatures(project, mapName, {
    center,
    height,
    limit,
    properties,
    sourceLayers,
    timeoutMs,
    width,
    zoom,
  });

  if (options.json) {
    process.stdout.write(serializeTileflowFeatureInspection(inspection));
    return;
  }

  printHumanInspection(inspection);
}

function parseCenter(value: string): [number, number] {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new Error('--center expects longitude,latitude.');
  }
  const longitude = parseNumber(parts[0]!, 'center longitude');
  const latitude = parseNumber(parts[1]!, 'center latitude');
  return [longitude, latitude];
}

function parseNumber(value: string, label: string): number {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    throw new Error(`--${label.replaceAll(' ', '-')} expects a number.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`--${label.replaceAll(' ', '-')} expects a number.`);
  return parsed;
}

function parseInteger(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim())) throw new Error(`--${label} expects an integer.`);
  return Number(value);
}

function parseCsv(value: string, label: string, allowEmpty = false): string[] {
  if (allowEmpty && value.trim() === '') return [];
  const values = value.split(',').map((entry) => entry.trim());
  if (values.length === 0 || values.some((entry) => entry === '')) {
    throw new Error(`--${label} expects a comma-separated list without empty names.`);
  }
  return values;
}

function printHumanInspection(inspection: TileflowFeatureInspection): void {
  console.log(
    `Inspected ${inspection.features.length} feature${inspection.features.length === 1 ? '' : 's'} from ${inspection.tilesRead} tile${inspection.tilesRead === 1 ? '' : 's'} at z${inspection.tileZoom}.`,
  );
  console.log(`Map: ${inspection.map}`);
  console.log(`Source: ${inspection.source.id} (${inspection.source.origin})`);
  if (inspection.truncated) console.log('Result truncated by configured safety limits.');
  for (const feature of inspection.features) {
    const name = feature.properties.name;
    const label =
      typeof name === 'string' ? name : feature.id === null ? '(anonymous)' : `#${feature.id}`;
    const properties = Object.entries(feature.properties)
      .filter(([property]) => property !== 'name')
      .map(([property, value]) => `${property}=${String(value)}`)
      .join(', ');
    console.log(`- ${feature.sourceLayer}: ${label}${properties ? ` (${properties})` : ''}`);
  }
}

function printFeatureInspectError(error: unknown): void {
  if (error instanceof TileflowValidationError) {
    console.error(
      [
        'Tileflow config has errors.',
        ...error.messages.map((issue) => `- ${issue.path || '(root)'}: ${issue.message}`),
      ].join('\n'),
    );
    return;
  }
  console.error(error instanceof Error ? error.message : 'Feature inspection failed.');
}
