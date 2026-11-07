import type {Command} from 'commander';
import pc from 'picocolors';
import {z} from 'zod';
import {resolveDeploySource} from './deploy-source';
import {emitFailure, emitJson} from './hosted-team';
import {hostedApiKeyOption, hostedApiUrlOption} from './hosted-options';
import {requestHostedJson} from './hosted-client';

type DeploymentOptions = {apiKey?: string; apiUrl?: string; json?: boolean; mapId?: string};
type HostedMapApi = {apiKey: string; apiUrl: string; mapId: string};

const deploymentSchema = z
  .object({
    active: z.boolean(),
    createdAt: z.string().min(1).max(64),
    deploymentId: z.string().min(1).max(128),
    restoredFromVersion: z.number().int().positive().nullable(),
    source: z
      .object({kind: z.string().min(1).max(32), revision: z.string().max(128).optional()})
      .strict()
      .nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const deploymentListResponseSchema = z
  .object({
    deployments: z.array(deploymentSchema).max(100),
    mapId: z.string().regex(/^map_[A-Za-z0-9_-]{16}$/u),
    schemaVersion: z.literal(1),
  })
  .strict();
export const deploymentRestoreResponseSchema = z
  .object({
    changed: z.boolean(),
    deploymentId: z.string().min(1).max(128),
    familyUrl: z.string().url().max(2048).optional(),
    mapId: z.string().regex(/^map_[A-Za-z0-9_-]{16}$/u),
    restoredFromVersion: z.number().int().positive(),
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
  })
  .strict();
const failureSchema = z
  .object({code: z.string().max(80), error: z.string().max(400)})
  .partial();

/**
 * Register the Map deployments family.
 *
 * Deployments are immutable, so a restore never moves a Map back: it publishes an earlier
 * deployment's content as a new version, and the deployment it replaces stays in the history.
 */
export function registerDeploymentCommands(
  program: Command,
  dependencies: {
    resolveApi(
      options: DeploymentOptions,
      behavior: {capabilityScopes: Array<'status:read' | 'styles:write'>; silent?: boolean},
    ): Promise<HostedMapApi | null>;
  },
): void {
  const deployments = program
    .command('deployments')
    .description('List a Map’s retained deployments and restore an earlier one');
  const withOptions = (command: Command) =>
    command
      .requiredOption('--map-id <id>', 'managed Map destination')
      .addOption(hostedApiUrlOption())
      .addOption(hostedApiKeyOption('Tileflow API key'))
      .option('--json', 'print deterministic schema-version-1 JSON');

  const readHistory = async (api: HostedMapApi, json: boolean | undefined) => {
    const response = await request(api, '/v1/styles/deployments', 'GET');
    if (!response.ok) {
      emitHttpFailure(json, response.status, response.body);
      return null;
    }
    const parsed = deploymentListResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.mapId !== api.mapId) {
      emitFailure(json, 'deployment_list_invalid', 'The deployment history was not understood.');
      return null;
    }
    return parsed.data.deployments;
  };

  withOptions(deployments.command('list').description('List the retained deployments, newest first'))
    .action(async (options: DeploymentOptions) => {
      const api = await dependencies.resolveApi(options, {
        capabilityScopes: ['status:read'],
        silent: options.json,
      });
      if (!api) return;
      const history = await readHistory(api, options.json);
      if (!history) return;
      if (options.json) {
        return emitJson({command: 'deployments list', deployments: history, schemaVersion: 1});
      }
      if (history.length === 0) return console.log(pc.gray('Nothing is published on this Map.'));
      for (const item of history) {
        const origin = item.restoredFromVersion ? `restored from v${item.restoredFromVersion}` : '';
        console.log(
          `  v${item.version}  ${item.active ? pc.green('live') : pc.gray('superseded')}  ${item.createdAt}  ${[item.source?.kind ?? 'unknown', origin].filter(Boolean).join(', ')}`,
        );
      }
    });

  withOptions(
    deployments
      .command('restore')
      .description('Publish an earlier deployment again, as a new version of the Map')
      .argument('<version>', 'the version to restore'),
  ).action(async (value: string, options: DeploymentOptions) => {
    if (!/^[1-9][0-9]{0,9}$/u.test(value)) {
      return emitFailure(options.json, 'invalid_version', 'Version must be a positive integer.');
    }
    const version = Number(value);
    const api = await dependencies.resolveApi(options, {
      capabilityScopes: ['status:read', 'styles:write'],
      silent: options.json,
    });
    if (!api) return;
    const history = await readHistory(api, options.json);
    if (!history) return;
    const live = history.find((item) => item.active);
    if (!live) {
      return emitFailure(options.json, 'nothing_published', 'Nothing is published on this Map.');
    }
    if (!history.some((item) => item.version === version)) {
      return emitFailure(
        options.json,
        'deployment_not_found',
        `Version ${version} is not in this Map's retained history.`,
      );
    }
    const response = await request(api, `/v1/styles/deployments/${version}/restore`, 'POST', {
      expectedCurrentVersion: live.version,
      source: resolveDeploySource(process.env),
    });
    if (!response.ok) return emitHttpFailure(options.json, response.status, response.body);
    const parsed = deploymentRestoreResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.mapId !== api.mapId) {
      return emitFailure(
        options.json,
        'deployment_restore_unconfirmed',
        `The restore of version ${version} was not confirmed.`,
      );
    }
    if (options.json) {
      return emitJson({command: 'deployments restore', ok: true, ...parsed.data});
    }
    console.log(
      parsed.data.changed
        ? `${pc.green('✓')} Version ${version} is live again as version ${parsed.data.version}. Version ${live.version} stays in the history.`
        : `${pc.green('✓')} The content of version ${version} is already live, as version ${parsed.data.version}.`,
    );
    if (parsed.data.changed) {
      console.log(
        pc.gray(
          '  New sessions pick it up within minutes. Your repository still holds the replaced map, so the next deploy publishes that again unless you revert it.',
        ),
      );
    }
  });
}

function request(api: HostedMapApi, path: string, method: 'GET' | 'POST', body?: unknown) {
  return requestHostedJson(api.apiUrl, path, {
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    headers: {
      Authorization: `Bearer ${api.apiKey}`,
      'X-Tileflow-Map-Id': api.mapId,
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    method,
  });
}

function emitHttpFailure(json: boolean | undefined, status: number, body: unknown) {
  const failure = failureSchema.safeParse(body);
  const message = failure.success ? failure.data.error : undefined;
  const code = failure.success ? failure.data.code : undefined;
  return emitFailure(json, code ?? `http_${status}`, message ?? `The request failed with ${status}.`);
}
