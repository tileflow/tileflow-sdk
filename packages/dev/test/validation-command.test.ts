import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {
  createTileflowCommandFailureDocument,
  createTileflowCommandSummary,
  serializeTileflowCommandDocument,
} from '../src/validation';

test('normalizes deterministic structured diagnostics without paths or secrets', () => {
  const cwd = resolve('/tmp/tileflow-agent-fixture');
  const secret = `tf_live_${'a'.repeat(32)}`;
  const error = {
    code: 'CONFIG_INVALID',
    phase: 'config-validation',
    messages: [
      {
        level: 'error',
        message: `Invalid value loaded from ${cwd}/tileflow.config.ts using https://user:password@example.test/data.json?token=${secret}`,
        path: `${cwd}/tileflow.config.ts`,
      },
      {
        code: secret,
        level: 'warning',
        message: 'A secondary warning',
        path: 'maps.main.modules.roads',
      },
    ],
  };

  const document = createTileflowCommandFailureDocument('validate', error, cwd, {
    code: 'VALIDATION_FAILED',
    phase: 'validation',
  });
  const serialized = serializeTileflowCommandDocument(document);

  assert.deepEqual(Object.keys(document), [
    'schemaVersion',
    'command',
    'ok',
    'phase',
    'code',
    'path',
    'severity',
    'message',
    'suggestion',
    'diagnostics',
  ]);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.ok, false);
  assert.equal(document.diagnostics.length, 2);
  assert.deepEqual(Object.keys(document.diagnostics[0]!), [
    'phase',
    'code',
    'path',
    'severity',
    'message',
    'suggestion',
  ]);
  assert.equal(document.diagnostics[0]?.severity, 'error');
  assert.equal(document.diagnostics[0]?.path, 'tileflow.config.ts');
  assert.match(document.diagnostics[0]?.suggestion ?? '', /config reference/u);
  assert.doesNotMatch(
    serialized,
    /user:password|token=|tf_live_|TF_LIVE_|\/tmp\/tileflow-agent-fixture/u,
  );
  assert.equal(serialized, serializeTileflowCommandDocument(document));
  assert.ok(serialized.endsWith('\n'));
});

test('creates a stable success summary with the same required fields', () => {
  const summary = createTileflowCommandSummary({
    code: 'VALIDATION_OK',
    command: 'validate',
    message: 'Tileflow config is valid.',
    ok: true,
    phase: 'validation',
    severity: 'info',
    suggestion: 'No changes are required.',
  });

  assert.deepEqual(summary, {
    schemaVersion: 1,
    command: 'validate',
    ok: true,
    phase: 'validation',
    code: 'VALIDATION_OK',
    path: '',
    severity: 'info',
    message: 'Tileflow config is valid.',
    suggestion: 'No changes are required.',
  });
});

test('preserves top-level theme-audit diagnostics and their actionable suggestion', () => {
  const document = createTileflowCommandFailureDocument(
    'validate',
    {
      diagnostics: [
        {
          code: 'THEME_IMPLICIT_FIXED',
          message: 'Visual color literal is implicitly fixed.',
          path: 'modules.water.bodies.fill.color',
          phase: 'theme-audit',
          severity: 'error',
          suggestion: 'Replace the literal with token.color(...) or fixed(value, {reason}).',
        },
      ],
    },
    '/tmp/tileflow-theme-audit',
    {code: 'STYLE_INVALID', phase: 'style-validation'},
  );

  assert.deepEqual(document.diagnostics, [
    {
      phase: 'theme-audit',
      code: 'THEME_IMPLICIT_FIXED',
      path: 'modules.water.bodies.fill.color',
      severity: 'error',
      message: 'Visual color literal is implicitly fixed.',
      suggestion: 'Replace the literal with token.color(...) or fixed(value, {reason}).',
    },
  ]);
});
