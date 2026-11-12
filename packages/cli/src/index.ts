#!/usr/bin/env node

import {getCliVersion, isRootCliVersionRequest} from './cli-version';

if (isRootCliVersionRequest(process.argv.slice(2))) {
  process.stdout.write(`${getCliVersion()}\n`);
} else if (process.argv[2] === 'geocode') {
  const {createCliProgram} = await import('./cli-program');
  const {registerGeocodeCommand} = await import('./geocode-command');
  const program = createCliProgram();
  registerGeocodeCommand(program);
  try {
    await program.parseAsync();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Geocoding failed.');
    process.exitCode = 1;
  }
} else if (process.argv[2] === 'tileset') {
  const {runTilesetCli} = await import('./tileset-entry');
  await runTilesetCli();
} else {
  await import('./cli-main');
}
