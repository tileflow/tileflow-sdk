/** Public, bounded diagnostics from a hosted operation. Never include the raw response body. */
export type HostedFailure = {
  status: number;
  code?: string;
  error: string;
  messages?: HostedDiagnostic[];
  requestId?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

type DiagnosticValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type HostedDiagnostic = {
  code?: string;
  message: string;
  path?: string;
  expected?: DiagnosticValue;
  actual?: DiagnosticValue;
  available?: DiagnosticValue;
};

type HostedFailureResponse = {
  status: number;
  body?: unknown;
  failure?: HostedFailure;
  requestId?: string;
  retryAfterMs?: number;
};

const maximumTextLength = 512;
const maximumMessages = 16;
const maximumRetryAfterMs = 86_400_000;
const unsafeText =
  /[\p{Cc}\p{Cf}]|\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|SQLSTATE|SQLITE_|postgres(?:ql)?\s+error|stack\s*(?:trace|:)|failed\s+query|params\s*:|at\s+\S+\s*\([^)]*:\d+:\d+\))/iu;
const credential =
  /\btf_(?:live|test|session|cap|pub|secret)_[A-Za-z0-9._-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Remote prose is not trusted terminal output, even on an authenticated API connection. */
export function safeHostedText(
  value: unknown,
  secrets: readonly string[] = [],
  limit = maximumTextLength,
) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || unsafeText.test(value))
    return undefined;
  let text = value.trim();
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, '[redacted]');
  }
  return text
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/giu, '[redacted URL]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/giu, '$1 [redacted]')
    .replace(credential, '[redacted]')
    .replace(
      /["']?\b(?:api[_ -]?key|access[_-]?token|token|secret|password|authorization|signature)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;]+)/giu,
      '[redacted credential]',
    );
}

function identifier(value: unknown, secrets: readonly string[]) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value))
    return undefined;
  return safeHostedText(value, secrets) === value ? value : undefined;
}

function diagnosticValue(value: unknown, secrets: readonly string[]): DiagnosticValue | undefined {
  if (Array.isArray(value)) {
    if (value.length > 16) return undefined;
    const entries = value.map((entry) => primitive(entry, secrets));
    return entries.every((entry) => entry !== undefined) ? entries : undefined;
  }
  return primitive(value, secrets);
}

function primitive(value: unknown, secrets: readonly string[]) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return safeHostedText(value, secrets, 128);
}

export function readHostedFailure(
  response: HostedFailureResponse,
  secrets: readonly string[] = [],
): HostedFailure {
  if (response.failure) return response.failure;
  const body = record(response.body);
  const code = identifier(body.code, secrets);
  const requestId = identifier(body.requestId, secrets) ?? identifier(response.requestId, secrets);
  const messages: HostedDiagnostic[] = [];
  for (const value of Array.isArray(body.messages) ? body.messages.slice(0, maximumMessages) : []) {
    const source = record(value);
    const message = safeHostedText(source.message, secrets);
    if (!message) continue;
    const item: HostedDiagnostic = {message};
    const diagnosticCode = identifier(source.code, secrets);
    const path = safeHostedText(source.path, secrets, 256);
    if (diagnosticCode) item.code = diagnosticCode;
    if (path) item.path = path;
    for (const key of ['expected', 'actual', 'available'] as const) {
      const value = diagnosticValue(source[key], secrets);
      if (value !== undefined) item[key] = value;
    }
    messages.push(item);
  }
  const boundedRetryAfter = (value: unknown): value is number =>
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximumRetryAfterMs;
  const retryAfterMs = boundedRetryAfter(body.retryAfterMs)
    ? body.retryAfterMs
    : boundedRetryAfter(response.retryAfterMs)
      ? response.retryAfterMs
      : undefined;
  return {
    status: response.status,
    ...(code ? {code} : {}),
    error:
      safeHostedText(body.error, secrets) ?? `Tileflow request failed (HTTP ${response.status}).`,
    ...(messages.length ? {messages} : {}),
    ...(requestId ? {requestId} : {}),
    ...(typeof body.retryable === 'boolean' ? {retryable: body.retryable} : {}),
    ...(retryAfterMs === undefined ? {} : {retryAfterMs}),
  };
}

export function formatHostedFailure(operation: string, failure: HostedFailure): string {
  const details = (failure.messages ?? []).map((item) => {
    const values = (['expected', 'actual', 'available'] as const)
      .filter((key) => item[key] !== undefined)
      .map((key) => `${key}: ${JSON.stringify(item[key])}`);
    return `  ${item.path ? `${item.path}: ` : ''}${item.message}${item.code ? ` [${item.code}]` : ''}${values.length ? ` (${values.join('; ')})` : ''}`;
  });
  return [
    `${operation} failed: ${failure.error}${failure.code ? ` [${failure.code}]` : ''}`,
    ...details,
    ...(failure.requestId ? [`Request ID: ${failure.requestId}`] : []),
    ...(failure.retryable === true
      ? [
          failure.retryAfterMs === undefined
            ? 'This failure is temporary; try again later.'
            : `Try again after ${Math.ceil(failure.retryAfterMs / 1000)} seconds.`,
        ]
      : failure.retryAfterMs !== undefined
        ? [`Retry-After: ${Math.ceil(failure.retryAfterMs / 1000)} seconds.`]
        : []),
  ].join('\n');
}

export class HostedRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly failure: HostedFailure,
    readonly nextSteps: readonly string[] = [],
  ) {
    super([formatHostedFailure(operation, failure), ...nextSteps].join('\n'));
    this.name = 'HostedRequestError';
  }
}
