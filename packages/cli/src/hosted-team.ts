import pc from 'picocolors';
import {serializeCanonicalJson} from '@tileflow/core';
import {type AuthConfig, normalizeApiOrigin, resolveAccountSession} from './account-session';
import type {ProjectIdentity} from './account-session';
import {
  type HostedTeamCapabilityScope,
  listAccountTeams,
  requestHostedJson,
  requestTeamCapability,
} from './hosted-client';
import {allowsStoredAccountSession, isHostedApiKey} from './hosted-options';

export type HostedTeamOptions = {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
  team?: string;
};

export type HostedTeamDependencies = {
  defaultApiUrl: string;
  loadAuthConfig: () => Promise<AuthConfig>;
};

export type HostedTeamAuthority = {
  apiOrigin: string;
  credential: string;
  getCredential?: () => Promise<string>;
  team: ProjectIdentity | null;
};

/**
 * Select one Team authority for a catalog command.
 *
 * A Team data key already selects its Team. An account session is exchanged for a short-lived
 * Team capability carrying exactly the requested scopes; a Map- or Project-scoped credential
 * never acquires catalog authority here.
 */
export async function resolveTeamAuthority(
  options: HostedTeamOptions,
  scopes: HostedTeamCapabilityScope[],
  dependencies: HostedTeamDependencies,
  fail: typeof emitFailure = emitFailure,
): Promise<HostedTeamAuthority | null> {
  let apiOrigin: string;
  try {
    apiOrigin = normalizeApiOrigin(options.apiUrl ?? dependencies.defaultApiUrl);
  } catch (error) {
    fail(options.json, 'invalid_api_url', safeMessage(error));
    return null;
  }
  if (options.apiKey !== undefined) {
    if (!isHostedApiKey(options.apiKey)) {
      fail(options.json, 'invalid_team_data_key', 'Team data API key is invalid.');
      return null;
    }
    if (options.team) {
      fail(
        options.json,
        'team_selector_with_api_key',
        'A Team data key already selects its Team; omit --team.',
      );
      return null;
    }
    return {apiOrigin, credential: options.apiKey, team: null};
  }

  if (!allowsStoredAccountSession()) {
    fail(
      options.json,
      'api_key_required',
      'CI requires TILEFLOW_API_KEY or --api-key. Saved personal logins are not used in CI.',
    );
    return null;
  }

  let config: AuthConfig;
  try {
    config = await dependencies.loadAuthConfig();
  } catch (error) {
    fail(options.json, 'auth_state_unavailable', safeMessage(error));
    return null;
  }
  const selected = resolveAccountSession(config, options.apiUrl ?? dependencies.defaultApiUrl);
  if (selected.kind !== 'selected') {
    fail(
      options.json,
      `account_session_${selected.kind}`,
      selected.kind === 'expired'
        ? 'Account session expired. Run tileflow login.'
        : 'Run tileflow login.',
    );
    return null;
  }
  const discovered = await listAccountTeams(selected.session);
  if (!discovered.ok) {
    fail(options.json, 'team_discovery_failed', discovered.error);
    return null;
  }
  const requested = options.team
    ? /^@([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(options.team)
    : null;
  if (options.team && !requested) {
    fail(options.json, 'invalid_team', 'Team must use @team syntax.');
    return null;
  }
  const team = requested
    ? discovered.teams.find(({slug}) => slug === requested[1])
    : discovered.teams.length === 1
      ? discovered.teams[0]
      : null;
  if (!team) {
    const options_ = discovered.teams.map(({slug}) => `@${slug}`);
    fail(
      options.json,
      options_.length > 1 ? 'team_ambiguous' : 'team_not_found',
      options_.length > 1
        ? `Choose one Team with --team: ${options_.join(', ')}.`
        : 'No matching Team is available.',
      {options: options_},
    );
    return null;
  }
  const capability = await requestTeamCapability(selected.session, `@${team.slug}`, scopes);
  if (!capability.ok || capability.team.id !== team.id) {
    fail(
      options.json,
      'team_capability_failed',
      capability.ok ? 'Team capability response was invalid.' : capability.error,
    );
    return null;
  }

  let current = capability;
  let renewal: Promise<void> | undefined;

  const getCredential = async () => {
    if (Date.parse(current.expiresAt) > Date.now() + 30_000) return current.capability;

    renewal ??= requestTeamCapability(selected.session, `@${team.slug}`, scopes)
      .then((next) => {
        if (
          !next.ok ||
          next.team.id !== team.id ||
          Date.parse(next.expiresAt) <= Date.now() + 30_000
        ) {
          throw new Error('Team authorization could not be renewed. Run tileflow login.');
        }
        current = next;
      })
      .finally(() => {
        renewal = undefined;
      });

    await renewal;
    return current.capability;
  };

  return {
    apiOrigin: selected.session.apiOrigin,
    credential: capability.capability,
    getCredential,
    team,
  };
}

export async function authorizedTeamRequest(
  authority: HostedTeamAuthority,
  path: string,
  method: string,
  init: {body?: BodyInit; headers?: Record<string, string>} = {},
) {
  const credential = (await authority.getCredential?.()) ?? authority.credential;

  return requestHostedJson(authority.apiOrigin, path, {
    ...(init.body === undefined ? {} : {body: init.body}),
    headers: {Authorization: `Bearer ${credential}`, ...init.headers},
    method,
  });
}

export function emitJson(value: unknown) {
  process.stdout.write(`${serializeCanonicalJson(value)}\n`);
}

export function emitFailure(
  json: boolean | undefined,
  code: string,
  message: string,
  context: Record<string, unknown> = {},
) {
  if (json) {
    process.stderr.write(
      `${serializeCanonicalJson({error: {code, ...context, message}, ok: false, schemaVersion: 1})}\n`,
    );
  } else {
    console.error(`${pc.red('Error:')} ${message}`);
  }
  process.exitCode = 1;
}

export function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Team command failed.';
}
