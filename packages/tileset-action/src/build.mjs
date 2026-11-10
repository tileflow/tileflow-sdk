import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, extname, join} from 'node:path';
import {readDocument, resolveCli, runCli, withoutApiKey} from './cli.mjs';
import {describeUrl, downloadSource, parseSource} from './source.mjs';
import {annotate, appendSummary, parseBoolean, setOutputs} from './workflow.mjs';

const valueOptions = [
  ['TILEFLOW_TILESET_RECIPE', '--recipe'],
  ['TILEFLOW_TILESET_SOURCE_CRS', '--source-crs'],
  ['TILEFLOW_TILESET_MAXZOOM', '--maxzoom'],
  ['TILEFLOW_TILESET_RANK_BY', '--rank-by'],
  ['TILEFLOW_TILESET_INCLUDE', '--include'],
  ['TILEFLOW_TILESET_INPUT_LAYER', '--input-layer'],
  ['TILEFLOW_TILESET_ZIP_ENTRY', '--zip-entry'],
  ['TILEFLOW_TILESET_LAYER', '--layer'],
  ['TILEFLOW_TILESET_FORMAT', '--format'],
  ['TILEFLOW_TILESET_LON_COLUMN', '--lon-column'],
  ['TILEFLOW_TILESET_LAT_COLUMN', '--lat-column'],
  ['TILEFLOW_TILESET_ATTRIBUTION', '--attribution'],
];
const reviewEvents = new Set(['pull_request', 'pull_request_target']);

/**
 * Builds with no API key in the environment, so parsing data and installing the CLI happen apart
 * from the credential. Everything that can fail cheaply is checked before the download and build.
 */
export async function runBuild(env = process.env, dependencies = {}) {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? console.log;
  const publish = parseBoolean(env.TILEFLOW_TILESET_PUBLISH ?? 'true', 'publish');
  const reproject = parseBoolean(env.TILEFLOW_TILESET_REPROJECT || 'false', 'reproject');
  if (publish) assertCanPublish(env);
  const source = parseSource(requireValue(env.TILEFLOW_TILESET_SOURCE, 'source'), cwd);

  const childEnv = withoutApiKey(env);
  const workspace = await mkdtemp(join(env.RUNNER_TEMP ?? tmpdir(), 'tileflow-tileset-'));
  const cli = await resolveCli({
    cwd,
    env: childEnv,
    installDirectory: join(workspace, 'cli'),
    version: env.TILEFLOW_TILESET_CLI_VERSION,
  });

  let input = source.path;
  if (source.kind === 'url') {
    log(`Downloading ${describeUrl(source.url)}`);
    const directory = join(workspace, 'source');
    await mkdir(directory);
    input = await downloadSource(source.url, directory, dependencies);
  }

  const output = join(workspace, `${basename(input, extname(input))}.pmtiles`);
  const args = ['tileset', 'build', input, `--output=${output}`, '--json'];
  for (const [variable, option] of valueOptions) {
    if (env[variable]) args.push(`${option}=${env[variable]}`);
  }
  if (reproject) args.push('--reproject');

  const document = readDocument(await runCli(cli, args, {cwd, env: childEnv}), 'tileset build');
  for (const warning of document.warnings ?? []) annotate('warning', warning, log);
  await setOutputs(env, {cli, path: output});
  const {archive} = document;
  log(`Built ${output}: ${archive.byteCount} bytes, zooms ${archive.minzoom}-${archive.maxzoom}.`);
  await appendSummary(
    env,
    `Built a tileset with ${document.input.features} features, zooms ${archive.minzoom}-${archive.maxzoom}, ${archive.byteCount} bytes.`,
  );
}

function assertCanPublish(env) {
  if (reviewEvents.has(env.GITHUB_EVENT_NAME)) {
    throw new Error(
      `Publishing from ${env.GITHUB_EVENT_NAME} would replace a live tileset with unreviewed data. Set publish to false for pull requests.`,
    );
  }
  requireValue(env.TILEFLOW_TILESET_ID, 'tileset-id');
  if (env.TILEFLOW_TILESET_HAS_API_KEY !== 'true') {
    throw new Error('api-key is required to publish. Pass it from secrets.TILEFLOW_API_KEY.');
  }
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
