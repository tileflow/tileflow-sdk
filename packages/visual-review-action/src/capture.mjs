import {execFile as execFileCallback, spawn} from 'node:child_process';
import {existsSync, readdirSync, realpathSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {promisify} from 'node:util';
import {evidenceFile, limits, needsApproval, reportFileName} from './contract.mjs';

const execFile = promisify(execFileCallback);
const lockfileInstallers = [
  {file: 'pnpm-lock.yaml', command: 'pnpm', args: ['install', '--frozen-lockfile'], corepack: true},
  {file: 'package-lock.json', command: 'npm', args: ['ci']},
  {file: 'yarn.lock', command: 'yarn', args: ['install', '--immutable'], corepack: true},
];
const unsafeEvents = new Set(['issue_comment', 'pull_request_target', 'workflow_run']);

/**
 * Runs inside the unprivileged pull request job. Config files are executable, so nothing here may
 * hold a write token, and the action refuses events that would grant one to pull request code.
 */
export async function runCapture(env = process.env) {
  if (unsafeEvents.has(env.GITHUB_EVENT_NAME)) {
    throw new Error(
      `Capture runs pull request code and must not run on ${env.GITHUB_EVENT_NAME}. Use pull_request.`,
    );
  }
  const options = {
    baselineDirectory: env.TILEFLOW_REVIEW_BASELINE_DIR,
    baseSha: env.TILEFLOW_REVIEW_BASE_SHA,
    config: env.TILEFLOW_REVIEW_CONFIG,
    cwd: process.cwd(),
    headSha: env.TILEFLOW_REVIEW_HEAD_SHA,
    installCommand: env.TILEFLOW_REVIEW_INSTALL_COMMAND,
    noiseRatio: Number(env.TILEFLOW_REVIEW_NOISE_RATIO),
    output: env.TILEFLOW_REVIEW_OUTPUT,
    pullRequest: Number(env.TILEFLOW_REVIEW_PULL_REQUEST),
  };
  await rm(options.output, {force: true, recursive: true});
  await mkdir(join(options.output, 'scenes'), {recursive: true});
  const report = {
    schemaVersion: 1,
    pullRequest: options.pullRequest,
    headSha: options.headSha,
    baseSha: options.baseSha,
    cliVersion: '',
    exitCode: 0,
    failure: null,
    scenes: [],
    semantic: [],
    warnings: [],
  };
  try {
    await collectEvidence(options, report);
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    console.error(report.failure);
  }
  await writeFile(join(options.output, reportFileName), `${JSON.stringify(report, null, 2)}\n`);
}

async function collectEvidence(options, report) {
  const {cwd} = options;
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const projectPath = relative(root, cwd).split('\\').join('/');
  await install(options, root);
  const tileflow = findExecutable(cwd, root);
  report.cliVersion = (await execFile(tileflow, ['--version'], {cwd})).stdout.trim();
  await prepareBrowser(tileflow, cwd);

  const temporary = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'tileflow-review-'));
  const baselineDirectory = join(temporary, 'baselines');
  await mkdir(baselineDirectory, {recursive: true});
  const repositoryBaseline = [projectPath, options.baselineDirectory]
    .filter(Boolean)
    .join('/')
    .replace(/\/+$/, '');
  await extractBaselines(root, options.baseSha, repositoryBaseline, baselineDirectory);

  const outputDirectory = join(temporary, 'diffs');
  const diff = await runTileflow(tileflow, cwd, [
    'visual',
    'diff',
    '--all',
    '--config',
    options.config,
    '--baseline-dir',
    baselineDirectory,
    '--output-dir',
    outputDirectory,
    '--fail-on',
    'changed',
    '--json',
  ]);
  report.exitCode = diff.code;
  const document = parseJson(diff.stdout);
  if (document?.command !== 'visual.diff' || !Array.isArray(document.comparisons)) {
    throw new Error(`Visual diff failed: ${describeFailure(diff)}`);
  }
  if (document.comparisons.length > limits.maximumScenes) {
    throw new Error(`The review supports up to ${limits.maximumScenes} scenes.`);
  }

  report.scenes = document.comparisons.map((entry) => summarizeScene(entry, options.noiseRatio));
  const pending = report.scenes.filter(needsApproval).map(({scene}) => scene);
  const proposalDirectory = join(temporary, 'proposed');
  if (pending.length > 0) {
    const update = await runTileflow(tileflow, cwd, [
      'visual',
      'update',
      ...pending,
      '--config',
      options.config,
      '--baseline-dir',
      proposalDirectory,
      '--json',
    ]);
    if (update.code !== 0) {
      throw new Error(`Proposed baselines failed: ${describeFailure(update)}`);
    }
  }
  for (const scene of report.scenes) {
    await collectImages(scene, {baselineDirectory, outputDirectory, proposalDirectory}, options);
  }
  report.warnings = [
    ...new Set(document.comparisons.flatMap((entry) => entry.warnings ?? [])),
  ].sort();
  report.semantic = await collectSemanticDiffs(tileflow, report, options, root, temporary);
}

function summarizeScene(entry, noiseRatio) {
  const noise =
    entry.status === 'changed' &&
    entry.changeKind === 'pixels' &&
    entry.perceptual?.changedPixels === 0 &&
    (entry.exact?.ratio ?? 1) <= noiseRatio;
  return {
    scene: entry.scene,
    map: entry.map,
    status: entry.status,
    noise,
    exactPixels: entry.exact?.changedPixels ?? null,
    perceptualPixels: entry.perceptual?.changedPixels ?? null,
    totalPixels: entry.exact?.totalPixels ?? null,
    afterSha256: entry.actual?.sha256 ?? null,
    images: {before: false, after: false, diff: false, receipt: false},
  };
}

async function collectImages(scene, directories, options) {
  const target = (kind) => join(options.output, 'scenes', evidenceFile(scene.scene, kind));
  const name = scene.scene;
  if (!needsApproval(scene)) return;
  if (existsSync(join(directories.baselineDirectory, `${name}.png`))) {
    await copyFile(join(directories.baselineDirectory, `${name}.png`), target('before'));
    scene.images.before = true;
  }
  await copyFile(join(directories.proposalDirectory, `${name}.png`), target('after'));
  await copyFile(join(directories.proposalDirectory, `${name}.receipt.json`), target('receipt'));
  scene.images.after = true;
  scene.images.receipt = true;
  scene.afterSha256 = JSON.parse(
    await readFile(join(directories.proposalDirectory, `${name}.receipt.json`), 'utf8'),
  ).image.sha256;
  if (existsSync(join(directories.outputDirectory, `${name}.diff.png`))) {
    await copyFile(join(directories.outputDirectory, `${name}.diff.png`), target('diff'));
    scene.images.diff = true;
  }
}

/**
 * Compares the base and pull request configs. The base config comes from a detached worktree that
 * borrows the installed dependencies, so a dependency bump in the pull request applies to both.
 */
async function collectSemanticDiffs(tileflow, report, options, root, temporary) {
  const worktree = join(temporary, 'base');
  await git(root, ['worktree', 'add', '--quiet', '--detach', worktree, options.baseSha]);
  try {
    const project = relative(root, options.cwd);
    const baseProject = join(worktree, project);
    for (const directory of new Set([root, options.cwd])) {
      const borrowed = join(worktree, relative(root, directory), 'node_modules');
      if (existsSync(join(directory, 'node_modules')) && !existsSync(borrowed)) {
        await mkdir(dirname(borrowed), {recursive: true});
        await symlink(join(directory, 'node_modules'), borrowed);
      }
    }
    const baseConfig = join(baseProject, options.config);
    const results = [];
    for (const map of new Set(report.scenes.map((scene) => scene.map))) {
      if (!existsSync(baseConfig)) {
        results.push({map, message: 'The base branch has no matching config.', changes: []});
        continue;
      }
      const result = await runTileflow(tileflow, options.cwd, [
        'semantic-diff',
        '--from-config',
        baseConfig,
        '--to-config',
        options.config,
        '--from-map',
        map,
        '--to-map',
        map,
        '--json',
      ]);
      const document = parseJson(result.stdout);
      if (result.code !== 0 || !document?.diff) {
        results.push({map, message: 'The semantic diff is unavailable.', changes: []});
        continue;
      }
      results.push({
        map,
        total: document.diff.summary.total,
        changes: document.diff.changes.slice(0, limits.maximumChanges),
      });
    }
    return results;
  } finally {
    await git(root, ['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}

async function extractBaselines(root, baseSha, baselinePath, destination) {
  const prefix = `${baselinePath}/`;
  const names = (
    await git(root, ['ls-tree', '-r', '--name-only', baseSha, '--', prefix]).catch((error) => {
      throw new Error(
        `The base commit is not available. Check out with fetch-depth: 0. ${error.message}`,
      );
    })
  )
    .split('\n')
    .filter(Boolean);
  for (const name of names) {
    const file = name.slice(prefix.length);
    if (file.includes('/') || !/\.(?:png|receipt\.json)$/.test(file)) continue;
    const {stdout} = await execFile('git', ['show', `${baseSha}:${name}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    await writeFile(join(destination, file), stdout);
  }
}

async function install(options, root) {
  if (options.installCommand) {
    await run('bash', ['-c', options.installCommand], options.cwd);
    return;
  }
  for (let directory = options.cwd; ; directory = dirname(directory)) {
    const installer = lockfileInstallers.find(({file}) => existsSync(join(directory, file)));
    if (installer) {
      if (installer.corepack) await run('corepack', ['enable'], directory);
      await run(installer.command, installer.args, directory);
      return;
    }
    if (directory === root || directory === dirname(directory)) break;
  }
  throw new Error('No supported lockfile found. Commit one or set install-command.');
}

function findExecutable(cwd, root) {
  for (let directory = cwd; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', '.bin', 'tileflow');
    if (existsSync(candidate)) return candidate;
    if (directory === root || directory === dirname(directory)) break;
  }
  throw new Error('The tileflow CLI is not installed. Add it as an exact devDependency.');
}

/**
 * The pinned headless shell needs system libraries on a clean runner, and Ubuntu's AppArmor policy
 * blocks the user namespaces of its sandbox unless that exact binary is authorized.
 */
async function prepareBrowser(tileflow, cwd) {
  await run(tileflow, ['setup', 'capture'], cwd);
  if (process.platform !== 'linux' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') return;
  const playwright = findPlaywrightCli(tileflow);
  await run('sudo', [process.execPath, playwright, 'install-deps', 'chromium'], cwd);
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const shells = readdirSync(cache)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .map((name) => join(cache, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))
    .filter((path) => existsSync(path));
  if (!existsSync('/sys/kernel/security/apparmor') || shells.length === 0) return;
  const profile = [
    'abi <abi/4.0>,',
    'include <tunables/global>',
    ...shells.map(
      (path, index) =>
        `profile tileflow-chromium-${index} "${path}" flags=(unconfined) { userns, }`,
    ),
    '',
  ].join('\n');
  await run('sudo', ['chown', '-R', 'root:root', cache], cwd);
  await run('sudo', ['chmod', '-R', 'go-w', cache], cwd);
  const profilePath = '/etc/apparmor.d/tileflow-playwright-chromium';
  await run('sudo', ['tee', profilePath], cwd, profile);
  await run('sudo', ['apparmor_parser', '-r', profilePath], cwd);
}

function findPlaywrightCli(tileflow) {
  const capture = findPackage(dirname(realpathSync(tileflow)), '@tileflow/capture');
  return join(findPackage(capture, 'playwright'), 'cli.js');
}

function findPackage(from, name) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(candidate)) return realpathSync(candidate);
    if (directory === dirname(directory)) throw new Error(`Cannot locate ${name}.`);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function describeFailure(result) {
  const document = parseJson(result.stderr) ?? parseJson(result.stdout);
  const message = document?.diagnostics?.[0]?.message;
  return message ?? (result.stderr.trim().slice(-400) || `exit code ${result.code}`);
}

async function git(cwd, args) {
  return (await execFile('git', args, {cwd, maxBuffer: 16 * 1024 * 1024})).stdout;
}

function runTileflow(executable, cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}

function run(command, args, cwd, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} ${args[0] ?? ''} failed with exit code ${code}.`)),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}
