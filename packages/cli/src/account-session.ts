import {randomBytes} from 'node:crypto';
import {chmod, mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {z} from 'zod';

export type AccountIdentity = Readonly<{email: string; id: string; name: string}>;
export type ProjectIdentity = Readonly<{id: string; name: string; slug: string}>;

export type CliAccountSessionV2 = Readonly<{
  account: AccountIdentity;
  accountSession: string;
  apiOrigin: string;
  createdAt: string;
  expiresAt: string;
  sessionId: string;
}>;

export type AuthConfigV2 = Readonly<{
  sessions: Readonly<Record<string, CliAccountSessionV2>>;
  version: 2;
}>;

export type LegacyAuthConfigV1 = Readonly<{
  apiKey: string;
  apiUrl: string;
  appUrl?: string;
  createdAt?: string;
  deviceName?: string;
  keyPrefix?: string;
  projectId?: string;
  scopes?: readonly string[];
}>;

export type AuthFileState =
  | Readonly<{kind: 'empty'}>
  | Readonly<{config: LegacyAuthConfigV1; kind: 'legacy_project_login'}>
  | Readonly<{config: AuthConfigV2; kind: 'v2'}>
  | Readonly<{kind: 'superseded_profiles'}>
  | Readonly<{kind: 'invalid'}>;

const maximumAuthFileBytes = 1024 * 1024;
const maximumOrigins = 16;
const accountSchema = z
  .object({
    email: z.email().max(320),
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
  })
  .strict();
const apiOriginSchema = z
  .url()
  .max(2048)
  .refine((value) => normalizeApiOrigin(value) === value);
const sessionSchema = z
  .object({
    account: accountSchema,
    accountSession: z.string().regex(/^tf_session_[0-9a-f]{64}$/u),
    apiOrigin: apiOriginSchema,
    createdAt: z.iso.datetime({offset: true}),
    expiresAt: z.iso.datetime({offset: true}),
    sessionId: z.string().min(1).max(200),
  })
  .strict()
  .refine((value) => Date.parse(value.expiresAt) > Date.parse(value.createdAt), {
    message: 'session expiry must follow creation',
  });
const authConfigV2Schema = z
  .object({
    sessions: z.record(z.string().max(2048), sessionSchema),
    version: z.literal(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.sessions).length > maximumOrigins) {
      context.addIssue({code: 'custom', message: 'too many API origins', path: ['sessions']});
    }
    for (const [origin, session] of Object.entries(value.sessions)) {
      if (normalizeApiOrigin(origin) !== origin || session.apiOrigin !== origin) {
        context.addIssue({code: 'custom', message: 'origin mismatch', path: ['sessions', origin]});
      }
    }
  });
const legacyAuthConfigSchema = z
  .object({
    apiKey: z.string().min(16).max(4096),
    apiUrl: z.string().min(1).max(2048),
    appUrl: z.string().max(2048).optional(),
    createdAt: z.string().max(64).optional(),
    deviceName: z.string().max(200).optional(),
    keyPrefix: z.string().max(64).optional(),
    projectId: z.string().max(200).optional(),
    scopes: z.array(z.string().max(128)).max(32).optional(),
  })
  .strict();

export function emptyAuthConfig(): AuthConfigV2 {
  return Object.freeze({sessions: Object.freeze({}), version: 2});
}

export async function readAuthFile(path = authConfigPath()): Promise<AuthFileState> {
  let source: string;

  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    return isMissingFile(error) ? {kind: 'empty'} : {kind: 'invalid'};
  }

  if (Buffer.byteLength(source, 'utf8') > maximumAuthFileBytes) return {kind: 'invalid'};

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return {kind: 'invalid'};
  }

  const v2 = authConfigV2Schema.safeParse(parsed);
  if (v2.success) return {config: freezeConfig(v2.data), kind: 'v2'};

  const legacy = legacyAuthConfigSchema.safeParse(parsed);
  if (legacy.success) {
    return {config: Object.freeze(legacy.data), kind: 'legacy_project_login'};
  }

  if (isSupersededProfileState(parsed)) return {kind: 'superseded_profiles'};
  return {kind: 'invalid'};
}

export async function loadAuthConfig(path = authConfigPath()): Promise<AuthConfigV2> {
  const state = await readAuthFile(path);

  if (state.kind === 'empty') return emptyAuthConfig();
  if (state.kind === 'v2') return state.config;
  if (state.kind === 'legacy_project_login' || state.kind === 'superseded_profiles') {
    throw new Error(
      'The saved login uses the retired destination-credential model. Run `tileflow login` to authorize your Tileflow account.',
    );
  }
  throw new Error('Tileflow auth state is invalid; no changes were made.');
}

export async function installAccountSession(session: CliAccountSessionV2, path = authConfigPath()) {
  const normalized = sessionSchema.parse({
    ...session,
    apiOrigin: normalizeApiOrigin(session.apiOrigin),
  });
  const state = await readAuthFile(path);
  if (state.kind === 'invalid') {
    throw new Error('Tileflow auth state is invalid; no changes were made.');
  }
  const current = state.kind === 'v2' ? state.config : emptyAuthConfig();
  const sessions = {...current.sessions, [normalized.apiOrigin]: normalized};
  if (Object.keys(sessions).length > maximumOrigins) {
    throw new Error('Tileflow CLI API-origin limit reached.');
  }
  const config = freezeConfig({sessions, version: 2});
  await writeAuthFileAtomic(config, path);
  return config;
}

export function resolveAccountSession(
  config: AuthConfigV2,
  apiUrl: string,
  now = new Date(),
):
  | {kind: 'expired' | 'missing'}
  | {kind: 'selected'; origin: string; session: CliAccountSessionV2} {
  const origin = normalizeApiOrigin(apiUrl);
  const session = config.sessions[origin];
  if (!session) return {kind: 'missing'};
  return Date.parse(session.expiresAt) <= now.getTime()
    ? {kind: 'expired'}
    : {kind: 'selected', origin, session};
}

export function removeAccountSession(config: AuthConfigV2, apiUrl: string) {
  const origin = normalizeApiOrigin(apiUrl);
  const sessions = {...config.sessions};
  const removed = sessions[origin];
  delete sessions[origin];
  return {config: freezeConfig({sessions, version: 2}), removed};
}

export async function writeAuthFileAtomic(
  config: AuthConfigV2,
  path = authConfigPath(),
): Promise<void> {
  const normalized = normalizeConfig(authConfigV2Schema.parse(config));
  const source = `${JSON.stringify(normalized, null, 2)}\n`;

  if (Buffer.byteLength(source, 'utf8') > maximumAuthFileBytes) {
    throw new Error('Tileflow auth state exceeds its safe size limit.');
  }

  const directory = dirname(path);
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  await mkdir(directory, {mode: 0o700, recursive: true});
  await chmod(directory, 0o700);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(source, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function removeAuthFile(path = authConfigPath()) {
  await unlink(path).catch((error) => {
    if (!isMissingFile(error)) throw error;
  });
}

export function normalizeApiOrigin(value: string) {
  const url = new URL(value);

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('Tileflow API URL must be a safe HTTP origin.');
  }

  return url.origin;
}

export function parseProjectReference(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^@([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(
    value,
  );
  return match ? {organizationSlug: match[1], projectSlug: match[2]} : null;
}

export function projectReference(value: {
  organization: Pick<ProjectIdentity, 'slug'>;
  project: Pick<ProjectIdentity, 'slug'>;
}) {
  return `@${value.organization.slug}/${value.project.slug}`;
}

export function authConfigPath() {
  return resolve(homedir(), '.tileflow', 'config.json');
}

function normalizeConfig(config: AuthConfigV2): AuthConfigV2 {
  return {
    sessions: Object.fromEntries(
      Object.entries(config.sessions)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([origin, session]) => [origin, {...session, apiOrigin: origin}]),
    ),
    version: 2,
  };
}

function freezeConfig(config: AuthConfigV2): AuthConfigV2 {
  const normalized = normalizeConfig(config);
  const sessions = Object.fromEntries(
    Object.entries(normalized.sessions).map(([origin, session]) => [
      origin,
      Object.freeze({...session, account: Object.freeze({...session.account})}),
    ]),
  );
  return Object.freeze({sessions: Object.freeze(sessions), version: 2 as const});
}

function isSupersededProfileState(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 2 &&
    Boolean(record.profiles && typeof record.profiles === 'object') &&
    Boolean(record.selections && typeof record.selections === 'object')
  );
}

async function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
