import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

/** CI exercises the freshly built executable; source mode keeps focused local tests convenient. */
export function cliFixtureArguments(args: string[]): string[] {
  const mode = process.env.TILEFLOW_TEST_CLI_MODE ?? 'source';
  if (mode === 'built') {
    return [fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url)), ...args];
  }
  if (mode !== 'source') throw new Error('TILEFLOW_TEST_CLI_MODE must be source or built.');

  return [
    '--import',
    pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
    fileURLToPath(new URL('../packages/cli/src/index.ts', import.meta.url)),
    ...args,
  ];
}
