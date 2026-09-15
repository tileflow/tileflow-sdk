import pc from 'picocolors';
import {serializeCanonicalJson} from '@tileflow/core';
import {type AuthConfigV2, normalizeApiOrigin, resolveAccountSession} from './account-session';
import type {ProjectIdentity} from './account-session';
import {
  type HostedTeamCapabilityScope,
  listAccountTeams,
  requestHostedJson,
  requestTeamCapability,
} from './hosted-client';

export type HostedTeamOptions = {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
  team?: string;
};

export type HostedTeamDependencies = {
  defaultApiUrl: string;
  loadAuthConfig: () => Promise<AuthConfigV2>;
};

export type HostedTeamAuthority = {
  apiOrigin: string;
  credential: string;
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
): Promise<HostedTeamAuthority | null> {
  let apiOrigin: string;
  try {
    apiOrigin = normalizeApiOrigin(options.apiUrl ?? dependencies.defaultApiUrl);
  } catch (error) {
    emitFailure(options.json, 'invalid_api_url', safeMessage(error));
    return null;
  }
  if (options.apiKey) {
    if (!/^tf_live_[0-9a-f]{48}$/u.test(options.apiKey)) {
      emitFailure(options.json, 'invalid_team_data_key', 'Team data API key is invalid.');
      return null;
    }
    if (options.team) {
      emitFailure(
        options.json,
        'team_selector_with_api_key',
        'A Team data key already selects its Team; omit --team.',
      );
      return null;
    }
    return {apiOrigin, credential: options.apiKey, team: null};
  }

  let config: AuthConfigV2;
  try {
    config = await dependencies.loadAuthConfig();
  } catch (error) {
    emitFailure(options.json, 'auth_state_unavailable', safeMessage(error));
    return null;
  }
  const selected = resolveAccountSession(config, options.apiUrl ?? dependencies.defaultApiUrl);
  if (selected.kind !== 'selected') {
    emitFailure(
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
    emitFailure(options.json, 'team_discovery_failed', discovered.error);
    return null;
  }
  const requested = options.team
    ? /^@([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(options.team)
    : null;
  if (options.team && !requested) {
    emitFailure(options.json, 'invalid_team', 'Team must use @team syntax.');
    return null;
  }
  const team = requested
    ? discovered.teams.find(({slug}) => slug === requested[1])
    : discovered.teams.length === 1
      ? discovered.teams[0]
      : null;
  if (!team) {
    const options_ = discovered.teams.map(({slug}) => `@${slug}`);
    emitFailure(
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
  if (!capability.ok) {
    emitFailure(options.json, 'team_capability_failed', capability.error);
    return null;
  }
  return {
    apiOrigin: selected.session.apiOrigin,
    credential: capability.capability,
    team,
  };
}

export function authorizedTeamRequest(
  authority: HostedTeamAuthority,
  path: string,
  method: string,
  init: {body?: BodyInit; headers?: Record<string, string>} = {},
) {
  return requestHostedJson(authority.apiOrigin, path, {
    ...(init.body === undefined ? {} : {body: init.body}),
    headers: {Authorization: `Bearer ${authority.credential}`, ...init.headers},
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
