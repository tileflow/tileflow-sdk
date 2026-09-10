import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('renders the Coordinates builder-input release step as valid Bash', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const start = workflow.indexOf('Produce verified Coordinates builder input');
  const end = workflow.indexOf(
    '\n      - name: Recheck current main before handing off publication',
    start,
  );
  const step = workflow.slice(start, end);

  assert.ok(start >= 0 && end > start, 'Coordinates builder-input workflow step is missing.');
  const shell = renderYamlLiteral(step);
  const result = spawnSync('bash', ['-n'], {encoding: 'utf8', input: shell});

  assert.equal(result.status, 0, result.stderr);
});

function renderYamlLiteral(step) {
  const marker = '        run: |\n';
  const index = step.indexOf(marker);
  assert.ok(index >= 0, 'Coordinates builder-input shell is missing.');
  const lines = step.slice(index + marker.length).split('\n');
  const indentation = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/u)[0].length),
  );
  return lines.map((line) => (line ? line.slice(indentation) : line)).join('\n');
}
