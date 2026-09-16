export const nativeDocumentLimits = Object.freeze({
  operations: 16,
  documentBytes: 8_388_608,
  manifestBytes: 1_048_576,
  chunkBytes: 65_536,
  timeoutMs: 30_000,
});

export type NativeDocumentScope = Readonly<{installation: string; context: string}>;

// Native owns ticket allocation. Documents carry no credential or grant fields.
// An optional context routes an eligible request through the existing admission engine.
export type NativeDocumentModule = Readonly<{
  openDocument(
    url: string,
    maximumBytes: number,
    installation: string | null,
    context: string | null,
  ): Promise<Readonly<{document: string}>>;
  documentResponse(document: string): Promise<Readonly<{url: string; status: number}>>;
  documentChunk(
    document: string,
    maximumBytes: number,
  ): Promise<Readonly<{bodyBase64: string; last: boolean}>>;
  cancelDocument(document: string): Promise<Readonly<{cancelled: true}>>;
}>;

export type NativeDocumentCode =
  | 'NATIVE_DOCUMENT_INVALID'
  | 'NATIVE_DOCUMENT_UNAVAILABLE'
  | 'NATIVE_DOCUMENT_CANCELLED';

export class NativeDocumentError extends Error {
  readonly code: NativeDocumentCode;
  constructor(code: NativeDocumentCode) {
    super('Native document acquisition failed.');
    this.name = 'NativeDocumentError';
    this.code = code;
  }
}
