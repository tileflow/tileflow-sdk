import type {Command} from 'commander';
import pc from 'picocolors';
import {
  type AuthConfig,
  type CliAccountSession,
  normalizeApiOrigin,
  resolveAccountSession,
} from './account-session';
import {emitFailure, emitJson, safeMessage} from './hosted-team';
import {
  createTerminalPrompts,
  describeBrowserAccess,
  type MapSetupOptions,
  type MapSetupPrompts,
  setUpManagedMap,
} from './map-setup';

export type MapCommandDependencies = {
  defaultApiUrl: string;
  loadAuthConfig: () => Promise<AuthConfig>;
};

type MapCreateOptions = MapSetupOptions & {apiUrl?: string; json?: boolean};

export function registerMapCommands(program: Command, dependencies: MapCommandDependencies) {
  const maps = program.command('maps').description('Manage Tileflow managed Maps');

  addMapSetupOptions(
    maps
      .command('create')
      .description('Create a managed Map for this account, ready for tileflow deploy --map-id')
      .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
      .option('--name <name>', 'Map name shown in the dashboard')
      .option('--json', 'print deterministic schema-version-1 JSON'),
  ).action(async (options: MapCreateOptions) => {
    const session = await loadSession(options, dependencies);
    if (!session) return;
    const result = await setUpManagedMap(session, options, {
      prompts: createTerminalPrompts(options.json),
    });
    if (!result.ok) {
      emitFailure(
        options.json,
        result.code,
        result.error,
        result.options ? {options: result.options} : {},
      );
      return;
    }
    const next = `tileflow deploy --map-id ${result.value.map.id}`;
    if (options.json) {
      emitJson({
        command: 'maps create',
        delivery: {allowedOrigins: result.value.allowedOrigins},
        map: result.value.map,
        next,
        ok: true,
        schemaVersion: 1,
        setupKey: result.setupKey,
        team: result.value.team,
      });
      return;
    }
    printCreatedMap(result.value);
    console.log(`\n${pc.bold('Next step')}`);
    console.log(`  ${pc.cyan('•')} Publish the repository map with ${pc.cyan(next)}.`);
  });
}

/** Options shared by `maps create` and `deploy` when it creates the Map. */
export function addMapSetupOptions(command: Command) {
  return command
    .option('--team <team>', 'Team that owns a new Map, as @team')
    .option(
      '--origin <origin>',
      'exact website origin that may load a new Map (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option('--any-website', 'let any website load a new Map')
    .option('--setup-key <key>', 'repeat an interrupted Map creation with the key it printed');
}

export function hasMapSetupOptions(options: MapSetupOptions) {
  return (
    options.team !== undefined ||
    (options.origin?.length ?? 0) > 0 ||
    options.anyWebsite === true ||
    options.setupKey !== undefined
  );
}

/**
 * Create the Map for a deploy that has no `--map-id`, after local preflight and before the first
 * hosted write. Returns the new Map ID, or null after printing why it could not be created.
 */
export async function createMapForDeploy(
  options: MapSetupOptions & {apiUrl?: string},
  dependencies: MapCommandDependencies & {prompts?: MapSetupPrompts | null},
): Promise<string | null> {
  const session = await loadSession(options, dependencies);
  if (!session) return null;
  console.log(`${pc.cyan('i')} No --map-id given; creating a managed Map for this deploy.`);
  const result = await setUpManagedMap(session, options, {
    prompts: dependencies.prompts === undefined ? createTerminalPrompts() : dependencies.prompts,
  });
  if (!result.ok) {
    emitFailure(false, result.code, result.error);
    return null;
  }
  printCreatedMap(result.value);
  console.log(
    pc.gray(
      `If this deploy is interrupted, rerun it with --setup-key ${result.setupKey} to reuse the same Map.`,
    ),
  );
  return result.value.map.id;
}

function printCreatedMap(created: {
  allowedOrigins: string[];
  map: {id: string};
  team: {name: string; slug: string};
}) {
  console.log(
    `${pc.green('✓')} Created ${pc.bold(created.map.id)} in ${created.team.name} ${pc.gray(`@${created.team.slug}`)}.`,
  );
  console.log(
    `${pc.gray('Websites:'.padEnd(13))} ${describeBrowserAccess(created.allowedOrigins)}`,
  );
}

async function loadSession(
  options: {apiUrl?: string; json?: boolean},
  dependencies: MapCommandDependencies,
): Promise<CliAccountSession | null> {
  let apiUrl: string;
  try {
    apiUrl = normalizeApiOrigin(options.apiUrl ?? dependencies.defaultApiUrl);
  } catch (error) {
    emitFailure(options.json, 'invalid_api_url', safeMessage(error));
    return null;
  }
  let config: AuthConfig;
  try {
    config = await dependencies.loadAuthConfig();
  } catch (error) {
    emitFailure(options.json, 'auth_state_unavailable', safeMessage(error));
    return null;
  }
  const selected = resolveAccountSession(config, apiUrl);
  if (selected.kind !== 'selected') {
    emitFailure(
      options.json,
      `account_session_${selected.kind}`,
      selected.kind === 'expired'
        ? 'The Tileflow account session has expired. Run tileflow login.'
        : 'Creating a Map needs a Tileflow account session. Run tileflow login.',
    );
    return null;
  }
  return selected.session;
}
