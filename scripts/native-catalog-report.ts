import {resolve} from 'node:path';
import {evaluateNativeCatalog} from '../packages/dev/test/native-catalog-fixture';

async function main(): Promise<void> {
  const report = await evaluateNativeCatalog(resolve(process.cwd(), 'packages/dev'));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// Run from the SDK root after building the workspace. Redirect stdout to retain this exact receipt.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
