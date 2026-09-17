import type {TileflowAnnotation, TileflowInteractionDiagnosticCode} from '@tileflow/interactions';
import type {MapProps} from './contract';
import {createMountedMapInteractions, type NativeInteractionHost} from './mounted-map-interactions';
import type {createMountedMapOwner} from './mounted-map-owner';

type Owner = ReturnType<typeof createMountedMapOwner>;
type Interactions = ReturnType<typeof createMountedMapInteractions>;
type NativeSnapshot = ReturnType<Owner['getSnapshot']>;
type Snapshot = NativeSnapshot & Readonly<{
	interactions?: ReturnType<Interactions['getSnapshot']>;
	interactionEnabled?: boolean;
}>;
type Epoch = {owner: Owner; interactions: Interactions; release(): void};
const empty: Snapshot = Object.freeze({revision: 0, mapOptions: Object.freeze({})});

/** React can replay an effect without reusing disposed native/controller ownership. */
export function createMapLifecycle(create: () => Owner, retire: (owner: Owner) => void) {
	let active: Epoch | undefined;
	let snapshot = empty;
	let lastNative: NativeSnapshot | undefined;
	let refreshing = false;
	let refreshAgain = false;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of [...listeners]) {
			try { listener(); } catch { /* Subscribers do not own native cleanup. */ }
		}
	};
	const refresh = (epoch: Epoch) => {
		if (active !== epoch) return;
		if (refreshing) { refreshAgain = true; return; }
		refreshing = true;
		try {
			do {
				refreshAgain = false;
				epoch.interactions.sync();
				if (active !== epoch) return;
				const native = epoch.owner.getSnapshot();
				const interactions = epoch.interactions.getSnapshot();
				const interactionEnabled = epoch.interactions.ready;
				if (native !== lastNative || interactions !== snapshot.interactions ||
					interactionEnabled !== snapshot.interactionEnabled) {
					lastNative = native;
					snapshot = Object.freeze({...native, interactions, interactionEnabled});
					notify();
				}
			} while (refreshAgain && active === epoch);
		} finally { refreshing = false; }
	};
	return Object.freeze({
		getSnapshot: (): Snapshot => snapshot,
		getSourceState() { return active?.owner.getSourceState(); },
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		mount(): () => void {
			if (active) throw new Error('Native Map is already mounted.');
			const owner = create();
			const interactions = createMountedMapInteractions(
				() => owner.getInteractionStyle(),
				() => refresh(epoch),
			);
			const epoch: Epoch = {owner, interactions, release: () => undefined};
			active = epoch;
			epoch.release = owner.subscribe(() => refresh(epoch));
			refresh(epoch);
			let closed = false;
			return () => {
				if (closed) return;
				closed = true;
				if (active === epoch) {
					active = undefined;
					snapshot = empty;
					lastNative = undefined;
				}
				epoch.interactions.dispose();
				epoch.release();
				retire(owner);
				notify();
			};
		},
		update<TAnnotation extends TileflowAnnotation>(props: MapProps<TAnnotation>): void {
			const epoch = active;
			if (!epoch) return;
			epoch.interactions.update(props);
			if (active !== epoch) return;
			epoch.owner.update(props);
			refresh(epoch);
		},
		bindInteractionHost(host: NativeInteractionHost): void {
			const epoch = active;
			if (!epoch || epoch.owner.getSnapshot().renderer?.key !== host.key) return;
			epoch.interactions.bind(host);
			refresh(epoch);
		},
		unbindInteractionHost(host: NativeInteractionHost): void {
			active?.interactions.unbind(host);
		},
		beginTouch(): void { active?.interactions.beginTouch(); },
		claimMarker(annotation: TileflowAnnotation): void { active?.interactions.claimMarker(annotation); },
		markerPress(annotation: TileflowAnnotation): void { active?.interactions.markerPress(annotation); },
		mapPress(input: unknown): void {
			void active?.interactions.mapPress(input).catch(() => undefined);
		},
		interactionDiagnostic(code: TileflowInteractionDiagnosticCode): void { active?.interactions.report(code); },
		rootMounted(key: string, root: number): void { active?.owner.rootMounted(key, root); },
		nativeStyleLoaded(key: string, root: number): void { active?.owner.nativeStyleLoaded(key, root); },
		layoutChanged(key: string): void { active?.owner.layoutChanged(key); },
		background(): void {
			active?.interactions.background();
			active?.owner.background();
		},
		resume(): void {
			active?.owner.resume();
			active?.interactions.resume();
		},
	});
}
