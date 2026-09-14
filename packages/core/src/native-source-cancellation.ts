import {TileflowNativeSourceError, type TileflowNativeAbortSignal} from './native-source-types';

/** Internal retirement token: deliberately not an AbortSignal polyfill. */
export class NativeSourceCancellation {
	private cancelled = false;
	private readonly listeners = new Set<() => void>();

	get aborted(): boolean { return this.cancelled; }

	cancel(): void {
		if (this.cancelled) return;
		this.cancelled = true;
		const listeners = [...this.listeners];
		this.listeners.clear();
		for (const listener of listeners) { try { listener(); } catch { /* Cleanup cannot undo retirement. */ } }
	}

	check(): void {
		if (this.cancelled) throw new TileflowNativeSourceError('NATIVE_SOURCE_ABORTED', 'signal');
	}

	onCancel(listener: () => void): () => void {
		if (this.cancelled) { listener(); return () => undefined; }
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	race<T>(promise: Promise<T>): Promise<T> {
		// Attach both handlers even when already retired; late rejections must be observed.
		return new Promise<T>((resolve, reject) => {
			const off = this.onCancel(() => reject(new TileflowNativeSourceError('NATIVE_SOURCE_ABORTED', 'signal')));
			promise.then((value) => { off(); resolve(value); }, (error: unknown) => { off(); reject(error); });
		});
	}

	link(signal: TileflowNativeAbortSignal | undefined): () => void {
		if (signal === undefined) return () => undefined;
		let onAbort: (() => void) | undefined;
		try {
			if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' ||
				typeof signal.removeEventListener !== 'function') throw new Error();
			onAbort = () => this.cancel();
			if (signal.aborted) { this.cancel(); return () => undefined; }
			signal.addEventListener('abort', onAbort, {once: true});
			if (signal.aborted) this.cancel();
		} catch {
			if (onAbort) { try { signal.removeEventListener('abort', onAbort); } catch { /* No remote exceptions. */ } }
			throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'signal');
		}
		return () => { try { signal.removeEventListener('abort', onAbort!); } catch { /* No remote exceptions. */ } };
	}
}

/** Cleanup is best-effort and never awaited: a broken adapter cannot keep a retired load pending. */
export function cancelNativeOperation(cancel: () => void | Promise<void>): void {
	try { void Promise.resolve(cancel()).catch(() => undefined); } catch { /* No remote exceptions. */ }
}
