import type {Command} from 'commander';
import pc from 'picocolors';
import {
  type AuthConfigV2,
  type CliAccountSessionV2,
  parseProjectReference,
  resolveAccountSession,
} from './account-session';
import {requestHostedJson} from './hosted-client';

type Identity = {id: string; name: string; slug: string};
type ProjectItem = Identity & {
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountProjectTarget = {
  organization: Identity;
  project: ProjectItem;
  reference: string;
};

type ProjectCommandOptions = {apiUrl?: string; json?: boolean};

export function registerProjectCommands(
  program: Command,
  dependencies: {
    defaultApiUrl: string;
    loadAuthConfig: () => Promise<AuthConfigV2>;
  },
) {
  const projects = program
    .command('projects', {hidden: true})
    .description('Manage internal application destinations');

  projects
    .command('list')
    .description('List application destinations accessible to the authenticated Tileflow account')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--include-archived', 'include archived application destinations')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: ProjectCommandOptions & {includeArchived?: boolean}) => {
      const session = await requireCommandSession(options, dependencies);
      if (!session) return;
      const result = await fetchAccountProjects(session, Boolean(options.includeArchived));
      if (!result.ok) return emitRemoteFailure(options.json, result);
      const document = {
        schemaVersion: 1,
        account: session.account,
        command: 'projects list',
        projects: result.items,
      };

      if (options.json) return emitJson(document);
      if (!result.items.length) {
        console.log(pc.gray('No managed destinations found.'));
        return;
      }
      for (const target of result.items) {
        console.log(
          `  ${target.project.archivedAt ? pc.yellow('○') : pc.green('●')} ${pc.bold(target.project.name)} ${pc.gray(target.reference)}${target.project.archivedAt ? pc.gray(' (archived)') : ''}`,
        );
      }
    });

  projects
    .command('create <slug>')
    .description('Create an isolated application destination')
    .requiredOption('--name <name>', 'application display name')
    .option('--organization <organization>', 'target organization as @organization')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(
      async (
        slug: string,
        options: ProjectCommandOptions & {name: string; organization?: string},
      ) => {
        if (!validSlug(slug) || !validName(options.name)) {
          return emitLocalFailure(
            options.json,
            'invalid_project',
            'Application slug or name is invalid.',
          );
        }
        const session = await requireCommandSession(options, dependencies);
        if (!session) return;
        const discovered = await fetchAccountProjects(session, false);
        if (!discovered.ok) return emitRemoteFailure(options.json, discovered);
        const organizations = uniqueOrganizations(discovered.items);
        const requested = parseOrganizationReference(options.organization);

        if (options.organization && !requested) {
          return emitLocalFailure(
            options.json,
            'invalid_organization',
            'Organization must use @organization syntax.',
          );
        }

        const organization = requested
          ? organizations.find((candidate) => candidate.slug === requested)
          : organizations.length === 1
            ? organizations[0]
            : null;

        if (!organization) {
          if (!requested && organizations.length > 1) {
            return emitAmbiguousOrganizations(options.json, organizations, slug, options.name);
          }
          return emitLocalFailure(
            options.json,
            'organization_not_found',
            requested
              ? `Organization @${requested} is not accessible.`
              : 'No active content organization is accessible.',
          );
        }

        const result = await accountRequest(
          session,
          `/v1/organizations/${encodeURIComponent(organization.slug)}/projects/${encodeURIComponent(slug)}`,
          {
            body: JSON.stringify({name: options.name.trim()}),
            headers: {'Content-Type': 'application/json'},
            method: 'PUT',
          },
        );
        if (!result.ok) return emitRemoteFailure(options.json, result);
        const document = {
          schemaVersion: 1,
          command: 'projects create',
          ...asRecord(result.body),
        };
        if (options.json) return emitJson(document);
        console.log(`${pc.green('✓')} Application ${pc.bold(options.name.trim())} is ready.`);
        console.log(pc.gray(`Its technical selector is --project @${organization.slug}/${slug}.`));
      },
    );

  projects
    .command('show <target>')
    .description('Show one application destination')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (target: string, options: ProjectCommandOptions) => {
      const requested = parseProjectReference(target);
      if (!requested) {
        return emitLocalFailure(options.json, 'invalid_project', 'Use @organization/project.');
      }
      const session = await requireCommandSession(options, dependencies);
      if (!session) return;
      const result = await accountRequest(
        session,
        `/v1/organizations/${encodeURIComponent(requested.organizationSlug)}/projects/${encodeURIComponent(requested.projectSlug)}?includeArchived=true`,
        {method: 'GET'},
      );
      if (!result.ok) return emitRemoteFailure(options.json, result);
      const document = {schemaVersion: 1, command: 'projects show', ...asRecord(result.body)};
      if (options.json) return emitJson(document);
      const project = asRecord(result.body).project;
      if (!isProjectItem(project)) {
        return emitLocalFailure(false, 'invalid_response', 'Destination response was invalid.');
      }
      console.log(`${pc.bold(project.name)} ${pc.gray(target)}`);
      console.log(project.archivedAt ? pc.yellow('Archived') : pc.green('Active'));
    });

  for (const archived of [true, false]) {
    const verb = archived ? 'archive' : 'unarchive';
    projects
      .command(`${verb} <target>`)
      .description(`${archived ? 'Archive' : 'Unarchive'} an application destination`)
      .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
      .option('--json', 'print deterministic schema-version-1 JSON')
      .action(async (target: string, options: ProjectCommandOptions) => {
        const requested = parseProjectReference(target);
        if (!requested) {
          return emitLocalFailure(options.json, 'invalid_project', 'Use @organization/project.');
        }
        const session = await requireCommandSession(options, dependencies);
        if (!session) return;
        const result = await accountRequest(
          session,
          `/v1/organizations/${encodeURIComponent(requested.organizationSlug)}/projects/${encodeURIComponent(requested.projectSlug)}`,
          {
            body: JSON.stringify({archived}),
            headers: {'Content-Type': 'application/json'},
            method: 'PATCH',
          },
        );
        if (!result.ok) return emitRemoteFailure(options.json, result);
        const document = {
          schemaVersion: 1,
          command: `projects ${verb}`,
          ...asRecord(result.body),
        };
        if (options.json) return emitJson(document);
        console.log(`${pc.green('✓')} Application ${archived ? 'archived' : 'unarchived'}.`);
      });
  }
}

export async function fetchAccountProjects(
  session: CliAccountSessionV2,
  includeArchived: boolean,
): Promise<{items: AccountProjectTarget[]; ok: true} | {error: string; ok: false; status: number}> {
  const items: AccountProjectTarget[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({
      includeArchived: includeArchived ? 'true' : 'false',
      limit: '100',
    });
    if (cursor) query.set('cursor', cursor);
    const result = await accountRequest(session, `/v1/cli/projects?${query}`, {method: 'GET'});
    if (!result.ok) return result;
    const body = asRecord(result.body);
    if (!Array.isArray(body.items) || !body.items.every(isAccountProjectTarget)) {
      return {error: 'Destination discovery returned an invalid response.', ok: false, status: 502};
    }
    items.push(...body.items);
    cursor = typeof body.nextCursor === 'string' ? body.nextCursor : null;
    if (!cursor) return validateTargetOrder(items);
  }

  return {error: 'Destination discovery exceeded its safe page limit.', ok: false, status: 502};
}

export async function resolveAccountProjectTarget(
  session: CliAccountSessionV2,
  requestedProject?: string,
): Promise<
  | {kind: 'selected'; target: AccountProjectTarget}
  | {kind: 'ambiguous'; targets: AccountProjectTarget[]}
  | {kind: 'invalid' | 'missing'; targets: AccountProjectTarget[]}
  | {error: string; kind: 'remote'; status: number}
> {
  const result = await fetchAccountProjects(session, false);
  if (!result.ok) return {error: result.error, kind: 'remote', status: result.status};
  if (requestedProject) {
    const parsed = parseProjectReference(requestedProject);
    if (!parsed) return {kind: 'invalid', targets: result.items};
    const target = result.items.find((candidate) => candidate.reference === requestedProject);
    return target ? {kind: 'selected', target} : {kind: 'missing', targets: result.items};
  }
  if (result.items.length === 1) return {kind: 'selected', target: result.items[0]};
  return result.items.length
    ? {kind: 'ambiguous', targets: result.items}
    : {kind: 'missing', targets: []};
}

async function requireCommandSession(
  options: ProjectCommandOptions,
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfigV2>},
) {
  let config: AuthConfigV2;
  try {
    config = await dependencies.loadAuthConfig();
  } catch (error) {
    emitLocalFailure(options.json, 'auth_state_unavailable', safeMessage(error));
    return null;
  }
  const resolved = resolveAccountSession(config, options.apiUrl ?? dependencies.defaultApiUrl);
  if (resolved.kind !== 'selected') {
    emitLocalFailure(
      options.json,
      `account_session_${resolved.kind}`,
      resolved.kind === 'expired'
        ? 'The Tileflow account session has expired. Run tileflow login.'
        : 'Not logged in. Run tileflow login.',
    );
    return null;
  }
  return resolved.session;
}

async function accountRequest(session: CliAccountSessionV2, path: string, init: RequestInit) {
  let response;
  try {
    response = await requestHostedJson(session.apiOrigin, path, {
      ...init,
      headers: {...init.headers, Authorization: `Bearer ${session.accountSession}`},
    });
  } catch (error) {
    return {
      body: null,
      error:
        error instanceof Error && /safe size limit|timed out/u.test(error.message)
          ? error.message
          : 'Hosted request failed.',
      ok: false as const,
      status: 502,
    };
  }
  if (response.ok && !response.json) {
    return {
      body: null,
      error: 'Hosted response returned invalid JSON.',
      ok: false as const,
      status: 502,
    };
  }
  return response.ok
    ? {body: response.body, ok: true as const, status: response.status}
    : {
        body: response.body,
        error: `Request failed (${response.status}).`,
        ok: false as const,
        status: response.status,
      };
}

function validateTargetOrder(items: AccountProjectTarget[]) {
  const references = items.map((item) => item.reference);
  if (
    new Set(references).size !== references.length ||
    references.some((reference, index) => index > 0 && references[index - 1] >= reference)
  ) {
    return {
      error: 'Destination discovery returned unstable ordering.',
      ok: false as const,
      status: 502,
    };
  }
  return {items, ok: true as const};
}

function uniqueOrganizations(items: AccountProjectTarget[]) {
  return [...new Map(items.map((item) => [item.organization.id, item.organization])).values()];
}

function parseOrganizationReference(value: string | undefined) {
  if (!value) return null;
  const match = /^@([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(value);
  return match?.[1] ?? null;
}

function emitAmbiguousOrganizations(
  json: boolean | undefined,
  organizations: Identity[],
  slug: string,
  name: string,
) {
  const references = organizations.map((organization) => `@${organization.slug}`);
  const retry = `tileflow projects create ${slug} --name ${JSON.stringify(name.trim())} --organization ${references[0]}`;
  return emitLocalFailure(
    json,
    'organization_ambiguous',
    `More than one organization is available: ${references.join(', ')}. Retry with: ${retry}`,
    {options: references, retry},
  );
}

function emitRemoteFailure(json: boolean | undefined, result: {error: string; status: number}) {
  return emitLocalFailure(json, `http_${result.status}`, result.error);
}

function emitLocalFailure(
  json: boolean | undefined,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  if (json) {
    console.error(message);
    emitJson({schemaVersion: 1, ok: false, error: {code, ...details}});
  } else {
    console.error(`${pc.red('✕')} ${message}`);
  }
  process.exitCode = 1;
}

function emitJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAccountProjectTarget(value: unknown): value is AccountProjectTarget {
  const target = asRecord(value);
  return (
    isIdentity(target.organization) &&
    isProjectItem(target.project) &&
    typeof target.reference === 'string' &&
    target.reference === `@${target.organization.slug}/${target.project.slug}`
  );
}

function isIdentity(value: unknown): value is Identity {
  const identity = asRecord(value);
  return (
    typeof identity.id === 'string' &&
    typeof identity.name === 'string' &&
    typeof identity.slug === 'string'
  );
}

function isProjectItem(value: unknown): value is ProjectItem {
  const item = asRecord(value);
  return (
    isIdentity(value) &&
    (item.archivedAt === null || typeof item.archivedAt === 'string') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}

function validSlug(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function validName(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 && !/[\p{Cc}]/u.test(normalized);
}

function safeMessage(error: unknown) {
  return error instanceof Error && error.message.length <= 300
    ? error.message
    : 'Tileflow auth state is unavailable.';
}
