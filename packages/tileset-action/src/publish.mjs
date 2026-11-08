import {readDocument, runCli} from './cli.mjs';
import {annotate, appendSummary, maskSecret, redact, setOutputs} from './workflow.mjs';

/**
 * The key reaches the CLI through its environment only, never as an argument, and any text that
 * came back from the CLI loses the key before it can reach an annotation.
 */
export async function runPublish(env = process.env, dependencies = {}) {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? console.log;
  const apiKey = env.TILEFLOW_API_KEY ?? '';
  if (!apiKey) throw new Error('api-key is required to publish.');
  maskSecret(apiKey, log);

  const args = [
    'tileset',
    'publish',
    env.TILEFLOW_TILESET_ARCHIVE,
    `--id=${env.TILEFLOW_TILESET_ID}`,
    '--json',
  ];
  if (env.TILEFLOW_TILESET_NAME) args.push(`--name=${env.TILEFLOW_TILESET_NAME}`);
  if (env.TILEFLOW_TILESET_ATTRIBUTION) {
    args.push(`--attribution=${env.TILEFLOW_TILESET_ATTRIBUTION}`);
  }

  const result = await runCli(env.TILEFLOW_TILESET_CLI, args, {cwd, env});
  let document;
  try {
    document = readDocument(result, 'tileset publish');
  } catch (error) {
    throw new Error(redact(error.message, apiKey));
  }

  const {publication, tileset} = document;
  await setOutputs(env, {
    id: tileset.logicalId,
    publication,
    version: tileset.version.number,
  });
  const team = env.TILEFLOW_TILESET_TEAM;
  const message = `${publication === 'changed' ? 'Published' : 'Unchanged'} ${tileset.logicalId} at version ${tileset.version.number}.`;
  log(message);
  if (team) {
    annotate('notice', `The API key selected the Team. ${team} was not checked against it.`, log);
  }
  await appendSummary(env, message);
}
