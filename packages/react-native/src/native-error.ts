// Native promise rejections carry the SDK error in `userInfo`. These helpers read it without
// trusting its shape.

export type NativeErrorInfo = Readonly<Record<string, unknown>>;

export function nativeErrorInfo(error: unknown): NativeErrorInfo | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const info = (error as {userInfo?: unknown}).userInfo;
  return typeof info === 'object' && info !== null ? (info as NativeErrorInfo) : undefined;
}

export function nativeErrorMessage(error: unknown, fallback: string): string {
  const message = (error as {message?: unknown} | null)?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function optionalString(info: NativeErrorInfo, key: string): string | undefined {
  const value = info[key];
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumber(info: NativeErrorInfo, key: string): number | undefined {
  const value = info[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
