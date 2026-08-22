import {type FSWatcher, watch} from 'chokidar';
import {realpathSync} from 'node:fs';
import {dirname, extname, isAbsolute, relative, resolve, sep, win32} from 'node:path';
import {sanitizeDiagnosticSecrets} from './diagnostic-sanitization';
import type {TileflowBuildArtifacts, TileflowBuildArtifactsOptions} from './index';

export const tileflowArtifactSessionSchemaVersion = 1 as const;

export type TileflowArtifactDiagnostic = {
  code?: string;
  message: string;
  path: string;
  phase?: string;
};

export type TileflowArtifactSessionState =
  | {
      status: 'building';
      generation: number;
      lastGoodGeneration?: number;
    }
  | {
      status: 'ready';
      generation: number;
      artifacts: TileflowBuildArtifacts;
      lastGoodGeneration: number;
    }
  | {
      status: 'invalid';
      generation: number;
      diagnostics: TileflowArtifactDiagnostic[];
      lastGoodGeneration?: number;
    };

export type TileflowArtifactSessionOptions = TileflowBuildArtifactsOptions & {
  debounceMs?: number;
  ignoredPaths?: string[];
  watch?: boolean;
};

export type TileflowArtifactSession = {
  close(): Promise<void>;
  getLastGoodArtifacts(): TileflowBuildArtifacts | undefined;
  getState(): TileflowArtifactSessionState;
  refresh(reason?: string): Promise<void>;
  subscribe(listener: (state: TileflowArtifactSessionState) => void): () => void;
};

type BuildArtifacts = (options: TileflowBuildArtifactsOptions) => Promise<TileflowBuildArtifacts>;

const configExtensions = new Set(['.cjs', '.cts', '.js', '.json', '.mjs', '.mts', '.ts', '.tsx']);
const iconExtensions = new Set(['.jpeg', '.jpg', '.png', '.svg', '.webp']);
const excludedDirectories = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.svn',
  '.svelte-kit',
  '.tileflow',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

export async function createTileflowArtifactSessionWithBuilder(
  options: TileflowArtifactSessionOptions,
  buildArtifacts: BuildArtifacts,
): Promise<TileflowArtifactSession> {
  const session = new TileflowArtifactSessionImpl(options, buildArtifacts);
  await session.start();
  return session;
}

class TileflowArtifactSessionImpl implements TileflowArtifactSession {
  readonly #buildArtifacts: BuildArtifacts;
  readonly #buildOptions: TileflowBuildArtifactsOptions;
  readonly #configPath: string;
  readonly #cwd: string;
  readonly #debounceMs: number;
  readonly #listeners = new Set<(state: TileflowArtifactSessionState) => void>();
  readonly #ignoredPaths: string[];
  readonly #watchEnabled: boolean;
  #closed = false;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  #lastGoodArtifacts: TileflowBuildArtifacts | undefined;
  #lastGoodGeneration: number | undefined;
  #refreshToken = 0;
  #state: TileflowArtifactSessionState = {generation: 0, status: 'building'};
  #watcher: FSWatcher | undefined;
  #watchedArtifactPaths = new Set<string>();

  constructor(options: TileflowArtifactSessionOptions, buildArtifacts: BuildArtifacts) {
    this.#cwd = resolve(options.cwd ?? process.cwd());
    this.#configPath = resolve(this.#cwd, options.config ?? 'tileflow.config.ts');
    this.#debounceMs = Math.max(0, Math.min(options.debounceMs ?? 75, 1_000));
    this.#watchEnabled = options.watch ?? false;
    this.#ignoredPaths = (options.ignoredPaths ?? []).map((path) => resolve(this.#cwd, path));
    this.#buildArtifacts = buildArtifacts;
    this.#buildOptions = {
      apiBaseUrl: options.apiBaseUrl,
      assetBaseUrl: options.assetBaseUrl,
      config: options.config,
      cwd: this.#cwd,
      styleBaseUrl: options.styleBaseUrl,
      worldGeneration: options.worldGeneration,
    };
  }

  async start(): Promise<void> {
    if (this.#watchEnabled) {
      this.#watcher = watch(dirname(this.#configPath), {
        awaitWriteFinish: {pollInterval: 20, stabilityThreshold: 50},
        followSymlinks: false,
        ignoreInitial: true,
        ignored: (path, stats) => this.#ignoreWatchPath(path, stats?.isDirectory()),
        usePolling: process.platform === 'win32',
      });
      const watcherReady = new Promise<void>((resolveReady, rejectReady) => {
        const watcher = this.#watcher!;
        const cleanup = () => {
          watcher.off('ready', onReady);
          watcher.off('error', onError);
        };
        const onReady = () => {
          cleanup();
          resolveReady();
        };
        const onError = (error: unknown) => {
          cleanup();
          rejectReady(error);
        };
        watcher.once('ready', onReady);
        watcher.once('error', onError);
      });
      this.#watcher.on('all', (event, path) => {
        if (event === 'addDir' || event === 'unlinkDir') return;
        if (!this.#shouldRefreshForWatchEvent(path)) return;
        this.#scheduleRefresh(path);
      });
      this.#watcher.on('error', (error) => {
        if (this.#closed) return;
        this.#refreshToken += 1;
        this.#publishInvalid(this.#generation + 1, error);
      });
      await watcherReady;
    }

    await this.refresh('initial');
  }

  getState(): TileflowArtifactSessionState {
    return this.#state;
  }

  getLastGoodArtifacts(): TileflowBuildArtifacts | undefined {
    return this.#lastGoodArtifacts;
  }

  subscribe(listener: (state: TileflowArtifactSessionState) => void): () => void {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(_reason = 'manual'): Promise<void> {
    if (this.#closed) return;

    const generation = ++this.#generation;
    const token = ++this.#refreshToken;
    this.#publish({
      generation,
      status: 'building',
      ...(this.#lastGoodGeneration === undefined
        ? {}
        : {lastGoodGeneration: this.#lastGoodGeneration}),
    });

    try {
      const artifacts = await this.#buildArtifacts(this.#buildOptions);
      if (this.#closed || token !== this.#refreshToken) return;

      this.#lastGoodArtifacts = artifacts;
      this.#lastGoodGeneration = generation;
      this.#updateArtifactWatchPaths(artifacts.watchPaths);
      this.#publish({
        artifacts,
        generation,
        lastGoodGeneration: generation,
        status: 'ready',
      });
    } catch (error) {
      if (this.#closed || token !== this.#refreshToken) return;
      this.#publishInvalid(generation, error);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#refreshToken += 1;
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#listeners.clear();
    await this.#watcher?.close();
  }

  #ignoreWatchPath(path: string, isDirectory: boolean | undefined): boolean {
    const resolvedPath = resolve(path);
    const relativePath = relative(dirname(this.#configPath), resolvedPath);
    const segments = relativePath.split(sep).filter(Boolean);

    if (this.#ignoredPaths.some((path) => isSameOrInside(path, resolvedPath))) return true;
    if (segments.some((segment) => excludedDirectories.has(segment))) return true;
    if (isDirectory !== false) return false;
    if (resolvedPath === this.#configPath || this.#watchedArtifactPaths.has(resolvedPath))
      return false;

    const extension = extname(resolvedPath).toLowerCase();
    if (configExtensions.has(extension)) return false;
    if (iconExtensions.has(extension)) return false;
    return true;
  }

  #shouldRefreshForWatchEvent(path: string): boolean {
    const resolvedPath = resolve(path);
    if (!iconExtensions.has(extname(resolvedPath).toLowerCase())) return true;
    return [...this.#watchedArtifactPaths].some((path) => isSameOrInside(path, resolvedPath));
  }

  #publish(state: TileflowArtifactSessionState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }

  #publishInvalid(generation: number, error: unknown): void {
    this.#generation = Math.max(this.#generation, generation);
    this.#publish({
      diagnostics: createTileflowArtifactDiagnostics(error, this.#cwd),
      generation,
      status: 'invalid',
      ...(this.#lastGoodGeneration === undefined
        ? {}
        : {lastGoodGeneration: this.#lastGoodGeneration}),
    });
  }

  #scheduleRefresh(_path: string): void {
    if (this.#closed) return;
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      void this.refresh('filesystem');
    }, this.#debounceMs);
  }

  #updateArtifactWatchPaths(paths: readonly string[]): void {
    if (!this.#watcher) return;
    const next = new Set(paths.map((path) => resolve(this.#cwd, path)));
    const previous = this.#watchedArtifactPaths;
    this.#watchedArtifactPaths = next;

    for (const path of previous) {
      if (!next.has(path) && !isSameOrInside(dirname(this.#configPath), path)) {
        void this.#watcher.unwatch(path);
      }
    }
    for (const path of next) {
      if (!previous.has(path) && !isSameOrInside(dirname(this.#configPath), path)) {
        this.#watcher.add(path);
      }
    }
  }
}

function isSameOrInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

export function createTileflowArtifactDiagnostics(
  error: unknown,
  cwd: string,
): TileflowArtifactDiagnostic[] {
  const inheritedCode = optionalDiagnosticField(error, 'code');
  const inheritedPhase =
    optionalDiagnosticField(error, 'phase') ?? optionalNestedDiagnosticField(error, 'phase');
  const issueList = getIssueList(error);
  if (issueList.length > 0) {
    return normalizeDiagnostics(
      issueList.map((issue) => ({
        ...((issue.code ?? inheritedCode) ? {code: issue.code ?? inheritedCode} : {}),
        message: sanitizeMessage(issue.message, cwd),
        path: sanitizePath(issue.path, cwd),
        ...((issue.phase ?? inheritedPhase) ? {phase: issue.phase ?? inheritedPhase} : {}),
      })),
    );
  }

  return normalizeDiagnostics([
    {
      ...(inheritedCode ? {code: inheritedCode} : {}),
      message: sanitizeMessage(error instanceof Error ? error.message : 'Unknown build error', cwd),
      path: '',
      ...(inheritedPhase ? {phase: inheritedPhase} : {}),
    },
  ]);
}

function getIssueList(
  error: unknown,
): Array<{code?: string; message: string; path: string; phase?: string}> {
  if (!error || typeof error !== 'object') return [];
  const containers: unknown[][] = [];
  for (const key of ['messages', 'issues'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (Array.isArray(value)) containers.push(value);
  }
  const details = (error as Record<string, unknown>).details;
  if (details && typeof details === 'object') {
    const diagnostics = (details as Record<string, unknown>).diagnostics;
    if (Array.isArray(diagnostics)) containers.push(diagnostics);
  }

  return containers.flatMap((value) =>
    value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const message = (entry as Record<string, unknown>).message;
      const path = (entry as Record<string, unknown>).path;
      const code = optionalDiagnosticField(entry, 'code');
      const phase = optionalDiagnosticField(entry, 'phase');
      return typeof message === 'string'
        ? [
            {
              ...(code ? {code} : {}),
              message,
              path: typeof path === 'string' ? path : '',
              ...(phase ? {phase} : {}),
            },
          ]
        : [];
    }),
  );
}

function sanitizeMessage(value: string, cwd: string): string {
  let sanitized = value;
  for (const root of localPathAliases(cwd)) sanitized = sanitized.replaceAll(root, '.');
  sanitized = sanitized.replace(/[\r\n]+/g, ' ').trim();
  sanitized = sanitized.replace(/https?:\/\/[^\s'")<>]+/gi, (url) => {
    try {
      return new URL(url.replace(/[),.;]+$/, '')).origin;
    } catch {
      return '(resource URL)';
    }
  });
  sanitized = sanitized.replace(/(^|[\s'"(])[A-Za-z]:[\\/][^\s'")]+/g, '$1(external path)');
  sanitized = sanitized.replace(/(^|[\s'"(])(?:\\\\|\/\/)[^\s'")]+/g, '$1(external path)');
  sanitized = sanitized.replace(/(^|[\s'"(])\/[^\s'")]+/g, '$1(external path)');
  return sanitizeDiagnosticSecrets(sanitized);
}

function sanitizePath(value: string, cwd: string): string {
  if (!value) return '';
  if (win32.isAbsolute(value) && !isAbsolute(value)) return '(external)';
  if (!isAbsolute(value)) return value.replaceAll('\\', '/');
  const local = relative(canonicalPath(cwd), canonicalPath(value)).replaceAll(sep, '/');
  return local.startsWith('../') || local === '..' ? '(external)' : local || '.';
}

function localPathAliases(path: string): string[] {
  return [...new Set([resolve(path), canonicalPath(path)])].sort(
    (left, right) => right.length - left.length,
  );
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}

function normalizeDiagnostics(
  diagnostics: readonly TileflowArtifactDiagnostic[],
): TileflowArtifactDiagnostic[] {
  const bounded = diagnostics.map((diagnostic) => ({
    ...(diagnostic.code ? {code: boundDiagnosticField(diagnostic.code)} : {}),
    message: boundDiagnosticText(diagnostic.message, 300),
    path: boundDiagnosticText(diagnostic.path, 300),
    ...(diagnostic.phase ? {phase: boundDiagnosticField(diagnostic.phase)} : {}),
  }));
  bounded.sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.message}\u0000${left.code ?? ''}\u0000${left.phase ?? ''}`;
    const rightKey = `${right.path}\u0000${right.message}\u0000${right.code ?? ''}\u0000${right.phase ?? ''}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  return bounded
    .filter(
      (diagnostic, index) =>
        index === 0 || JSON.stringify(diagnostic) !== JSON.stringify(bounded[index - 1]),
    )
    .slice(0, 32);
}

function optionalDiagnosticField(value: unknown, key: 'code' | 'phase'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? boundDiagnosticField(field) : undefined;
}

function optionalNestedDiagnosticField(value: unknown, key: 'code' | 'phase'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return optionalDiagnosticField((value as Record<string, unknown>).details, key);
}

function boundDiagnosticField(value: string): string {
  return boundDiagnosticText(value.replace(/[^A-Za-z0-9_-]/g, ''), 64);
}

function boundDiagnosticText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
