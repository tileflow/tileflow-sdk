import type {Command} from 'commander';
import {inspectTileflowConfig, type TileflowConfigInspection} from '@tileflow/dev/inspect';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {boundJson, parseQueryInteger, selectJsonPointer} from './query-output';

type ConfigInspectCommandOptions = {
  config: string;
  json?: boolean;
  map?: string;
  domain?: string;
  path?: string;
  limit?: string;
  depth?: string;
};

export function registerConfigInspectCommand(
  inspect: Command,
  dependencies: {defaultConfigPath: string},
): void {
  inspect
    .enablePositionalOptions()
    .description('Inspect resolved maps, lineage, and merge provenance')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--map <name>', 'inspect one exact configured map')
    .option('--domain <name>', 'project one resolved semantic module')
    .option('--path <pointer>', 'project an RFC 6901 pointer in each resolved map')
    .option('--limit <count>', 'bound returned tree entries per map (1–500)')
    .option('--depth <count>', 'maximum projection depth (1–12; default: 6)')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: ConfigInspectCommandOptions) => {
      try {
        const document = await withTileflowConfigSecretsHidden(() =>
          inspectTileflowConfig({config: options.config, cwd: process.cwd(), map: options.map}),
        );
        if (
          options.domain !== undefined ||
          options.path !== undefined ||
          options.limit !== undefined ||
          options.depth !== undefined
        ) {
          if (options.domain !== undefined && options.path !== undefined)
            throw new Error('Choose --domain or --path.');
          const path =
            options.path ??
            (options.domain
              ? `/modules/${options.domain.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
              : '');
          const limit = parseQueryInteger(options.limit ?? '100', '--limit', 500);
          const depth = parseQueryInteger(options.depth ?? '6', '--depth', 12);
          process.stdout.write(
            serializeTileflowCommandDocument({
              ...document,
              maps: document.maps.map((map) => ({
                id: map.id,
                path,
                ...boundJson(selectJsonPointer(map.resolved, path), {limit, depth}),
              })),
            }),
          );
          return;
        }
        if (options.json) {
          process.stdout.write(serializeTileflowCommandDocument(document));
          return;
        }
        printHumanConfigInspection(document);
      } catch (error) {
        const failure = createTileflowCommandFailureDocument('inspect', error, process.cwd(), {
          code: 'INSPECTION_FAILED',
          phase: 'config-inspection',
        });
        if (options.json) {
          process.stderr.write(serializeTileflowCommandDocument(failure));
        } else {
          console.error(`${failure.message} [${failure.code}; ${failure.phase}]`);
          for (const diagnostic of failure.diagnostics.slice(1)) {
            console.error(`- ${diagnostic.path || '(root)'}: ${diagnostic.message}`);
          }
          console.error(`Suggestion: ${failure.suggestion}`);
        }
        process.exitCode = 1;
      }
    });
}

function printHumanConfigInspection(inspection: TileflowConfigInspection): void {
  console.log(inspection.message);
  for (const map of inspection.maps) {
    console.log(`Map: ${map.id}`);
    console.log(`Lineage: ${map.lineage.map((entry) => entry.id).join(' -> ')}`);
    console.log(`Resolved provenance entries: ${map.provenance.length}`);
  }
  console.log('Run tileflow inspect --json for the complete machine-readable result.');
}
