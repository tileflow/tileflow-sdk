import type {Command} from 'commander';
import {tileflowAuthoringManifest} from '@tileflow/core';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';
import {loadPackagedSchema} from './language-command';
import {boundJson, parseQueryInteger, selectJsonPointer} from './query-output';

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe')
    .description('Discover domains and query the generated authoring schema without loading a map')
    .argument('[topic]', 'domain name, expressions, or schema')
    .option(
      '--ref <pointer>',
      'exact local schema reference, such as #/$defs/TileflowRoadsModuleOptions',
    )
    .option('--path <pointer>', 'JSON Pointer within the selected topic or schema', '')
    .option('--limit <count>', 'maximum returned tree entries (1–500)', '80')
    .option('--depth <count>', 'maximum returned tree depth (1–12)', '4')
    .option('--json', 'print deterministic bounded JSON')
    .action(
      async (
        topic: string | undefined,
        options: {ref?: string; path: string; limit: string; depth: string; json?: boolean},
      ) => {
        try {
          const limit = parseQueryInteger(options.limit, '--limit', 500);
          const depth = parseQueryInteger(options.depth, '--depth', 12);
          const manifest = tileflowAuthoringManifest;
          let value: unknown;
          let schemaRef: string | undefined;
          if (options.ref || (topic && topic !== 'expressions')) {
            const schema = await loadPackagedSchema();
            const domain = manifest.domains.find((entry) => entry.name === topic);
            if (topic && topic !== 'schema' && !domain)
              throw new Error(
                `Unknown topic ${topic}. Run tileflow describe for available domains.`,
              );
            schemaRef = options.ref ?? domain?.optionsSchemaRef ?? '';
            if (schemaRef && !schemaRef.startsWith('#/'))
              throw new Error('--ref must be a local schema reference beginning with #/.');
            value = selectJsonPointer(schema, schemaRef.replace(/^#/u, ''));
          } else if (topic === 'expressions') {
            value = manifest.expressions;
          } else {
            value = {
              domains: manifest.domains.map(({name, api, optionsSchemaRef}) => ({
                name,
                api,
                schemaRef: optionsSchemaRef,
              })),
              topics: ['expressions', 'schema'],
              commands: ['describe', 'inspect', 'capture', 'compare', 'preview'],
            };
          }
          const result = {
            schemaVersion: 1,
            command: 'describe',
            ok: true,
            topic: topic ?? 'overview',
            ...(schemaRef ? {schemaRef} : {}),
            path: options.path,
            ...boundJson(selectJsonPointer(value, options.path), {limit, depth}),
          };
          process.stdout.write(serializeTileflowCommandDocument(result));
        } catch (error) {
          const failure = createTileflowCommandFailureDocument('describe', error, process.cwd(), {
            code: 'DESCRIPTION_FAILED',
            phase: 'language-discovery',
          });
          if (options.json) process.stderr.write(serializeTileflowCommandDocument(failure));
          else console.error(failure.message);
          process.exitCode = 1;
        }
      },
    );
}
