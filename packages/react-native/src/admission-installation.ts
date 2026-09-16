import {nativeAdmissionLimits} from './native-admission-contract';
import {
  NativeAdmissionError,
  type NativeMapAdmission,
  type NativeMapAdmissionInput,
} from './native-admission-owner';

type Installation = {
  openMap(input: NativeMapAdmissionInput): Promise<NativeMapAdmission>;
  dispose(): Promise<unknown>;
};

type Lease = Readonly<{
  ready: Promise<NativeMapAdmission>;
  retire(): Promise<void>;
}>;

type Entry = {lease: Lease; retiring: boolean};
type Epoch = {
  owner: Installation;
  entries: Set<Entry>;
  sealed: boolean;
  removal?: Promise<void>;
};

/** Shared installation lifetime only. Every lease has its own native context and controller. */
export function createAdmissionInstallation(create: () => Installation) {
  let current: Epoch | undefined;
  const entries = new Set<Entry>();
  const starts = new Set<Promise<void>>();
  const unavailable = () => new NativeAdmissionError('NATIVE_ADMISSION_UNAVAILABLE');

  function remove(epoch: Epoch): Promise<void> {
    if (epoch.removal) return epoch.removal;
    epoch.sealed = true;
    const attempt = Promise.resolve().then(async () => {
      try {
        await epoch.owner.dispose();
        if (current === epoch) current = undefined;
      } catch {
        throw unavailable();
      }
    });
    epoch.removal = attempt;
    void attempt.catch(() => {
      if (epoch.removal === attempt) epoch.removal = undefined;
    });
    return attempt;
  }

  async function drain(epoch: Epoch): Promise<void> {
    if (epoch.entries.size === 0) return remove(epoch);
    // A sealed epoch has no live lease; failed acknowledgements remain retryable.
    await Promise.all([...epoch.entries].map((entry) => entry.lease.retire()));
  }

  function open(input: NativeMapAdmissionInput): Lease {
    let resolve!: (map: NativeMapAdmission) => void;
    let reject!: (error: NativeAdmissionError) => void;
    const ready = new Promise<NativeMapAdmission>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void ready.catch(() => undefined);
    let epoch: Epoch | undefined;
    let resolveWork!: (map: NativeMapAdmission | null) => void;
    let rejectWork!: (error: unknown) => void;
    const work = new Promise<NativeMapAdmission | null>((yes, no) => {
      resolveWork = yes;
      rejectWork = no;
    });
    void work.catch(() => undefined);
    let retirement: Promise<void> | undefined;
    let released = false;
    const entry: Entry = {lease: undefined as unknown as Lease, retiring: false};
    const lease: Lease = Object.freeze({
      ready,
      retire(): Promise<void> {
        if (retirement) return retirement;
        entry.retiring = true;
        reject(new NativeAdmissionError('NATIVE_ADMISSION_CANCELLED'));
        if (epoch && [...epoch.entries].every((item) => item.retiring)) epoch.sealed = true;
        const attempt = work
          .catch(() => null)
          .then(async (map) => {
            try {
              if (!released) {
                if (map) {
                  const ack = await map.retire();
                  if (ack?.retired !== true) throw unavailable();
                }
                released = true;
                epoch?.entries.delete(entry);
                entries.delete(entry);
              }
              if (epoch && epoch.entries.size === 0) await remove(epoch);
            } catch {
              throw unavailable();
            }
          });
        retirement = attempt;
        void attempt.catch(() => {
          if (retirement === attempt) retirement = undefined;
        });
        return attempt;
      },
    });
    entry.lease = lease;
    if (entries.size >= nativeAdmissionLimits.contexts) {
      reject(unavailable());
      resolveWork(null);
      return lease;
    }
    entries.add(entry);
    const start = Promise.resolve().then(async () => {
      try {
        while (current?.sealed) await drain(current);
        if (entry.retiring) {
          resolveWork(null);
          return;
        }
        if (!current) current = {owner: create(), entries: new Set(), sealed: false};
        epoch = current;
        epoch.entries.add(entry);
        const pending = epoch.owner.openMap(input);
        void pending.then(
          (map) => {
            resolveWork(map);
            if (!entry.retiring) resolve(map);
          },
          () => {
            rejectWork(unavailable());
            reject(unavailable());
            void lease.retire().catch(() => undefined);
          },
        );
      } catch {
        rejectWork(unavailable());
        reject(unavailable());
        void lease.retire().catch(() => undefined);
      }
    });
    starts.add(start);
    void start.then(() => starts.delete(start));
    return lease;
  }

  return Object.freeze({
    open,
    /** Retry only retired leases. An active Map cannot be removed by another Map's cleanup. */
    async retryRetirements(): Promise<void> {
      await Promise.all(
        [...entries].filter((entry) => entry.retiring).map((entry) => entry.lease.retire()),
      );
      if (current?.sealed && current.entries.size === 0) await remove(current);
    },
    /** Registration scheduling barrier; this does not acknowledge a context or native work. */
    async whenIdle(): Promise<void> {
      await Promise.all([...starts]);
    },
  });
}
