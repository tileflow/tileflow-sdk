import type {NativeSessionResourceScope} from './session-controller';

// These are transport bounds, never commercial admission counters.
export const nativeAdmissionLimits = Object.freeze({
  contexts: 16,
  resources: 128,
  queueDepth: 128,
  batchSize: 8,
  urlCharacters: 2048,
  bridgeBytes: 524288,
  grantCharacters: 24576,
  waitMs: 30000,
  validitySafetyMs: 1000,
  redirects: 3,
  responseBytes: 8388608,
});

export const nativeContextParameter = '__tf_native_context';
export const nativeGrantHeader = 'X-Tileflow-Native-Grant';

// Exact documents or bounded expansions of an explicit resource template.
// A template never changes its origin, fixed path/query identity, class or tileset.
export type NativeAdmissionResource = Readonly<{
  url: string;
  scope: NativeSessionResourceScope;
  tilesetId?: string;
  template?: 'tile' | 'glyphs';
  fontStacks?: readonly string[];
}>;

export type NativeAdmissionCode =
  | 'NATIVE_ADMISSION_INVALID'
  | 'NATIVE_ADMISSION_CANCELLED'
  | 'NATIVE_ADMISSION_EXPIRED'
  | 'NATIVE_ADMISSION_DENIED'
  | 'NATIVE_ADMISSION_OWNERSHIP'
  | 'NATIVE_ADMISSION_UNAVAILABLE';

export type NativeAdmissionTicket = Readonly<{ticket: string; url: string}>;
export type NativeAdmissionResult =
  | Readonly<{
      ticket: string;
      kind: 'grant';
      validForMs: number;
      authority: Readonly<{
        grant: string;
        mapId: string;
        resourceOrigins: readonly string[];
        resourceScopes: readonly NativeSessionResourceScope[];
        tilesetIds: readonly string[];
      }>;
    }>
  | Readonly<{ticket: string; kind: 'delegate'}>
  | Readonly<{ticket: string; kind: 'reject'; code: NativeAdmissionCode}>;

type ContextEvent = Readonly<{
  installation: string;
  context: string;
  generation: number;
}>;
export type NativeAdmissionEvent =
  | (ContextEvent &
      Readonly<{
        kind: 'batch';
        batch: string;
        tickets: readonly NativeAdmissionTicket[];
      }>)
  | (ContextEvent & Readonly<{kind: 'cancel'; tickets: readonly string[]}> )
  | (ContextEvent & Readonly<{kind: 'retired'; code: NativeAdmissionCode}>)
  | (ContextEvent & Readonly<{kind: 'response'; status: number}>)
  | Readonly<{kind: 'lifecycle'; installation: string; foreground: boolean}>
  | Readonly<{kind: 'ownershipLost'; installation: string}>;

export type NativeContextAck = Readonly<{context: string; generation: number}>;
export type NativeRemovalAck = Readonly<{removed: boolean; ownershipLost: boolean}>;

// Grants cross only completeBatch, never an event, URL, diagnostic or snapshot.
// Native anchors validForMs at the ticket's earlier monotonic enqueue time,
// subtracts the safety margin, and rechecks before every start and redirect.
export type NativeAdmissionBridge = Readonly<{
  subscribe(listener: (event: NativeAdmissionEvent) => void): () => void;
  install(): Promise<Readonly<{installation: string}>>;
  registerContext(
    installation: string,
    registration: Readonly<{mapId: string | null; resources: readonly NativeAdmissionResource[]}>,
  ): Promise<NativeContextAck>;
  // Older internal exact-resource fixtures may omit this capability; extension then fails closed.
  extendContext?(
    installation: string,
    context: string,
    resources: readonly NativeAdmissionResource[],
  ): Promise<Readonly<{resources: number}>>;
  retireContext(installation: string, context: string): Promise<Readonly<{retired: true}>>;
  completeBatch(
    installation: string,
    context: string,
    generation: number,
    batch: string,
    results: readonly NativeAdmissionResult[],
  ): Promise<Readonly<{accepted: number}>>;
  remove(installation: string): Promise<NativeRemovalAck>;
}>;
