import {nativeErrorInfo, nativeErrorMessage, optionalNumber, optionalString} from '../native-error';
import type {TileflowService} from './types';

/**
 * Why a service call failed, as the native clients report it.
 *
 * - `configuration`: no usable credential or app identity for the service. Nothing was sent.
 * - `invalidRequest`: the request breaks the service's documented limits. Nothing was sent.
 * - `network`: no HTTP answer arrived (connection, TLS, timeout or a redirect).
 * - `rejected`: the service answered with an HTTP error; see `status`, `code` and `retryAfter`.
 * - `invalidResponse`: the service answered outside its documented contract.
 */
export type TileflowServiceErrorKind =
  'configuration' | 'invalidRequest' | 'network' | 'rejected' | 'invalidResponse';

const kinds = new Set<string>([
  'configuration',
  'invalidRequest',
  'network',
  'rejected',
  'invalidResponse',
]);

export class TileflowServiceError extends Error {
  readonly service: TileflowService;
  readonly kind: TileflowServiceErrorKind;
  /** The service's documented code, such as `GEOCODING_QUOTA_EXCEEDED`. */
  readonly code?: string;
  readonly status?: number;
  readonly requestId?: string;
  /** Milliseconds to wait before trying again, when the service asked for it. */
  readonly retryAfter?: number;

  constructor(
    service: TileflowService,
    kind: TileflowServiceErrorKind,
    message: string,
    details: {code?: string; status?: number; requestId?: string; retryAfter?: number} = {},
  ) {
    super(message);
    this.name = 'TileflowServiceError';
    this.service = service;
    this.kind = kind;
    if (details.code !== undefined) this.code = details.code;
    if (details.status !== undefined) this.status = details.status;
    if (details.requestId !== undefined) this.requestId = details.requestId;
    if (details.retryAfter !== undefined) this.retryAfter = details.retryAfter;
  }
}

/** The service error a native rejection carries; other errors pass through unchanged. */
export function serviceError(service: TileflowService, error: unknown): unknown {
  const info = nativeErrorInfo(error);
  const kind = info && optionalString(info, 'kind');
  if (!info || !kind || !kinds.has(kind)) return error;
  const details: {code?: string; status?: number; requestId?: string; retryAfter?: number} = {};
  const code = optionalString(info, 'code');
  const status = optionalNumber(info, 'status');
  const requestId = optionalString(info, 'requestId');
  const retryAfter = optionalNumber(info, 'retryAfter');
  if (code !== undefined) details.code = code;
  if (status !== undefined) details.status = status;
  if (requestId !== undefined) details.requestId = requestId;
  if (retryAfter !== undefined) details.retryAfter = retryAfter;
  return new TileflowServiceError(
    service,
    kind as TileflowServiceErrorKind,
    nativeErrorMessage(error, 'Tileflow service request failed'),
    details,
  );
}
