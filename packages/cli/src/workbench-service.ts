import type {Command} from 'commander';
import {opendir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {
  compareTileflowCapturesForReview,
  createTileflowCaptureSession,
  createTileflowVisualReviewDocument,
  type TileflowCaptureSession,
} from '@tileflow/capture';
import {tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema} from '@tileflow/core';
import {resolveTileflowPreview} from '@tileflow/dev/preview';
import type {TileflowArtifactSession} from '@tileflow/dev/server';
import {
  captureRecordDirectory,
  deleteCaptureRecord,
  readCaptureRecord,
  saveCaptureRecord,
} from './capture-record';

const prefix = '/__workbench';
const captureInput = z
  .object({
    side: z.enum(['left', 'right']).default('left'),
    generation: z.number().int().nonnegative(),
    name: tileflowCaptureSceneNameSchema,
    definition: tileflowCaptureSceneSchema,
  })
  .strict();
const compareInput = z
  .object({before: z.string().regex(/^[a-f0-9]{64}$/u), after: z.string().regex(/^[a-f0-9]{64}$/u)})
  .strict();
const deleteInput = z.object({id: z.string().regex(/^[a-f0-9]{64}$/u)}).strict();
const contextInput = z
  .object({
    client: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/u),
    side: z.enum(['left', 'right']),
    generation: z.number().int(),
    context: z.record(z.string(), z.unknown()),
  })
  .strict();

type WorkbenchSide = {session: TileflowArtifactSession; basePath: string; config?: string};
type Options = {
  origin: string;
  cwd: string;
  sides: {left: WorkbenchSide; right?: WorkbenchSide};
  /** Allows tests and embedders to reuse an explicitly managed capture session. */
  captureSession?: TileflowCaptureSession;
};

/** Local adapter over the same pinned artifacts, saved records and review engine as the CLI. */
export function createWorkbenchService(options: Options) {
  const directory = resolve(options.cwd, captureRecordDirectory);
  const contexts = new Map<
    string,
    {
      side: 'left' | 'right';
      generation: number;
      context: Record<string, unknown>;
      updatedAt: string;
    }
  >();
  let captureSession: TileflowCaptureSession | undefined = options.captureSession;
  let pending: Promise<Response> | undefined;
  let closed = false;

  function catalog() {
    return Object.fromEntries(
      Object.entries(options.sides).map(([id, side]) => {
        const state = side.session.getState();
        const artifacts = side.session.getLastGoodArtifacts();
        const selections: Array<Record<string, unknown>> = [];
        if (artifacts) {
          for (const [map, themes] of Object.entries(artifacts.styles)) {
            for (const theme of Object.keys(themes)) {
              const preview = resolveTileflowPreview(artifacts.project, {map, theme});
              selections.push({
                id: `map:${map}:${theme}`,
                label: `${map} · ${theme}`,
                map,
                theme,
                url: `${side.basePath}/?${new URLSearchParams({map, theme})}`,
                camera: preview.camera,
              });
            }
          }
          for (const name of Object.keys(artifacts.project.scenes ?? {})) {
            try {
              const preview = resolveTileflowPreview(artifacts.project, {scene: name});
              selections.push({
                id: `scene:${name}`,
                label: name,
                scene: name,
                map: preview.mapName,
                theme: preview.themeName,
                camera: preview.camera,
                viewport: preview.viewport,
                url: `${side.basePath}/?${new URLSearchParams({scene: name})}`,
              });
            } catch {
              /* Application scenes are reviewed in their application's dev server. */
            }
          }
        }
        return [
          id,
          {
            config: side.config,
            status: state.status,
            generation: state.generation,
            lastGoodGeneration: state.lastGoodGeneration,
            diagnostics: state.status === 'invalid' ? state.diagnostics : [],
            selections,
          },
        ];
      }),
    );
  }

  async function history(offset: number) {
    const entries: Array<{id: string; modified: number}> = [];
    let scanned = 0;
    let truncated = false;
    try {
      const files = await opendir(directory);
      for await (const entry of files) {
        if (++scanned > 5000) {
          truncated = true;
          break;
        }
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
        const info = await stat(resolve(directory, entry.name));
        entries.push({id: entry.name.slice(0, -5), modified: info.mtimeMs});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    entries.sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id));
    const records = [];
    const warnings: string[] = [];
    for (const entry of entries.slice(offset, offset + 20)) {
      try {
        const record = await readCaptureRecord(entry.id, directory);
        records.push({
          id: entry.id,
          scene: record.capture.scene,
          map: record.capture.map,
          theme: record.capture.theme,
          definition: record.definition,
          styleSha256: record.capture.styleSha256,
          warnings: record.capture.warnings,
          savedAt: new Date(entry.modified).toISOString(),
          imageUrl: `${prefix}/captures/${entry.id}.png`,
        });
      } catch {
        warnings.push(`Capture ${entry.id.slice(0, 12)} could not be verified.`);
      }
    }
    return {records, warnings, truncated, next: offset + 20 < entries.length ? offset + 20 : null};
  }

  async function action(path: string, input: unknown): Promise<Response> {
    if (path === '/captures/delete') {
      const {id} = deleteInput.parse(input);
      await deleteCaptureRecord(id, options.cwd);
      return json({deleted: id});
    }
    if (path === '/capture') {
      const {side: id, generation, name, definition} = captureInput.parse(input);
      if (definition.target?.kind === 'application')
        throw new Error('Map DevTools captures require a map scene.');
      const side = options.sides[id];
      if (!side) throw new Error('Unknown Map DevTools side.');
      const state = side.session.getState();
      if (state.status !== 'ready' || state.generation !== generation)
        return json(
          {
            code: 'STALE_GENERATION',
            message:
              'The map changed or is invalid. Wait for the current preview and capture again.',
          },
          409,
        );
      const acquired = side.session.acquireArtifacts(generation);
      if (!acquired)
        return json(
          {code: 'STALE_GENERATION', message: 'This map revision is no longer available.'},
          409,
        );
      try {
        captureSession ??= createTileflowCaptureSession({cwd: options.cwd});
        const result = await captureSession.captureArtifacts(
          {
            ...acquired.artifacts,
            project: {...acquired.artifacts.project, scenes: {[name]: definition}},
          },
          [name],
        );
        const capture = result.captures[0]!;
        const id = await saveCaptureRecord(capture, options.cwd);
        return json({
          captureId: id,
          generation,
          definition: capture.definition,
          warnings: capture.warnings,
        });
      } finally {
        await acquired.release();
      }
    }
    const {before, after} = compareInput.parse(input);
    const [left, right] = await Promise.all([
      readCaptureRecord(before, directory),
      readCaptureRecord(after, directory),
    ]);
    const result = await compareTileflowCapturesForReview(left, right, {includeDiff: true});
    return json({
      before,
      after,
      reused: true,
      review: createTileflowVisualReviewDocument(result),
      diff: result.diffPng
        ? `data:image/png;base64,${Buffer.from(result.diffPng).toString('base64')}`
        : null,
    });
  }

  return {
    url: prefix,
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (
        url.origin !== options.origin ||
        (request.headers.has('origin') && request.headers.get('origin') !== options.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        return json(
          {code: 'ORIGIN_MISMATCH', message: 'Use Map DevTools from its local origin.'},
          403,
        );
      if (closed) return json({code: 'SESSION_CLOSED', message: 'Map DevTools has stopped.'}, 503);
      const path = url.pathname.slice(prefix.length);
      try {
        if (request.method === 'GET') {
          if (path === '' || path === '/')
            return json({
              capabilities: [
                'catalog',
                'capture',
                'history',
                'delete-capture',
                'compare',
                'context',
              ],
              busy: Boolean(pending),
              sides: catalog(),
              endpoints: {
                context: `${prefix}/context`,
                captures: `${prefix}/captures`,
                capture: `${prefix}/capture`,
                deleteCapture: `${prefix}/captures/delete`,
                compare: `${prefix}/compare`,
              },
            });
          if (path === '/context') {
            const now = Date.now();
            for (const [key, value] of contexts)
              if (now - Date.parse(value.updatedAt) > 600_000) contexts.delete(key);
            return json({
              source: 'browser-observation',
              contexts: [...contexts.entries()].map(([client, value]) => ({
                client,
                ...value,
                stale:
                  options.sides[value.side]?.session.getState().status !== 'ready' ||
                  options.sides[value.side]?.session.getState().generation !== value.generation ||
                  value.context.displayedGeneration !== value.generation,
              })),
              sides: catalog(),
            });
          }
          if (path === '/captures') {
            const offset = z.coerce
              .number()
              .int()
              .min(0)
              .max(5000)
              .parse(url.searchParams.get('offset') ?? 0);
            return json(await history(offset));
          }
          const image = /^\/captures\/([a-f0-9]{64})\.png$/u.exec(path);
          if (image) {
            const record = await readCaptureRecord(image[1]!, directory);
            return new Response(Buffer.from(record.capture.png), {
              headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
          return json({code: 'NOT_FOUND', message: 'Unknown Map DevTools endpoint.'}, 404);
        }
        if (request.method !== 'POST')
          return json({code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST.'}, 405);
        if (
          request.headers.get('x-tileflow-workbench') !== '1' ||
          request.headers.get('content-type')?.split(';')[0] !== 'application/json'
        )
          return json(
            {code: 'INVALID_REQUEST', message: 'Send JSON with X-Tileflow-Workbench: 1.'},
            400,
          );
        const body = await readBody(request);
        if (path === '/context') {
          const {client, ...value} = contextInput.parse(body);
          if (!options.sides[value.side]) throw new Error('Unknown Map DevTools side.');
          contexts.delete(client);
          contexts.set(client, {...value, updatedAt: new Date().toISOString()});
          if (contexts.size > 8) contexts.delete(contexts.keys().next().value!);
          return json({saved: true});
        }
        if (path !== '/capture' && path !== '/compare' && path !== '/captures/delete')
          return json({code: 'NOT_FOUND', message: 'Unknown Map DevTools action.'}, 404);
        if (pending)
          return json(
            {
              code: 'WORKBENCH_BUSY',
              message: 'A capture operation is already running. Try again when it finishes.',
            },
            409,
          );
        pending = action(path, body);
        try {
          return await pending;
        } finally {
          pending = undefined;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Map DevTools operation failed.';
        return json({code: 'WORKBENCH_OPERATION_FAILED', message: message.slice(0, 1500)}, 400);
      }
    },
    async close() {
      closed = true;
      await pending?.catch(() => {});
      await captureSession?.close();
    },
  };
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing JSON body.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) {
        await reader.cancel();
        throw new Error('Map DevTools request exceeds 64 KiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(value: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({schemaVersion: 1, ...value}), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function registerWorkbenchInspection(inspect: Command) {
  inspect
    .command('session')
    .description('Read the active local Map DevTools context and capabilities')
    .option('--url <origin>', 'local Map DevTools origin', 'http://127.0.0.1:3333')
    .option('--json', 'print the versioned context document')
    .action(async (options: {url: string; json?: boolean}) => {
      try {
        const url = new URL(options.url);
        if (
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.protocol !== 'http:' ||
          url.username ||
          url.password
        )
          throw new Error('--url must identify a local Map DevTools HTTP server.');
        const response = await fetch(new URL(`${prefix}/context`, url.origin), {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Map DevTools returned HTTP ${response.status}.`);
        const document = await response.json();
        console.log(
          JSON.stringify(
            {schemaVersion: 1, command: 'inspect.session', ...document},
            null,
            options.json ? undefined : 2,
          ),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            schemaVersion: 1,
            command: 'inspect.session',
            code: 'WORKBENCH_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        process.exitCode = 1;
      }
    });
}
