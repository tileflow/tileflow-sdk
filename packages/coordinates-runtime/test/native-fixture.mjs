import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

let body = '';
for await (const chunk of process.stdin) body += chunk;
const request = JSON.parse(body);

if (request.mode === 'exit') process.exit(9);
if (request.mode === 'malformed') {
  process.stdout.write('{');
  process.exit(0);
}
if (request.mode === 'oversized') {
  process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
  process.exit(0);
}
if (request.mode === 'hold') {
  if (request.marker) await writeFile(join(request.marker, String(process.pid)), 'started');
  await new Promise((resolve) => setTimeout(resolve, request.milliseconds));
}
process.stdout.write(JSON.stringify({ok: true, mode: request.mode}) + '\n');
