import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import pc from 'picocolors';
import {type CliAccountSession} from './account-session';
import {
  type CreatedManagedMap,
  createManagedMapSetup,
  type HostedRequestOptions,
  listMapSetupTeams,
  type MapSetupFailureCode,
  type MapSetupTeam,
} from './hosted-client';

/** Browser access chosen for a new Map. `any` is stored as an empty origin list. */
export type BrowserAccess = {kind: 'any'} | {kind: 'selected'; origins: string[]};

export type MapSetupOptions = {
  anyWebsite?: boolean;
  name?: string;
  origin?: string[];
  setupKey?: string;
  team?: string;
};

export type MapSetupPrompts = {
  chooseAccess(): Promise<BrowserAccess | null>;
  chooseTeam(teams: readonly MapSetupTeam[]): Promise<MapSetupTeam | null>;
};

export type MapSetupResult =
  | {ok: true; setupKey: string; value: CreatedManagedMap}
  | {
      code: MapSetupFailureCode | MapSetupInputCode;
      error: string;
      ok: false;
      options?: string[];
    };

type MapSetupInputCode =
  | 'browser_access_required'
  | 'invalid_browser_access'
  | 'invalid_name'
  | 'invalid_setup_key'
  | 'invalid_team'
  | 'no_eligible_team'
  | 'team_ambiguous'
  | 'team_discovery_failed';

export type TeamResolution =
  | {kind: 'choose'; teams: MapSetupTeam[]}
  | {kind: 'map_limit'}
  | {kind: 'none'}
  | {kind: 'not_found'}
  | {kind: 'selected'; team: MapSetupTeam};

const maximumOrigins = 20;
const exactHost = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/u;
const teamReference = /^@([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u;
const setupKeyPattern = /^[\x21-\x7e]{8,128}$/u;

/**
 * The Web entry rule: a named Team is used only while eligible; otherwise exactly one eligible
 * Team is used without asking, several require a choice, and none blocks.
 */
export function resolveMapSetupTeam(
  teams: readonly MapSetupTeam[],
  requestedSlug?: string,
): TeamResolution {
  if (requestedSlug !== undefined) {
    const team = teams.find(({slug}) => slug === requestedSlug);
    if (!team) return {kind: 'not_found'};
    return team.eligible ? {kind: 'selected', team} : {kind: 'map_limit'};
  }
  const eligible = teams.filter((team) => team.eligible);
  if (eligible.length === 1) return {kind: 'selected', team: eligible[0]!};
  if (eligible.length > 1) return {kind: 'choose', teams: eligible};
  return teams.some((team) => team.unavailableReason === 'map_limit')
    ? {kind: 'map_limit'}
    : {kind: 'none'};
}

/** Exact lowercase HTTP(S) origin, or null for paths, wildcards, credentials and bare hosts. */
export function normalizeBrowserOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !exactHost.test(url.hostname) ||
    value.toLowerCase() !== url.origin.toLowerCase()
  ) {
    return null;
  }
  return url.origin.toLowerCase();
}

/** Parse `--origin` and `--any-website`; `null` means no choice was given. */
export function parseBrowserAccess(
  options: Pick<MapSetupOptions, 'anyWebsite' | 'origin'>,
): {ok: true; value: BrowserAccess | null} | {error: string; ok: false} {
  const values = options.origin ?? [];
  if (options.anyWebsite && values.length > 0) {
    return {error: 'Choose either --any-website or --origin, not both.', ok: false};
  }
  if (options.anyWebsite) return {ok: true, value: {kind: 'any'}};
  if (values.length === 0) return {ok: true, value: null};
  return parseOriginList(values);
}

export function parseOriginList(
  values: readonly string[],
): {ok: true; value: BrowserAccess} | {error: string; ok: false} {
  const origins = new Set<string>();
  for (const value of values) {
    const origin = normalizeBrowserOrigin(value.trim());
    if (!origin) {
      return {
        error: `${JSON.stringify(value)} is not an exact website origin such as https://example.com (no path or wildcard).`,
        ok: false,
      };
    }
    origins.add(origin);
  }
  if (origins.size === 0 || origins.size > maximumOrigins) {
    return {error: `Enter between 1 and ${maximumOrigins} website origins.`, ok: false};
  }
  return {ok: true, value: {kind: 'selected', origins: [...origins].sort()}};
}

/** Validate every local Map setup option before any network request. */
export function checkMapSetupOptions(
  options: MapSetupOptions,
): {access: BrowserAccess | null; ok: true} | {code: MapSetupInputCode; error: string; ok: false} {
  if (options.team !== undefined && !teamReference.test(options.team)) {
    return {code: 'invalid_team', error: 'Team must use @team syntax.', ok: false};
  }
  if (options.setupKey !== undefined && !setupKeyPattern.test(options.setupKey)) {
    return {
      code: 'invalid_setup_key',
      error: 'Setup key must be 8 to 128 visible ASCII characters without spaces.',
      ok: false,
    };
  }
  if (
    options.name !== undefined &&
    (options.name.length < 1 ||
      options.name.length > 200 ||
      options.name !== options.name.trim() ||
      /\p{Cc}/u.test(options.name))
  ) {
    return {code: 'invalid_name', error: 'Map name must be 1 to 200 characters.', ok: false};
  }
  const access = parseBrowserAccess(options);
  return access.ok
    ? {access: access.value, ok: true}
    : {code: 'invalid_browser_access', error: access.error, ok: false};
}

/**
 * Resolve the Team and browser access, then create the setup-pending Map.
 *
 * Without prompts (agents, pipes, JSON), a choice that belongs to a person must arrive as a flag:
 * the Team when several are eligible, and browser access always.
 */
export async function setUpManagedMap(
  session: CliAccountSession,
  options: MapSetupOptions,
  dependencies: {prompts: MapSetupPrompts | null; request?: HostedRequestOptions},
): Promise<MapSetupResult> {
  const checked = checkMapSetupOptions(options);
  if (!checked.ok) return checked;

  const discovered = await listMapSetupTeams(session, dependencies.request);
  if (!discovered.ok) {
    return {code: 'team_discovery_failed', error: discovered.error, ok: false};
  }
  const resolution = resolveMapSetupTeam(
    discovered.teams,
    options.team ? teamReference.exec(options.team)![1] : undefined,
  );
  let team: MapSetupTeam | null = null;
  if (resolution.kind === 'selected') team = resolution.team;
  else if (resolution.kind === 'choose') {
    team = dependencies.prompts ? await dependencies.prompts.chooseTeam(resolution.teams) : null;
    if (!team) {
      const choices = resolution.teams.map(({slug}) => `@${slug}`);
      return {
        code: 'team_ambiguous',
        error: `Several Teams can own this Map. Choose one with --team: ${choices.join(', ')}.`,
        ok: false,
        options: choices,
      };
    }
  } else if (resolution.kind === 'map_limit') {
    return {
      code: 'map_limit',
      error: options.team
        ? `${options.team} has reached its Map limit. Archive or delete a Map, or change the plan, in the Tileflow dashboard.`
        : 'Every Team you administer has reached its Map limit. Archive or delete a Map, or change the plan, in the Tileflow dashboard.',
      ok: false,
    };
  } else if (resolution.kind === 'not_found') {
    return {code: 'team_not_found', error: `You do not administer ${options.team}.`, ok: false};
  } else {
    return {
      code: 'no_eligible_team',
      error: 'This account does not administer a Team. Ask a Team Admin to create the Map.',
      ok: false,
    };
  }

  const access =
    checked.access ?? (dependencies.prompts ? await dependencies.prompts.chooseAccess() : null);
  if (!access) {
    return {
      code: 'browser_access_required',
      error:
        'Choose which websites may load this Map: --origin <origin> (repeatable) for exact sites, or --any-website.',
      ok: false,
    };
  }

  const setupKey = options.setupKey ?? `cli-${randomBytes(16).toString('hex')}`;
  const created = await createManagedMapSetup(
    session,
    {
      allowedOrigins: access.kind === 'any' ? [] : access.origins,
      idempotencyKey: setupKey,
      ...(options.name ? {name: options.name} : {}),
      team: `@${team.slug}`,
    },
    dependencies.request,
  );
  return created.ok ? {ok: true, setupKey, value: created.value} : created;
}

export function describeBrowserAccess(allowedOrigins: readonly string[]) {
  return allowedOrigins.length === 0 ? 'Any website' : allowedOrigins.join(', ');
}

/** Interactive choices on a terminal; `null` when stdin or stdout is not a terminal. */
export function createTerminalPrompts(json = false): MapSetupPrompts | null {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) return null;
  return {
    async chooseTeam(teams) {
      console.log(`${pc.cyan('?')} Which Team should own the new Map?`);
      teams.forEach((team, index) =>
        console.log(`  ${index + 1}) ${team.name} ${pc.gray(`@${team.slug}`)}`),
      );
      const answer = await ask('Team number', (value) => {
        const index = Number(value);
        return Number.isInteger(index) && index >= 1 && index <= teams.length
          ? teams[index - 1]!
          : null;
      });
      return answer;
    },
    async chooseAccess() {
      console.log(`${pc.cyan('?')} Which websites may load this Map in a browser?`);
      console.log('  1) Only selected websites (recommended)');
      console.log('  2) Any website');
      const mode = await ask('Choice', (value) =>
        value === '1' ? 'selected' : value === '2' ? 'any' : null,
      );
      if (mode === null) return null;
      if (mode === 'any') return {kind: 'any'};
      return ask('Website origins, separated by spaces (https://example.com)', (value) => {
        const parsed = parseOriginList(value.split(/[\s,]+/u).filter(Boolean));
        if (!parsed.ok) console.log(`  ${pc.yellow(parsed.error)}`);
        return parsed.ok ? parsed.value : null;
      });
    },
  };
}

async function ask<T>(question: string, parse: (value: string) => T | null): Promise<T | null> {
  const readline = createInterface({input: process.stdin, output: process.stdout});
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = parse((await readline.question(`  ${question}: `)).trim());
      if (value !== null) return value;
    }
    return null;
  } finally {
    readline.close();
  }
}
