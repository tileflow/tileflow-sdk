import type {Command} from 'commander';
import {lstat} from 'node:fs/promises';
import {basename, dirname, relative, resolve} from 'node:path';
import pc from 'picocolors';
import {z} from 'zod';
import {tileflowModelContentType} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {
  assertValidTileflowConfig,
  defaultTileflowConfigPath,
  loadTileflowConfigWithInputs,
} from '@tileflow/dev/config';
import {
  type PreparedTileflowBuildingModel,
  prepareTileflowMapTreeModels,
} from '@tileflow/dev/icons';
import type {AuthConfig} from './account-session';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {
  authorizedTeamRequest,
  emitFailure,
  emitJson,
  type HostedTeamAuthority,
  type HostedTeamOptions,
  resolveTeamAuthority,
  safeMessage,
} from './hosted-team';
import {prepareModelAssets} from './model-assets';

const modelName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const maximumListPages = 20;

/**
 * Register the Team 3D models family.
 *
 * A Team 3D model is a building model the Team publishes once and its maps place by name. Maps
 * follow its current version, so publishing a new version or restoring the previous one changes
 * every map that places it on its next load, without deploying the maps again.
 */
export function registerModelCommands(
  program: Command,
  dependencies: {defaultApiUrl: string; loadAuthConfig: () => Promise<AuthConfig>},
): void {
  const models = program
    .command('models')
    .description('Publish and manage the Team 3D models that maps place');

  withTeamOptions(
    models
      .command('publish')
      .description(
        "Prepare building models and publish each as its Team 3D model's current version",
      )
      .argument(
        '[paths...]',
        "model files (<name>.glb) or directories; defaults to the maps' models directories",
      )
      .option(
        '-c, --config <path>',
        'config path, read when no path is given',
        defaultTileflowConfigPath,
      ),
  ).action(async (paths: string[], options: HostedTeamOptions & {config: string}) => {
    let prepared: Map<string, PreparedTileflowBuildingModel>;
    try {
      prepared =
        paths.length > 0 ? await prepareFromPaths(paths) : await prepareFromConfig(options.config);
    } catch (error) {
      return emitFailure(options.json, 'model_preparation_failed', safeMessage(error));
    }
    if (prepared.size === 0) {
      return emitFailure(
        options.json,
        'no_building_models',
        'No building models were found. A building model is a .glb whose materials name its parts, such as surface, glass, roof or water; one whose materials name only bark, leaves, fronds or stem is a tree.',
      );
    }
    const authority = await resolveTeamAuthority(options, ['models:write'], dependencies);
    if (!authority) return;

    const results: z.infer<typeof publishResponseSchema>[] = [];
    for (const [name, model] of [...prepared].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const body = new FormData();
      body.append(
        'metadata',
        new Blob([JSON.stringify({sources: model.sources})], {type: 'application/json'}),
        'metadata.json',
      );
      const bytes = new Uint8Array(model.bytes.byteLength);
      bytes.set(model.bytes);
      body.append(
        'file',
        new Blob([bytes.buffer], {type: tileflowModelContentType}),
        `${name}.glb`,
      );
      const response = await authorizedTeamRequest(
        authority,
        `/v1/models/${encodeURIComponent(name)}/versions/${model.sha256}`,
        'PUT',
        {body},
      );
      if (!response.ok) return emitHttpFailure(options.json, response.status, response.body, name);
      const parsed = publishResponseSchema.safeParse(response.body);
      if (!parsed.success || parsed.data.model.current?.contentHash !== model.sha256) {
        return emitFailure(
          options.json,
          'model_publish_unconfirmed',
          `The publication of ${name} did not confirm the submitted model file.`,
        );
      }
      results.push(parsed.data);
      if (!options.json) {
        const current = parsed.data.model.current!;
        const action = parsed.data.changed ? 'Published' : 'Unchanged';
        console.log(
          `${pc.green('✓')} ${action} 3D model ${pc.bold(name)} version ${current.version} (${formatBytes(current.byteLength)}, ${formatCount(current.summary.levels[0]?.triangles ?? 0)} triangles).`,
        );
      }
    }
    if (options.json) {
      emitJson({
        command: 'models publish',
        ok: true,
        schemaVersion: 1,
        models: results.map(({changed, model}) => ({
          changed,
          contentHash: model.current!.contentHash,
          name: model.name,
          version: model.current!.version,
        })),
      });
    } else if (results.some(({changed}) => changed)) {
      console.log('Maps that place them draw the new versions on their next load.');
    }
  });

  withTeamOptions(models.command('list').description("List the Team's 3D models")).action(
    async (options: HostedTeamOptions) => {
      const authority = await resolveTeamAuthority(options, ['models:read'], dependencies);
      if (!authority) return;
      const listed: z.infer<typeof modelSchema>[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < maximumListPages; page += 1) {
        const response = await authorizedTeamRequest(
          authority,
          `/v1/models${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          'GET',
        );
        if (!response.ok) return emitHttpFailure(options.json, response.status, response.body);
        const parsed = listResponseSchema.safeParse(response.body);
        if (!parsed.success)
          return emitFailure(options.json, 'invalid_response', 'The model list was not readable.');
        listed.push(...parsed.data.models);
        cursor = parsed.data.nextCursor;
        if (!cursor) break;
      }
      if (options.json)
        return emitJson({command: 'models list', ok: true, schemaVersion: 1, models: listed});
      if (listed.length === 0) {
        console.log('The Team has no 3D models. Publish one with tileflow models publish.');
        return;
      }
      for (const model of listed) {
        const current = model.current;
        console.log(
          `${pc.bold(model.name)}  ${current ? `version ${current.version}, ${formatBytes(current.byteLength)}` : 'no current version'}  ${model.usedByMaps === 1 ? '1 map' : `${model.usedByMaps} maps`}${model.state === 'purging' ? pc.yellow('  purging') : ''}`,
        );
      }
    },
  );

  withTeamOptions(
    models
      .command('status')
      .description("Show a 3D model's versions and the maps that place it")
      .argument('<name>', 'model name'),
  ).action(async (name: string, options: HostedTeamOptions) => {
    if (!modelName.test(name))
      return emitFailure(options.json, 'invalid_model', 'Model name is invalid.');
    const authority = await resolveTeamAuthority(options, ['models:read'], dependencies);
    if (!authority) return;
    const detail = await readDetail(authority, name, options.json);
    if (!detail) return;
    if (options.json) return emitJson({...detail, command: 'models status', ok: true});
    const {model, versions, uses} = detail;
    console.log(
      `${pc.bold(model.name)}${model.state === 'purging' ? pc.yellow(' (purging)') : ''}`,
    );
    for (const version of versions) {
      const role =
        version.state === 'current'
          ? 'current'
          : version.state === 'previous'
            ? 'previous'
            : version.state;
      console.log(
        `  version ${version.version}  ${role}  ${formatBytes(version.byteLength)}  ${formatCount(version.summary.levels[0]?.triangles ?? 0)} triangles  ${version.publishedAt}`,
      );
    }
    console.log(
      uses.length === 0
        ? '  No map places it.'
        : `  Placed by ${uses.map(({mapName, mapId}) => mapName ?? mapId).join(', ')}.`,
    );
  });

  withTeamOptions(
    models
      .command('restore')
      .description("Make a 3D model's previous version current again, in every map that places it")
      .argument('<name>', 'model name'),
  ).action(async (name: string, options: HostedTeamOptions) => {
    if (!modelName.test(name))
      return emitFailure(options.json, 'invalid_model', 'Model name is invalid.');
    const authority = await resolveTeamAuthority(options, ['models:write'], dependencies);
    if (!authority) return;
    const detail = await readDetail(authority, name, options.json);
    if (!detail) return;
    const {current, previous} = detail.model;
    if (!current || !previous) {
      return emitFailure(
        options.json,
        'no_previous_version',
        `${name} has no previous version to restore.`,
      );
    }
    const response = await authorizedTeamRequest(
      authority,
      `/v1/models/${encodeURIComponent(name)}/restore`,
      'POST',
      {
        body: JSON.stringify({expectedCurrentVersion: current.version}),
        headers: {'Content-Type': 'application/json'},
      },
    );
    if (!response.ok) return emitHttpFailure(options.json, response.status, response.body, name);
    const parsed = restoreResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.model.current?.version !== previous.version) {
      return emitFailure(
        options.json,
        'model_restore_unconfirmed',
        `The restore of ${name} was not confirmed.`,
      );
    }
    if (options.json)
      return emitJson({
        command: 'models restore',
        ok: true,
        schemaVersion: 1,
        model: parsed.data.model,
      });
    console.log(
      `${pc.green('✓')} ${pc.bold(name)} is at version ${previous.version} again; version ${current.version} is its previous one. Maps draw it on their next load.`,
    );
  });

  withTeamOptions(
    models
      .command('purge')
      .description('Delete a 3D model and its versions; refused while a map places it')
      .argument('<name>', 'model name')
      .option('--confirm <name>', 'repeat the model name to confirm'),
  ).action(async (name: string, options: HostedTeamOptions & {confirm?: string}) => {
    if (!modelName.test(name))
      return emitFailure(options.json, 'invalid_model', 'Model name is invalid.');
    if (options.confirm !== name) {
      return emitFailure(
        options.json,
        'confirmation_required',
        `Repeat the model name to purge it: --confirm ${name}`,
      );
    }
    const authority = await resolveTeamAuthority(options, ['models:write'], dependencies);
    if (!authority) return;
    const response = await authorizedTeamRequest(
      authority,
      `/v1/models/${encodeURIComponent(name)}`,
      'DELETE',
      {
        headers: {'X-Tileflow-Confirm-Model-Purge': name},
      },
    );
    if (!response.ok) return emitHttpFailure(options.json, response.status, response.body, name);
    const parsed = purgeResponseSchema.safeParse(response.body);
    if (!parsed.success)
      return emitFailure(options.json, 'invalid_response', 'The purge was not confirmed.');
    if (options.json)
      return emitJson({
        command: 'models purge',
        ok: true,
        schemaVersion: 1,
        purge: parsed.data.purge,
      });
    console.log(
      `${pc.green('✓')} ${pc.bold(name)} is being purged; its name is free once its files are deleted.`,
    );
  });
}

function withTeamOptions(command: Command): Command {
  return command
    .option('--team <team>', 'Team, as @team, when the account has several')
    .option('--api-key <key>', 'Team data API key with the 3D models permission')
    .option('--api-url <url>', 'Tileflow API origin')
    .option('--json', 'machine-readable output');
}

async function readDetail(authority: HostedTeamAuthority, name: string, json: boolean | undefined) {
  const response = await authorizedTeamRequest(
    authority,
    `/v1/models/${encodeURIComponent(name)}`,
    'GET',
  );
  if (!response.ok) {
    emitHttpFailure(json, response.status, response.body, name);
    return undefined;
  }
  const parsed = detailResponseSchema.safeParse(response.body);
  if (!parsed.success) {
    emitFailure(json, 'invalid_response', `The details of ${name} were not readable.`);
    return undefined;
  }
  return parsed.data;
}

/** The building models in the given files or directories, by name. */
async function prepareFromPaths(paths: readonly string[]) {
  const cwd = process.cwd();
  // Each directory by its absolute path, with the names chosen in it or all of its models.
  const directories = new Map<string, Set<string> | 'all'>();
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    const info = await lstat(absolute).catch(() => undefined);
    if (!info) throw new Error(`${path} does not exist.`);
    const directory = info.isDirectory() ? absolute : dirname(absolute);
    if (relative(cwd, directory).startsWith('..'))
      throw new Error(`${path} is outside the current directory.`);
    if (info.isDirectory()) {
      directories.set(directory, 'all');
      continue;
    }
    const file = basename(absolute);
    if (!file.toLowerCase().endsWith('.glb'))
      throw new Error(`${path} is not a glTF binary (.glb).`);
    const name = file.replace(/(\.mid|\.far)?\.glb$/iu, '');
    const selected = directories.get(directory);
    if (selected === 'all') continue;
    directories.set(directory, new Set([...(selected ?? []), name]));
  }
  const models = new Map<string, PreparedTileflowBuildingModel>();
  for (const [directory, selected] of directories) {
    // A directory is read as its parent's `./<name>`, the form a map's models directories take.
    const parent = dirname(directory);
    const local = `./${basename(directory)}` as const;
    const display = relative(cwd, directory) || '.';
    const prepared = await prepareTileflowMapTreeModels([local], {
      baseDirectory: parent,
      configPath: display,
      cwd: parent,
      target: 'hosted',
    });
    for (const [name, model] of Object.entries(prepared.buildings)) {
      if (selected !== 'all' && !selected.has(name)) continue;
      addModel(models, name, model);
    }
    if (selected !== 'all')
      for (const name of selected)
        if (!prepared.buildings[name])
          throw new Error(
            `${display}/${name}.glb is not a building model: its materials must name its parts, such as surface, glass, roof or water, and not only a tree's.`,
          );
  }
  return models;
}

/** The building models of every map the project's config declares. */
async function prepareFromConfig(configPath: string) {
  const loaded = await withTileflowConfigSecretsHidden(() =>
    loadTileflowConfigWithInputs(configPath),
  );
  const project = loaded.project as TileflowBuildCatalog;
  assertValidTileflowConfig(project);
  const prepared = await prepareModelAssets(project, {
    baseDirectory: dirname(loaded.configFile),
    target: 'hosted',
  });
  const models = new Map<string, PreparedTileflowBuildingModel>();
  for (const buildings of Object.values(prepared.buildings))
    for (const [name, model] of Object.entries(buildings)) addModel(models, name, model);
  return models;
}

function addModel(
  models: Map<string, PreparedTileflowBuildingModel>,
  name: string,
  model: PreparedTileflowBuildingModel,
) {
  const known = models.get(name);
  if (known && known.sha256 !== model.sha256)
    throw new Error(`Two different models are named ${name}; a Team has one model of each name.`);
  models.set(name, model);
}

function emitHttpFailure(json: boolean | undefined, status: number, body: unknown, name?: string) {
  const error = z
    .object({error: z.object({code: z.string().max(80), message: z.string().max(400)}).partial()})
    .partial()
    .safeParse(body);
  const message = error.success ? error.data.error?.message : undefined;
  const code = error.success ? error.data.error?.code : undefined;
  if (status === 404)
    return emitFailure(
      json,
      'model_not_found',
      name ? `The Team has no 3D model named ${name}.` : 'Not found.',
    );
  return emitFailure(
    json,
    code ?? `http_${status}`,
    message ?? `The request failed with ${status}.`,
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatCount(count: number) {
  return new Intl.NumberFormat('en-US').format(count);
}

const summarySchema = z
  .object({
    levels: z
      .array(
        z
          .object({
            level: z.enum(['near', 'mid', 'far']),
            vertices: z.number().int().nonnegative(),
            triangles: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    width: z.number().nonnegative(),
    depth: z.number().nonnegative(),
    height: z.number().nonnegative(),
    footprint: z
      .object({
        rings: z.number().int().nonnegative(),
        points: z.number().int().nonnegative(),
        area: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

const versionSchema = z
  .object({
    id: z.string().regex(/^tmv_[A-Za-z0-9_-]{16,64}$/u),
    version: z.number().int().positive(),
    state: z.enum(['current', 'previous', 'gc_pending', 'deleting', 'deleted']),
    contentHash: z.string().regex(sha256),
    byteLength: z.number().int().positive(),
    publishedAt: z.iso.datetime({offset: true}),
    summary: summarySchema,
  })
  .strict();

const modelSchema = z
  .object({
    id: z.string().regex(/^tmd_[A-Za-z0-9_-]{16,64}$/u),
    name: z.string().regex(modelName).max(64),
    state: z.enum(['active', 'purging']),
    current: versionSchema.nullable(),
    previous: versionSchema.nullable(),
    url: z.url(),
    usedByMaps: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime({offset: true}),
  })
  .strict();

export const listResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.array(modelSchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export const detailResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: modelSchema,
    versions: z.array(versionSchema).max(100),
    uses: z
      .array(
        z
          .object({
            mapId: z.string().min(1).max(160),
            mapName: z.string().max(200).nullable(),
            relationship: z.enum(['active', 'retained']),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const publishResponseSchema = z
  .object({schemaVersion: z.literal(1), changed: z.boolean(), model: modelSchema})
  .strict();
export const restoreResponseSchema = z
  .object({schemaVersion: z.literal(1), model: modelSchema})
  .strict();
export const purgeResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    purge: z
      .object({name: z.string().regex(modelName), state: z.enum(['purging', 'purged'])})
      .strict(),
  })
  .strict();
