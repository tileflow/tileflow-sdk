import type {Command} from 'commander';
import pc from 'picocolors';
import {serializeCanonicalJson} from '@tileflow/core';
import {inspectTileflowPmtiles} from '@tileflow/dev/tilesets';
import {z} from 'zod';
import {type AuthConfigV2, normalizeApiOrigin, resolveAccountSession} from './account-session';
import {
  type HostedTeamCapabilityScope,
  listAccountTeams,
  requestHostedJson,
  requestTeamCapability,
} from './hosted-client';
import {
  createHostedTeamTilesetUploadTransport,
  inspectNodeTeamTilesetArchive,
  openNodeTeamTilesetArchive,
  prepareTeamTilesetUpload,
  publishPreparedTeamTilesetUpload,
  TeamTilesetUploadError,
  type PositionedUploadFile,
} from './tileset-upload';

type HostedTilesetOptions = {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
  team?: string;
};

export function registerTilesetCommands(
  program: Command,
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfigV2>},
): void {
  const tileset = program.command('tileset').description('Inspect and manage geospatial tilesets');

  tileset
    .command('inspect')
    .description('Inspect one local PMTiles archive deterministically')
    .argument('<archive>', 'repository-local PMTiles archive')
    .option('--json', 'print deterministic inspection-schema-version-1 JSON')
    .option('--no-sample', 'read authoritative header and metadata without bounded MVT sampling')
    .option(
      '--include-values <fields>',
      'include bounded observed values for comma-separated field names (requires --json)',
    )
    .action(
      async (
        archive: string,
        options: {includeValues?: string; json?: boolean; sample: boolean},
      ) => {
        try {
          if (options.includeValues && !options.json) {
            throw inspectionOptionError('--include-values requires --json.');
          }
          const inspection = await inspectTileflowPmtiles(archive, {
            includeValues: parseIncludedValueFields(options.includeValues),
            sample: options.sample,
          });
          if (options.json) {
            process.stdout.write(`${serializeCanonicalJson(inspection)}\n`);
            return;
          }

          console.log(`${pc.green('✓')} PMTiles archive is valid.`);
          console.log(`  Type: ${inspection.contract.tileType}`);
          console.log(`  Zooms: ${inspection.contract.minzoom}-${inspection.contract.maxzoom}`);
          console.log(`  Source layers: ${inspection.contract.sourceLayers.length}`);
          if (inspection.observation) {
            console.log(
              `  Sample: ${inspection.observation.featuresRead} features in ${inspection.observation.tilesRead} tiles`,
            );
          }
          for (const warning of inspection.warnings) {
            console.log(`${pc.yellow('!')} ${warning.message}`);
          }
        } catch (error) {
          const record = asRecord(error);
          const code =
            typeof record.code === 'string' ? record.code : 'TF_TILESET_INSPECTION_FAILED';
          const path = typeof record.path === 'string' ? record.path : 'archive';
          const message = error instanceof Error ? error.message : 'Tileset inspection failed.';
          if (options.json) {
            process.stderr.write(
              `${serializeCanonicalJson({error: {code, message, path}, ok: false, schemaVersion: 1})}\n`,
            );
          } else {
            console.error(`${pc.red('Error:')} ${message}`);
          }
          process.exitCode = 1;
        }
      },
    );

  tileset
    .command('publish')
    .description('Register and publish one PMTiles archive to a Team')
    .argument('<archive>', 'repository-local PMTiles archive')
    .requiredOption('--id <id>', 'Team-local logical tileset ID')
    .option('--name <name>', 'display name')
    .option('--attribution <text>', 'data attribution')
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-2 JSON')
    .action(
      async (
        archive: string,
        options: HostedTilesetOptions & {
          attribution?: string;
          id: string;
          name?: string;
        },
      ) => {
        let uploadFile: PositionedUploadFile | null = null;
        try {
          if (!isTilesetId(options.id)) {
            return emitFailure(options.json, 'invalid_tileset_id', 'Tileset ID is invalid.');
          }

          const initialIdentity = await inspectNodeTeamTilesetArchive(archive);
          await inspectTileflowPmtiles(archive, {sample: false});
          uploadFile = await openNodeTeamTilesetArchive(archive, initialIdentity);
          const prepared = await prepareTeamTilesetUpload(uploadFile);
          const authority = await resolveTeamAuthority(options, ['tilesets:write'], dependencies);
          if (!authority) return;

          const registration = await requestHostedJson(authority.apiOrigin, '/v1/tilesets', {
            body: JSON.stringify({
              ...(options.attribution ? {attribution: options.attribution} : {}),
              format: 'pmtiles',
              name: options.name?.trim() || options.id,
              slug: options.id,
            }),
            headers: {
              Authorization: `Bearer ${authority.credential}`,
              'Content-Type': 'application/json',
            },
            method: 'POST',
          });
          const registered = asRecord(registration.body);
          const resourceId = String(registered.tilesetId ?? '');
          if (!registration.ok || !/^tls_[A-Za-z0-9_-]{16,76}$/u.test(resourceId)) {
            return emitFailure(
              options.json,
              `http_${registration.status}`,
              `Tileset registration failed (${registration.status}).`,
            );
          }

          let reportedParts = 0;
          let reportedValidation = false;
          const publication = await publishPreparedTeamTilesetUpload({
            file: uploadFile,
            onProgress: options.json
              ? undefined
              : ({completedParts, phase, totalParts}) => {
                  if (phase === 'validating') {
                    if (!reportedValidation) {
                      process.stderr.write('Validating uploaded bytes.\n');
                      reportedValidation = true;
                    }
                    return;
                  }
                  if (completedParts === totalParts || completedParts - reportedParts >= 16) {
                    process.stderr.write(`Uploaded ${completedParts}/${totalParts} parts.\n`);
                    reportedParts = completedParts;
                  }
                },
            tilesetId: resourceId,
            transport: createHostedTeamTilesetUploadTransport({
              apiOrigin: authority.apiOrigin,
              credential: authority.credential,
              tilesetId: resourceId,
            }),
            upload: prepared,
          });
          const document = {
            command: 'tileset publish',
            publication: publication.changed ? 'changed' : 'unchanged',
            schemaVersion: 2,
            team: authority.team ? {id: authority.team.id, slug: authority.team.slug} : null,
            tileset: {
              byteCount: publication.byteCount,
              contentHash: publication.contentHash,
              contentHashAlgorithm: publication.contentHashAlgorithm,
              logicalId: options.id,
              state: publication.state,
              tilesetId: resourceId,
              version: {id: publication.versionId, number: publication.version},
            },
          };
          if (options.json) return emitJson(document);
          console.log(
            `${pc.green('✓')} ${publication.changed ? 'Published' : 'Unchanged'} ${pc.bold(options.id)} in ${authority.team ? `@${authority.team.slug}` : 'the Team bound to the data key'}.`,
          );
        } catch (error) {
          if (error instanceof TeamTilesetUploadError) {
            emitFailure(options.json, error.code, error.message, error.details);
          } else {
            emitFailure(options.json, 'tileset_publish_failed', 'Tileset publication failed.');
          }
        } finally {
          await uploadFile?.close().catch(() => undefined);
        }
      },
    );

  tileset
    .command('list')
    .description('List tilesets owned by one Team')
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (options: HostedTilesetOptions) => {
      try {
        const authority = await resolveTeamAuthority(options, ['tilesets:read'], dependencies);
        if (!authority) return;
        const items = await fetchAllTeamTilesets(authority);
        const document = {command: 'tileset list', schemaVersion: 1, tilesets: items};
        if (options.json) return emitJson(document);
        if (items.length === 0) return console.log(pc.gray('No Team tilesets.'));
        for (const item of items) {
          console.log(`  ${pc.bold(item.logicalName)} ${pc.gray(item.status)}`);
        }
      } catch {
        emitFailure(options.json, 'tileset_list_failed', 'Tileset list failed.');
      }
    });

  tileset
    .command('status')
    .description('Show one Team tileset')
    .argument('<id>', 'Team-local logical ID or opaque resource ID')
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (id: string, options: HostedTilesetOptions) => {
      try {
        if (!isTilesetId(id))
          return emitFailure(options.json, 'invalid_tileset_id', 'Tileset ID is invalid.');
        const authority = await resolveTeamAuthority(options, ['tilesets:read'], dependencies);
        if (!authority) return;
        const response = await authorizedTeamRequest(
          authority,
          `/v1/tilesets/${encodeURIComponent(id)}`,
          'GET',
        );
        if (!response.ok) {
          return emitFailure(
            options.json,
            `http_${response.status}`,
            `Tileset status failed (${response.status}).`,
          );
        }
        const parsed = tilesetDetailResponseSchema.parse(response.body);
        const document = {command: 'tileset status', schemaVersion: 1, tileset: parsed.tileset};
        if (options.json) return emitJson(document);
        const item = parsed.tileset;
        console.log(`${pc.bold(item.name)} ${pc.gray(item.state)}`);
        console.log(`  ID: ${item.id}`);
        console.log(`  Current version: ${String(item.currentVersion ?? 'unpublished')}`);
      } catch {
        emitFailure(options.json, 'tileset_status_failed', 'Tileset status failed.');
      }
    });

  tileset
    .command('purge')
    .description('Permanently purge one unreferenced Team tileset')
    .argument('<id>', 'Team-local logical ID or opaque resource ID')
    .requiredOption('--confirm <id>', 'repeat the exact tileset ID')
    .option('--team <team>', 'target Team as @team')
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Team data API key', process.env.TILEFLOW_API_KEY)
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (id: string, options: HostedTilesetOptions & {confirm: string}) => {
      try {
        if (!isTilesetId(id) || options.confirm !== id) {
          return emitFailure(
            options.json,
            'purge_confirmation_mismatch',
            'Purge confirmation must match the tileset ID.',
          );
        }
        const authority = await resolveTeamAuthority(options, ['tilesets:write'], dependencies);
        if (!authority) return;
        const response = await requestHostedJson(
          authority.apiOrigin,
          `/v1/tilesets/${encodeURIComponent(id)}`,
          {
            headers: {
              Authorization: `Bearer ${authority.credential}`,
              'X-Tileflow-Confirm-Tileset-Purge': id,
            },
            method: 'DELETE',
          },
        );
        if (!response.ok) {
          const inUse = tilesetInUseResponseSchema.safeParse(response.body);
          if (inUse.success) {
            return emitFailure(
              options.json,
              inUse.data.code,
              'Tileset is used by retained Map deployments.',
              {
                dependencies: inUse.data.dependencies,
                nextCursor: inUse.data.nextCursor,
              },
            );
          }
          return emitFailure(
            options.json,
            `http_${response.status}`,
            `Tileset purge failed (${response.status}).`,
          );
        }
        const parsed = tilesetPurgeResponseSchema.parse(response.body);
        const document = {command: 'tileset purge', schemaVersion: 1, ...parsed};
        if (options.json) return emitJson(document);
        console.log(`${pc.green('✓')} Purge ${parsed.reclamation}.`);
      } catch {
        emitFailure(options.json, 'tileset_purge_failed', 'Tileset purge failed.');
      }
    });
}

async function resolveTeamAuthority(
  options: HostedTilesetOptions,
  scopes: HostedTeamCapabilityScope[],
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfigV2>},
) {
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

function authorizedTeamRequest(
  authority: Awaited<ReturnType<typeof resolveTeamAuthority>> & {},
  path: string,
  method: string,
) {
  return requestHostedJson(authority.apiOrigin, path, {
    headers: {Authorization: `Bearer ${authority.credential}`},
    method,
  });
}

async function fetchAllTeamTilesets(
  authority: Awaited<ReturnType<typeof resolveTeamAuthority>> & {},
) {
  const items: Array<z.infer<typeof tilesetInventoryItemSchema>> = [];
  const seenCursors = new Set<string>();
  const seenIds = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({limit: '100'});
    if (cursor) query.set('cursor', cursor);
    const response = await authorizedTeamRequest(
      authority,
      `/v1/tilesets?${query.toString()}`,
      'GET',
    );
    if (!response.ok) {
      throw new TeamTilesetUploadError(
        `http_${response.status}`,
        `Tileset list failed (${response.status}).`,
      );
    }
    const parsed = tilesetListResponseSchema.parse(response.body);
    for (const item of parsed.tilesets) {
      if (seenIds.has(item.id)) throw new Error('Tileset list returned a duplicate resource.');
      const previous = items.at(-1);
      if (
        previous &&
        (previous.logicalName > item.logicalName ||
          (previous.logicalName === item.logicalName && previous.id >= item.id))
      ) {
        throw new Error('Tileset list returned unstable ordering.');
      }
      seenIds.add(item.id);
      items.push(item);
    }
    cursor = parsed.nextCursor ?? null;
    if (!cursor) return Object.freeze(items);
    if (seenCursors.has(cursor)) throw new Error('Tileset list repeated a cursor.');
    seenCursors.add(cursor);
  }

  throw new Error('Tileset list exceeded its safe page limit.');
}

function emitJson(value: unknown) {
  process.stdout.write(`${serializeCanonicalJson(value)}\n`);
}

function emitFailure(
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

function isTilesetId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) && !['terrain', 'world'].includes(value);
}

function parseIncludedValueFields(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const fields = value.split(',').map((field) => field.trim());
  if (fields.some((field) => !field)) {
    throw inspectionOptionError('--include-values requires comma-separated field names.');
  }
  return fields;
}

function inspectionOptionError(message: string) {
  return Object.assign(new Error(message), {
    code: 'TF_TILESET_INSPECTION_OPTIONS_INVALID',
    path: 'includeValues',
  });
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Tileset command failed.';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const physicalTilesetIdSchema = z
  .string()
  .min(20)
  .max(80)
  .regex(/^tls_[A-Za-z0-9_-]+$/u);
const cursorSchema = z.string().min(1).max(2_048).nullable();
const tilesetInventoryItemSchema = z
  .object({
    currentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    hasCurrent: z.boolean(),
    id: physicalTilesetIdSchema,
    logicalName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    name: z.string().min(1).max(200),
    retainedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    retainedDeploymentCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['active', 'purging', 'retired']),
    updatedAt: z.iso.datetime({offset: true}),
    usedByMapCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const tilesetListResponseSchema = z
  .object({
    nextCursor: cursorSchema.optional(),
    schemaVersion: z.literal(1),
    tilesets: z.array(tilesetInventoryItemSchema).max(100),
  })
  .strict();
const tilesetDependencySchema = z
  .object({
    active: z.boolean(),
    deploymentId: safeIdentifierSchema,
    deploymentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    environment: z.string().min(1).max(64),
    mapId: safeIdentifierSchema,
    sourceId: safeIdentifierSchema,
  })
  .strict();
const tilesetDetailResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    tileset: z
      .object({
        attribution: z.string().max(4_096).nullable(),
        currentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
        dependencies: z.array(tilesetDependencySchema).max(25),
        dependencyNextCursor: cursorSchema,
        id: physicalTilesetIdSchema,
        name: z.string().min(1).max(200),
        slug: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        state: z.enum(['active', 'purging', 'purged']),
      })
      .strict(),
  })
  .strict();
const purgeDependencySchema = z
  .object({
    deploymentId: safeIdentifierSchema,
    mapId: safeIdentifierSchema,
    sourceId: safeIdentifierSchema,
  })
  .strict();
const tilesetInUseResponseSchema = z
  .object({
    code: z.literal('TF_TILESET_IN_USE'),
    dependencies: z.array(purgeDependencySchema).max(32),
    error: z.literal('Tileset is used by retained Map deployments'),
    nextCursor: cursorSchema,
  })
  .strict();
const tilesetPurgeResponseSchema = z
  .object({
    deliveryFence: z.enum(['complete', 'pending']),
    pendingVersions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    reclamation: z.enum(['complete', 'pending']),
    state: z.enum(['purged', 'purging']),
    tilesetId: physicalTilesetIdSchema,
  })
  .strict();
