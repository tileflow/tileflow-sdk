import {z} from 'zod';

const safeErrorTextSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(hasNoControlCharacters, {message: 'Expected no control characters'});

const safeErrorIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const maxRetryAfterMs = 24 * 60 * 60 * 1000;
const retryAfterMsSchema = z.number().int().min(0).max(maxRetryAfterMs);

export type StaticMapErrorMetadata = Readonly<{
  requestId?: string;
  retryAfterMs?: number;
}>;

export const staticMapErrorResponseSchema = z
  .object({
    code: safeErrorIdentifierSchema.optional(),
    error: safeErrorTextSchema,
    remainingUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    requestId: safeErrorIdentifierSchema.optional(),
    requiredPlan: safeErrorIdentifierSchema.optional(),
    retryAfterMs: retryAfterMsSchema.optional(),
    retryable: z.boolean().optional(),
  })
  .strip();

export type StaticMapErrorResponse = z.infer<typeof staticMapErrorResponseSchema>;

export class StaticMapError extends Error {
  readonly code: string | null;
  readonly remainingUnits: number | null;
  readonly requestId: string | null;
  readonly requiredPlan: string | null;
  readonly response: StaticMapErrorResponse;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean | null;
  readonly status: number;

  constructor(
    response: StaticMapErrorResponse,
    status: number,
    metadata: StaticMapErrorMetadata = {},
  ) {
    const parsed = staticMapErrorResponseSchema.parse({...response, ...metadata});

    super(parsed.error);
    this.name = 'StaticMapError';
    this.code = parsed.code ?? null;
    this.remainingUnits = parsed.remainingUnits ?? null;
    this.requestId = parsed.requestId ?? null;
    this.requiredPlan = parsed.requiredPlan ?? null;
    this.retryAfterMs = parsed.retryAfterMs ?? null;
    this.response = Object.freeze(parsed);
    this.retryable = parsed.retryable ?? null;
    this.status = status;
  }
}

/** Only public diagnostics cross the network boundary; response bodies remain untrusted. */
export function readStaticMapErrorResponse(value: unknown, secrets: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = safeDiagnosticText(record.error, secrets);
  if (!message) return null;
  const candidate: Record<string, unknown> = {error: message};
  for (const key of ['code', 'requestId', 'requiredPlan'] as const) {
    const identifier = safeErrorIdentifierSchema.safeParse(record[key]);
    if (identifier.success && safeDiagnosticText(identifier.data, secrets) === identifier.data)
      candidate[key] = identifier.data;
  }
  if (typeof record.retryable === 'boolean') candidate.retryable = record.retryable;
  if (
    typeof record.remainingUnits === 'number' &&
    Number.isSafeInteger(record.remainingUnits) &&
    record.remainingUnits >= 0
  )
    candidate.remainingUnits = record.remainingUnits;
  const retryAfter = retryAfterMsSchema.safeParse(record.retryAfterMs);
  if (retryAfter.success) candidate.retryAfterMs = retryAfter.data;
  const parsed = staticMapErrorResponseSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function readStaticMapErrorMetadata(
  response: StaticMapErrorResponse,
  headers: Headers,
  secrets: readonly string[] = [],
): StaticMapErrorMetadata {
  const requestId = safeErrorIdentifierSchema.safeParse(headers.get('X-Request-ID'));
  const retryAfter = headers.get('Retry-After');
  const delay =
    retryAfter === null
      ? undefined
      : /^\d+$/u.test(retryAfter)
        ? Number(retryAfter) * 1000
        : /(?:GMT|UTC)$/u.test(retryAfter)
          ? Math.max(0, Date.parse(retryAfter) - Date.now())
          : undefined;
  const retryAfterMs = retryAfterMsSchema.safeParse(delay);
  return {
    ...(response.requestId
      ? {requestId: response.requestId}
      : requestId.success && safeDiagnosticText(requestId.data, secrets) === requestId.data
        ? {requestId: requestId.data}
        : {}),
    ...(response.retryAfterMs !== undefined
      ? {retryAfterMs: response.retryAfterMs}
      : retryAfterMs.success
        ? {retryAfterMs: retryAfterMs.data}
        : {}),
  };
}

/** Request-error schemas further restrict this bounded tree to their known detail fields. */
export function sanitizeStaticMapErrorDetails(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  let remaining = 128;
  const visit = (input: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 6) return undefined;
    if (typeof input === 'string') return safeDiagnosticText(input, secrets);
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
    if (input === null || typeof input === 'boolean') return input;
    if (Array.isArray(input))
      return input.length <= 24 ? input.map((item) => visit(item, depth + 1)) : undefined;
    if (!input || typeof input !== 'object') return undefined;
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, visit(item, depth + 1)]),
    );
  };
  return visit(value, 0);
}

function safeDiagnosticText(value: unknown, secrets: readonly string[]): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 512 ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    /\b(?:failed\s+query|query\s*:|params\s*:|stack\s*(?:trace|:)|select\s+.+\s+from|insert\s+into|delete\s+from|update\s+.+\s+set|SQLSTATE|SQLITE_|postgres(?:ql)?\s+error|at\s+\S+\s*\([^)]*:\d+:\d+\))/iu.test(
      value,
    )
  )
    return undefined;
  let safe = value;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[redacted]');
  return safe
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/giu, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/giu, '$1 [redacted]')
    .replace(/\btf_(?:live|test|session|cap|pub|secret)_[A-Za-z0-9._-]+/giu, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted]')
    .replace(
      /["']?\b(?:api[_ -]?key|access[_-]?token|token|secret|password|authorization|signature)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;]+)/giu,
      '[redacted credential]',
    );
}

function hasNoControlCharacters(value: string) {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
