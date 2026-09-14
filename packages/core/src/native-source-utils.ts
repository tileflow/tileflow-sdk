/** Snapshot plain caller-owned records without evaluating their getters. */
export function nativeOwnRecord(value: unknown): Record<string, unknown> | undefined {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== null && prototype !== Object.prototype) return undefined;
		const result: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(value)) {
			const property = Object.getOwnPropertyDescriptor(value, key);
			if (!property || !('value' in property)) return undefined;
			result[key] = property.value;
		}
		return result;
	} catch { return undefined; }
}

/** Only call on fresh canonical JSON, never on caller-owned input or adapter objects. */
export function freezeNativeSnapshot<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeNativeSnapshot(child);
		Object.freeze(value);
	}
	return value;
}
