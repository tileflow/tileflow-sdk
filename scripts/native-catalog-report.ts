import {fileURLToPath} from 'node:url';
import {evaluateNativeCatalog} from '../packages/dev/test/native-catalog-fixture';

// Run after building the workspace. Redirect stdout to retain this exact static catalog receipt.
const report = await evaluateNativeCatalog(fileURLToPath(new URL('../packages/dev/', import.meta.url)));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
