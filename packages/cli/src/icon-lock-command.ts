import type {Command} from 'commander';
import {dirname} from 'node:path';
import pc from 'picocolors';
import {
  collectTileflowIconSetReferences,
  compareCodeUnits,
  parseResolvedTileflowMap,
  parseTileflowIconsLockfile,
  type TileflowIconSetPin,
  type TileflowIconSetReference,
  tileflowIconSetReferenceSchema,
  tileflowIconsLockfileName,
  type TileflowIconSource,
} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {
  getTileflowMapNames,
  loadValidTileflowConfigWithInputs,
  TileflowValidationError,
} from '@tileflow/dev/config';
import {readTileflowIconsLockfileText, writeTileflowIconsLockfile} from '@tileflow/dev/icons';
import type {AuthConfigV2} from './account-session';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {
  authorizedTeamRequest,
  emitFailure,
  emitJson,
  type HostedTeamAuthority,
  type HostedTeamOptions,
  resolveTeamAuthority,
} from './hosted-team';
import {revisionResponseSchema} from './icon-set-command';

type IconLockOptions = HostedTeamOptions & {config: string};

/**
 * Register the repository-local Icon Set lock family.
 *
 * These are the only build-adjacent commands allowed to resolve `latest` or to write
 * `tileflow.icons.lock.json`. They validate every requested target first, then replace the whole
 * lock in one compare-and-swap write. They never rewrite `tileflow.config.ts`.
 */
export function registerIconLockCommands(
  program: Command,
  dependencies: {
    defaultApiUrl: string;
    defaultConfigPath: string;
    loadAuthConfig: () => Promise<AuthConfigV2>;
  },
): void {
  const icons =
    program.commands.find((command) => command.name() === 'icons') ??
    program.command('icons').description('Inspect managed Tileflow icons');

  withLockOptions(
    icons
      .command('install')
      .description('Lock every declared Icon Set reference that has no exact pin yet')
      .argument('[references...]', 'declared @team/set references; omit for every declared set'),
    dependencies,
  ).action(async (references: string[], options: IconLockOptions) => {
    await maintainLock('install', references, options);
  });

  withLockOptions(
    icons
      .command('update')
      .description('Move selected declared Icon Set references to their current latest revision')
      .argument('[references...]', 'declared @team/set references; omit for every declared set'),
    dependencies,
  ).action(async (references: string[], options: IconLockOptions) => {
    await maintainLock('update', references, options);
  });

  withLockOptions(
    icons
      .command('pin')
      .description('Lock one declared Icon Set reference to one exact revision')
      .argument('<reference>', 'declared @team/set reference')
      .requiredOption('--version <version>', 'exact positive revision'),
    dependencies,
  ).action(async (reference: string, options: IconLockOptions & {version: string}) => {
    if (!/^[1-9][0-9]*$/u.test(options.version) || !Number.isSafeInteger(+options.version)) {
      return emitFailure(
        options.json,
        'invalid_icon_set_version',
        'Pin requires one exact positive revision.',
      );
    }
    await maintainLock('pin', [reference], options, Number(options.version));
  });

  async function maintainLock(
    operation: 'install' | 'pin' | 'update',
    requested: readonly string[],
    options: IconLockOptions,
    version?: number,
  ): Promise<void> {
    let declared: DeclaredReferences;
    let baseDirectory: string;
    try {
      const loaded = await withTileflowConfigSecretsHidden(() =>
        loadValidTileflowConfigWithInputs(options.config),
      );
      baseDirectory = dirname(loaded.configFile);
      declared = collectDeclaredReferences(loaded.project);
    } catch (error) {
      return emitFailure(
        options.json,
        error instanceof TileflowValidationError ? 'config_invalid' : 'config_load_failed',
        error instanceof TileflowValidationError
          ? 'Tileflow config has errors.'
          : 'Tileflow config could not be loaded.',
      );
    }

    const selection = selectReferences(operation, requested, declared);
    if ('error' in selection) {
      return emitFailure(options.json, selection.error.code, selection.error.message);
    }

    // Read the exact current bytes before any request so the later write is a true swap.
    let expected: string | null;
    let current: Record<string, TileflowIconSetPin>;
    try {
      expected = await readTileflowIconsLockfileText(baseDirectory);
      current = expected === null ? {} : await readCurrentPins(expected);
    } catch {
      return emitFailure(
        options.json,
        'icon_lock_unreadable',
        `Existing ${tileflowIconsLockfileName} is unreadable; repair or remove it explicitly.`,
      );
    }

    const targets =
      operation === 'install'
        ? selection.selected.filter((reference) => !current[reference])
        : selection.selected;
    if (targets.length === 0 && operation !== 'install') {
      return emitFailure(
        options.json,
        'icon_set_not_declared',
        'Select at least one declared @team/set reference.',
      );
    }

    const authority =
      targets.length === 0
        ? null
        : await resolveTeamAuthority(options, ['icons:read'], dependencies);
    if (targets.length > 0 && !authority) return;

    // Resolve every requested reference before writing anything; no partial lock is valid.
    const resolved: Record<string, TileflowIconSetPin> = {};
    for (const reference of targets) {
      const result = await resolvePin(authority!, reference, version);
      if ('error' in result) {
        return emitFailure(options.json, result.error.code, result.error.message);
      }
      resolved[reference] = result.pin;
    }

    const sets: Record<string, TileflowIconSetPin> = {};
    for (const reference of declared.references) {
      const pin = resolved[reference] ?? current[reference];
      if (pin) sets[reference] = pin;
    }
    // Never create an empty lock for a repository that declares no shared set.
    if (expected !== null || Object.keys(sets).length > 0) {
      try {
        await writeTileflowIconsLockfile(baseDirectory, {lockfileVersion: 1, sets}, expected);
      } catch (error) {
        const code =
          error !== null && typeof error === 'object' && 'code' in error
            ? String((error as {code: unknown}).code)
            : 'icon_lock_write_failed';
        return emitFailure(
          options.json,
          code,
          code === 'ICON_LOCK_CONFLICT'
            ? 'The icon lock changed while this command ran; rerun it without discarding other pins.'
            : 'The icon lock could not be written.',
        );
      }
    }

    const missing = declared.references.filter((reference) => !sets[reference]);
    const document = {
      command: `icons ${operation}`,
      lockfile: tileflowIconsLockfileName,
      missing,
      schemaVersion: 1,
      sets: declared.references
        .filter((reference) => sets[reference])
        .map((reference) => ({
          changed: Boolean(resolved[reference]),
          contentHash: sets[reference]!.contentHash,
          packageId: sets[reference]!.packageId,
          reference,
          version: sets[reference]!.version,
          versionId: sets[reference]!.versionId,
        })),
    };
    if (options.json) return emitJson(document);
    if (document.sets.length === 0) return console.log(pc.gray('No Icon Set references declared.'));
    for (const entry of document.sets) {
      console.log(
        `  ${pc.bold(entry.reference)} ${pc.gray(`v${String(entry.version)}`)}${entry.changed ? '' : pc.gray(' (unchanged)')}`,
      );
    }
    for (const reference of missing) {
      console.log(pc.yellow(`! ${reference} is declared but not locked.`));
    }
  }

  async function resolvePin(
    authority: HostedTeamAuthority,
    reference: string,
    version: number | undefined,
  ): Promise<{pin: TileflowIconSetPin} | {error: {code: string; message: string}}> {
    const slug = reference.split('/')[1]!;
    const selector = version === undefined ? 'latest' : String(version);
    const response = await authorizedTeamRequest(
      authority,
      `/v1/icon-sets/${encodeURIComponent(slug)}/versions/${encodeURIComponent(selector)}`,
      'GET',
    );
    if (!response.ok) {
      return {
        error: {
          code: `http_${response.status}`,
          message: `Resolving ${reference}@${selector} failed (${response.status}).`,
        },
      };
    }
    const parsed = revisionResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      return {
        error: {
          code: 'icon_set_response_invalid',
          message: `Resolving ${reference}@${selector} returned an invalid response.`,
        },
      };
    }
    const revision = parsed.data.revision;
    if (revision.reference !== reference) {
      return {
        error: {
          code: 'icon_set_reference_mismatch',
          message: `Resolving ${reference} returned a different Icon Set.`,
        },
      };
    }
    if (!revision.pin || revision.purgedAt !== null) {
      return {
        error: {
          code: 'icon_set_revision_unavailable',
          message: `${reference}@${selector} has no retained delivery artifact.`,
        },
      };
    }
    if (version !== undefined && revision.version !== version) {
      return {
        error: {
          code: 'icon_set_revision_mismatch',
          message: `${reference}@${selector} returned revision ${revision.version}.`,
        },
      };
    }
    if (authority.team && revision.pin.teamId !== authority.team.id) {
      return {
        error: {
          code: 'icon_set_team_mismatch',
          message: `${reference} is owned by a different Team.`,
        },
      };
    }
    return {pin: revision.pin};
  }
}

function withLockOptions(
  command: Command,
  dependencies: {defaultApiUrl: string; defaultConfigPath: string},
): Command {
  return command
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-1 JSON');
}

type DeclaredReferences = {references: TileflowIconSetReference[]};

/** Collect the declared sequence exactly as authored; a lock command never adds a declaration. */
function collectDeclaredReferences(project: TileflowBuildCatalog): DeclaredReferences {
  const references: TileflowIconSetReference[] = [];
  const seen = new Set<string>();
  for (const mapName of getTileflowMapNames(project).sort(compareCodeUnits)) {
    const sources = (parseResolvedTileflowMap(project.maps[mapName]!).icons ??
      []) as TileflowIconSource[];
    for (const reference of collectTileflowIconSetReferences(sources)) {
      if (seen.has(reference)) continue;
      seen.add(reference);
      references.push(reference);
    }
  }
  return {references: references.sort(compareCodeUnits)};
}

function selectReferences(
  operation: 'install' | 'pin' | 'update',
  requested: readonly string[],
  declared: DeclaredReferences,
): {selected: TileflowIconSetReference[]} | {error: {code: string; message: string}} {
  if (requested.length === 0) {
    if (operation === 'pin') {
      return {error: {code: 'icon_set_not_selected', message: 'Pin one @team/set reference.'}};
    }
    return {selected: [...declared.references]};
  }
  const selected: TileflowIconSetReference[] = [];
  for (const reference of requested) {
    if (!tileflowIconSetReferenceSchema.safeParse(reference).success) {
      return {
        error: {
          code: 'invalid_icon_set_reference',
          message: `${reference} is not a canonical @team/set reference.`,
        },
      };
    }
    if (!declared.references.includes(reference as TileflowIconSetReference)) {
      return {
        error: {
          code: 'icon_set_not_declared',
          message: `${reference} is not declared by any map; add iconSet('${reference}') first.`,
        },
      };
    }
    if (!selected.includes(reference as TileflowIconSetReference)) {
      selected.push(reference as TileflowIconSetReference);
    }
  }
  return {selected: selected.sort(compareCodeUnits)};
}

/** Retain every existing pin verbatim; an unselected reference is never re-resolved or dropped. */
async function readCurrentPins(contents: string): Promise<Record<string, TileflowIconSetPin>> {
  return (await parseTileflowIconsLockfile(contents)).sets;
}
