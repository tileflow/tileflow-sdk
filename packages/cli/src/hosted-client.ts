import type {z} from 'zod';
import {serializeTileflowFontBundleManifest} from '@tileflow/core';
import type {CompiledTileflowFontBundle} from '@tileflow/dev/fonts';
import type {CompiledTileflowIconPackage} from '@tileflow/dev/icons';
import {
  type AccountIdentity,
  type CliAccountSessionV2,
  normalizeApiOrigin,
  type ProjectIdentity,
} from './account-session';
import {
  hostedFontBundleResponseSchema,
  hostedIconPackageResponseSchema,
  type HostedMapStatus,
  hostedMapStatusSchema,
  hostedStyleDeploymentResponseSchema,
  readBoundedResponseText,
} from './hosted-response';

const defaultHostedRequestTimeoutMs = 30_000;
const maximumHostedRequestTimeoutMs = 60_000;

export type HostedApi = {apiKey: string; apiUrl: string};
export type HostedCapabilityScope = 'static:write' | 'status:read' | 'styles:write';
export type HostedTeamCapabilityScope = 'status:read' | 'tilesets:read' | 'tilesets:write';
export type HostedRequestOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ApiProfile = {
  apiKeyId: string;
  credentialType: 'project_api_key';
  mapId: string;
  organization: ProjectIdentity;
  project: ProjectIdentity;
  projectId: string;
  scopes: string[];
};

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
};

export async function requestHostedJson(
  apiUrl: string,
  path: string,
  init: RequestInit = {},
  options: HostedRequestOptions = {},
): Promise<HostedJsonResponse> {
  return withHostedResponse(apiUrl, path, init, options, async (response) => {
    const source = await readBoundedResponseText(response, 'Hosted API');
    if (!source) return {body: null, json: true, ok: response.ok, status: response.status};
    try {
      return {
        body: JSON.parse(source) as unknown,
        json: true,
        ok: response.ok,
        status: response.status,
      };
    } catch {
      return {body: null, json: false, ok: response.ok, status: response.status};
    }
  });
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
  input: {codeVerifier: string; sleep?: (milliseconds: number) => Promise<unknown>},
  options: HostedRequestOptions = {},
): Promise<DeviceToken> {
  const expiresAt = Date.now() + authorization.expiresIn * 1000;
  const intervalMs = Math.max(authorization.interval, 1) * 1000;
  const wait =
    input.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  while (Date.now() < expiresAt) {
    await wait(intervalMs);
    const response = await requestHostedJson(
      appUrl,
      '/api/cli/device/token',
      jsonRequest('POST', {
        codeVerifier: input.codeVerifier,
        deviceCode: authorization.deviceCode,
      }),
      options,
    );
    if (response.ok && isDeviceToken(response.body)) return response.body;
    const error = asRecord(response.body).error;
    if (error === 'authorization_pending') continue;
    if (error === 'access_denied') throw new Error('CLI authorization was denied.');
    throw new Error(`CLI authorization failed (${response.status}).`);
  }

  throw new Error('CLI authorization expired. Run `tileflow login` again.');
}

export async function validateAccountSession(
  session: CliAccountSessionV2,
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
    return {error: `Account session validation failed (${response.status}).`, ok: false};
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
  session: CliAccountSessionV2,
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
    return {error: `Map capability request failed (${response.status}).`, ok: false};
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

export async function requestProjectCapability(
  session: CliAccountSessionV2,
  project: string,
  scopes: HostedCapabilityScope[],
  options: HostedRequestOptions = {},
): Promise<{capability: string; ok: true} | {error: string; ok: false}> {
  let response: HostedJsonResponse;
  try {
    response = await requestHostedJson(
      session.apiOrigin,
      '/v1/cli/project-capabilities',
      {
        ...jsonRequest('POST', {project, scopes}),
        headers: {
          ...authorizationHeaders(session.accountSession),
          'Content-Type': 'application/json',
        },
      },
      options,
    );
  } catch (error) {
    return {
      error: safeTransportError(error, 'Project capability request failed.'),
      ok: false,
    };
  }
  if (!response.ok) {
    return {error: `Project capability request failed (${response.status}).`, ok: false};
  }
  const body = asRecord(response.body);
  if (
    !response.json ||
    typeof body.capability !== 'string' ||
    !body.capability.startsWith('tf_cap_') ||
    body.capability.length > 8_192 ||
    body.reference !== project ||
    !validIsoDate(body.expiresAt) ||
    !Array.isArray(body.scopes) ||
    body.scopes.join('\0') !== [...scopes].sort().join('\0')
  ) {
    return {error: 'Project capability response was invalid.', ok: false};
  }
  return {capability: body.capability, ok: true};
}

export async function requestTeamCapability(
  session: CliAccountSessionV2,
  team: string,
  scopes: HostedTeamCapabilityScope[],
  options: HostedRequestOptions = {},
): Promise<{capability: string; ok: true; team: ProjectIdentity} | {error: string; ok: false}> {
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
  return {capability: body.capability, ok: true, team: body.team};
}

export async function listAccountTeams(
  session: CliAccountSessionV2,
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

export async function publishHostedStyle(
  api: HostedApi,
  body: unknown,
  responseLabel: string,
  options: HostedRequestOptions = {},
): Promise<
  | {ok: false; status: number}
  | {ok: true; value: z.infer<typeof hostedStyleDeploymentResponseSchema>}
> {
  const response = await requestHostedJson(
    api.apiUrl,
    '/v1/styles',
    {
      ...jsonRequest('POST', body),
      headers: {...authorizationHeaders(api.apiKey), 'Content-Type': 'application/json'},
    },
    options,
  );
  if (!response.ok) return {ok: false, status: response.status};
  return {
    ok: true,
    value: parseResponse(response, hostedStyleDeploymentResponseSchema, responseLabel),
  };
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
    {body: formData, headers: authorizationHeaders(api.apiKey), method: 'PUT'},
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
    {body: formData, headers: authorizationHeaders(api.apiKey), method: 'PUT'},
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
    {headers: authorizationHeaders(api.apiKey)},
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

function authorizationHeaders(token: string): Record<string, string> {
  if (!token || token.length > 8_192 || /[\p{Cc}]/u.test(token)) {
    throw new TypeError('Hosted authorization credential is invalid.');
  }
  return {Authorization: `Bearer ${token}`};
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
