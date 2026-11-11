// Compiles one map into a directory. `@tileflow/next/server` runs this in a child process while
// Next.js builds the application; it is not a public entry point.
import {
  type TileflowIconResolutionOptions,
  writeTileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';

type Payload = {
  apiBaseUrl?: string;
  assetBaseUrl: string;
  config: string;
  cwd: string;
  icons?: TileflowIconResolutionOptions;
  outDir: string;
  styleBaseUrl: string;
};

try {
  const payload = JSON.parse(process.argv[2] ?? '') as Payload;
  await writeTileflowBuildArtifacts({
    apiBaseUrl: payload.apiBaseUrl,
    assetBaseUrl: payload.assetBaseUrl,
    config: payload.config,
    cwd: payload.cwd,
    ...(payload.icons ? {icons: payload.icons} : {}),
    outDir: payload.outDir,
    styleBaseUrl: payload.styleBaseUrl,
  });
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
