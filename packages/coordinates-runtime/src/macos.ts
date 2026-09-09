import {spawn} from 'node:child_process';

const commandTimeoutMs = 15_000;
const copyTimeoutMs = 15 * 60 * 1000;

const markDownloadedDmg = `
ObjC.import('Foundation');
const path = $.NSProcessInfo.processInfo.environment.objectForKey('TILEFLOW_COORDINATES_DMG_PATH');
const url = $.NSURL.fileURLWithPath(path);
const error = $();
const value = Ref();
if (!url.getResourceValueForKeyError(value, $.NSURLQuarantinePropertiesKey, error)) throw new Error('get failed');
const existing = ObjC.unwrap(value[0]);
if (existing) {
  // Preserve any existing quarantine dictionary, including opaque consent state.
} else {
  const properties = $.NSMutableDictionary.alloc.init;
  properties.setObjectForKey($('LSQuarantineTypeWebDownload'), $('LSQuarantineType'));
  properties.setObjectForKey($('Tileflow'), $('LSQuarantineAgentName'));
  if (!url.setResourceValueForKeyError(properties, $.NSURLQuarantinePropertiesKey, error)) throw new Error('set failed');
}
`;

class MacOSQuarantineError extends Error {
  constructor(readonly code: 'CANCELLED' | 'UNAVAILABLE') {
    super('macOS quarantine handling failed.');
    this.name = 'MacOSQuarantineError';
  }
}

export type MacOSQuarantineCommand = Readonly<{
  args: readonly string[];
  environment: Record<string, string>;
  file: string;
  signal: AbortSignal;
  timeoutMs: number;
}>;

export type MacOSQuarantineRunner = (command: MacOSQuarantineCommand) => Promise<void>;

export function createMacOSQuarantine(run: MacOSQuarantineRunner = runCommand) {
  return {
    copyOfflineDmg: (source: string, destination: string, signal: AbortSignal) =>
      command(
        run,
        '/usr/bin/ditto',
        ['--rsrc', '--extattr', '--qtn', source, destination],
        signal,
        copyTimeoutMs,
      ),
    ensureRemoteDmgQuarantine: (path: string, signal: AbortSignal) =>
      command(
        run,
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', markDownloadedDmg],
        signal,
        commandTimeoutMs,
        {TILEFLOW_COORDINATES_DMG_PATH: path},
      ),
  };
}

export const {copyOfflineDmg, ensureRemoteDmgQuarantine} = createMacOSQuarantine();

async function command(
  run: MacOSQuarantineRunner,
  file: string,
  args: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
  extraEnvironment: Record<string, string> = {},
) {
  if (signal.aborted) throw new MacOSQuarantineError('CANCELLED');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await run({
      args,
      environment: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', ...extraEnvironment},
      file,
      signal: controller.signal,
      timeoutMs,
    });
  } catch {
    throw new MacOSQuarantineError(signal.aborted ? 'CANCELLED' : 'UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function runCommand(command: MacOSQuarantineCommand) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {env: command.environment, stdio: 'ignore'});
    let settled = false;
    const finish = (error?: MacOSQuarantineError) => {
      if (settled) return;
      settled = true;
      command.signal.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else resolve();
    };
    const abort = () => finish(new MacOSQuarantineError('CANCELLED'));
    command.signal.addEventListener('abort', abort, {once: true});
    child.once('error', () => finish(new MacOSQuarantineError('UNAVAILABLE')));
    child.once('close', (code) =>
      code === 0 ? finish() : finish(new MacOSQuarantineError('UNAVAILABLE')),
    );
    if (command.signal.aborted) abort();
  });
}
