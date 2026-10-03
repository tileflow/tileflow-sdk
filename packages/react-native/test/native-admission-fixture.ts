import type {
  NativeAdmissionBridge,
  NativeAdmissionEvent,
  NativeAdmissionResource,
  NativeAdmissionResult,
  NativeContextAck,
} from '../src/native-admission-contract';
import {deferred} from './session-fixture';

export const styleResource: NativeAdmissionResource = Object.freeze({
  url: 'https://maps.example.test/light.json',
  scope: 'style',
});

// This double models only bridge messages and acknowledgements. Native network
// safety must be tested against the actual Android and iOS implementations.
export class AdmissionBridgeDouble implements NativeAdmissionBridge {
  listener: (event: NativeAdmissionEvent) => void = () => undefined;
  readonly installation = 'installation_1';
  readonly registrations = new Map<
    string,
    {mapId: string | null; resources: readonly NativeAdmissionResource[]}
  >();
  readonly completions: Array<{context: string; results: readonly NativeAdmissionResult[]}> = [];
  readonly retirements: string[] = [];
  readonly removals: string[] = [];
  installGate: Promise<{installation: string}> | undefined;
  removeGate: Promise<{removed: boolean; ownershipLost: boolean}> | undefined;
  registerGate: Promise<void> | undefined;
  retireGate: Promise<void> | undefined;
  sequence = 0;
  batchSequence = 0;
  private pending = new Map<
    string,
    {context: string; resolve: (results: readonly NativeAdmissionResult[]) => void}
  >();

  subscribe(listener: (event: NativeAdmissionEvent) => void) {
    this.listener = listener;
    return () => {
      this.listener = () => undefined;
    };
  }

  emit(event: NativeAdmissionEvent) {
    this.listener(event);
  }

  async install() {
    return this.installGate ?? {installation: this.installation};
  }

  async registerContext(
    _installation: string,
    registration: {mapId: string | null; resources: readonly NativeAdmissionResource[]},
  ): Promise<NativeContextAck> {
    await this.registerGate;
    const context = `${this.installation}.${++this.sequence}`;
    this.registrations.set(context, registration);
    return {context, generation: 1};
  }

  async retireContext(_installation: string, context: string): Promise<{retired: true}> {
    await this.retireGate;
    this.retirements.push(context);
    this.registrations.delete(context);
    for (const [id, pending] of this.pending) {
      if (pending.context !== context) continue;
      pending.resolve([]);
      this.pending.delete(id);
    }
    return {retired: true};
  }

  async completeBatch(
    _installation: string,
    context: string,
    _generation: number,
    batch: string,
    results: readonly NativeAdmissionResult[],
  ) {
    this.completions.push({context, results});
    this.pending.get(batch)?.resolve(results);
    this.pending.delete(batch);
    return {accepted: results.filter((result) => result.kind !== 'reject').length};
  }

  async remove(installation: string) {
    this.removals.push(installation);
    for (const context of [...this.registrations.keys()])
      await this.retireContext(installation, context);
    return this.removeGate ?? {removed: true, ownershipLost: false};
  }

  batch(context: string, urls: readonly string[], generation = 1) {
    const batch = String(++this.batchSequence);
    const result = deferred<readonly NativeAdmissionResult[]>();
    this.pending.set(batch, {context, resolve: result.resolve});
    const tickets = urls.map((url, index) => ({ticket: `${batch}.${index}`, url}));
    this.listener({
      kind: 'batch',
      installation: this.installation,
      context,
      generation,
      batch,
      tickets,
    });
    return {promise: result.promise, tickets, batch};
  }
}
