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

/** Lazily initializes state ownership from the first committed props, never from placeholder props. */
export function createMountedMapInteractions(
	getStyle: () => NativeInteractionStyle | undefined,
	changed: () => void,
) {
	let disposed = false;
	let foreground = true;
	let owner: ReturnType<typeof createNativeInteractionOwner> | undefined;
	let release: (() => void) | undefined;
	let host: NativeInteractionHost | undefined;
	let proof: NativeInteractionStyle | undefined;
	let query: ReturnType<typeof createNativeInteractionQuery> | undefined;
	let callbacks: NativeInteractionCallbacks = {};
	let initialNotifications: (() => unknown)[] | undefined;
	let touch: {marker?: string; markerActivated?: boolean; mapActivated?: boolean} = {};
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
			return !disposed && foreground && !!proof && !!query && hostCurrent(host) &&
				proof.isCurrent() && getStyle() === proof;
		} catch { return false; }
	};
	const sync = () => {
		if (disposed || !owner) return;
		let next: NativeInteractionStyle | undefined;
		const mounted = host;
		try {
			next = foreground && hostCurrent(mounted) ? getStyle() : undefined;
			if (next && (!next.isCurrent() || next.key !== mounted?.key || next.style !== mounted.style))
				next = undefined;
		} catch { next = undefined; }
		if (next === proof && (next === undefined || query)) return;
		const previous = query;
		query = undefined;
		proof = undefined;
		previous?.retire();
		if (!next || !mounted) {
			owner.replaceStyle();
			notify();
			return;
		}
		const accepted = next;
		proof = accepted;
		query = createNativeInteractionQuery(accepted.style, () =>
			!disposed && foreground && host === mounted && hostCurrent(mounted) &&
			proof === accepted && accepted.isCurrent() && getStyle() === accepted,
			mounted.query);
		owner.replaceStyle(query.lease);
		notify();
	};
	const currentAnnotation = (annotation: TileflowAnnotation) =>
		owner?.getSnapshot().annotations.some((candidate) => candidate === annotation) === true;
	const claimMarker = (annotation: TileflowAnnotation): boolean => {
		if (disposed || !owner) return false;
		// Claim before activation so a native map event cannot also activate a semantic feature.
		if (touch.marker !== undefined && touch.marker !== annotation.id) return false;
		touch.marker = annotation.id;
		owner.cancelTouch();
		if (!ready()) return false;
		if (!currentAnnotation(annotation)) { report('STALE_TARGET'); return false; }
		return true;
	};
	return Object.freeze({
		getSnapshot: () => owner?.getSnapshot(),
		get ready() { return ready(); },
		sync,
		update<TAnnotation extends TileflowAnnotation>(props: MapInteractionProps<TAnnotation>): void {
			if (disposed) return;
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
				for (const notification of notifications) invoke(notification);
				notify();
			} else owner.update(props);
			if (invalidCallback) report('INVALID_FIELD');
			sync();
		},
		bind(next: NativeInteractionHost): void {
			if (disposed || host === next) return;
			if (host) {
				query?.retire();
				query = undefined;
				proof = undefined;
				owner?.replaceStyle();
			}
			host = next;
			sync();
		},
		unbind(expected: NativeInteractionHost): void {
			if (host !== expected) return;
			host = undefined;
			sync();
		},
		beginTouch(): void {
			if (disposed) return;
			touch = {};
			owner?.cancelTouch();
		},
		claimMarker,
		markerPress(annotation: TileflowAnnotation): void {
			if (!claimMarker(annotation) || touch.markerActivated) return;
			touch.markerActivated = true;
			owner?.activateAnnotation(annotation.id, 'touch');
		},
		async mapPress(input: unknown): Promise<void> {
			if (disposed || !foreground || !owner || touch.marker || touch.mapActivated) return;
			sync();
			if (!ready()) return;
			touch.mapActivated = true;
			await owner.activateTouch(input);
		},
		report,
		background(): void {
			if (disposed) return;
			foreground = false;
			touch = {};
			owner?.cancelTouch();
			sync();
		},
		resume(): void {
			if (disposed) return;
			foreground = true;
			sync();
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			host = undefined;
			proof = undefined;
			query?.retire();
			query = undefined;
			release?.();
			owner?.dispose();
			callbacks = {};
			initialNotifications = undefined;
			touch = {};
		},
	});
}
