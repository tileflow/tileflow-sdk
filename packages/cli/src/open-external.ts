import {spawn as spawnChild, type ChildProcess} from 'node:child_process';
import {platform as hostPlatform} from 'node:os';

type OpenExternalChild = Pick<ChildProcess, 'once' | 'unref'>;

export type OpenExternalDependencies = {
  onError?: (error: unknown) => void;
  platform?: NodeJS.Platform;
  spawn?: (
    command: string,
    args: readonly string[],
    options: {
      detached: true;
      shell: false;
      stdio: 'ignore';
      windowsHide: true;
    },
  ) => OpenExternalChild;
};

/** Open one local artifact or URL without passing attacker-controlled text through a shell. */
export function openTileflowExternal(
  target: string,
  dependencies: OpenExternalDependencies = {},
): void {
  const invocation = resolveTileflowExternalOpenInvocation(
    target,
    dependencies.platform ?? hostPlatform(),
  );
  const spawn = dependencies.spawn ?? spawnChild;
  let child: OpenExternalChild;
  try {
    child = spawn(invocation.command, invocation.args, {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    dependencies.onError?.(error);
    return;
  }
  child.once('error', (error) => dependencies.onError?.(error));
  child.unref();
}

export function resolveTileflowExternalOpenInvocation(
  target: string,
  platform: NodeJS.Platform,
): {args: string[]; command: string} {
  if (!target || target.includes('\0')) throw new Error('The external target is invalid.');
  if (platform === 'darwin') return {command: 'open', args: [target]};
  if (platform === 'win32') return {command: 'explorer.exe', args: [target]};
  return {command: 'xdg-open', args: [target]};
}
