import type {
	TileflowAnnotation,
	TileflowInteractionDiagnosticCode,
	TileflowInteractionEvent,
} from '@tileflow/interactions';
import type {MapInteractionProps} from './interaction-contract';
import {nativeInteractionDiagnostic} from './native-interaction-input';
import {
	createNativeInteractionOwner,
	type NativeInteractionCallbacks,
} from './native-interaction-owner';
import {createNativeInteractionQuery, type NativeInteractionQuery} from './native-interaction-query';
import type {NativeInteractionStyle} from './native-interaction-style';

/** One mounted NativeScene supplies this private host; no handle enters portable state. */
export type NativeInteractionHost = Readonly<{
	key: string;
	style: Readonly<Record<string, unknown>>;
	current(): boolean;
	query: NativeInteractionQuery;
}>;
type Touch = {
	proof: NativeInteractionStyle;
	host: NativeInteractionHost;
	marker?: string;
	markerActivated?: boolean;
	mapActivated?: boolean;
};

/** Lazily initializes state ownership from the first committed props, never from placeholder props. */
export function createMountedMapInteractions(
	getStyle: () => NativeInteractionStyle | undefined,
	changed: () => void,
) {
	let disposed = false;
	let foreground = true;
	let propsVersion = 0;
	let ownershipVersion = 0;
	let touchVersion = 0;
	let owner: ReturnType<typeof createNativeInteractionOwner> | undefined;
	let release: (() => void) | undefined;
	let host: NativeInteractionHost | undefined;
	let boundHost: NativeInteractionHost | undefined;
	let proof: NativeInteractionStyle | undefined;
	let query: ReturnType<typeof createNativeInteractionQuery> | undefined;
	let callbacks: NativeInteractionCallbacks = {};
	let initialNotifications: (() => unknown)[] | undefined;
	let touch: Touch | undefined;
	const invoke = (work: () => unknown) => {
		if (disposed) return;
		if (initialNotifications) { initialNotifications.push(work); return; }
		try { void Promise.resolve(work()).catch(() => undefined); }
		catch { /* Observer errors cannot alter native ownership. */ }
	};
	const notify = () => { if (!disposed) invoke(changed); };
	const foundationCallbacks: NativeInteractionCallbacks = {
		onInteractionEvent: (event) => invoke(() => callbacks.onInteractionEvent?.(event)),
		onInteractionStateChange: (state) => invoke(() => callbacks.onInteractionStateChange?.(state)),
		onDiagnostic: (diagnostic) => invoke(() => callbacks.onDiagnostic?.(diagnostic)),
	};
	const report = (code: TileflowInteractionDiagnosticCode) =>
		invoke(() => callbacks.onDiagnostic?.(nativeInteractionDiagnostic(code)));
	const hostCurrent = (candidate: NativeInteractionHost | undefined) => {
		try { return !!candidate && candidate.current(); } catch { return false; }
	};
	const ready = () => {
		try {
			return !disposed && foreground && !!proof && !!query && host === boundHost &&
				hostCurrent(host) && proof.isCurrent() && getStyle() === proof;
		} catch { return false; }
	};
	const createQuery = (accepted: NativeInteractionStyle, mounted: NativeInteractionHost) =>
		createNativeInteractionQuery(accepted.style, () =>
			!disposed && foreground && host === mounted && hostCurrent(mounted) &&
			proof === accepted && accepted.isCurrent() && getStyle() === accepted,
			mounted.query);
	const sync = () => {
		if (disposed || !owner) return;
		const version = ownershipVersion;
		let next: NativeInteractionStyle | undefined;
		const mounted = host;
		try {
			next = foreground && hostCurrent(mounted) ? getStyle() : undefined;
			if (next && (!mounted || !next.isCurrent() || next.key !== mounted.key || next.style !== mounted.style))
				next = undefined;
		} catch { next = undefined; }
		if (disposed || version !== ownershipVersion || mounted !== host) return;
		if (next === proof && (next === undefined || (query && mounted === boundHost))) return;
		++ownershipVersion;
		const previous = query;
		query = undefined;
		proof = undefined;
		boundHost = undefined;
		touch = undefined;
		previous?.retire();
		if (!next || !mounted) {
			owner.replaceStyle();
			notify();
			return;
		}
		proof = next;
		boundHost = mounted;
		query = createQuery(next, mounted);
		owner.replaceStyle(query.lease);
		notify();
	};
	const currentTouch = (candidate: Touch | undefined): candidate is Touch =>
		!!candidate && touch === candidate && candidate.proof === proof && candidate.host === host && ready();
	const currentAnnotation = (annotation: TileflowAnnotation) =>
		owner?.getSnapshot().annotations.some((candidate) => candidate === annotation) === true;
	const claimMarker = (annotation: TileflowAnnotation): boolean => {
		const gesture = touch;
		if (!owner || !currentTouch(gesture)) return false;
		if (!currentAnnotation(annotation)) { report('STALE_TARGET'); return false; }
		if (gesture.marker !== undefined && gesture.marker !== annotation.id) return false;
		// Claim before activation so a native map event cannot also activate a semantic feature.
		if (gesture.marker === undefined) {
			gesture.marker = annotation.id;
			owner.cancelTouch();
		}
		return currentTouch(gesture);
	};
	return Object.freeze({
		getSnapshot: () => owner?.getSnapshot(),
		get ready() { return ready(); },
		sync,
		update<TAnnotation extends TileflowAnnotation>(props: MapInteractionProps<TAnnotation>): void {
			if (disposed) return;
			const version = ++propsVersion;
			let invalidCallback = false;
			const callback = (key: keyof MapInteractionProps<TAnnotation>): unknown => {
				try {
					const descriptor = Object.getOwnPropertyDescriptor(props, key);
					if (!descriptor) return undefined;
					if (!('value' in descriptor) || !descriptor.enumerable ||
						(descriptor.value !== undefined && typeof descriptor.value !== 'function')) throw new Error();
					return descriptor.value;
				} catch { invalidCallback = true; return undefined; }
			};
			const event = callback('onInteractionEvent') as MapInteractionProps<TAnnotation>['onInteractionEvent'];
			const state = callback('onInteractionStateChange') as MapInteractionProps<TAnnotation>['onInteractionStateChange'];
			const diagnostic = callback('onInteractionDiagnostic') as MapInteractionProps<TAnnotation>['onInteractionDiagnostic'];
			if (disposed || propsVersion !== version) return;
			callbacks = {
				// Stage A retains detached annotation JSON; this boundary restores the consumer's generic type.
				onInteractionEvent: (value) => event?.(value as TileflowInteractionEvent<TAnnotation>),
				onInteractionStateChange: state,
				onDiagnostic: diagnostic,
			};
			if (!owner) {
				initialNotifications = [];
				owner = createNativeInteractionOwner(props, foundationCallbacks);
				release = owner.subscribe(notify);
				const notifications = initialNotifications;
				initialNotifications = undefined;
				for (const notification of notifications) {
					if (disposed || propsVersion !== version) return;
					invoke(notification);
				}
				notify();
			} else owner.update(props);
			if (disposed || propsVersion !== version) return;
			if (invalidCallback) report('INVALID_FIELD');
			sync();
		},
		bind(next: NativeInteractionHost): void {
			if (disposed || host === next) return;
			++ownershipVersion;
			host = next;
			touch = undefined;
			sync();
		},
		unbind(expected: NativeInteractionHost): void {
			if (host !== expected) return;
			++ownershipVersion;
			host = undefined;
			touch = undefined;
			sync();
		},
		beginTouch(): void {
			if (disposed) return;
			const intent = ++touchVersion;
			touch = undefined;
			owner?.cancelTouch();
			sync();
			if (!ready() || !owner || !proof || !host || !query) return;
			const accepted = proof;
			const mounted = host;
			const previous = query;
			const next = createQuery(accepted, mounted);
			query = next;
			const renewed = owner.renewTouchLease(next.lease);
			// The old lease is permanently invalid before this newer gesture can issue a query.
			previous.retire();
			if (disposed || query !== next || touchVersion !== intent) return;
			if (!renewed || proof !== accepted || host !== mounted || !ready()) {
				next.retire();
				query = undefined;
				proof = undefined;
				boundHost = undefined;
				owner.replaceStyle();
				notify();
				return;
			}
			touch = {proof: accepted, host: mounted};
		},
		claimMarker,
		markerPress(annotation: TileflowAnnotation): void {
			const gesture = touch;
			if (!currentTouch(gesture) || gesture.markerActivated || !claimMarker(annotation)) return;
			gesture.markerActivated = true;
			owner?.activateAnnotation(annotation.id, 'touch');
		},
		async mapPress(input: unknown): Promise<void> {
			const gesture = touch;
			if (!owner || !currentTouch(gesture) || gesture.marker || gesture.mapActivated) return;
			sync();
			if (!currentTouch(gesture)) return;
			gesture.mapActivated = true;
			await owner.activateTouch(input);
		},
		report,
		background(): void {
			if (disposed) return;
			++ownershipVersion;
			foreground = false;
			touch = undefined;
			owner?.cancelTouch();
			sync();
		},
		resume(): void {
			if (disposed) return;
			++ownershipVersion;
			foreground = true;
			sync();
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			++ownershipVersion;
			++propsVersion;
			host = undefined;
			boundHost = undefined;
			proof = undefined;
			query?.retire();
			query = undefined;
			release?.();
			owner?.dispose();
			callbacks = {};
			initialNotifications = undefined;
			touch = undefined;
		},
	});
}
