import type {Command} from 'commander';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {
  serializeCanonicalJson,
  tileflowAuthoringManifest,
  type TileflowAuthoringManifest,
} from '@tileflow/core';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';

type JsonDocument = Readonly<Record<string, unknown>>;
type LanguageCommandName = 'language-manifest' | 'language-schema';

export function registerLanguageCommand(
  program: Command,
  dependencies: {
    loadManifest?: () => TileflowAuthoringManifest;
    loadSchema?: () => Promise<JsonDocument>;
  } = {},
): void {
  const language = program
    .command('language')
    .description('Inspect the complete machine-readable Tileflow semantic language');

  language
    .command('manifest')
    .description('Print the semantic compiler authoring manifest')
    .option('--json', 'print deterministic JSON')
    .action(async (options: {json?: boolean}) =>
      runLanguageCommand('language-manifest', options, () =>
        printManifest((dependencies.loadManifest ?? (() => tileflowAuthoringManifest))(), options),
      ),
    );

  language
    .command('schema')
    .description('Print the generated authoring and resolved JSON Schema')
    .option('--json', 'print deterministic JSON')
    .action(async (options: {json?: boolean}) =>
      runLanguageCommand('language-schema', options, async () =>
        printSchema(await (dependencies.loadSchema ?? loadPackagedSchema)(), options),
      ),
    );
}

async function runLanguageCommand(
  command: LanguageCommandName,
  options: {json?: boolean},
  operation: () => Promise<void> | void,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const failure = createTileflowCommandFailureDocument(command, error, process.cwd(), {
      code: command === 'language-manifest' ? 'LANGUAGE_MANIFEST_FAILED' : 'LANGUAGE_SCHEMA_FAILED',
      phase: 'language-discovery',
    });
    if (options.json) process.stderr.write(serializeTileflowCommandDocument(failure));
    else {
      console.error(`${failure.message} [${failure.code}; ${failure.phase}]`);
      console.error(`Suggestion: ${failure.suggestion}`);
    }
    process.exitCode = 1;
  }
}

function printManifest(manifest: TileflowAuthoringManifest, options: {json?: boolean}): void {
  if (options.json) {
    process.stdout.write(`${serializeCanonicalJson(manifest)}\n`);
    return;
  }
  console.log(
    `${manifest.language} (${manifest.compiler.name} v${manifest.compiler.version}); ` +
      `${manifest.domains.length} domains, ${manifest.expressions.builders.length} expression builders.`,
  );
  console.log('Run tileflow language manifest --json for the complete machine-readable document.');
}

function printSchema(schema: JsonDocument, options: {json?: boolean}): void {
  if (options.json) {
    process.stdout.write(`${serializeCanonicalJson(schema)}\n`);
    return;
  }
  console.log(
    `Tileflow config reference schema ${String(schema.schemaVersion)}: ${String(schema.$id)}.`,
  );
  console.log('Run tileflow language schema --json for the complete machine-readable document.');
}

async function loadPackagedSchema(): Promise<JsonDocument> {
  const schemaUrl = import.meta.resolve('@tileflow/core/config-reference.json');
  const parsed = JSON.parse(await readFile(fileURLToPath(schemaUrl), 'utf8')) as unknown;
  if (!isRecord(parsed))
    throw new Error('Packaged Tileflow config reference is not a JSON object.');
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
