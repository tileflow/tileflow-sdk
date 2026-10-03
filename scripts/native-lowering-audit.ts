import {resolve} from 'node:path';
import {auditOfficialStreets} from '../packages/dev/test/native-lowering-audit-fixture';

async function main(): Promise<void> {
  const report = await auditOfficialStreets(resolve(process.cwd(), 'packages/dev'));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write('Unable to complete the native lowering audit.\n');
  process.exitCode = 1;
});
