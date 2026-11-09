import {type Command, CommanderError} from 'commander';
import pc from 'picocolors';
import {defaultTileflowApiUrl} from '@tileflow/dev/config';
import {configureJsonErrors} from './cli-program';
import {emitFailure} from './hosted-team';

/**
 * What to do next, stated so an agent can act on it without reading documentation. A step carries
 * an exact command whenever one exists; a description alone means the next move needs judgment.
 */
export type NextStep = Readonly<{command?: string; description: string}>;

export function printNextSteps(steps: readonly NextStep[], write = console.log) {
  if (steps.length === 0) return;
  write(`\n${pc.bold('Next steps')}`);
  for (const step of steps) {
    write(`  ${pc.cyan('•')} ${step.description}`);
    if (step.command) write(`    ${pc.cyan(step.command)}`);
  }
}

export function emitGuidedFailure(
  json: boolean | undefined,
  code: string,
  message: string,
  nextSteps: readonly NextStep[],
  context: Record<string, unknown> = {},
) {
  emitFailure(json, code, message, {...context, nextSteps});
  if (!json) printNextSteps(nextSteps, console.error);
}

export function emitRestoreFailure(
  json: boolean | undefined,
  code: string,
  message: string,
  context: Record<string, unknown> = {},
) {
  emitGuidedFailure(json, code, message, [], context);
}

/** The origin comes from the resolved authority. Quote uncommon host characters for the shell. */
export function apiOriginOption(origin: string, defaultOrigin = defaultTileflowApiUrl): string {
  if (origin === defaultOrigin) return '';
  const argument = /^[A-Za-z0-9.:/-]+$/u.test(origin)
    ? origin
    : "'" + origin.replaceAll("'", "'\\''") + "'";
  return ` --api-url ${argument}`;
}

const credentialSteps = (scope: string, originOption: string): NextStep[] => [
  {
    description: `Use a credential with the ${scope} scope, or sign in as someone who can manage this Team's content.`,
    command: `tileflow login${originOption}`,
  },
];

/** Refusals of `deployments restore`, each with the way out that fits it. */
export function deploymentRestoreSteps(input: {
  code: string;
  mapId: string;
  apiUrl: string;
}): NextStep[] {
  const origin = apiOriginOption(input.apiUrl);
  const target = `--map-id ${input.mapId}${origin}`;
  const list = `tileflow deployments list ${target}`;
  switch (input.code) {
    case 'TF_DEPLOYMENT_CURRENT_CHANGED':
      return [
        {
          description:
            'The live version moved while restoring. Read it, then repeat the restore if it is still what you want.',
          command: list,
        },
      ];
    case 'deployment_not_found':
    case 'TF_DEPLOYMENT_NOT_FOUND':
      return [{description: 'Choose a version that is still retained.', command: list}];
    case 'TF_DEPLOYMENT_NOT_RESTORABLE':
    case 'TF_DEPLOYMENT_ASSETS_UNAVAILABLE':
      return [
        {description: 'Choose another retained version.', command: list},
        {
          description: 'Or publish the map again from its repository.',
          command: `tileflow deploy ${target}`,
        },
      ];
    case 'TF_DEPLOYMENT_SOURCE_INCOMPATIBLE':
      return [
        {description: 'Choose a version whose data still exists.', command: list},
        {
          description:
            'Or publish the data named in this error to its tileset, then repeat the restore.',
        },
      ];
    case 'nothing_published':
      return [{description: 'Publish the map first.', command: `tileflow deploy ${target}`}];
    case 'TF_MAP_UNAVAILABLE':
      return [
        {
          description:
            'Only an active Map can restore. Make the Map active, then repeat the restore.',
        },
      ];
    case 'TF_DEPLOYMENT_RESTORE_FORBIDDEN':
    case 'http_401':
    case 'http_403':
      return credentialSteps('styles:write', origin);
    default:
      return [{description: 'Check what is live before trying again.', command: list}];
  }
}

export type BlockingUpload = Readonly<{
  byteCount: number;
  expiresAt: string;
  id: string;
  state: string;
}>;

const windingDownStates = new Set(['aborting', 'expiring', 'publishing', 'rejecting']);

/** Refusals of `tileset restore`. `commands` already carries the tileset and Team. */
export function tilesetRestoreSteps(input: {
  abort: string;
  attemptedVersion: number | undefined;
  origin: string;
  pinned: boolean;
  uncertain: boolean;
  code: string;
  restore: string;
  status: string;
  upload?: BlockingUpload | undefined;
}): NextStep[] {
  const boundRestore = `${input.restore} --expected-current-version ${input.attemptedVersion}`;
  if (
    input.attemptedVersion !== undefined &&
    (input.uncertain ||
      input.code === 'TF_TILESET_DELIVERY_PENDING' ||
      input.code === 'TF_TILESET_RESTORE_UNAVAILABLE')
  ) {
    return [
      {description: 'Check which version is current.', command: input.status},
      {
        description: 'Retry the original restore using its expected version.',
        command: boundRestore,
      },
    ];
  }
  switch (input.code) {
    case 'TF_TILESET_UPLOAD_IN_PROGRESS':
      if (!input.upload || windingDownStates.has(input.upload.state)) {
        return [
          {
            description:
              'The upload is finishing on its own. Wait a minute, then repeat the restore.',
            command: input.pinned ? boundRestore : input.restore,
          },
        ];
      }
      return [
        {
          description: `Upload ${input.upload.id} is ${input.upload.state} and expires at ${input.upload.expiresAt}. It may belong to a teammate or a CI run: abort it only if nothing is still uploading.`,
          command: `${input.abort} --upload-id ${input.upload.id}`,
        },
        {
          description: 'After aborting, or once the upload ends, repeat the restore.',
          command: input.pinned ? boundRestore : input.restore,
        },
      ];
    case 'no_previous_version':
    case 'TF_TILESET_NO_PREVIOUS_VERSION':
      return [
        {
          description: 'There is nothing to go back to. Publish a corrected archive instead.',
        },
      ];
    case 'TF_TILESET_CURRENT_VERSION_CHANGED':
      return [
        {
          description: input.pinned
            ? 'Nothing was swapped. The original restore may have finished, or another change updated the current version.'
            : 'The current version moved while restoring. Read it, then repeat the restore if it is still what you want.',
          command: input.status,
        },
      ];
    case 'TF_TILESET_RESTORE_INCOMPATIBLE':
      return [
        {description: 'See which Maps use this tileset.', command: input.status},
        {
          description:
            'Restore or redeploy the live Map that needs the newer data, then repeat this restore.',
        },
      ];
    case 'TF_TILESET_PURGING':
      return [{description: 'This tileset is being purged, so it cannot be restored.'}];
    case 'http_401':
    case 'http_403':
      return credentialSteps('tilesets:write', input.origin);
    default:
      return [{description: 'Check the tileset before trying again.', command: input.status}];
  }
}

export function isRestoreJsonCommand(args: readonly string[]) {
  const [group, subcommand, operation] = args;
  return (
    args.includes('--json') &&
    ((group === 'deployments' && (subcommand === 'list' || subcommand === 'restore')) ||
      (group === 'tileset' &&
        (subcommand === 'restore' || (subcommand === 'upload' && operation === 'abort'))))
  );
}

export async function parseRestoreJson(program: Command): Promise<void> {
  configureJsonErrors(program);
  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0)
        emitRestoreFailure(
          true,
          'invalid_command_arguments',
          'Invalid command arguments. Check the command help.',
        );
    } else {
      emitRestoreFailure(
        true,
        'hosted_request_failed',
        'The command could not complete its Hosted request.',
      );
    }
  }
}
