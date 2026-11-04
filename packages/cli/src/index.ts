#!/usr/bin/env node

import {getCliVersion, isRootCliVersionRequest} from './cli-version';

if (isRootCliVersionRequest(process.argv.slice(2))) {
  process.stdout.write(`${getCliVersion()}\n`);
} else if (process.argv[2] === 'tileset') {
  const {runTilesetCli} = await import('./tileset-entry');
  await runTilesetCli();
} else {
  await import('./cli-main');
}
