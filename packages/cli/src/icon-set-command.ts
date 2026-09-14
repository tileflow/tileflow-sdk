import type {Command} from 'commander';
import pc from 'picocolors';
import {isAbsolute} from 'node:path';
import {tileflowIconSetPinSchema, tileflowIconSetReferenceSchema} from '@tileflow/core';
import {type CompiledTileflowIconPackage, composeTileflowIconSources} from '@tileflow/dev/icons';
import {z} from 'zod';
import type {AuthConfigV2} from './account-session';
import {
  authorizedTeamRequest,
  emitFailure,
  emitJson,
  type HostedTeamAuthority,
  type HostedTeamDependencies,
  type HostedTeamOptions,
  resolveTeamAuthority,
  safeMessage,
} from './hosted-team';

const maximumCatalogPages = 100;
const pageSize = 100;

/**
 * Register the Team Icon Set catalog family.
 *
 * `icon-set` manages remote Team authority. Repository-local inspection and explicit lock
 * maintenance stay in the keyless `icons` family, so a networked catalog mutation never looks
 * like a local read.
 */
export function registerIconSetCommands(
  program: Command,
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfigV2>},
): void {
  const iconSet = program
    .command('icon-set')
    .description('Publish and manage versioned Team Icon Sets');

  withTeamOptions(
    iconSet
      .command('publish')
      .description('Compile one local directory and publish it as an immutable Team revision')
      .argument('<directory>', 'repository-local icon directory')
      .requiredOption('--id <id>', 'Team-local Icon Set slug')
      .requiredOption('--idempotency-key <key>', 'durable retry key for this exact publication')
      .option('--name <name>', 'display name')
      .option('--description <text>', 'display description'),
  ).action(
    async (
      directory: string,
      options: HostedTeamOptions & {
        description?: string;
        id: string;
        idempotencyKey: string;
        name?: string;
      },
    ) => {
      try {
        if (!isIconSetSlug(options.id)) {
          return emitFailure(options.json, 'invalid_icon_set_id', 'Icon Set ID is invalid.');
        }
        if (!isIdempotencyKey(options.idempotencyKey)) {
          return emitFailure(
            options.json,
            'invalid_idempotency_key',
            'Idempotency key must be 8 to 128 characters from A-Z a-z 0-9 . _ : -',
          );
        }
        const source = normalizeLocalDirectory(directory);
        if (!source) {
          return emitFailure(
            options.json,
            'invalid_icon_directory',
            'Publish one repository-relative icon directory.',
          );
        }
        let iconPackage: CompiledTileflowIconPackage;
        try {
          const composed = await composeTileflowIconSources([source], {
            cwd: process.cwd(),
            target: 'hosted',
          });
          if (!composed.package) throw new Error('The selected directory has no icons.');
          iconPackage = composed.package;
        } catch (error) {
          return emitFailure(options.json, 'icon_compilation_failed', safeMessage(error));
        }
        const authority = await resolveTeamAuthority(options, ['icons:write'], dependencies);
        if (!authority) return;

        const body = new FormData();
        for (const file of iconPackage.files) {
          const bytes = new Uint8Array(file.source.byteLength);
          bytes.set(file.source);
          body.append(
            file.fileName,
            new Blob([bytes.buffer], {type: file.contentType}),
            file.fileName,
          );
        }
        const response = await authorizedTeamRequest(
          authority,
          `/v1/icon-sets/${encodeURIComponent(options.id)}/versions/${encodeURIComponent(iconPackage.contentHash)}`,
          'PUT',
          {body, headers: {'Idempotency-Key': options.idempotencyKey}},
        );
        if (!response.ok) return emitHttpFailure(options.json, response.status, 'publish');
        const parsed = publishResponseSchema.parse(response.body);
        if (parsed.revision.pin && parsed.revision.pin.contentHash !== iconPackage.contentHash) {
          return emitFailure(
            options.json,
            'icon_set_publish_unconfirmed',
            'Publication response did not confirm the submitted generated artifact.',
          );
        }
        const totalBytes = iconPackage.manifest.files.reduce(
          (total, file) => total + file.byteLength,
          0,
        );
        const document = {
          command: 'icon-set publish',
          iconSet: {
            contentHash: iconPackage.contentHash,
            iconCount: iconPackage.manifest.iconNames.length,
            logicalId: options.id,
            packageId: parsed.revision.pin?.packageId ?? null,
            reference: parsed.revision.reference,
            totalBytes,
            version: parsed.revision.version,
            versionId: parsed.revision.id,
          },
          publication: parsed.changed ? 'changed' : 'unchanged',
          schemaVersion: 1,
          team: describeTeam(authority),
        };
        if (options.json) return emitJson(document);
        console.log(
          `${pc.green('✓')} ${parsed.changed ? 'Published' : 'Unchanged'} ${pc.bold(parsed.revision.reference)} revision ${parsed.revision.version}.`,
        );
      } catch (error) {
        emitFailure(options.json, 'icon_set_publish_failed', boundedMessage(error, 'publish'));
      }
    },
  );

  withTeamOptions(
    iconSet
      .command('list')
      .description('List Icon Sets owned by one Team')
      .option('--archived', 'list archived Icon Sets instead of active ones'),
  ).action(async (options: HostedTeamOptions & {archived?: boolean}) => {
    try {
      const authority = await resolveTeamAuthority(options, ['icons:read'], dependencies);
      if (!authority) return;
      const sets = await readAllPages(
        authority,
        '/v1/icon-sets',
        options.archived ? {archived: 'true'} : {},
        catalogListResponseSchema,
        (page) => page.sets,
        (set) => set.id,
      );
      const document = {
        command: 'icon-set list',
        schemaVersion: 1,
        sets,
        team: describeTeam(authority),
      };
      if (options.json) return emitJson(document);
      if (sets.length === 0) return console.log(pc.gray('No Team Icon Sets.'));
      for (const set of sets) {
        console.log(
          `  ${pc.bold(set.reference)} ${pc.gray(set.archivedAt ? 'archived' : `v${String(set.latestVersion ?? 0)}`)}`,
        );
      }
    } catch (error) {
      emitFailure(options.json, 'icon_set_list_failed', boundedMessage(error, 'list'));
    }
  });

  withTeamOptions(
    iconSet
      .command('status')
      .description('Show one Team Icon Set')
      .argument('<slug>', 'Team-local Icon Set slug'),
  ).action(async (slug: string, options: HostedTeamOptions) => {
    await readCommand(slug, options, 'icon-set status', async (authority) => {
      const response = await authorizedTeamRequest(
        authority,
        `/v1/icon-sets/${encodeURIComponent(slug)}`,
        'GET',
      );
      if (!response.ok) return {status: response.status};
      const parsed = catalogDetailResponseSchema.parse(response.body);
      return {value: {set: parsed.set}};
    });
  });

  withTeamOptions(
    iconSet
      .command('versions')
      .description('List the retained revisions of one Team Icon Set')
      .argument('<slug>', 'Team-local Icon Set slug'),
  ).action(async (slug: string, options: HostedTeamOptions) => {
    await readCommand(slug, options, 'icon-set versions', async (authority) => {
      const versions = await readAllPages(
        authority,
        `/v1/icon-sets/${encodeURIComponent(slug)}/versions`,
        {},
        versionsResponseSchema,
        (page) => page.versions,
        (revision) => revision.id,
      );
      return {value: {versions: versions.map(describeRevision)}};
    });
  });

  withTeamOptions(
    iconSet
      .command('uses')
      .description('List the known hosted deployments that retain one Team Icon Set')
      .argument('<slug>', 'Team-local Icon Set slug'),
  ).action(async (slug: string, options: HostedTeamOptions) => {
    await readCommand(slug, options, 'icon-set uses', async (authority) => {
      const uses = await readAllPages(
        authority,
        `/v1/icon-sets/${encodeURIComponent(slug)}/uses`,
        {},
        usesResponseSchema,
        (page) => page.uses,
        (use) => `${use.deploymentId}\0${use.versionId}\0${String(use.ordinal)}`,
      );
      return {
        value: {
          // Repository locks that were never deployed are unknowable to the catalog.
          coverage: 'known-hosted-deployments',
          includesUndeployedRepositoryLocks: false,
          uses,
        },
      };
    });
  });

  for (const [name, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    withTeamOptions(
      iconSet
        .command(name)
        .description(
          archived
            ? 'Archive one Team Icon Set without removing its retained revisions'
            : 'Return one archived Team Icon Set to the active catalog',
        )
        .argument('<slug>', 'Team-local Icon Set slug'),
    ).action(async (slug: string, options: HostedTeamOptions) => {
      try {
        if (!isIconSetSlug(slug)) {
          return emitFailure(options.json, 'invalid_icon_set_id', 'Icon Set ID is invalid.');
        }
        const authority = await resolveTeamAuthority(options, ['icons:write'], dependencies);
        if (!authority) return;
        const response = await authorizedTeamRequest(
          authority,
          `/v1/icon-sets/${encodeURIComponent(slug)}`,
          'PATCH',
          {
            body: JSON.stringify({archived}),
            headers: {'Content-Type': 'application/json'},
          },
        );
        if (!response.ok) return emitHttpFailure(options.json, response.status, name);
        const parsed = catalogDetailResponseSchema.parse(response.body);
        const document = {
          command: `icon-set ${name}`,
          schemaVersion: 1,
          set: parsed.set,
          team: describeTeam(authority),
        };
        if (options.json) return emitJson(document);
        console.log(
          `${pc.green('✓')} ${archived ? 'Archived' : 'Restored'} ${pc.bold(parsed.set.reference)}.`,
        );
      } catch (error) {
        emitFailure(options.json, `icon_set_${name}_failed`, boundedMessage(error, name));
      }
    });
  }

  withTeamOptions(
    iconSet
      .command('purge')
      .description('Permanently purge one exact Team Icon Set revision')
      .argument('<slug>', 'Team-local Icon Set slug')
      .requiredOption('--version <version>', 'exact positive revision to purge')
      .requiredOption('--idempotency-key <key>', 'durable retry key for this exact purge')
      .requiredOption('--confirm <reference>', 'repeat the exact @team/set@version being purged')
      .option(
        '--acknowledge-unknown-locks',
        'acknowledge that undeployed repository locks are not discoverable',
      ),
  ).action(
    async (
      slug: string,
      options: HostedTeamOptions & {
        acknowledgeUnknownLocks?: boolean;
        confirm: string;
        idempotencyKey: string;
        version: string;
      },
    ) => {
      try {
        if (!isIconSetSlug(slug)) {
          return emitFailure(options.json, 'invalid_icon_set_id', 'Icon Set ID is invalid.');
        }
        if (!/^[1-9][0-9]*$/u.test(options.version) || !Number.isSafeInteger(+options.version)) {
          return emitFailure(
            options.json,
            'invalid_icon_set_version',
            'Purge requires one exact positive revision.',
          );
        }
        if (!isIdempotencyKey(options.idempotencyKey)) {
          return emitFailure(
            options.json,
            'invalid_idempotency_key',
            'Idempotency key must be 8 to 128 characters from A-Z a-z 0-9 . _ : -',
          );
        }
        const confirmation = parsePurgeConfirmation(options.confirm);
        if (
          !confirmation ||
          confirmation.slug !== slug ||
          confirmation.version !== Number(options.version)
        ) {
          return emitFailure(
            options.json,
            'purge_confirmation_mismatch',
            'Purge confirmation must repeat the exact @team/set@version being purged.',
          );
        }
        if (options.acknowledgeUnknownLocks !== true) {
          return emitFailure(
            options.json,
            'purge_unknown_locks_unacknowledged',
            'Purge requires --acknowledge-unknown-locks; undeployed repository locks are not discoverable.',
          );
        }
        const authority = await resolveTeamAuthority(options, ['icons:write'], dependencies);
        if (!authority) return;
        if (authority.team && `@${authority.team.slug}` !== confirmation.team) {
          return emitFailure(
            options.json,
            'purge_confirmation_mismatch',
            'Purge confirmation must name the selected Team.',
          );
        }
        const response = await authorizedTeamRequest(
          authority,
          `/v1/icon-sets/${encodeURIComponent(slug)}/versions/${encodeURIComponent(options.version)}/purge`,
          'POST',
          {
            body: JSON.stringify({
              acknowledgeUnknownLocks: true,
              confirmation: options.confirm,
            }),
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': options.idempotencyKey,
            },
          },
        );
        if (!response.ok) return emitHttpFailure(options.json, response.status, 'purge');
        const parsed = purgeResponseSchema.parse(response.body);
        const document = {
          command: 'icon-set purge',
          result: parsed.result,
          schemaVersion: 1,
          team: describeTeam(authority),
        };
        if (options.json) return emitJson(document);
        console.log(`${pc.green('✓')} Purged ${pc.bold(options.confirm)}.`);
        console.log(pc.yellow(`! ${parsed.result.warning}`));
      } catch (error) {
        emitFailure(options.json, 'icon_set_purge_failed', boundedMessage(error, 'purge'));
      }
    },
  );

  async function readCommand(
    slug: string,
    options: HostedTeamOptions,
    command: string,
    run: (
      authority: HostedTeamAuthority,
    ) => Promise<{status: number} | {value: Record<string, unknown>}>,
  ) {
    try {
      if (!isIconSetSlug(slug)) {
        return emitFailure(options.json, 'invalid_icon_set_id', 'Icon Set ID is invalid.');
      }
      const authority = await resolveTeamAuthority(options, ['icons:read'], dependencies);
      if (!authority) return;
      const result = await run(authority);
      if ('status' in result) return emitHttpFailure(options.json, result.status, command);
      const document = {
        command,
        schemaVersion: 1,
        team: describeTeam(authority),
        ...result.value,
      };
      if (options.json) return emitJson(document);
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      emitFailure(
        options.json,
        `${command.replaceAll(/[^a-z]+/gu, '_')}_failed`,
        boundedMessage(error, command),
      );
    }
  }
}

function withTeamOptions(command: Command): Command {
  return command
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-1 JSON');
}

/** Read every bounded page without trusting a repeated cursor, duplicate row, or page count. */
async function readAllPages<Page, Item>(
  authority: HostedTeamAuthority,
  path: string,
  query: Record<string, string>,
  schema: z.ZodType<Page>,
  select: (page: Page) => readonly Item[],
  identify: (item: Item) => string,
): Promise<Item[]> {
  const items: Item[] = [];
  const seenCursors = new Set<string>();
  const seenIds = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maximumCatalogPages; page += 1) {
    const parameters = new URLSearchParams({limit: String(pageSize), ...query});
    if (cursor) parameters.set('cursor', cursor);
    const response = await authorizedTeamRequest(
      authority,
      `${path}?${parameters.toString()}`,
      'GET',
    );
    if (!response.ok) throw new IconSetTransportError(response.status);
    const parsed = schema.parse(response.body);
    for (const item of select(parsed)) {
      const id = identify(item);
      if (seenIds.has(id)) throw new Error('Icon Set list returned a duplicate row.');
      seenIds.add(id);
      items.push(item);
    }
    cursor = (parsed as {nextCursor?: string | null}).nextCursor ?? null;
    if (!cursor) return items;
    if (seenCursors.has(cursor)) throw new Error('Icon Set list repeated a cursor.');
    seenCursors.add(cursor);
  }
  throw new Error('Icon Set list exceeded its safe page limit.');
}

class IconSetTransportError extends Error {
  constructor(readonly status: number) {
    super(`Icon Set request failed (${status}).`);
    this.name = 'IconSetTransportError';
  }
}

function emitHttpFailure(json: boolean | undefined, status: number, command: string) {
  emitFailure(json, `http_${status}`, `Icon Set ${command} failed (${status}).`);
}

function boundedMessage(error: unknown, command: string): string {
  if (error instanceof IconSetTransportError) return error.message;
  if (error instanceof Error && /limit|cursor|duplicate row/u.test(error.message)) {
    return error.message;
  }
  return `Icon Set ${command} failed.`;
}

function describeTeam(authority: HostedTeamAuthority) {
  return authority.team ? {id: authority.team.id, slug: authority.team.slug} : null;
}

function describeRevision(revision: z.infer<typeof revisionSchema>) {
  return {
    iconCount: revision.iconCount,
    id: revision.id,
    packageId: revision.pin?.packageId ?? null,
    publishedAt: revision.publishedAt,
    purgedAt: revision.purgedAt,
    reference: revision.reference,
    totalBytes: revision.totalBytes,
    version: revision.version,
  };
}

/** Accept a repository-relative directory only; never an absolute or package-owned descriptor. */
function normalizeLocalDirectory(value: string): `./${string}` | `../${string}` | null {
  if (!value || isAbsolute(value) || value.includes('\\') || /[\p{Cc}]/u.test(value)) return null;
  const normalized = value.startsWith('./') || value.startsWith('../') ? value : `./${value}`;
  return normalized.replace(/\/+$/u, '') as `./${string}` | `../${string}`;
}

function parsePurgeConfirmation(
  value: string,
): {slug: string; team: string; version: number} | null {
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || value.length > 160) return null;
  const reference = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (!tileflowIconSetReferenceSchema.safeParse(reference).success) return null;
  if (!/^[1-9][0-9]*$/u.test(version) || !Number.isSafeInteger(Number(version))) return null;
  return {slug: reference.split('/')[1]!, team: reference.split('/')[0]!, version: Number(version)};
}

function isIconSetSlug(value: string) {
  return value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isIdempotencyKey(value: string) {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value);
}

const cursorSchema = z.string().min(1).max(2_048).nullable();
const isoDateSchema = z.iso.datetime({offset: true});
const setSchema = z
  .object({
    id: z.string().regex(/^ics_[A-Za-z0-9_-]{16}$/u),
    reference: tileflowIconSetReferenceSchema,
    name: z.string().max(200),
    description: z.string().max(2_000),
    archivedAt: isoDateSchema.nullable(),
    latestVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
/** Bounded exactly like every other Team response; the CLI keeps only what its receipt reports. */
const revisionSchema = z
  .object({
    id: z.string().regex(/^icv_[A-Za-z0-9_-]{16}$/u),
    reference: tileflowIconSetReferenceSchema,
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    publishedAt: isoDateSchema,
    purgedAt: isoDateSchema.nullable(),
    iconCount: z.number().int().min(0).max(256),
    totalBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    publisher: z
      .object({kind: z.enum(['credential', 'membership']), id: z.string().max(200).nullable()})
      .strict(),
    pin: tileflowIconSetPinSchema.nullable(),
  })
  .strict()
  .transform(({id, reference, version, publishedAt, purgedAt, iconCount, totalBytes, pin}) => ({
    iconCount,
    id,
    pin,
    publishedAt,
    purgedAt,
    reference,
    totalBytes,
    version,
  }));

export const catalogListResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    sets: z.array(setSchema).max(pageSize),
    nextCursor: cursorSchema.optional(),
  })
  .strict();
export const catalogDetailResponseSchema = z
  .object({schemaVersion: z.literal(1), set: setSchema})
  .strict();
export const versionsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    versions: z.array(revisionSchema).max(pageSize),
    nextCursor: cursorSchema.optional(),
  })
  .strict();
export const revisionResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    archived: z.boolean(),
    revision: revisionSchema,
  })
  .strict();
export const publishResponseSchema = z
  .object({schemaVersion: z.literal(1), changed: z.boolean(), revision: revisionSchema})
  .strict();
export const usesResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    uses: z
      .array(
        z
          .object({
            deploymentId: z.string().min(1).max(160),
            deploymentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            mapId: z.string().min(1).max(160),
            mapName: z.string().max(200).nullable(),
            mapState: z.string().max(64),
            versionId: z.string().regex(/^icv_[A-Za-z0-9_-]{16}$/u),
            version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            ordinal: z.number().int().min(0).max(31),
            relationship: z.enum(['active', 'retained']),
          })
          .strict(),
      )
      .max(pageSize),
    nextCursor: cursorSchema.optional(),
    coverage: z.literal('known-hosted-deployments'),
    includesUndeployedRepositoryLocks: z.literal(false),
  })
  .strict();
export const purgeResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    result: z
      .object({
        schemaVersion: z.literal(1),
        versionId: z.string().regex(/^icv_[A-Za-z0-9_-]{16}$/u),
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        purged: z.boolean(),
        knownRetainedDeployments: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        physicalBytesReleased: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        unknownRepositoryLocks: z.boolean(),
        warning: z.string().max(400),
      })
      .strict(),
  })
  .strict();
