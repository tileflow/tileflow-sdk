import {z} from 'zod';

const maximumHostedResponseBytes = 1024 * 1024;
const safeTextSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !/[\p{Cc}]/u.test(value));
const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const publicHttpUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  });

export const hostedStyleDeploymentResponseSchema = z.object({
  changed: z.boolean().optional(),
  deploymentId: safeIdentifierSchema.optional(),
  mapId: safeIdentifierSchema,
  mapUrl: publicHttpUrlSchema,
  styleId: safeIdentifierSchema.optional(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  worldPromotionId: safeIdentifierSchema.optional(),
});

export const hostedIconPackageResponseSchema = z.object({
  changed: z.boolean().optional(),
  spriteUrl: publicHttpUrlSchema,
});

const hostedStatusStyleSchema = z.object({
  environment: safeTextSchema,
  key: safeIdentifierSchema,
  mapId: safeIdentifierSchema,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  uploaded: z.iso.datetime({offset: true}),
});

export const hostedProjectStatusSchema = z.object({
  projectId: safeIdentifierSchema,
  styles: z.array(hostedStatusStyleSchema).max(10_000),
});

export type HostedProjectStatus = z.infer<typeof hostedProjectStatusSchema>;

export async function readHostedJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  label: string,
): Promise<T> {
  const source = await readBoundedResponseText(response, label);
  let parsed: unknown;

  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`${label} returned an invalid response.`);
  return result.data;
}

export async function readHostedError(response: Response, label: string): Promise<string> {
  let source: string;

  try {
    source = await readBoundedResponseText(response, label);
  } catch {
    return `${label}: ${response.status}.`;
  }

  try {
    const body = JSON.parse(source) as unknown;
    const error =
      body && typeof body === 'object' && !Array.isArray(body)
        ? safeTextSchema.safeParse((body as {error?: unknown}).error)
        : null;
    if (error?.success) return `${label}: ${response.status} ${error.data}`;
  } catch {
    // Use the stable status-only message below; never echo an untrusted body.
  }

  return `${label}: ${response.status}.`;
}

async function readBoundedResponseText(response: Response, label: string): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > maximumHostedResponseBytes
  ) {
    throw new Error(`${label} response exceeded the safe size limit.`);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;

      byteLength += value.byteLength;
      if (byteLength > maximumHostedResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} response exceeded the safe size limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new Error(`${label} returned invalid UTF-8.`);
  }
}
