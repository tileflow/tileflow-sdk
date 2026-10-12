import {randomBytes} from 'node:crypto';
import {chmod, mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {z} from 'zod';

export type AccountIdentity = Readonly<{email: string; id: string; name: string}>;
export type ProjectIdentity = Readonly<{id: string; name: string; slug: string}>;

export const rejectedAccountSessionMessage =
  'The saved Tileflow account session is no longer valid. Run tileflow login to authorize this machine again.';

export type CliAccountSession = Readonly<{
  account: AccountIdentity;
  accountSession: string;
  apiOrigin: string;
  createdAt: string;
  expiresAt: string;
  sessionId: string;
}>;

export type AuthConfig = Readonly<{
  sessions: Readonly<Record<string, CliAccountSession>>;
  version: 2;
}>;

export type AuthFileState =
  | Readonly<{kind: 'empty'}>
  | Readonly<{config: AuthConfig; kind: 'sessions'}>
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
const authConfigSchema = z
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
export function emptyAuthConfig(): AuthConfig {
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

  const config = authConfigSchema.safeParse(parsed);
  return config.success ? {config: freezeConfig(config.data), kind: 'sessions'} : {kind: 'invalid'};
}

export async function loadAuthConfig(path = authConfigPath()): Promise<AuthConfig> {
  const state = await readAuthFile(path);

  if (state.kind === 'empty') return emptyAuthConfig();
  if (state.kind === 'sessions') return state.config;
  throw new Error('Tileflow auth state is invalid; no changes were made.');
}

export async function installAccountSession(session: CliAccountSession, path = authConfigPath()) {
  const normalized = sessionSchema.parse({
    ...session,
    apiOrigin: normalizeApiOrigin(session.apiOrigin),
  });
  const state = await readAuthFile(path);
  if (state.kind === 'invalid') {
    throw new Error('Tileflow auth state is invalid; no changes were made.');
  }
  const current = state.kind === 'sessions' ? state.config : emptyAuthConfig();
  const sessions = {...current.sessions, [normalized.apiOrigin]: normalized};
  if (Object.keys(sessions).length > maximumOrigins) {
    throw new Error('Tileflow CLI API-origin limit reached.');
  }
  const config = freezeConfig({sessions, version: 2});
  await writeAuthFileAtomic(config, path);
  return config;
}

export function resolveAccountSession(
  config: AuthConfig,
  apiUrl: string,
  now = new Date(),
): {kind: 'expired' | 'missing'} | {kind: 'selected'; origin: string; session: CliAccountSession} {
  const origin = normalizeApiOrigin(apiUrl);
  const session = config.sessions[origin];
  if (!session) return {kind: 'missing'};
  return Date.parse(session.expiresAt) <= now.getTime()
    ? {kind: 'expired'}
    : {kind: 'selected', origin, session};
}

export function removeAccountSession(config: AuthConfig, apiUrl: string) {
  const origin = normalizeApiOrigin(apiUrl);
  const sessions = {...config.sessions};
  const removed = sessions[origin];
  delete sessions[origin];
  return {config: freezeConfig({sessions, version: 2}), removed};
}

export async function writeAuthFileAtomic(
  config: AuthConfig,
  path = authConfigPath(),
): Promise<void> {
  const normalized = normalizeConfig(authConfigSchema.parse(config));
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

export function authConfigPath() {
  return resolve(homedir(), '.tileflow', 'config.json');
}

function normalizeConfig(config: AuthConfig): AuthConfig {
  return {
    sessions: Object.fromEntries(
      Object.entries(config.sessions)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([origin, session]) => [origin, {...session, apiOrigin: origin}]),
    ),
    version: 2,
  };
}

function freezeConfig(config: AuthConfig): AuthConfig {
  const normalized = normalizeConfig(config);
  const sessions = Object.fromEntries(
    Object.entries(normalized.sessions).map(([origin, session]) => [
      origin,
      Object.freeze({...session, account: Object.freeze({...session.account})}),
    ]),
  );
  return Object.freeze({sessions: Object.freeze(sessions), version: 2 as const});
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
