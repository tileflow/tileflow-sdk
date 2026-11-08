import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * Finds the CLI before the API key is in play. A floating tag would let a new release run in a job
 * that publishes with a Team key, so an install needs an exact version.
 */
export async function resolveCli({cwd, env, installDirectory, version}) {
  if (version) {
    if (!exactVersion.test(version)) {
      throw new Error(`tileflow-version must be an exact version, but it is "${version}".`);
    }
    await mkdir(installDirectory, {recursive: true});
    await writeFile(join(installDirectory, 'package.json'), '{"private":true}\n');
    await installCli(installDirectory, version, env);
    return readCliEntry(installDirectory);
  }
  for (const directory of [cwd, env.GITHUB_WORKSPACE]) {
    if (directory && existsSync(join(directory, 'node_modules', 'tileflow', 'package.json'))) {
      return readCliEntry(directory);
    }
  }
  throw new Error(
    'No tileflow package is installed. Set tileflow-version to an exact version, or install tileflow in working-directory first.',
  );
}

async function installCli(directory, version, env) {
  const result = await run(
    'npm',
    ['install', '--no-audit', '--no-fund', `tileflow@${version}`],
    directory,
    withoutApiKey(env),
    process.platform === 'win32',
  );
  if (result.code !== 0) {
    throw new Error(`Installing tileflow@${version} failed: ${lastLines(result.stderr)}`);
  }
}

async function readCliEntry(directory) {
  const packageRoot = join(directory, 'node_modules', 'tileflow');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tileflow;
  if (!entry) throw new Error('The installed tileflow package has no CLI entry point.');
  return join(packageRoot, entry);
}

export function runCli(cli, args, {cwd, env}) {
  return run(process.execPath, [cli, ...args], cwd, env, false);
}

export function withoutApiKey(env) {
  const scrubbed = {...env};
  delete scrubbed.TILEFLOW_API_KEY;
  return scrubbed;
}

/**
 * Reads the document a `--json` command printed, or explains why there is none. On failure the
 * tileset commands print `{error: {code, message}}` to stdout or stderr, depending on the command.
 */
export function readDocument(result, command) {
  const success = parseJson(result.stdout);
  if (result.code === 0 && success?.command === command) return success;
  const failure = success?.error ?? parseJson(result.stderr)?.error;
  if (failure?.message) {
    throw new Error(`${command} failed: ${failure.message} (${failure.code ?? 'no code'})`);
  }
  throw new Error(
    `${command} failed with exit code ${result.code}: ${lastLines(result.stderr) || 'no details.'}`,
  );
}

function run(command, args, cwd, env, shell) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      }),
    );
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function lastLines(text) {
  return text.trim().split('\n').slice(-10).join('\n');
}
