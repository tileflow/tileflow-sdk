import pc from 'picocolors';
import {defaultTileflowApiUrl} from '@tileflow/dev/config';
import {loadAuthConfig} from './account-session';
import {createCliProgram} from './cli-program';
import {registerTilesetCommands} from './tileset-command';

export async function runTilesetCli(): Promise<void> {
  const program = createCliProgram();
  registerTilesetCommands(program, {defaultApiUrl: defaultTileflowApiUrl, loadAuthConfig});

  try {
    await program.parseAsync();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Command failed.';
    console.error(`${pc.red('Error:')} ${message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
