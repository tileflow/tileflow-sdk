import type {Command} from 'commander';
import {inspectTileflowConfig, type TileflowConfigInspection} from '@tileflow/dev/inspect';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';
import {withTileflowConfigSecretsHidden} from './config-execution';

type ConfigInspectCommandOptions = {
  config: string;
  json?: boolean;
  map?: string;
};

export function registerConfigInspectCommand(
  inspect: Command,
  dependencies: {defaultConfigPath: string},
): void {
  inspect
    .description('Inspect resolved maps, lineage, and merge provenance')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--map <name>', 'inspect one exact configured map')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: ConfigInspectCommandOptions) => {
      try {
        const document = await withTileflowConfigSecretsHidden(() =>
          inspectTileflowConfig({config: options.config, cwd: process.cwd(), map: options.map}),
        );
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
