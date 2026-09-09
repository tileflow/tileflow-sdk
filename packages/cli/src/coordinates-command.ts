import type {Command} from 'commander';
import {lstat, open} from 'node:fs/promises';
import {CoordinatesSetupError} from '@tileflow/coordinates-runtime';
import {
  type CoordinatesCommand,
  CoordinatesContractError,
  coordinatesFailureSchema,
  coordinatesLimits,
  parseCoordinatesJsonRequest,
  parseCoordinatesRequest,
} from '@tileflow/coordinates/contract';
import {installSignalAbortController} from './capture-command';

type SignalController = AbortController & {close(): void};

type LocalCoordinates = Readonly<{
  close(): Promise<void>;
  describe(request: unknown, options?: {signal?: AbortSignal}): Promise<unknown>;
  directory: string;
  operations(request: unknown, options?: {signal?: AbortSignal}): Promise<unknown>;
  provenance: unknown;
  releaseId: string;
  search(request: unknown, options?: {signal?: AbortSignal}): Promise<unknown>;
  transform(request: unknown, options?: {signal?: AbortSignal}): Promise<unknown>;
}>;

export type CoordinatesCommandDependencies = Readonly<{
  createLocalCoordinates(input: {
    allowDevelopment?: boolean;
    directory?: string;
    requiredReleaseId?: string;
    signal?: AbortSignal;
  }): Promise<LocalCoordinates>;
  setupCoordinates(input: {
    allowDevelopment?: boolean;
    cacheDirectory?: string;
    requiredReleaseId?: string;
    signal?: AbortSignal;
    source?: string;
  }): Promise<unknown>;
  createSignalController?: () => SignalController;
  readInput?: (input: string, signal: AbortSignal) => Promise<string>;
}>;

type RuntimeOptions = Readonly<{
  development?: boolean;
  release?: string;
  runtimeDir?: string;
}>;

type RequestOptions = RuntimeOptions &
  Readonly<{
    help?: boolean;
    input?: string;
    json?: boolean;
    request?: string;
  }>;

type SearchOptions = RequestOptions & Readonly<{query?: string}>;
type DescribeOptions = RequestOptions & Readonly<{id?: string}>;
type PairOptions = RequestOptions & Readonly<{from?: string; to?: string}>;
type TransformOptions = PairOptions & Readonly<{positions?: string}>;
type SetupOptions = Readonly<{
  archive?: string;
  cacheDir?: string;
  development?: boolean;
  help?: boolean;
  json?: boolean;
  release?: string;
  source?: string;
}>;

class CoordinatesInputError extends Error {
  constructor(readonly reason: 'INVALID_VALUE' | 'REQUEST_TOO_LARGE') {
    super('Coordinates input could not be read.');
  }
}

export function registerCoordinatesCommands(
  program: Command,
  dependencies: CoordinatesCommandDependencies,
): void {
  const setup =
    program.commands.find((command) => command.name() === 'setup') ??
    program.command('setup').description('Provision local Tileflow tooling');
  configureCommand(
    setup
      .command('coordinates')
      .description('Provision an offline Coordinates execution release')
      .option('--source <url-or-path>', 'distribution manifest URL or offline path')
      .option('--archive <path>', 'offline archive path alias')
      .option('--cache-dir <path>', 'Coordinates cache directory')
      .option('--release <release-id>', 'required Coordinates release identity')
      .option('--development', 'allow a development distribution')
      .option('--json', 'print one JSON receipt'),
  ).action(async (options: SetupOptions, command: Command) => {
    if (options.help) {
      printHelp(command, options.json, () => printSetupFailure());
      return;
    }
    if (
      command.args.length > 0 ||
      (options.source && options.archive) ||
      (options.archive && isRemoteLocation(options.archive))
    ) {
      printSetupFailure(new CoordinatesSetupError('COORDINATES_SETUP_INVALID_REQUEST'));
      return;
    }
    const controller = (dependencies.createSignalController ?? installSignalAbortController)();
    try {
      const receipt = await dependencies.setupCoordinates({
        source: options.archive ?? options.source,
        cacheDirectory: options.cacheDir,
        requiredReleaseId: options.release,
        allowDevelopment: options.development,
        signal: controller.signal,
      });
      printDocument(receipt);
    } catch (error) {
      printSetupFailure(error);
    } finally {
      controller.close();
    }
  });

  const coordinates = program
    .command('coordinates')
    .description('Inspect and execute Coordinates requests using a provisioned local release');
  configureCommand(coordinates).option('--json', 'print one JSON response');
  coordinates.action((options: {help?: boolean; json?: boolean}, command: Command) => {
    if (options.help) {
      printHelp(command, options.json, () =>
        printFailure(invalidRequest(null, 'INVALID_VALUE', {path: ['command']})),
      );
      return;
    }
    const reason = command.args.length === 0 ? 'INVALID_VALUE' : 'UNKNOWN_FIELD';
    printFailure(invalidRequest(null, reason, {path: ['command']}));
  });

  registerOperation(coordinates, 'search', dependencies, (options: SearchOptions) =>
    parseRequest('search', options, {query: options.query}),
  );
  registerOperation(coordinates, 'describe', dependencies, (options: DescribeOptions) =>
    parseRequest('describe', options, {id: options.id}),
  );
  registerOperation(coordinates, 'operations', dependencies, (options: PairOptions) =>
    parseRequest('operations', options, {from: options.from, to: options.to}),
  );
  registerOperation(coordinates, 'transform', dependencies, (options: TransformOptions) =>
    parseTransformRequest(options),
  );
}

function registerOperation(
  coordinates: Command,
  name: CoordinatesCommand,
  dependencies: CoordinatesCommandDependencies,
  parse: (options: RequestOptions) => unknown,
): void {
  const command = configureCommand(
    coordinates
      .command(name)
      .description(`Run the local Coordinates ${name} operation`)
      .option('--request <json>', 'complete JSON request')
      .option('--input <path-or-dash>', 'complete JSON request file, or - for standard input')
      .option('--runtime-dir <path>', 'prepared Coordinates runtime directory')
      .option('--release <release-id>', 'required Coordinates release identity')
      .option('--development', 'allow a development runtime')
      .option('--json', 'print one JSON response'),
  );
  if (name === 'search') command.option('--query <text>', 'search query');
  if (name === 'describe') command.option('--id <crs-id>', 'CRS identifier');
  if (name === 'operations' || name === 'transform') {
    command
      .option('--from <crs-id>', 'source CRS identifier')
      .option('--to <crs-id>', 'target CRS identifier');
  }
  if (name === 'transform') command.option('--positions <json>', 'JSON coordinate positions');

  command.action(async (options: RequestOptions, invoked: Command) => {
    const parent = invoked.parent?.opts() as RequestOptions | undefined;
    const wantsHelp = options.help ?? parent?.help;
    const wantsJson = options.json ?? parent?.json;
    if (wantsHelp) {
      printHelp(invoked, wantsJson, () =>
        printFailure(invalidRequest(name, 'INVALID_VALUE', {path: ['command']})),
      );
      return;
    }
    if (invoked.args.length > 0) {
      printFailure(invalidRequest(name, 'UNKNOWN_FIELD', {path: ['options']}));
      return;
    }
    const controller = (dependencies.createSignalController ?? installSignalAbortController)();
    let local: LocalCoordinates | undefined;
    try {
      const request = await resolveRequest(
        name,
        options,
        parse,
        dependencies.readInput,
        controller.signal,
      );
      local = await dependencies.createLocalCoordinates({
        directory: options.runtimeDir,
        requiredReleaseId: options.release,
        allowDevelopment: options.development,
        signal: controller.signal,
      });
      const response = await local[name](request, {signal: controller.signal});
      await local.close();
      local = undefined;
      printDocument(response);
    } catch (error) {
      printFailure(error, name);
    } finally {
      try {
        await local?.close();
      } catch {
        // A primary command failure was already serialized above.
      } finally {
        controller.close();
      }
    }
  });
}

function configureCommand(command: Command): Command {
  return command
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .option('-h, --help', 'display help');
}

async function resolveRequest(
  command: CoordinatesCommand,
  options: RequestOptions,
  parse: (options: RequestOptions) => unknown,
  readInput: (input: string, signal: AbortSignal) => Promise<string> = readCoordinatesInput,
  signal?: AbortSignal,
): Promise<unknown> {
  const rawRequest = options.request !== undefined || options.input !== undefined;
  if (
    (options.request !== undefined && options.input !== undefined) ||
    (rawRequest && hasConvenienceOptions(command, options))
  ) {
    throw invalidRequest(command, 'INVALID_VALUE', {path: ['request']});
  }
  if (options.request !== undefined) return parseCoordinatesJsonRequest(command, options.request);
  if (options.input !== undefined) {
    try {
      const input = await readInput(options.input, signal ?? new AbortController().signal);
      if (signal?.aborted) throw cancelledRequest(command);
      return parseCoordinatesJsonRequest(command, input);
    } catch (error) {
      if (signal?.aborted) throw cancelledRequest(command);
      if (error instanceof CoordinatesInputError) throw invalidRequest(command, error.reason);
      throw error;
    }
  }
  return parse(options);
}

function hasConvenienceOptions(command: CoordinatesCommand, options: RequestOptions): boolean {
  if (command === 'search') return (options as SearchOptions).query !== undefined;
  if (command === 'describe') return (options as DescribeOptions).id !== undefined;
  if (command === 'operations') {
    const pair = options as PairOptions;
    return pair.from !== undefined || pair.to !== undefined;
  }
  const transform = options as TransformOptions;
  return (
    transform.from !== undefined || transform.to !== undefined || transform.positions !== undefined
  );
}

function parseRequest(
  command: CoordinatesCommand,
  options: RequestOptions,
  request: Record<string, unknown>,
): unknown {
  return parseCoordinatesRequest(command, request);
}

function parseTransformRequest(options: TransformOptions): unknown {
  let positions: unknown;
  try {
    positions = options.positions === undefined ? undefined : JSON.parse(options.positions);
  } catch {
    throw invalidRequest('transform', 'INVALID_JSON');
  }
  return parseCoordinatesRequest('transform', {from: options.from, to: options.to, positions});
}

async function readCoordinatesInput(input: string, signal: AbortSignal): Promise<string> {
  if (input === '-') return readStandardInput(signal);
  assertNotAborted(signal);
  let info;
  try {
    info = await lstat(input);
  } catch {
    throw new CoordinatesInputError('INVALID_VALUE');
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new CoordinatesInputError('INVALID_VALUE');
  if (info.size > coordinatesLimits.maximumRequestBytes) {
    throw new CoordinatesInputError('REQUEST_TOO_LARGE');
  }
  const handle = await open(input, 'r');
  try {
    let length = 0;
    const bytes = Buffer.alloc(coordinatesLimits.maximumRequestBytes + 1);
    while (length < bytes.length) {
      assertNotAborted(signal);
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assertNotAborted(signal);
    if (length > coordinatesLimits.maximumRequestBytes) {
      throw new CoordinatesInputError('REQUEST_TOO_LARGE');
    }
    return decodeInput(bytes.subarray(0, length));
  } finally {
    await handle.close();
  }
}

async function readStandardInput(signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  return new Promise<string>((resolve, reject) => {
    const finish = (result: () => void) => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      result();
    };
    const onAbort = () => {
      process.stdin.pause();
      finish(() => reject(new CoordinatesInputError('INVALID_VALUE')));
    };
    const onData = (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > coordinatesLimits.maximumRequestBytes) {
        process.stdin.pause();
        finish(() => reject(new CoordinatesInputError('REQUEST_TOO_LARGE')));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish(() => resolve(decodeInput(Buffer.concat(chunks))));
    const onError = () => finish(() => reject(new CoordinatesInputError('INVALID_VALUE')));
    if (signal.aborted) {
      onAbort();
      return;
    }
    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    signal.addEventListener('abort', onAbort, {once: true});
    process.stdin.resume();
  });
}

function invalidRequest(
  command: CoordinatesCommand | null,
  reason: 'INVALID_JSON' | 'INVALID_VALUE' | 'UNKNOWN_FIELD' | 'REQUEST_TOO_LARGE',
  details: Record<string, unknown> = {},
): CoordinatesContractError {
  return new CoordinatesContractError({
    schemaVersion: 1,
    ok: false,
    command,
    releaseId: null,
    provenance: null,
    warnings: [],
    usage: null,
    error: {code: 'COORDINATES_INVALID_REQUEST', reason, details, phase: 'input'},
  });
}

function cancelledRequest(command: CoordinatesCommand): CoordinatesContractError {
  return new CoordinatesContractError({
    schemaVersion: 1,
    ok: false,
    command,
    releaseId: null,
    provenance: null,
    warnings: [],
    usage: null,
    error: {code: 'COORDINATES_CANCELLED', reason: 'CANCELLED', details: {}, phase: 'input'},
  });
}

function printDocument(document: unknown): void {
  process.stdout.write(`${JSON.stringify(document)}\n`);
}

function printFailure(error: unknown, command?: CoordinatesCommand): void {
  const document =
    serializeCoordinatesFailure(error, command) ??
    (command ? invalidRequest(command, 'INVALID_VALUE').toJSON() : setupFailureDocument());
  process.stderr.write(`${JSON.stringify(document)}\n`);
  process.exitCode = 1;
}

function printSetupFailure(error?: unknown): void {
  process.stderr.write(
    `${JSON.stringify(serializeSetupFailure(error) ?? setupFailureDocument())}\n`,
  );
  process.exitCode = 1;
}

function serializeCoordinatesFailure(
  error: unknown,
  command?: CoordinatesCommand,
): unknown | undefined {
  if (!(error instanceof CoordinatesContractError)) return undefined;
  const parsed = coordinatesFailureSchema.safeParse(error.toJSON());
  if (!parsed.success) return undefined;
  const failure = parsed.data;
  return new CoordinatesContractError({
    ...failure,
    command: failure.command ?? command ?? null,
  }).toJSON();
}

function serializeSetupFailure(error: unknown): unknown | undefined {
  if (!(error instanceof CoordinatesSetupError)) return undefined;
  const codes = new Set([
    'COORDINATES_SETUP_INVALID_REQUEST',
    'COORDINATES_SETUP_RELEASE_UNAVAILABLE',
    'COORDINATES_SETUP_MANIFEST_INVALID',
    'COORDINATES_SETUP_ARTIFACT_UNAVAILABLE',
    'COORDINATES_SETUP_INTEGRITY_FAILED',
    'COORDINATES_SETUP_INSTALLATION_FAILED',
    'COORDINATES_SETUP_CANCELLED',
    'COORDINATES_SETUP_TIMEOUT',
  ]);
  if (!codes.has(error.code)) return undefined;
  return new CoordinatesSetupError(error.code, error.releaseId, error.assetId).toJSON();
}

function setupFailureDocument(): unknown {
  return new CoordinatesSetupError('COORDINATES_SETUP_INVALID_REQUEST').toJSON();
}

function printHelp(command: Command, json: boolean | undefined, printJson: () => void): void {
  if (json) {
    printJson();
    return;
  }
  command.outputHelp();
}

function isRemoteLocation(input: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(input);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CoordinatesInputError('INVALID_VALUE');
}

function decodeInput(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new CoordinatesInputError('INVALID_VALUE');
  }
}
