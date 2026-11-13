import assert from 'node:assert/strict';
import test from 'node:test';
import {formatHostedFailure, readHostedFailure} from '../src/hosted-error';

test('hosted diagnostics retain public fields, paths, bounded values and explicit retry metadata', () => {
  const failure = readHostedFailure({
    status: 422,
    requestId: 'header-ref',
    retryAfterMs: 3000,
    body: {
      code: 'TF_STYLE_INVALID',
      error: 'Fix the highlighted style properties.',
      requestId: 'body-ref',
      retryable: false,
      messages: [
        {
          code: 'TYPE_MISMATCH',
          message: 'Expected a number.',
          path: 'layers[2].paint.width',
          expected: 'number',
          actual: 'string',
          available: [1, 2],
        },
      ],
    },
  });
  assert.equal(failure.requestId, 'body-ref');
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.messages?.[0], {
    code: 'TYPE_MISMATCH',
    message: 'Expected a number.',
    path: 'layers[2].paint.width',
    expected: 'number',
    actual: 'string',
    available: [1, 2],
  });
  const human = formatHostedFailure('Style deployment', failure);
  for (const value of [
    'TF_STYLE_INVALID',
    'TYPE_MISMATCH',
    'layers[2].paint.width',
    'body-ref',
    'Expected a number.',
  ])
    assert.ok(human.includes(value));
  assert.doesNotMatch(human, /try again/iu);
});

test('hosted diagnostics redact credentials and URLs without reflecting arbitrary nested data', () => {
  const secret = 'synthetic-credential';
  const failure = readHostedFailure(
    {
      status: 403,
      body: {
        code: 'TF_FORBIDDEN',
        error: `Denied ${secret}; Bearer private; tf_live_hidden; https://user:password@example.test/path?signature=abc; {"password":"quoted-sensitive"}`,
        messages: [
          {
            message: 'Choose an available scope.',
            actual: {secret},
            expected: ['styles:write'],
            extra: secret,
          },
        ],
        stack: secret,
      },
    },
    [secret],
  );
  const output = JSON.stringify(failure);
  assert.doesNotMatch(
    output,
    /synthetic-credential|private|tf_live_hidden|example.test|password|signature=abc|quoted-sensitive/u,
  );
  assert.ok(failure.error.includes('[redacted]'));
  assert.equal(failure.messages?.[0]?.actual, undefined);
  assert.deepEqual(failure.messages?.[0]?.expected, ['styles:write']);
});

test('unsafe controls, database dumps and oversized diagnostic data fall back safely', () => {
  for (const error of [
    'SELECT password FROM users',
    'SQLITE_ERROR: secret',
    'at query (/app/sql.ts:20:3)',
    '\u001b[2Jsecret',
    'bad\u202ehidden',
    'Failed query: private',
    'params: private',
    'stack: private',
    'x'.repeat(513),
  ]) {
    const failure = readHostedFailure({
      status: 500,
      requestId: 'support-123',
      retryAfterMs: Number.MAX_SAFE_INTEGER,
      body: {error, code: 'tf_live_hidden', requestId: 'bad\nheader'},
    });
    assert.equal(failure.error, 'Tileflow request failed (HTTP 500).');
    assert.equal(failure.requestId, 'support-123');
    assert.equal(failure.code, undefined);
    assert.equal(failure.retryAfterMs, undefined);
    assert.equal(failure.retryable, undefined);
  }
  const failure = readHostedFailure({
    status: 400,
    body: {
      messages: Array.from({length: 100}, () => ({
        message: 'Invalid field.',
        available: Array(17).fill('x'),
      })),
    },
  });
  assert.equal(failure.messages?.length, 16);
  assert.equal(failure.messages?.[0]?.available, undefined);
});

test('only explicit retryability recommends retry; missing bodies retain status and request reference', () => {
  for (const status of [429, 500, 503]) {
    const failure = readHostedFailure({
      status,
      body: '<html>private proxy dump</html>',
      requestId: 'ref-123',
    });
    assert.equal(failure.retryable, undefined);
    assert.match(failure.error, new RegExp(String(status)));
    assert.doesNotMatch(formatHostedFailure('Upload', failure), /try again/iu);
  }
  assert.match(
    formatHostedFailure(
      'Upload',
      readHostedFailure({
        status: 503,
        retryAfterMs: 2001,
        body: {error: 'Upload is temporarily unavailable.', retryable: true},
      }),
    ),
    /after 3 seconds/u,
  );
});

test('body retry delay is bounded with a valid header fallback', () => {
  assert.equal(
    readHostedFailure({status: 503, retryAfterMs: 3000, body: {retryAfterMs: 5000}}).retryAfterMs,
    5000,
  );
  assert.equal(
    readHostedFailure({status: 503, retryAfterMs: 3000, body: {retryAfterMs: -1}}).retryAfterMs,
    3000,
  );
  assert.equal(
    readHostedFailure({status: 503, body: {retryAfterMs: 86_400_001}}).retryAfterMs,
    undefined,
  );
});

test('redacts complete quoted credentials and Basic authentication material', () => {
  for (const message of [
    'Rejected credentials: {"password":"secret with spaces"}',
    "Rejected credentials: {'access_token':'secret with spaces'}",
    'Rejected credentials: {"password":"secret \\"quoted\\" suffix"}',
    'Rejected credentials: password="secret with spaces',
    'Authorization failed for Basic dXNlcjpzZWNyZXQ=',
  ]) {
    const failure = readHostedFailure({status: 403, body: {error: message}});
    assert.doesNotMatch(
      JSON.stringify({failure, message: formatHostedFailure('Upload', failure)}),
      /secret|with spaces|quoted|suffix|dXNlcjpzZWNyZXQ/u,
    );
    assert.match(failure.error, /redacted/u);
  }
});
