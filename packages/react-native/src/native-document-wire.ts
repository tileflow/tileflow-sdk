import {
  resolveTileflowNativeManifestUrl,
  type TileflowNativeManifestOperation,
  type TileflowNativeManifestResponse,
} from '@tileflow/core/native';
import {
  hasReservedNativeContext,
  isNativeToken,
  nativeResourceOrigin,
} from './native-admission-url';
import {
  NativeDocumentError,
  nativeDocumentLimits,
  type NativeDocumentModule,
  type NativeDocumentScope,
} from './native-document-contract';

const invalid = () => new NativeDocumentError('NATIVE_DOCUMENT_INVALID');
const unavailable = () => new NativeDocumentError('NATIVE_DOCUMENT_UNAVAILABLE');
const cancelled = () => new NativeDocumentError('NATIVE_DOCUMENT_CANCELLED');

function safeUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    resolveTileflowNativeManifestUrl(value) !== value ||
    hasReservedNativeContext(value) ||
    /tf_native_|tf_public_/iu.test(decodeURIComponent(value))
  )
    throw invalid();
  return value;
}

function decode(value: unknown, maximumBytes: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  )
    throw invalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const length = (value.length / 4) * 3 - padding;
  if (length > maximumBytes) throw invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const result = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]!);
    const b = alphabet.indexOf(value[index + 1]!);
    const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2]!);
    const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3]!);
    if (
      index + 4 === value.length &&
      ((padding === 2 && (b & 15) !== 0) || (padding === 1 && (c & 3) !== 0))
    )
      throw invalid();
    const word = a * 262144 + b * 4096 + c * 64 + d;
    if (offset < length) result[offset++] = (word >>> 16) & 255;
    if (offset < length) result[offset++] = (word >>> 8) & 255;
    if (offset < length) result[offset++] = word & 255;
  }
  return result;
}

/** No ambient fetch, URL, timers, network installation or application configuration. */
export function createNativeDocumentTransport(locate: () => unknown) {
  const pending = new Set<() => Promise<void>>();

  function acquire(
    value: string,
    options: Readonly<{maximumBytes: number}>,
    scope?: NativeDocumentScope,
  ): TileflowNativeManifestOperation {
    let url: string;
    const maximumBytes = options.maximumBytes;
    try {
      url = safeUrl(value);
      if (
        !Number.isSafeInteger(maximumBytes) ||
        maximumBytes < 1 ||
        maximumBytes > nativeDocumentLimits.documentBytes ||
        (scope !== undefined &&
          (!isNativeToken(scope.installation) || !isNativeToken(scope.context)))
      )
        throw invalid();
    } catch {
      throw invalid();
    }
    if (pending.size >= nativeDocumentLimits.operations) throw unavailable();
    let closed = false;
    let finished = false;
    let reading = false;
    let received = 0;
    let retirement: Promise<void> | undefined;
    let rejectStop!: (error: NativeDocumentError) => void;
    const stop = new Promise<never>((_resolve, reject) => {
      rejectStop = reject;
    });
    void stop.catch(() => undefined);
    let module: NativeDocumentModule | undefined;
    let allocation: Promise<string>;
    const methods = new Map<string, unknown>();
    const release = () => pending.delete(cancel);
    const checkOwner = () => {
      try {
        if (
          !module ||
          locate() !== module ||
          [...methods].some(
            ([name, method]) => (module as unknown as Record<string, unknown>)[name] !== method,
          )
        )
          throw unavailable();
      } catch {
        throw unavailable();
      }
    };
    function cancel(): Promise<void> {
      if (retirement) return retirement;
      closed = true;
      rejectStop(cancelled());
      if (finished) {
        release();
        return Promise.resolve();
      }
      const attempt = allocation.then(
        async (id) => {
          try {
            const method = methods.get('cancelDocument') as NativeDocumentModule['cancelDocument'];
            const ack = await method.call(module, id);
            if (ack?.cancelled !== true) throw unavailable();
            finished = true;
            release();
          } catch {
            throw unavailable();
          }
        },
        () => {
          finished = true;
          release();
        },
      );
      retirement = attempt;
      void attempt.catch(() => {
        if (retirement === attempt) retirement = undefined;
      });
      return attempt;
    }
    pending.add(cancel);
    try {
      const candidate = locate();
      if (!candidate || typeof candidate !== 'object') throw unavailable();
      for (const name of ['openDocument', 'documentResponse', 'documentChunk', 'cancelDocument']) {
        const method = (candidate as Record<string, unknown>)[name];
        if (typeof method !== 'function') throw unavailable();
        methods.set(name, method);
      }
      module = candidate as NativeDocumentModule;
      allocation = Promise.resolve(
        module.openDocument(url, maximumBytes, scope?.installation ?? null, scope?.context ?? null),
      ).then(
        (ack) => {
          if (!ack || !isNativeToken(ack.document)) throw invalid();
          return ack.document;
        },
        () => {
          throw unavailable();
        },
      );
    } catch {
      allocation = Promise.reject(unavailable());
      finished = true;
      release();
    }
    void allocation.catch(() => undefined);
    const response = (async (): Promise<TileflowNativeManifestResponse> => {
      try {
        const id = await Promise.race([allocation, stop]);
        if (closed) throw cancelled();
        checkOwner();
        let reply;
        try {
          reply = await Promise.race([module!.documentResponse(id), stop]);
        } catch {
          if (closed) throw cancelled();
          throw unavailable();
        }
        if (closed) throw cancelled();
        checkOwner();
        let finalUrl: string;
        try {
          finalUrl = safeUrl(reply.url);
          if (
            !Number.isInteger(reply.status) ||
            reply.status < 100 ||
            reply.status > 599 ||
            nativeResourceOrigin(finalUrl) !== nativeResourceOrigin(url)
          )
            throw invalid();
        } catch {
          throw invalid();
        }
        const status = reply.status;
        return Object.freeze({
          url: finalUrl,
          status,
          reader: Object.freeze({
            async read(
              bound: number,
            ): Promise<{done: true; value?: undefined} | {done: false; value: Uint8Array}> {
              if (closed) throw cancelled();
              if (finished) return {done: true};
              if (reading || !Number.isSafeInteger(bound) || bound < 1) throw invalid();
              const limit = Math.min(
                bound,
                nativeDocumentLimits.chunkBytes,
                maximumBytes - received + 1,
              );
              reading = true;
              try {
                checkOwner();
                let chunk;
                try {
                  chunk = await Promise.race([module!.documentChunk(id, limit), stop]);
                } catch {
                  if (closed) throw cancelled();
                  throw unavailable();
                }
                if (closed) throw cancelled();
                checkOwner();
                const bytes = decode(chunk.bodyBase64, limit);
                if (
                  typeof chunk.last !== 'boolean' ||
                  (bytes.length === 0 && !chunk.last) ||
                  received + bytes.length > maximumBytes
                ) {
                  bytes.fill(0);
                  throw invalid();
                }
                if (closed) {
                  bytes.fill(0);
                  throw cancelled();
                }
                received += bytes.length;
                if (chunk.last) {
                  finished = true;
                  release();
                }
                return bytes.length === 0 ? {done: true} : {done: false, value: bytes};
              } catch (error) {
                void cancel().catch(() => undefined);
                throw error instanceof NativeDocumentError ? error : invalid();
              } finally {
                reading = false;
              }
            },
            cancel,
          }),
        });
      } catch (error) {
        void cancel().catch(() => undefined);
        throw error instanceof NativeDocumentError ? error : unavailable();
      }
    })();
    void response.catch(() => undefined);
    return Object.freeze({response, cancel});
  }

  return Object.freeze({
    acquire,
    async retryRetirements(): Promise<void> {
      // Only callers that explicitly retired their operation retry through its cancel handle.
      // This channel is shared application transport, not a Map lifecycle owner.
      await Promise.resolve();
    },
  });
}
