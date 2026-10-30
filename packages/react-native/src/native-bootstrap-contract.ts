import type {NativeAdmissionBridge} from './native-admission-contract';

export const nativeBootstrapLimits = Object.freeze({
  queueDepth: 32,
  requestBytes: 2048,
  responseBytes: 65536,
  retryAfterCharacters: 64,
  // Well inside the 30 s ticket and batch deadlines.
  timeoutMs: 10000,
});

export type NativeBootstrapReply = Readonly<{
  status: number;
  cacheControl: string;
  /** Empty when the response had none. */
  retryAfter?: string;
  bodyBase64: string;
}>;

// Native promises, not events, carry the bounded bootstrap response. The
// controller alone parses session authority and makes admission decisions.
export type NativeAdmissionNativeModule = Omit<NativeAdmissionBridge, 'subscribe'> &
  Readonly<{
    bootstrap(
      installation: string,
      context: string,
      request: string,
      url: string,
      credential: string,
      body: string,
    ): Promise<NativeBootstrapReply>;
    cancelBootstrap(
      installation: string,
      context: string,
      request: string,
    ): Promise<Readonly<{cancelled: true}>>;
  }>;
