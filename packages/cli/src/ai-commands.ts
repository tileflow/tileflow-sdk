import type {Command} from 'commander';
import {dirname} from 'node:path';
import {
  createStyleResult,
  diffTileflowMaps,
  parseResolvedTileflowMap,
  parseTileflowMap,
  tileflowAuthoringManifestSchemaVersion,
  type TileflowCompilationDiagnostic,
  type TileflowCompilationReport,
  type TileflowSemanticDiff,
  type TileflowSemanticJsonValue,
} from '@tileflow/core';
import {type LoadedTileflowConfig, loadTileflowConfigWithInputs} from '@tileflow/dev/config';
import {prepareTileflowCatalogIcons} from '@tileflow/dev/icons';
import {sanitizeTileflowInspectableValue} from '@tileflow/dev/inspect';
import {
  createTileflowCommandFailureDocument,
  createTileflowCommandSummary,
  createTileflowStructuredDiagnostics,
  sanitizeDiagnosticSecrets,
  serializeTileflowCommandDocument,
  type TileflowStructuredDiagnostic,
} from '@tileflow/dev/validation';
import {withTileflowConfigSecretsHidden} from './config-execution';

type ExplainOptions = {
  apiBaseUrl: string;
  config: string;
  inspection?: boolean;
  json?: boolean;
  map?: string;
  theme?: string;
};

type SemanticDiffOptions = {
  config?: string;
  from?: string;
  fromConfig?: string;
  fromMap?: string;
  json?: boolean;
  to?: string;
  toConfig?: string;
  toMap?: string;
};

type SemanticDiffPlan =
  | {
      config: string;
      from: string;
      mode: 'workspace';
      to: string;
    }
  | {
      fromConfig: string;
      fromMap?: string;
      mode: 'configs';
      toConfig: string;
      toMap?: string;
    };

type SafeCompilationDiagnostic = {
  code: string;
  domain?: string;
  message: string;
  path: string;
  phase: string;
  severity: TileflowCompilationDiagnostic['severity'];
  suggestion?: string;
  target?: string;
};

type ExplainCompilation = {
  diagnostics: SafeCompilationDiagnostic[];
  ok: boolean;
  report: TileflowCompilationReport;
};

export function registerAiCommands(
  program: Command,
  dependencies: {
    /** Test seam for exercising the complete command projection with a compiler failure. */
    createStyleResult?: typeof createStyleResult;
    defaultApiUrl: string;
    defaultConfigPath: string;
  },
): void {
  program
    .command('explain')
    .description('Compile one map/theme and explain semantic compiler decisions')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--map <name>', 'compile one exact configured map')
    .option('--theme <name>', 'compile one exact concrete theme; defaults to the map default')
    .option('--inspection', 'include physical-layer provenance in the compilation report')
    .option('--api-base-url <url>', 'Tileflow API base URL', dependencies.defaultApiUrl)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: ExplainOptions) =>
      runExplain(options, dependencies.createStyleResult ?? createStyleResult),
    );

  program
    .command('semantic-diff')
    .description('Compare resolved semantic maps from two configs or one workspace')
    .option('-c, --config <path>', 'workspace config path for the --from/--to shortcut')
    .option('--from <map>', 'before map ID in --config workspace mode')
    .option('--to <map>', 'after map ID in --config workspace mode')
    .option('--from-config <path>', 'config path used as the before state')
    .option('--to-config <path>', 'config path used as the after state')
    .option('--from-map <map>', 'before map ID; required only when --from-config is multi-map')
    .option('--to-map <map>', 'after map ID; required only when --to-config is multi-map')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: SemanticDiffOptions) =>
      runSemanticDiff(options, dependencies.defaultConfigPath),
    );
}

async function runExplain(
  options: ExplainOptions,
  compileStyle: typeof createStyleResult,
): Promise<void> {
  let selection: {map: string; theme: string} | undefined;
  try {
    const output = await withTileflowConfigSecretsHidden(async () => {
      const loaded = await loadTileflowConfigWithInputs(options.config);
      const mapName = selectMap(loaded, options.map, 'EXPLAIN');
      const themeName = selectTheme(loaded, mapName, options.theme);
      selection = {map: mapName, theme: themeName};

      const prepared = await prepareTileflowCatalogIcons(loaded.project, {
        assetBaseUrl: '/tileflow',
        baseDirectory: dirname(loaded.configFile),
        cwd: process.cwd(),
      });
      const authoredMap = loaded.authoringMaps[mapName] ?? loaded.project.maps[mapName]!;
      const metadata = loaded.project.mapMetadata?.[mapName];
      const result = compileStyle(authoredMap, {
        apiBaseUrl: options.apiBaseUrl,
        inspection: options.inspection,
        map: metadata
          ? {
              id: metadata.id,
              lineage: metadata.lineage.map(({id}) => id),
              version: metadata.version,
            }
          : undefined,
        preparedAssets: prepared.mapAssets[mapName],
        theme: themeName,
      });
      const structuredDiagnostics =
        result.diagnostics.length === 0
          ? []
          : createTileflowStructuredDiagnostics({diagnostics: result.diagnostics}, process.cwd(), {
              code: 'COMPILATION_FAILED',
              phase: 'compilation',
            });
      const compilation: ExplainCompilation = {
        diagnostics: structuredDiagnostics.map(toSafeCompilationDiagnostic),
        ok: result.ok,
        report: result.report,
      };
      return {compilation, result, structuredDiagnostics};
    });

    if (!selection) throw new Error('Explain selection was not resolved.');
    if (!output.result.ok) {
      const failure = createTileflowCommandFailureDocument(
        'explain',
        {diagnostics: output.structuredDiagnostics},
        process.cwd(),
        {code: 'COMPILATION_FAILED', phase: 'compilation'},
      );
      const document = {
        ...failure,
        authoringManifestSchemaVersion: tileflowAuthoringManifestSchemaVersion,
        selection,
        compilation: output.compilation,
      };
      if (options.json) process.stderr.write(serializeTileflowCommandDocument(document));
      else printHumanExplainFailure(document);
      process.exitCode = 1;
      return;
    }

    const summary = createTileflowCommandSummary({
      code: 'COMPILATION_EXPLAINED',
      command: 'explain',
      message: `Compiled and explained ${selection.map}/${selection.theme}.`,
      ok: true,
      path: '',
      phase: 'compilation',
      severity: 'info',
      suggestion: 'Use the report targets and planner decisions to make semantic authoring edits.',
    });
    const document = {
      ...summary,
      authoringManifestSchemaVersion: tileflowAuthoringManifestSchemaVersion,
      selection,
      compilation: output.compilation,
      diagnostics: output.structuredDiagnostics,
    };
    if (options.json) process.stdout.write(serializeTileflowCommandDocument(document));
    else printHumanExplain(document);
  } catch (error) {
    const failure = createTileflowCommandFailureDocument('explain', error, process.cwd(), {
      code: 'EXPLAIN_FAILED',
      phase: 'compilation',
    });
    if (options.json) process.stderr.write(serializeTileflowCommandDocument(failure));
    else printHumanCommandFailure(failure);
    process.exitCode = 1;
  }
}

async function runSemanticDiff(
  options: SemanticDiffOptions,
  defaultConfigPath: string,
): Promise<void> {
  try {
    const difference = await withTileflowConfigSecretsHidden(async () => {
      const plan = createSemanticDiffPlan(options, defaultConfigPath);
      if (plan.mode === 'configs') {
        const fromLoaded = await loadTileflowConfigWithInputs(plan.fromConfig);
        const fromName = selectConfigMap(fromLoaded, plan.fromMap, 'from');

        const toLoaded = await loadTileflowConfigWithInputs(plan.toConfig);
        const toName = selectConfigMap(toLoaded, plan.toMap, 'to');

        return sanitizeSemanticDiff(
          diffTileflowMaps(
            fromLoaded.authoringMaps[fromName] ?? fromLoaded.project.maps[fromName]!,
            toLoaded.authoringMaps[toName] ?? toLoaded.project.maps[toName]!,
          ),
          process.cwd(),
        );
      }

      const loaded = await loadTileflowConfigWithInputs(plan.config);
      const fromName = selectExactMap(loaded, plan.from, 'SEMANTIC_DIFF_FROM', 'from');
      const toName = selectExactMap(loaded, plan.to, 'SEMANTIC_DIFF_TO', 'to');
      const difference = diffTileflowMaps(
        loaded.authoringMaps[fromName] ?? loaded.project.maps[fromName]!,
        loaded.authoringMaps[toName] ?? loaded.project.maps[toName]!,
      );
      return sanitizeSemanticDiff(difference, process.cwd());
    });
    const summary = createTileflowCommandSummary({
      code: 'SEMANTIC_DIFF_READY',
      command: 'semantic-diff',
      message: `Compared ${difference.from.id} to ${difference.to.id} (${difference.summary.total} semantic changes).`,
      ok: true,
      path: '',
      phase: 'semantic-diff',
      severity: 'info',
      suggestion:
        difference.summary.total === 0
          ? 'The resolved semantic designs are equivalent.'
          : 'Apply changes by JSON Pointer through the public semantic module API.',
    });
    const document = {...summary, diff: difference, diagnostics: []};
    if (options.json) process.stdout.write(serializeTileflowCommandDocument(document));
    else printHumanSemanticDiff(difference);
  } catch (error) {
    const failure = createTileflowCommandFailureDocument('semantic-diff', error, process.cwd(), {
      code: 'SEMANTIC_DIFF_FAILED',
      phase: 'semantic-diff',
    });
    if (options.json) process.stderr.write(serializeTileflowCommandDocument(failure));
    else printHumanCommandFailure(failure);
    process.exitCode = 1;
  }
}

function createSemanticDiffPlan(
  options: SemanticDiffOptions,
  defaultConfigPath: string,
): SemanticDiffPlan {
  const usesConfigPair = options.fromConfig !== undefined || options.toConfig !== undefined;
  if (usesConfigPair) {
    const conflictingWorkspaceOption = [
      ['config', options.config],
      ['from', options.from],
      ['to', options.to],
    ].find((entry): entry is [string, string] => entry[1] !== undefined);
    if (conflictingWorkspaceOption) {
      throw commandSelectionError(
        'SEMANTIC_DIFF_MODE_CONFLICT',
        `--${conflictingWorkspaceOption[0]} cannot be combined with --from-config/--to-config; use either paired configs or the --config --from --to workspace shortcut.`,
        conflictingWorkspaceOption[0],
      );
    }
    if (!options.fromConfig) {
      throw commandSelectionError(
        'SEMANTIC_DIFF_FROM_CONFIG_REQUIRED',
        'Paired-config mode requires --from-config <path>.',
        'from-config',
      );
    }
    if (!options.toConfig) {
      throw commandSelectionError(
        'SEMANTIC_DIFF_TO_CONFIG_REQUIRED',
        'Paired-config mode requires --to-config <path>.',
        'to-config',
      );
    }
    return {
      fromConfig: options.fromConfig,
      ...(options.fromMap === undefined ? {} : {fromMap: options.fromMap}),
      mode: 'configs',
      toConfig: options.toConfig,
      ...(options.toMap === undefined ? {} : {toMap: options.toMap}),
    };
  }

  const configSelector = options.fromMap === undefined ? options.toMap : options.fromMap;
  if (configSelector !== undefined) {
    const path = options.fromMap === undefined ? 'to-map' : 'from-map';
    throw commandSelectionError(
      'SEMANTIC_DIFF_MODE_CONFLICT',
      `--${path} is valid only with --from-config and --to-config.`,
      path,
    );
  }
  if (!options.from || !options.to) {
    throw commandSelectionError(
      'SEMANTIC_DIFF_SELECTION_REQUIRED',
      'Workspace mode requires both --from <map> and --to <map>.',
      !options.from ? 'from' : 'to',
    );
  }
  return {
    config: options.config ?? defaultConfigPath,
    from: options.from,
    mode: 'workspace',
    to: options.to,
  };
}

function selectMap(
  loaded: LoadedTileflowConfig,
  requested: string | undefined,
  code: string,
): string {
  const mapNames = Object.keys(loaded.project.maps).sort(compareCodeUnits);
  if (requested) return selectExactMap(loaded, requested, `${code}_MAP`, 'map');
  if (mapNames.length === 1) return mapNames[0]!;
  throw commandSelectionError(
    `${code}_MAP_REQUIRED`,
    `This config defines ${mapNames.length} maps; select one with --map. Available maps: ${mapNames.join(', ')}.`,
    'map',
  );
}

function selectConfigMap(
  loaded: LoadedTileflowConfig,
  requested: string | undefined,
  side: 'from' | 'to',
): string {
  const mapNames = Object.keys(loaded.project.maps).sort(compareCodeUnits);
  const sideCode = side.toUpperCase();
  const path = `${side}-map`;
  if (mapNames.length === 1) {
    if (requested === undefined) return mapNames[0]!;
    throw commandSelectionError(
      `SEMANTIC_DIFF_${sideCode}_MAP_UNNECESSARY`,
      `--${path} is not valid because --${side}-config defines exactly one map (${mapNames[0]}).`,
      path,
    );
  }
  if (requested === undefined) {
    throw commandSelectionError(
      `SEMANTIC_DIFF_${sideCode}_MAP_REQUIRED`,
      `--${side}-config defines ${mapNames.length} maps; select one with --${path}. Available maps: ${mapNames.join(', ')}.`,
      path,
    );
  }
  return selectExactMap(loaded, requested, `SEMANTIC_DIFF_${sideCode}_MAP`, path);
}

function selectExactMap(
  loaded: LoadedTileflowConfig,
  requested: string,
  code: string,
  path: string,
): string {
  if (Object.hasOwn(loaded.project.maps, requested)) return requested;
  const mapNames = Object.keys(loaded.project.maps).sort(compareCodeUnits);
  throw commandSelectionError(
    `${code}_NOT_FOUND`,
    `Unknown Tileflow map "${requested}". Available maps: ${mapNames.join(', ') || '(none)'}.`,
    path,
  );
}

function selectTheme(
  loaded: LoadedTileflowConfig,
  mapName: string,
  requested: string | undefined,
): string {
  const map = parseResolvedTileflowMap(loaded.project.maps[mapName]!);
  const themeNames = Object.keys(map.themes).sort(compareCodeUnits);
  const themeName = requested ?? map.defaultTheme;
  if (Object.hasOwn(map.themes, themeName)) return themeName;
  throw commandSelectionError(
    'EXPLAIN_THEME_NOT_FOUND',
    `Unknown theme "${themeName}" for map "${mapName}". Available themes: ${themeNames.join(', ')}.`,
    'theme',
  );
}

function commandSelectionError(code: string, message: string, path: string): Error {
  return Object.assign(new Error(message), {
    code,
    issues: [{code, message, path, phase: 'command-validation'}],
    phase: 'command-validation',
  });
}

function sanitizeSemanticDiff(difference: TileflowSemanticDiff, cwd: string): TileflowSemanticDiff {
  return {
    ...difference,
    changes: difference.changes.map((change) => ({
      ...change,
      path: sanitizeDiagnosticSecrets(change.path),
      ...('before' in change
        ? {
            before: sanitizeTileflowInspectableValue(
              change.before,
              cwd,
            ) as TileflowSemanticJsonValue,
          }
        : {}),
      ...('after' in change
        ? {
            after: sanitizeTileflowInspectableValue(change.after, cwd) as TileflowSemanticJsonValue,
          }
        : {}),
    })),
  };
}

function toSafeCompilationDiagnostic(
  diagnostic: TileflowStructuredDiagnostic,
): SafeCompilationDiagnostic {
  return {
    code: diagnostic.code,
    ...(diagnostic.domain ? {domain: diagnostic.domain} : {}),
    message: diagnostic.message,
    path: diagnostic.path,
    phase: diagnostic.phase,
    severity: diagnostic.severity === 'info' ? 'warning' : diagnostic.severity,
    ...(diagnostic.suggestion ? {suggestion: diagnostic.suggestion} : {}),
    ...(diagnostic.target ? {target: diagnostic.target} : {}),
  };
}

function printHumanExplain(document: {
  compilation: ExplainCompilation;
  message: string;
  selection: {map: string; theme: string};
}): void {
  console.log(document.message);
  const emitted = document.compilation.report.domains.filter(({status}) => status === 'emitted');
  const suppressed = document.compilation.report.domains.length - emitted.length;
  console.log(`Domains: ${emitted.length} emitted, ${suppressed} suppressed.`);
  console.log(`Semantic targets: ${document.compilation.report.targets.length}.`);
  for (const decision of document.compilation.report.planner) {
    console.log(`Planner ${decision.stage}: ${decision.inputCount} -> ${decision.outputCount}.`);
  }
  console.log(
    document.compilation.diagnostics.length === 0
      ? 'Diagnostics: none.'
      : `Diagnostics: ${document.compilation.diagnostics.length}.`,
  );
  console.log('Run tileflow explain --json for the complete machine-readable report.');
}

function printHumanExplainFailure(document: {
  compilation: ExplainCompilation;
  message: string;
  code: string;
  phase: string;
  suggestion: string;
}): void {
  console.error(`${document.message} [${document.code}; ${document.phase}]`);
  for (const diagnostic of document.compilation.diagnostics) {
    console.error(`- ${diagnostic.path || '(root)'}: ${diagnostic.message}`);
  }
  console.error(`Suggestion: ${document.suggestion}`);
}

function printHumanSemanticDiff(difference: TileflowSemanticDiff): void {
  console.log(
    `Compared ${difference.from.id}@${difference.from.version} to ${difference.to.id}@${difference.to.version}.`,
  );
  console.log(
    `Changes: ${difference.summary.total} (${difference.summary.add} add, ${difference.summary.remove} remove, ${difference.summary.change} change).`,
  );
  for (const change of difference.changes) {
    console.log(`${change.kind.padEnd(6)} ${change.path || '/'}`);
  }
}

function printHumanCommandFailure(document: {
  code: string;
  diagnostics: readonly TileflowStructuredDiagnostic[];
  message: string;
  phase: string;
  suggestion: string;
}): void {
  console.error(`${document.message} [${document.code}; ${document.phase}]`);
  for (const diagnostic of document.diagnostics.slice(1)) {
    console.error(`- ${diagnostic.path || '(root)'}: ${diagnostic.message}`);
  }
  console.error(`Suggestion: ${document.suggestion}`);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
