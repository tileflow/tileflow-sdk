import {nativeErrorInfo, nativeErrorMessage, optionalNumber, optionalString} from '../native-error';
import type {OfflineErrorInfo} from './types';

/** A failed offline store call, with the native `TileflowOfflineError` fields. */
export class TileflowOfflineError extends Error implements OfflineErrorInfo {
  readonly code: string;
  readonly recoverable: boolean;
  readonly reason?: string;
  readonly status?: number;
  readonly limit?: number;
  readonly retryAfter?: number;

  constructor(info: OfflineErrorInfo, message: string) {
    super(message);
    this.name = 'TileflowOfflineError';
    this.code = info.code;
    this.recoverable = info.recoverable;
    if (info.reason !== undefined) this.reason = info.reason;
    if (info.status !== undefined) this.status = info.status;
    if (info.limit !== undefined) this.limit = info.limit;
    if (info.retryAfter !== undefined) this.retryAfter = info.retryAfter;
  }
}

/** The offline error a native rejection carries; other errors pass through unchanged. */
export function offlineError(error: unknown): unknown {
  const info = nativeErrorInfo(error);
  const code = info && optionalString(info, 'code');
  if (!info || !code || typeof info.recoverable !== 'boolean') return error;
  const details: OfflineErrorInfo = {code, recoverable: info.recoverable};
  const reason = optionalString(info, 'reason');
  const status = optionalNumber(info, 'status');
  const limit = optionalNumber(info, 'limit');
  const retryAfter = optionalNumber(info, 'retryAfter');
  if (reason !== undefined) details.reason = reason;
  if (status !== undefined) details.status = status;
  if (limit !== undefined) details.limit = limit;
  if (retryAfter !== undefined) details.retryAfter = retryAfter;
  return new TileflowOfflineError(details, nativeErrorMessage(error, `Tileflow offline ${code}`));
}
