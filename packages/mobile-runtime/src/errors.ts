import {protocol} from './contract';

export type ResourceKind = (typeof protocol.resourceKinds)[number];
export type ErrorReason = (typeof protocol.errorReasons)[number];
type Errors = typeof protocol.errors;
/** The shared error codes this renderer may send; host-only codes are excluded. */
export type ProtocolErrorCode = {
  [K in keyof Errors]: 'runtime' extends Errors[K]['sources'][number] ? K : never;
}[keyof Errors];
/** Diagnostic detail. Never a URL path, query or credential: origins only. */
export type ErrorContext = Readonly<{
  reason?: ErrorReason;
  resource?: ResourceKind;
  origin?: string;
  status?: number;
  limit?: number;
}>;
export type WireError = Readonly<{
  code: ProtocolErrorCode;
  message: string;
  context?: ErrorContext;
}>;

export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly context?: ErrorContext,
  ) {
    super(message);
  }

  toWire(): WireError {
    return {
      code: this.code,
      message: this.message,
      ...(this.context ? {context: this.context} : {}),
    };
  }
}
