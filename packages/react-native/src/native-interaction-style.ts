export type NativeInteractionStyle = Readonly<{
	key: string;
	token: string;
	style: Readonly<Record<string, unknown>>;
	isCurrent(): boolean;
}>;

/** Only the renderer owner may publish after receiving its matching native-surface style token. */
export function createNativeInteractionStyleOwner(changed: () => void) {
	let proof: NativeInteractionStyle | undefined;
	let revoke: (() => void) | undefined;
	const notify = () => {
		try { changed(); } catch { /* Observers cannot extend native ownership. */ }
	};
	return Object.freeze({
		get(): NativeInteractionStyle | undefined {
			return proof?.isCurrent() ? proof : undefined;
		},
		publish(key: string, token: string, style: Readonly<Record<string, unknown>>, current: () => boolean): void {
			revoke?.();
			let live = true;
			revoke = () => { live = false; };
			proof = Object.freeze({key, token, style, isCurrent: () => live && current()});
			notify();
		},
		retire(): void {
			if (!proof) return;
			revoke?.();
			revoke = undefined;
			proof = undefined;
			notify();
		},
	});
}
