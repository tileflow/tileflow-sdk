import type {Command} from 'commander';
import pc from 'picocolors';
import {z} from 'zod';
import {serializeCanonicalJson} from '@tileflow/core';
import {inspectTileflowPmtiles} from '@tileflow/dev/tilesets';
import type {AuthConfig} from './account-session';
import {hostedApiKeyOption, hostedApiUrlOption} from './hosted-options';
import {
  authorizedTeamRequest,
  emitFailure,
  emitJson,
  type HostedTeamAuthority,
  type HostedTeamOptions,
  resolveTeamAuthority,
} from './hosted-team';
import {
  apiOriginOption,
  type BlockingUpload,
  emitGuidedFailure,
  emitRestoreFailure,
  printNextSteps,
  tilesetRestoreSteps,
} from './restore-guidance';
import {registerTilesetBuildCommand} from './tileset-build-command';
import {
  createHostedTeamTilesetUploadTransport,
  inspectNodeTeamTilesetArchive,
  openNodeTeamTilesetArchive,
  parseUploadSession,
  type PositionedUploadFile,
  prepareTeamTilesetUpload,
  publishPreparedTeamTilesetUpload,
  TeamTilesetUploadError,
} from './tileset-upload';

type HostedTilesetOptions = HostedTeamOptions;

export function registerTilesetInspectCommand(parent: Command, name = 'inspect'): void {
  parent
    .command(name)
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
}

export function registerTilesetCommands(
  program: Command,
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfig>},
): void {
  const tileset = program.command('tileset').description('Inspect and manage geospatial tilesets');

  registerTilesetBuildCommand(tileset);
  registerTilesetInspectCommand(tileset);

  tileset
    .command('publish')
    .description('Register and publish one PMTiles archive to a Team')
    .argument('<archive>', 'repository-local PMTiles archive')
    .requiredOption('--id <id>', 'Team-local logical tileset ID')
    .option('--name <name>', 'display name')
    .option('--attribution <text>', 'data attribution')
    .option('--team <team>', 'target Team as @team')
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
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

          const registration = await authorizedTeamRequest(authority, '/v1/tilesets', 'POST', {
            body: JSON.stringify({
              ...(options.attribution ? {attribution: options.attribution} : {}),
              format: 'pmtiles',
              name: options.name?.trim() || options.id,
              slug: options.id,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
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
              getCredential: authority.getCredential,
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
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
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
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
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
    .command('restore')
    .description("Make a tileset's previous version current again, for every Map that uses it")
    .argument('<id>', 'Team-local logical ID or opaque resource ID')
    .option('--expected-current-version <n>', 'restore against this original current version')
    .option('--team <team>', 'target Team as @team')
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(
      async (id: string, options: HostedTilesetOptions & {expectedCurrentVersion?: string}) => {
        let commands: ReturnType<typeof tilesetCommands> | undefined;
        let attemptedVersion: number | undefined;
        const pinned = options.expectedCurrentVersion !== undefined;
        const refuse = (
          code: string,
          message: string,
          upload?: BlockingUpload,
          uncertain = false,
        ) =>
          emitGuidedFailure(
            options.json,
            code,
            message,
            commands
              ? tilesetRestoreSteps({
                  ...commands,
                  code,
                  upload,
                  attemptedVersion,
                  pinned,
                  uncertain,
                })
              : [],
            upload ? {upload} : {},
          );
        try {
          if (!isTilesetId(id))
            return emitRestoreFailure(options.json, 'invalid_tileset_id', 'Tileset ID is invalid.');
          const requestedVersion = Number(options.expectedCurrentVersion);
          if (
            options.expectedCurrentVersion !== undefined &&
            (!/^\d+$/u.test(options.expectedCurrentVersion) ||
              !Number.isSafeInteger(requestedVersion) ||
              requestedVersion < 1)
          ) {
            return emitGuidedFailure(
              options.json,
              'invalid_expected_current_version',
              'Expected current version must be a positive integer.',
              [],
            );
          }
          const authority = await resolveTeamAuthority(
            options,
            ['tilesets:write'],
            dependencies,
            emitRestoreFailure,
          );
          if (!authority) return;
          commands = tilesetCommands(id, authority, dependencies.defaultApiUrl);
          const path = `/v1/tilesets/${encodeURIComponent(id)}`;
          const detail = await authorizedTeamRequest(authority, path, 'GET');
          if (!detail.ok) {
            return refuse(`http_${detail.status}`, `Tileset status failed (${detail.status}).`);
          }
          const selected = tilesetDetailResponseSchema.parse(detail.body).tileset;
          const currentVersion = selected.currentVersion;
          if (!authority.team)
            commands = tilesetCommands(selected.id, authority, dependencies.defaultApiUrl);
          const expectedCurrentVersion = pinned ? requestedVersion : currentVersion;
          if (expectedCurrentVersion === null) {
            return refuse('no_previous_version', `${id} has no previous version to restore.`);
          }
          attemptedVersion = expectedCurrentVersion;
          const response = await authorizedTeamRequest(authority, `${path}/restore`, 'POST', {
            body: JSON.stringify({expectedCurrentVersion}),
            headers: {'Content-Type': 'application/json'},
          });
          if (!response.ok) {
            const failure = tilesetRestoreFailureSchema.safeParse(response.body);
            const body = failure.success ? failure.data : {};
            return refuse(
              body.code ?? `http_${response.status}`,
              body.error
                ? `${body.error.replace(/\.$/u, '')}.`
                : `Tileset restore failed (${response.status}).`,
              body.upload,
              response.status >= 500 || !failure.success || !response.json,
            );
          }
          const restored = tilesetRestoreResponseSchema.parse(response.body).tileset;
          const nextSteps =
            restored.outcome === 'repaired'
              ? [
                  {
                    description:
                      'That finished an earlier change. Nothing was swapped this time; run restore again only if you still want to go back a version.',
                    command: commands.status,
                  },
                ]
              : [
                  {
                    description: `To undo, ${pinned ? 'run this command' : 'run the same command'} to swap versions ${restored.currentVersion} and ${restored.previousVersion} back.`,
                    command: pinned
                      ? `${commands.restore} --expected-current-version ${restored.currentVersion}`
                      : commands.restore,
                  },
                  {
                    description:
                      'Publishing a new version retires the one this restore replaced, so check the archive first.',
                  },
                ];
          if (options.json) {
            return emitJson({
              command: 'tileset restore',
              nextSteps,
              ok: true,
              schemaVersion: 1,
              tileset: restored,
            });
          }
          console.log(
            restored.outcome === 'repaired'
              ? `${pc.green('✓')} ${pc.bold(id)} is at version ${restored.currentVersion}, and readers have caught up.`
              : `${pc.green('✓')} ${pc.bold(id)} is at version ${restored.currentVersion} again; version ${restored.previousVersion} is its previous one. Maps read it within minutes, without deploying.`,
          );
          printNextSteps(nextSteps);
        } catch {
          if (attemptedVersion !== undefined)
            return refuse(
              'tileset_restore_failed',
              'The restore outcome could not be confirmed.',
              undefined,
              true,
            );
          emitRestoreFailure(options.json, 'tileset_restore_failed', 'Tileset restore failed.');
        }
      },
    );

  tileset
    .command('upload')
    .description('Manage an upload that has not been published')
    .command('abort')
    .description('Abort the upload in progress on one tileset, so a restore or publish can proceed')
    .argument('<id>', 'Team-local logical ID or opaque resource ID')
    .option('--upload-id <id>', 'abort only this upload session')
    .option('--team <team>', 'target Team as @team')
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
    .option('--json', 'print deterministic schema-version-1 JSON')
    .action(async (id: string, options: HostedTilesetOptions & {uploadId?: string}) => {
      try {
        if (!isTilesetId(id))
          return emitRestoreFailure(options.json, 'invalid_tileset_id', 'Tileset ID is invalid.');
        const authority = await resolveTeamAuthority(
          options,
          ['tilesets:write'],
          dependencies,
          emitRestoreFailure,
        );
        if (!authority) return;
        let commands = tilesetCommands(id, authority, dependencies.defaultApiUrl);
        const check = () => [{description: 'Check the tileset.', command: commands.status}];
        const detail = await authorizedTeamRequest(
          authority,
          `/v1/tilesets/${encodeURIComponent(id)}`,
          'GET',
        );
        if (!detail.ok) {
          return emitGuidedFailure(
            options.json,
            `http_${detail.status}`,
            `Tileset status failed (${detail.status}).`,
            check(),
          );
        }
        const tilesetId = tilesetDetailResponseSchema.parse(detail.body).tileset.id;
        if (!authority.team)
          commands = tilesetCommands(tilesetId, authority, dependencies.defaultApiUrl);
        const uploads = `/v1/tilesets/${encodeURIComponent(tilesetId)}/uploads`;
        const active = await authorizedTeamRequest(authority, uploads, 'GET');
        if (!active.ok) {
          return emitGuidedFailure(
            options.json,
            `http_${active.status}`,
            `Reading the upload failed (${active.status}).`,
            check(),
          );
        }
        const {upload} = activeUploadResponseSchema.parse(active.body);
        const proceed = [
          {
            description: 'Restore the previous version if that was the aim.',
            command: commands.restore,
          },
        ];
        if (!upload) {
          if (options.json) {
            return emitJson({
              aborted: false,
              command: 'tileset upload abort',
              nextSteps: proceed,
              ok: true,
              schemaVersion: 1,
              upload: null,
            });
          }
          console.log(pc.gray(`No upload is in progress on ${id}.`));
          return printNextSteps(proceed);
        }
        if (options.uploadId !== undefined && options.uploadId !== upload.id) {
          return emitGuidedFailure(
            options.json,
            'tileset_upload_changed',
            'The active upload changed. Nothing was aborted.',
            check(),
            {upload},
          );
        }
        const response = await authorizedTeamRequest(
          authority,
          `${uploads}/${encodeURIComponent(upload.id)}`,
          'DELETE',
        );
        if (!response.ok) {
          const failure = tilesetRestoreFailureSchema.safeParse(response.body);
          const body = failure.success ? failure.data : {};
          return emitGuidedFailure(
            options.json,
            body.code ?? `http_${response.status}`,
            body.error
              ? `${body.error.replace(/\.$/u, '')}.`
              : `Aborting upload ${upload.id} failed (${response.status}).`,
            [
              {
                description: `Upload ${upload.id} was ${upload.state}. A late stage finishes on its own: wait a minute, then check it.`,
                command: commands.status,
              },
            ],
            {upload},
          );
        }
        const result = parseUploadSession(response.body);
        if (result.state === 'published' || result.uploadId !== upload.id) {
          return emitGuidedFailure(
            options.json,
            'tileset_upload_abort_unconfirmed',
            'The cancellation response did not identify the requested upload.',
            check(),
          );
        }
        const aborted = result.state === 'aborted';
        const nextSteps = aborted ? proceed : check();
        const updated = {
          ...upload,
          state: result.state,
          byteCount: result.byteCount,
          expiresAt: result.expiresAt,
        };
        if (options.json) {
          return emitJson({
            aborted,
            command: 'tileset upload abort',
            nextSteps,
            ok: true,
            schemaVersion: 1,
            upload: updated,
          });
        }
        const ended = result.state === 'expired' || result.state === 'rejected';
        const message = aborted
          ? `Aborted upload ${upload.id} on ${id}.`
          : ended
            ? `Upload ${upload.id} is ${result.state}.`
            : `Cancellation of upload ${upload.id} is pending (${result.state}).`;
        console.log(message);
        printNextSteps(nextSteps);
      } catch {
        emitRestoreFailure(
          options.json,
          'tileset_upload_abort_failed',
          'Aborting the upload failed.',
        );
      }
    });

  tileset
    .command('purge')
    .description('Permanently purge one unreferenced Team tileset')
    .argument('<id>', 'Team-local logical ID or opaque resource ID')
    .requiredOption('--confirm <id>', 'repeat the exact tileset ID')
    .option('--team <team>', 'target Team as @team')
    .addOption(hostedApiUrlOption())
    .addOption(hostedApiKeyOption('Team data API key'))
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
        const response = await authorizedTeamRequest(
          authority,
          `/v1/tilesets/${encodeURIComponent(id)}`,
          'DELETE',
          {
            headers: {
              'X-Tileflow-Confirm-Tileset-Purge': id,
            },
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

/** The exact commands a next step names, carrying the same tileset and Team as this one. */
function tilesetCommands(id: string, authority: HostedTeamAuthority, defaultApiUrl: string) {
  const origin = apiOriginOption(authority.apiOrigin, defaultApiUrl);
  const target = `${id}${authority.team ? ` --team @${authority.team.slug}` : ''}${origin}`;
  return {
    abort: `tileflow tileset upload abort ${target}`,
    restore: `tileflow tileset restore ${target}`,
    status: `tileflow tileset status ${target}`,
    origin,
  };
}

async function fetchAllTeamTilesets(authority: HostedTeamAuthority) {
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
export const tilesetRestoreResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    tileset: z
      .object({
        currentVersion: z.number().int().positive(),
        id: physicalTilesetIdSchema,
        outcome: z.enum(['repaired', 'restored']),
        previousVersion: z.number().int().positive().nullable(),
        slug: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();
const blockingUploadSchema = z
  .object({
    byteCount: z.number().int().nonnegative(),
    expiresAt: z.string().min(1).max(64),
    id: safeIdentifierSchema.max(128),
    state: z.string().min(1).max(32),
  })
  .strict();
const activeUploadResponseSchema = z
  .object({schemaVersion: z.literal(1), upload: blockingUploadSchema.nullable()})
  .strict();
const tilesetRestoreFailureSchema = z.object({
  code: z.string().max(80).optional(),
  error: z.string().max(400).optional(),
  upload: blockingUploadSchema.optional(),
});
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
