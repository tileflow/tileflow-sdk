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

export const staticMapErrorResponseSchema = z
  .object({
    code: safeErrorIdentifierSchema.optional(),
    error: safeErrorTextSchema,
    remainingUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    requestId: safeErrorIdentifierSchema.optional(),
    retryable: z.boolean().optional(),
  })
  .strip();

export type StaticMapErrorResponse = z.infer<typeof staticMapErrorResponseSchema>;

export class StaticMapError extends Error {
  readonly code: string | null;
  readonly remainingUnits: number | null;
  readonly requestId: string | null;
  readonly response: StaticMapErrorResponse;
  readonly retryable: boolean | null;
  readonly status: number;

  constructor(response: StaticMapErrorResponse, status: number) {
    const parsed = staticMapErrorResponseSchema.parse(response);

    super(parsed.error);
    this.name = 'StaticMapError';
    this.code = parsed.code ?? null;
    this.remainingUnits = parsed.remainingUnits ?? null;
    this.requestId = parsed.requestId ?? null;
    this.response = Object.freeze(parsed);
    this.retryable = parsed.retryable ?? null;
    this.status = status;
  }
}

function hasNoControlCharacters(value: string) {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
