import {gzipSync} from 'node:zlib';
import type {z} from 'zod';
import {serializeCanonicalJson, serializeTileflowFontBundleManifest} from '@tileflow/core';
import {
  tileflowDeploymentWebBytes,
  tileflowNativeDocumentReceiptSchema,
  tileflowNativeDocumentUploadPath,
  tileflowRendererDeploymentLimits,
  tileflowRendererDeploymentPendingSchema,
  type TileflowRendererDeploymentResponse,
  tileflowRendererDeploymentResponseSchema,
  type TileflowSplitRendererDeployment,
} from '@tileflow/core/build';
import type {CompiledTileflowFontBundle} from '@tileflow/dev/fonts';
import type {CompiledTileflowIconPackage} from '@tileflow/dev/icons';
import {
  type AccountIdentity,
  type CliAccountSession,
  normalizeApiOrigin,
  type ProjectIdentity,
  rejectedAccountSessionMessage,
} from './account-session';
import {
  hostedFontBundleResponseSchema,
  hostedIconPackageResponseSchema,
  type HostedMapStatus,
  hostedMapStatusSchema,
  readBoundedResponseText,
} from './hosted-response';

const defaultHostedRequestTimeoutMs = 30_000;
const maximumHostedRequestTimeoutMs = 60_000;

export type HostedApi = {apiKey: string; apiUrl: string; mapId?: string};
export type HostedCapabilityScope = 'static:write' | 'status:read' | 'styles:write';
export type HostedTeamCapabilityScope =
  | 'icons:read'
  | 'icons:write'
  | 'models:read'
  | 'models:write'
  | 'status:read'
  | 'tilesets:read'
  | 'tilesets:write';
export type HostedRequestOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ProjectApiProfile = {
  apiKeyId: string;
  credentialType: 'project_api_key';
  mapId: string;
  organization: ProjectIdentity;
  project: ProjectIdentity;
  projectId: string;
  scopes: string[];
};

export type TeamApiProfile = {
  apiKeyId: string;
  credentialType: 'team_api_key';
  organization: ProjectIdentity;
  mapId: null;
  project: null;
  projectId: null;
  mapAccess: {mode: 'all'} | {mode: 'selected'; ids: string[]} | null;
  scopes: string[];
};

export type ApiProfile = ProjectApiProfile | TeamApiProfile;

export function apiProfileCanTargetMap(profile: ApiProfile, mapId: string) {
  if (!/^map_[A-Za-z0-9_-]{16}$/u.test(mapId)) return false;
  return profile.credentialType === 'project_api_key'
    ? profile.mapId === mapId
    : profile.mapAccess?.mode === 'all' ||
        (profile.mapAccess?.mode === 'selected' && profile.mapAccess.ids.includes(mapId));
}

export type DeviceAuthorization = {
  apiUrl: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
};

export type DeviceToken = {
  account: AccountIdentity;
  accountSession: string;
  apiUrl: string;
  createdAt: string;
  expiresAt: string;
  sessionId: string;
};

export type HostedJsonResponse = {
  body: unknown;
  json: boolean;
  ok: boolean;
  status: number;
  retryAfterMs?: number;
};

export async function requestHostedJson(
  apiUrl: string,
  path: string,
  init: RequestInit = {},
  options: HostedRequestOptions = {},
): Promise<HostedJsonResponse> {
  return withHostedResponse(apiUrl, path, init, options, readHostedJsonResponse);
}

async function readHostedJsonResponse(response: Response): Promise<HostedJsonResponse> {
  const retryAfter = response.headers.get('retry-after');
  const retryAfterMs =
    retryAfter === null
      ? undefined
      : /^\d+$/u.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now());
  const metadata = {
    ok: response.ok,
    status: response.status,
    ...(Number.isFinite(retryAfterMs) ? {retryAfterMs} : {}),
  };
  const source = await readBoundedResponseText(response, 'Hosted API');
  if (!source) return {body: null, json: true, ...metadata};
  try {
    return {
      body: JSON.parse(source) as unknown,
      json: true,
      ...metadata,
    };
  } catch {
    return {body: null, json: false, ...metadata};
  }
}

export async function startDeviceAuthorization(
  appUrl: string,
  body: {codeChallenge: string; deviceName: string},
  options: HostedRequestOptions = {},
): Promise<DeviceAuthorization> {
  const response = await requestHostedJson(
    appUrl,
    '/api/cli/device/start',
    jsonRequest('POST', body),
    options,
  );
  if (!response.ok) {
    throw new Error(`Could not start CLI authorization (${response.status}).`);
  }
  if (!isDeviceAuthorization(response.body)) {
    throw new Error('Could not start CLI authorization (invalid response).');
  }
  const appOrigin = normalizeApiOrigin(appUrl);
  if (
    new URL(response.body.verificationUri).origin !== appOrigin ||
    new URL(response.body.verificationUriComplete).origin !== appOrigin
  ) {
    throw new Error('Could not start CLI authorization (unexpected verification origin).');
  }
  return response.body;
}

export async function pollDeviceToken(
  appUrl: string,
  authorization: DeviceAuthorization,
  input: {
    codeVerifier: string;
    expiresAt?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<unknown>;
  },
  options: HostedRequestOptions = {},
): Promise<DeviceToken> {
  const now = input.now ?? Date.now;
  const expiresAt = input.expiresAt ?? now() + authorization.expiresIn * 1000;
  let intervalMs = Math.max(authorization.interval, 1) * 1000;
  let delayMs = intervalMs;
  const wait =
    input.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  while (now() < expiresAt) {
    options.signal?.throwIfAborted();
    await wait(Math.min(delayMs, expiresAt - now()));
    options.signal?.throwIfAborted();
    if (now() >= expiresAt) break;
    let response: HostedJsonResponse;
    try {
      response = await requestHostedJson(
        appUrl,
        '/api/cli/device/token',
        jsonRequest('POST', {
          codeVerifier: input.codeVerifier,
          deviceCode: authorization.deviceCode,
        }),
        {
          ...options,
          timeoutMs: Math.min(
            options.timeoutMs ?? defaultHostedRequestTimeoutMs,
            expiresAt - now(),
          ),
        },
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (
        !(error instanceof TypeError) &&
        !(error instanceof Error && error.name === 'TimeoutError')
      )
        throw error;
      delayMs = Math.min(Math.max(delayMs * 2, intervalMs), 60_000);
      continue;
    }
    if (response.ok && isDeviceToken(response.body)) return response.body;
    const error = asRecord(response.body).error;
    if (error === 'access_denied') throw new Error('CLI authorization was denied.');
    if (error === 'expired_token') break;
    if (error === 'slow_down' || response.status === 429) {
      intervalMs += 5_000;
      delayMs = Math.max(intervalMs, response.retryAfterMs ?? 0);
      continue;
    }
    if (error === 'authorization_pending') {
      delayMs = intervalMs;
      continue;
    }
    if ([408, 500, 502, 503, 504].includes(response.status)) {
      delayMs = Math.max(Math.min(delayMs * 2, 60_000), response.retryAfterMs ?? 0);
      continue;
    }
    throw new Error(`CLI authorization failed (${response.status}).`);
  }

  throw new Error('CLI authorization expired. Run `tileflow login` again.');
}

export async function validateAccountSession(
  session: CliAccountSession,
  options: HostedRequestOptions = {},
): Promise<
  | {ok: true; value: {account: AccountIdentity; session: {expiresAt: string; id: string}}}
  | {error: string; ok: false}
> {
  const response = await requestHostedJson(
    session.apiOrigin,
    '/v1/cli/account',
    {headers: authorizationHeaders(session.accountSession)},
    options,
  );
  if (!response.ok) {
    return {
      error:
        response.status === 401
          ? rejectedAccountSessionMessage
          : `Account session validation failed (${response.status}).`,
      ok: false,
    };
  }
  const body = asRecord(response.body);
  const account = asRecord(body.account);
  const sessionProfile = asRecord(body.session);
  if (
    !response.json ||
    body.schemaVersion !== 1 ||
    !isAccountIdentity(account) ||
    typeof sessionProfile.id !== 'string' ||
    sessionProfile.id !== session.sessionId ||
    !validIsoDate(sessionProfile.expiresAt) ||
    sessionProfile.expiresAt !== session.expiresAt ||
    Object.hasOwn(body, 'project')
  ) {
    return {error: 'Account session validation returned an invalid response.', ok: false};
  }
  return {
    ok: true,
    value: {
      account,
      session: {expiresAt: sessionProfile.expiresAt, id: sessionProfile.id},
    },
  };
}

export async function validateApiKey(
  apiUrl: string,
  apiKey: string,
  options: HostedRequestOptions = {},
): Promise<{ok: true; value: ApiProfile} | {error: string; ok: false}> {
  const response = await requestHostedJson(
    apiUrl,
    '/v1/me',
    {headers: authorizationHeaders(apiKey)},
    options,
  );
  if (!response.ok) {
    return {error: `API key validation failed (${response.status}).`, ok: false};
  }
  const body = asRecord(response.body);
  if (response.json && body.credentialType === 'team_api_key') {
    const mapAccess = asRecord(body.mapAccess);
    const validMaps =
      body.mapAccess === null ||
      (mapAccess.mode === 'all' && Object.keys(mapAccess).length === 1) ||
      (mapAccess.mode === 'selected' &&
        Object.keys(mapAccess).length === 2 &&
        Array.isArray(mapAccess.ids) &&
        mapAccess.ids.length > 0 &&
        mapAccess.ids.length <= 1000 &&
        mapAccess.ids.every(
          (id) => typeof id === 'string' && /^map_[A-Za-z0-9_-]{16}$/u.test(id),
        ) &&
        new Set(mapAccess.ids).size === mapAccess.ids.length);
    if (
      typeof body.apiKeyId !== 'string' ||
      !isProjectIdentity(body.organization) ||
      body.project !== null ||
      body.projectId !== null ||
      body.mapId !== null ||
      !validMaps ||
      !Array.isArray(body.scopes) ||
      !body.scopes.every((scope) => typeof scope === 'string')
    ) {
      return {error: 'API key validation returned an invalid response.', ok: false};
    }
    return {
      ok: true,
      value: {
        apiKeyId: body.apiKeyId,
        credentialType: 'team_api_key',
        organization: body.organization,
        mapId: null,
        project: null,
        projectId: null,
        scopes: body.scopes as string[],
        mapAccess:
          body.mapAccess === null
            ? null
            : mapAccess.mode === 'all'
              ? {mode: 'all'}
              : {mode: 'selected', ids: mapAccess.ids as string[]},
      },
    };
  }
  if (
    !response.json ||
    typeof body.apiKeyId !== 'string' ||
    body.credentialType !== 'project_api_key' ||
    typeof body.mapId !== 'string' ||
    !/^map_[A-Za-z0-9_-]{16}$/u.test(body.mapId) ||
    !isProjectIdentity(body.organization) ||
    !isProjectIdentity(body.project) ||
    typeof body.projectId !== 'string' ||
    body.projectId !== body.project.id ||
    !Array.isArray(body.scopes)
  ) {
    return {error: 'API key validation returned an invalid response.', ok: false};
  }
  return {
    ok: true,
    value: {
      apiKeyId: body.apiKeyId,
      credentialType: body.credentialType,
      mapId: body.mapId,
      organization: body.organization,
      project: body.project,
      projectId: body.projectId,
      scopes: body.scopes.filter((scope): scope is string => typeof scope === 'string'),
    },
  };
}

export async function requestMapCapability(
  session: CliAccountSession,
  target: {mapId: string},
  scopes: HostedCapabilityScope[],
  options: HostedRequestOptions = {},
): Promise<{capability: string; mapId: string; ok: true} | {error: string; ok: false}> {
  let response: HostedJsonResponse;
  try {
    response = await requestHostedJson(
      session.apiOrigin,
      '/v1/cli/map-capabilities',
      {
        ...jsonRequest('POST', {...target, scopes}),
        headers: {
          ...authorizationHeaders(session.accountSession),
          'Content-Type': 'application/json',
        },
      },
      options,
    );
  } catch (error) {
    return {error: safeTransportError(error, 'Map capability request failed.'), ok: false};
  }
  if (!response.ok) {
    return {
      error:
        response.status === 401
          ? rejectedAccountSessionMessage
          : `Map capability request failed (${response.status}).`,
      ok: false,
    };
  }
  const body = asRecord(response.body);
  if (
    !response.json ||
    typeof body.capability !== 'string' ||
    !body.capability.startsWith('tf_cap_') ||
    body.capability.length > 8_192 ||
    typeof body.mapId !== 'string' ||
    !/^map_[A-Za-z0-9_-]{16}$/u.test(body.mapId) ||
    body.mapId !== target.mapId ||
    !validIsoDate(body.expiresAt) ||
    !Array.isArray(body.scopes) ||
    body.scopes.join('\0') !== [...scopes].sort().join('\0')
  ) {
    return {error: 'Map capability response was invalid.', ok: false};
  }
  return {capability: body.capability, mapId: body.mapId, ok: true};
}

export async function requestTeamCapability(
  session: CliAccountSession,
  team: string,
  scopes: HostedTeamCapabilityScope[],
  options: HostedRequestOptions = {},
): Promise<
  | {capability: string; expiresAt: string; ok: true; team: ProjectIdentity}
  | {error: string; ok: false}
> {
  let response: HostedJsonResponse;
  try {
    response = await requestHostedJson(
      session.apiOrigin,
      '/v1/cli/team-capabilities',
      {
        ...jsonRequest('POST', {scopes, team}),
        headers: {
          ...authorizationHeaders(session.accountSession),
          'Content-Type': 'application/json',
        },
      },
      options,
    );
  } catch (error) {
    return {error: safeTransportError(error, 'Team capability request failed.'), ok: false};
  }
  if (!response.ok) {
    return {error: `Team capability request failed (${response.status}).`, ok: false};
  }
  const body = asRecord(response.body);
  if (
    !response.json ||
    body.schemaVersion !== 1 ||
    typeof body.capability !== 'string' ||
    !body.capability.startsWith('tf_cap_') ||
    body.capability.length > 8_192 ||
    body.reference !== team ||
    !isProjectIdentity(body.team) ||
    `@${body.team.slug}` !== team ||
    !validIsoDate(body.expiresAt) ||
    !Array.isArray(body.scopes) ||
    body.scopes.join('\0') !== [...scopes].sort().join('\0')
  ) {
    return {error: 'Team capability response was invalid.', ok: false};
  }
  return {capability: body.capability, expiresAt: body.expiresAt, ok: true, team: body.team};
}

export async function listAccountTeams(
  session: CliAccountSession,
  options: HostedRequestOptions = {},
): Promise<{ok: true; teams: ProjectIdentity[]} | {error: string; ok: false}> {
  const response = await requestHostedJson(
    session.apiOrigin,
    '/v1/cli/teams',
    {headers: authorizationHeaders(session.accountSession)},
    options,
  );
  const body = asRecord(response.body);
  if (!response.ok) return {error: `Team discovery failed (${response.status}).`, ok: false};
  if (
    !response.json ||
    body.schemaVersion !== 1 ||
    !Array.isArray(body.teams) ||
    !body.teams.every(isProjectIdentity)
  ) {
    return {error: 'Team discovery returned an invalid response.', ok: false};
  }
  const teams = [...body.teams].sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
  if (
    new Set(teams.map(({id}) => id)).size !== teams.length ||
    teams.some((team, index) => index > 0 && teams[index - 1]!.slug >= team.slug)
  ) {
    return {error: 'Team discovery returned unstable ordering.', ok: false};
  }
  return {ok: true, teams};
}

export type MapSetupTeam = {
  eligible: boolean;
  name: string;
  slug: string;
  unavailableReason?: 'map_limit';
};

export type CreatedManagedMap = {
  allowedOrigins: string[];
  map: {id: string; name: string | null; state: 'active' | 'setup_pending'};
  team: {name: string; slug: string};
};

export type MapSetupFailureCode =
  | 'account_session_rejected'
  | 'invalid_request'
  | 'map_limit'
  | 'permission_required'
  | 'setup_conflict'
  | 'setup_failed'
  | 'team_not_found';

/** Teams the account administers, with whether each can allocate one more Map now. */
export async function listMapSetupTeams(
  session: CliAccountSession,
  options: HostedRequestOptions = {},
): Promise<{ok: true; teams: MapSetupTeam[]} | {error: string; ok: false}> {
  let response: HostedJsonResponse;
  try {
    response = await requestHostedJson(
      session.apiOrigin,
      '/v1/cli/map-setup/teams',
      {headers: authorizationHeaders(session.accountSession)},
      options,
    );
  } catch (error) {
    return {error: safeTransportError(error, 'Team discovery failed.'), ok: false};
  }
  if (!response.ok) {
    return {
      error:
        response.status === 401
          ? rejectedAccountSessionMessage
          : `Team discovery failed (${response.status}).`,
      ok: false,
    };
  }
  const body = asRecord(response.body);
  if (
    !response.json ||
    body.schemaVersion !== 1 ||
    !Array.isArray(body.teams) ||
    !body.teams.every(isMapSetupTeam)
  ) {
    return {error: 'Team discovery returned an invalid response.', ok: false};
  }
  return {ok: true, teams: body.teams};
}

/**
 * Create, or replay with the same key, one setup-pending Map in the named Team.
 *
 * `allowedOrigins: []` stores Any website; the caller must have obtained that choice explicitly.
 */
export async function createManagedMapSetup(
  session: CliAccountSession,
  input: {allowedOrigins: string[]; idempotencyKey: string; name?: string; team: string},
  options: HostedRequestOptions = {},
): Promise<
  {ok: true; value: CreatedManagedMap} | {code: MapSetupFailureCode; error: string; ok: false}
> {
  let response: HostedJsonResponse;
  try {
    response = await requestHostedJson(
      session.apiOrigin,
      '/v1/cli/maps',
      {
        ...jsonRequest('POST', input),
        headers: {
          ...authorizationHeaders(session.accountSession),
          'Content-Type': 'application/json',
        },
      },
      options,
    );
  } catch (error) {
    return {
      code: 'setup_failed',
      error: safeTransportError(error, 'Map setup request failed.'),
      ok: false,
    };
  }
  const body = asRecord(response.body);
  if (!response.ok) {
    if (response.status === 401) {
      return {code: 'account_session_rejected', error: rejectedAccountSessionMessage, ok: false};
    }
    const code = mapSetupFailureMessages[body.code as string] ? (body.code as string) : null;
    return code
      ? {code: code as MapSetupFailureCode, error: mapSetupFailureMessages[code]!, ok: false}
      : {code: 'setup_failed', error: `Map setup failed (${response.status}).`, ok: false};
  }
  const map = asRecord(body.map);
  const team = asRecord(body.team);
  const delivery = asRecord(body.delivery);
  if (
    !response.json ||
    body.schemaVersion !== 1 ||
    typeof map.id !== 'string' ||
    !/^map_[A-Za-z0-9_-]{16}$/u.test(map.id) ||
    (map.name !== null && typeof map.name !== 'string') ||
    (map.state !== 'setup_pending' && map.state !== 'active') ||
    typeof team.name !== 'string' ||
    `@${String(team.slug)}` !== input.team ||
    !Array.isArray(delivery.allowedOrigins) ||
    !delivery.allowedOrigins.every((origin) => typeof origin === 'string') ||
    delivery.allowedOrigins.length !== input.allowedOrigins.length
  ) {
    return {code: 'setup_failed', error: 'Map setup returned an invalid response.', ok: false};
  }
  return {
    ok: true,
    value: {
      allowedOrigins: delivery.allowedOrigins as string[],
      map: {id: map.id, name: map.name as string | null, state: map.state},
      team: {name: team.name, slug: team.slug as string},
    },
  };
}

const mapSetupFailureMessages: Readonly<Record<string, string>> = {
  invalid_request: 'Tileflow rejected the Map setup request.',
  map_limit:
    'This Team has reached its Map limit. Archive or delete a Map, or change the plan, in the Tileflow dashboard.',
  permission_required: 'Only a Team Admin can create Maps.',
  setup_conflict:
    'This setup key was already used with another Team or browser access choice. Omit --setup-key to start a new setup.',
  team_not_found: 'No Team you administer matches this Team.',
};

function isMapSetupTeam(value: unknown): value is MapSetupTeam {
  const team = asRecord(value);
  return (
    typeof team.eligible === 'boolean' &&
    typeof team.name === 'string' &&
    typeof team.slug === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(team.slug) &&
    (team.unavailableReason === undefined || team.unavailableReason === 'map_limit') &&
    Object.keys(team).every((key) =>
      ['eligible', 'name', 'slug', 'unavailableReason'].includes(key),
    )
  );
}

/** Why a Hosted renderer deployment stopped; `resumable` when the same deploy can continue it. */
export class HostedDeploymentError extends Error {
  readonly resumable: boolean;
  readonly status?: number;
  readonly code?: string;
  constructor(
    message: string,
    options: {resumable?: boolean; status?: number; code?: string} = {},
  ) {
    super(message);
    this.name = 'HostedDeploymentError';
    this.resumable = options.resumable === true;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
  }
}

/** What a renderer deployment reports as it travels. */
export type HostedRendererDeploymentEvent =
  | Readonly<{
      kind: 'reserved';
      deploymentId: string;
      version: number;
      /** Native documents still to upload, and their decoded bytes. */
      documents: number;
      bytes: number;
      /** Every native document of the deployment: each theme style and the family. */
      total: number;
    }>
  | Readonly<{
      kind: 'uploaded';
      document: 'family' | 'style';
      theme?: string;
      bytes: number;
      position: number;
      count: number;
    }>
  | Readonly<{kind: 'activating'; version: number}>;

const deploymentRequestTimeoutMs = 60_000;
const maximumDeploymentRounds = 4;
const maximumDocumentAttempts = 3;

/**
 * Publish a renderer deployment: post its request, upload every native document the server still
 * lacks (each theme style, then the family document), and post the request again to activate it.
 * Every request travels gzip-encoded. Uploads are create-only on the server, so repeating the same
 * deployment resumes where an interrupted one stopped and a published one answers unchanged.
 */
export async function publishHostedRendererDeployment(
  api: HostedApi,
  input: Readonly<{
    body: Readonly<Record<string, unknown>>;
    split: TileflowSplitRendererDeployment;
  }>,
  options: Readonly<{
    request?: HostedRequestOptions;
    onProgress?(event: HostedRendererDeploymentEvent): void;
    /** Waits between attempts at one document; tests make it immediate. */
    sleep?(milliseconds: number): Promise<unknown>;
  }> = {},
): Promise<TileflowRendererDeploymentResponse> {
  const origin = normalizeApiOrigin(api.apiUrl);
  const mapId = api.mapId;
  if (!mapId) throw new HostedDeploymentError('Hosted deploy requires a managed Map.');
  const headers = {
    ...authorizationHeaders(api.apiKey, mapId),
    'Content-Encoding': 'gzip',
    'Content-Type': 'application/json',
  };
  const request: HostedRequestOptions = {
    ...options.request,
    timeoutMs: options.request?.timeoutMs ?? deploymentRequestTimeoutMs,
  };
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const text = serializeCanonicalJson(input.body);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > tileflowRendererDeploymentLimits.maximumWebRequestBytes)
    throw new HostedDeploymentError(
      `The deployment request is ${formatMegabytes(bytes)}; Hosted accepts at most ${formatMegabytes(tileflowRendererDeploymentLimits.maximumWebRequestBytes)}.`,
    );
  const webBytes = tileflowDeploymentWebBytes(input.body);
  if (webBytes > tileflowRendererDeploymentLimits.maximumWebBytes)
    throw new HostedDeploymentError(
      `The compact web styles use ${webBytes} bytes; Hosted accepts at most ${tileflowRendererDeploymentLimits.maximumWebBytes}.`,
    );
  const body = gzipSync(text);
  const index = input.split.artifact.renderers.native.documents;
  const total = Object.keys(index.styles).length + 1;
  let lastVersion: number | undefined;
  for (let round = 0; round < maximumDeploymentRounds; round += 1) {
    if (lastVersion !== undefined) options.onProgress?.({kind: 'activating', version: lastVersion});
    const response = await requestHostedPublication(
      origin,
      '/v1/styles',
      {body, headers, method: 'POST'},
      request,
      {step: lastVersion === undefined ? 'reservation' : 'activation', bytes},
    );
    if (response.status === 200) {
      const parsed = response.json
        ? tileflowRendererDeploymentResponseSchema.safeParse(response.body)
        : undefined;
      if (!parsed?.success)
        throw new HostedDeploymentError('The deployment response is invalid.', {status: 200});
      return parsed.data;
    }
    if (response.status === 503 && failureCode(response) === 'TF_NATIVE_STAGING_INCOMPLETE')
      continue;
    if (response.status !== 202) throw deploymentFailure(response);
    const parsed = response.json
      ? tileflowRendererDeploymentPendingSchema.safeParse(response.body)
      : undefined;
    if (!parsed?.success || parsed.data.mapId !== mapId)
      throw new HostedDeploymentError('The pending deployment response is invalid.', {
        status: 202,
      });
    const pending = parsed.data;
    lastVersion = pending.version;
    const documents = pending.native.documents.map((document) => {
      const expected = document.document === 'family' ? index.family : index.styles[document.theme];
      const path = tileflowNativeDocumentUploadPath(pending.deploymentId, document);
      if (
        !expected ||
        expected.sha256 !== document.sha256 ||
        expected.bytes !== document.bytes ||
        document.url !== `${origin}${path}`
      )
        throw new HostedDeploymentError(
          'The server reserved a deployment that does not match these native documents.',
          {status: 202},
        );
      const text =
        document.document === 'family'
          ? input.split.documents.family
          : input.split.documents.styles[document.theme]!;
      return {...document, path, text};
    });
    options.onProgress?.({
      kind: 'reserved',
      deploymentId: pending.deploymentId,
      version: pending.version,
      documents: documents.length,
      bytes: documents.reduce((sum, document) => sum + document.bytes, 0),
      total,
    });
    for (const [position, document] of documents.entries()) {
      const outcome = await uploadNativeDocument(origin, headers, request, sleep, {
        ...document,
        deploymentId: pending.deploymentId,
        version: pending.version,
      });
      // The server answered that the deployment moved on: ask it again what remains.
      if (outcome === 'retry-deployment') break;
      options.onProgress?.({
        kind: 'uploaded',
        document: document.document,
        ...(document.document === 'style' ? {theme: document.theme} : {}),
        bytes: document.bytes,
        position: position + 1,
        count: documents.length,
      });
    }
  }
  throw new HostedDeploymentError('The deployment did not complete after its native uploads.', {
    resumable: true,
  });
}

async function uploadNativeDocument(
  origin: string,
  headers: Record<string, string>,
  request: HostedRequestOptions,
  sleep: (milliseconds: number) => Promise<unknown>,
  document: Readonly<{
    deploymentId: string;
    version: number;
    document: 'family' | 'style';
    theme?: string;
    sha256: string;
    bytes: number;
    path: string;
    text: string;
  }>,
): Promise<'retry-deployment' | 'uploaded'> {
  const body = gzipSync(document.text);
  const label =
    document.document === 'family' ? 'the family document' : `native style ${document.theme}`;
  let failure: HostedDeploymentError | undefined;
  for (let attempt = 0; attempt < maximumDocumentAttempts; attempt += 1) {
    if (attempt > 0) await sleep(500 * attempt);
    let response: HostedJsonResponse;
    try {
      response = await requestHostedPublication(
        origin,
        document.path,
        {body, headers, method: 'PUT'},
        request,
        {
          step:
            document.document === 'family'
              ? 'family document upload'
              : `native style ${document.theme} upload`,
          bytes: document.bytes,
        },
      );
    } catch (error) {
      if (!(error instanceof HostedDeploymentError)) throw error;
      failure = error;
      continue;
    }
    const code = failureCode(response);
    if (response.status === 200) {
      const receipt = response.json
        ? tileflowNativeDocumentReceiptSchema.safeParse(response.body)
        : undefined;
      if (
        !receipt?.success ||
        receipt.data.deploymentId !== document.deploymentId ||
        receipt.data.version !== document.version ||
        receipt.data.document !== document.document ||
        receipt.data.theme !== document.theme ||
        receipt.data.sha256 !== document.sha256 ||
        receipt.data.bytes !== document.bytes
      )
        throw new HostedDeploymentError(`The receipt for ${label} is invalid.`, {status: 200});
      return 'uploaded';
    }
    if (
      response.status === 409 &&
      (code === 'TF_NATIVE_DEPLOYMENT_PUBLISHED' || code === 'TF_NATIVE_DOCUMENTS_INCOMPLETE')
    )
      return 'retry-deployment';
    if (response.status >= 500 || response.status === 429) {
      failure = deploymentFailure(response, `The upload of ${label} failed`, true);
      continue;
    }
    throw deploymentFailure(response, `The upload of ${label} failed`);
  }
  throw failure!;
}

async function requestHostedPublication(
  origin: string,
  path: string,
  init: RequestInit,
  request: HostedRequestOptions,
  {step, bytes}: Readonly<{step: string; bytes: number}>,
): Promise<HostedJsonResponse> {
  let status: number | undefined;
  let requestId: string | undefined;
  const opaqueFailure = () =>
    new HostedDeploymentError(
      `The server could not process the publication during ${step} (${bytes} bytes uncompressed).` +
        (requestId ? ` Request ID: ${requestId}.` : '') +
        ' Contact support.',
      {resumable: true, ...(status !== undefined ? {status} : {})},
    );

  let response: HostedJsonResponse;
  try {
    response = await withHostedResponse(origin, path, init, request, (raw) => {
      status = raw.status;
      requestId = [raw.headers.get('x-request-id'), raw.headers.get('cf-ray')].find(
        isPublicationRequestId,
      );
      return readHostedJsonResponse(raw);
    });
  } catch {
    throw opaqueFailure();
  }
  if (response.status >= 500 && !failureCode(response)) {
    const bodyId = asRecord(response.body).requestId;
    if (!requestId && isPublicationRequestId(bodyId)) requestId = bodyId;
    throw opaqueFailure();
  }
  return response;
}

function isPublicationRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

const deploymentFailureDetails = new Map([
  ['TF_DEPLOYMENT_BODY_INVALID', 'Hosted could not read the deployment request.'],
  ['TF_MAP_FORBIDDEN', 'Check that the credential can publish to this Map.'],
  ['TF_STYLE_STORAGE_UNAVAILABLE', 'Hosted could not store the style. Retry the deployment.'],
  ['TF_RENDERER_DEPLOYMENT_RETIRED', 'Update the Tileflow CLI and retry.'],
  ['TF_RENDERER_DEPLOYMENT_INVALID', 'Run tileflow validate --target hosted and fix any issues.'],
  ['TF_NATIVE_FAMILY_REQUIRED', 'The deployment is missing its native family.'],
  ['TF_NATIVE_FAMILY_TOO_LARGE', 'The native family exceeds the Hosted size limit.'],
  ['TF_NATIVE_FAMILY_INVALID', 'The native family document did not match the deployment.'],
  ['TF_NATIVE_DOCUMENT_NOT_FOUND', 'The reserved deployment does not contain this document.'],
  ['TF_NATIVE_DOCUMENT_MISMATCH', 'The native document does not match the deployment.'],
  ['TF_NATIVE_DOCUMENT_UNAVAILABLE', 'Hosted could not store the native document.'],
  ['TF_NATIVE_DOCUMENTS_INCOMPLETE', 'The deployment is missing native documents.'],
  ['TF_NATIVE_DEPLOYMENT_PUBLISHED', 'The deployment was already published.'],
  ['TF_NATIVE_DEPLOYMENT_INCONSISTENT', 'The reservation does not match this deployment.'],
  ['TF_NATIVE_STAGING_INCOMPLETE', 'Hosted has not finished preparing the deployment.'],
  ['TF_NATIVE_STAGING_UNAVAILABLE', 'Hosted could not prepare the deployment.'],
]);

function failureCode(response: HostedJsonResponse): string | undefined {
  const code = asRecord(response.body).code;
  return typeof code === 'string' && deploymentFailureDetails.has(code) ? code : undefined;
}

function deploymentFailure(
  response: HostedJsonResponse,
  prefix = 'Deploy failed',
  resumable = response.status >= 500 || response.status === 429,
): HostedDeploymentError {
  const code = failureCode(response);
  const detail = code
    ? deploymentFailureDetails.get(code)
    : response.status === 401 || response.status === 403
      ? 'Check that the credential can publish to this Map.'
      : undefined;
  return new HostedDeploymentError(
    `${prefix} (${response.status}${code ? ` ${code}` : ''})${detail ? `: ${detail}` : ''}`,
    {resumable, status: response.status, ...(code ? {code} : {})},
  );
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export async function uploadHostedIconPackage(
  api: HostedApi,
  iconPackage: CompiledTileflowIconPackage,
  options: HostedRequestOptions = {},
): Promise<
  {ok: false; status: number} | {ok: true; value: z.infer<typeof hostedIconPackageResponseSchema>}
> {
  const formData = new FormData();
  const fieldNames: Record<string, string> = {
    'sprite.json': 'spriteJson',
    'sprite.png': 'spritePng',
    'sprite@2x.json': 'sprite2xJson',
    'sprite@2x.png': 'sprite2xPng',
  };
  for (const file of iconPackage.files) {
    const fieldName = fieldNames[file.fileName];
    if (!fieldName) throw new Error(`Unknown generated icon package file: ${file.fileName}`);
    const bytes = new Uint8Array(file.source.byteLength);
    bytes.set(file.source);
    formData.append(fieldName, new Blob([bytes.buffer], {type: file.contentType}), file.fileName);
  }
  const response = await requestHostedJson(
    api.apiUrl,
    `/v1/icon-packages/${encodeURIComponent(iconPackage.contentHash)}`,
    {body: formData, headers: authorizationHeaders(api.apiKey, api.mapId), method: 'PUT'},
    options,
  );
  if (!response.ok) return {ok: false, status: response.status};
  const value = parseResponse(
    response,
    hostedIconPackageResponseSchema,
    'Icon package upload response',
  );
  const publicSpriteUrl = new URL(value.spriteUrl);
  if (
    value.contentHash !== iconPackage.contentHash ||
    value.iconCount !== iconPackage.manifest.iconNames.length ||
    value.totalBytes !==
      iconPackage.manifest.files.reduce((total, file) => total + file.byteLength, 0) ||
    publicSpriteUrl.pathname !== `/sprites/${value.id}/sprite` ||
    publicSpriteUrl.search !== ''
  ) {
    throw new Error('Icon package upload response did not confirm the submitted package.');
  }
  return {ok: true, value};
}

export async function uploadHostedFontBundle(
  api: HostedApi,
  bundle: CompiledTileflowFontBundle,
  options: HostedRequestOptions = {},
): Promise<
  {ok: false; status: number} | {ok: true; value: z.infer<typeof hostedFontBundleResponseSchema>}
> {
  const formData = new FormData();
  formData.append(
    'manifest',
    new Blob([serializeTileflowFontBundleManifest(bundle.manifest)], {
      type: 'application/json',
    }),
    'manifest.json',
  );
  for (const file of bundle.files) {
    const source =
      typeof file.source === 'string' ? new TextEncoder().encode(file.source) : file.source;
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    formData.append(
      `file:${encodeURIComponent(file.fileName)}`,
      new Blob([bytes.buffer], {type: file.contentType}),
      file.fileName.split('/').at(-1)!,
    );
  }
  const response = await requestHostedJson(
    api.apiUrl,
    `/v1/font-bundles/${encodeURIComponent(bundle.contentHash)}`,
    {body: formData, headers: authorizationHeaders(api.apiKey, api.mapId), method: 'PUT'},
    options,
  );
  if (!response.ok) return {ok: false, status: response.status};
  const value = parseResponse(
    response,
    hostedFontBundleResponseSchema,
    'Font bundle upload response',
  );
  const publicBaseUrl = new URL(value.baseUrl);
  if (
    value.contentHash !== bundle.contentHash ||
    value.fontFaceCount !== bundle.manifest.fontFaces.length ||
    value.totalBytes !==
      bundle.manifest.files.reduce((total, file) => total + file.byteLength, 0) ||
    publicBaseUrl.pathname !== `/font-bundles/${value.id}` ||
    publicBaseUrl.search !== ''
  ) {
    throw new Error('Font bundle upload response did not confirm the submitted bundle.');
  }
  return {ok: true, value};
}

export async function fetchHostedMapStatus(
  api: HostedApi,
  options: HostedRequestOptions = {},
): Promise<HostedMapStatus> {
  const response = await requestHostedJson(
    api.apiUrl,
    '/v1/status',
    {headers: authorizationHeaders(api.apiKey, api.mapId)},
    options,
  );
  if (!response.ok) throw new Error(`Status failed: ${response.status}.`);
  return parseResponse(response, hostedMapStatusSchema, 'Status response');
}

export async function revokeHostedAccountSession(
  apiUrl: string,
  accountSession: string,
  options: HostedRequestOptions = {},
): Promise<boolean> {
  try {
    const response = await requestHostedJson(
      apiUrl,
      '/v1/cli/account/session',
      {headers: authorizationHeaders(accountSession), method: 'DELETE'},
      options,
    );
    return response.status === 401 || response.ok;
  } catch {
    return false;
  }
}

async function withHostedResponse<T>(
  apiUrl: string,
  path: string,
  init: RequestInit,
  options: HostedRequestOptions,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const origin = normalizeApiOrigin(apiUrl);
  const url = resolveHostedRequestUrl(origin, path);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const requestSignal = createRequestSignal(options.signal ?? init.signal ?? undefined, timeoutMs);
  const requestFetch = options.fetch ?? globalThis.fetch;
  const {signal: _ignoredSignal, ...requestInit} = init;
  try {
    const operation = Promise.resolve()
      .then(() =>
        requestFetch(url, {...requestInit, redirect: 'error', signal: requestSignal.signal}),
      )
      .then(consume);
    return await raceWithAbort(operation, requestSignal.signal);
  } finally {
    requestSignal.cleanup();
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, {once: true});
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function resolveHostedRequestUrl(origin: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\p{Cc}\\]/u.test(path)) {
    throw new TypeError('Hosted API path must be a safe root-relative path.');
  }
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || url.hash) {
    throw new TypeError('Hosted API path must stay on the configured API origin.');
  }
  return url.toString();
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return defaultHostedRequestTimeoutMs;
  if (!Number.isFinite(value) || value < 1 || value > maximumHostedRequestTimeoutMs) {
    throw new TypeError('Hosted request timeoutMs must be between 1 and 60000 milliseconds.');
  }
  return value;
}

function createRequestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(external?.reason);
  if (external?.aborted) abortFromExternal();
  else external?.addEventListener('abort', abortFromExternal, {once: true});
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Hosted request timed out', 'TimeoutError')),
    timeoutMs,
  );
  return {
    cleanup() {
      clearTimeout(timeout);
      external?.removeEventListener('abort', abortFromExternal);
    },
    signal: controller.signal,
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json'},
    method,
  };
}

function authorizationHeaders(token: string, mapId?: string): Record<string, string> {
  if (!token || token.length > 8_192 || /[\p{Cc}]/u.test(token)) {
    throw new TypeError('Hosted authorization credential is invalid.');
  }
  if (mapId !== undefined && !/^map_[A-Za-z0-9_-]{16}$/u.test(mapId))
    throw new TypeError('Hosted Map ID is invalid.');
  return {
    Authorization: `Bearer ${token}`,
    ...(mapId === undefined ? {} : {'X-Tileflow-Map-Id': mapId}),
  };
}

function parseResponse<T>(response: HostedJsonResponse, schema: z.ZodType<T>, label: string): T {
  if (!response.json) throw new Error(`${label} returned invalid JSON.`);
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) throw new Error(`${label} returned an invalid response.`);
  return parsed.data;
}

function isDeviceAuthorization(value: unknown): value is DeviceAuthorization {
  const authorization = asRecord(value);
  return (
    typeof authorization.apiUrl === 'string' &&
    safeOrigin(authorization.apiUrl) !== null &&
    safeIdentifier(authorization.deviceCode, 512) &&
    Number.isInteger(authorization.expiresIn) &&
    (authorization.expiresIn as number) >= 1 &&
    (authorization.expiresIn as number) <= 3_600 &&
    Number.isInteger(authorization.interval) &&
    (authorization.interval as number) >= 1 &&
    (authorization.interval as number) <= 60 &&
    safeIdentifier(authorization.userCode, 64) &&
    safePublicUrl(authorization.verificationUri) &&
    safePublicUrl(authorization.verificationUriComplete)
  );
}

function isDeviceToken(value: unknown): value is DeviceToken {
  const token = asRecord(value);
  return (
    isAccountIdentity(token.account) &&
    typeof token.accountSession === 'string' &&
    /^tf_session_[0-9a-f]{64}$/u.test(token.accountSession) &&
    typeof token.apiUrl === 'string' &&
    safeOrigin(token.apiUrl) !== null &&
    validIsoDate(token.createdAt) &&
    validIsoDate(token.expiresAt) &&
    Date.parse(token.expiresAt) > Date.parse(token.createdAt) &&
    safeIdentifier(token.sessionId, 200) &&
    !Object.hasOwn(token, 'project')
  );
}

function isProjectIdentity(value: unknown): value is ProjectIdentity {
  const identity = asRecord(value);
  return (
    safeIdentifier(identity.id, 160) &&
    safeText(identity.name, 200) &&
    typeof identity.slug === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(identity.slug)
  );
}

function isAccountIdentity(value: unknown): value is AccountIdentity {
  const account = asRecord(value);
  return (
    safeIdentifier(account.id, 200) &&
    safeText(account.name, 200) &&
    typeof account.email === 'string' &&
    account.email.length > 2 &&
    account.email.length <= 320 &&
    account.email.includes('@') &&
    !/[\p{Cc}]/u.test(account.email)
  );
}

function safeIdentifier(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}]/u.test(value)
  );
}

function safeText(value: unknown, maximum: number): value is string {
  return safeIdentifier(value, maximum);
}

function safePublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function safeOrigin(value: string): string | null {
  try {
    return normalizeApiOrigin(value);
  } catch {
    return null;
  }
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeTransportError(error: unknown, fallback: string): string {
  if (error instanceof Error && /safe size limit|timed out/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}
