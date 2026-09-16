import type {MapOptions} from './contract';

const allowed = new Set([
	'dragPan', 'touchZoom', 'doubleTapZoom', 'doubleTapHoldZoom', 'touchRotate',
	'touchPitch', 'compass', 'compassHiddenFacingNorth', 'scaleBar',
]);

/** Own data properties only. Caller values never enter option diagnostics. */
export function snapshotNativeMapOptions(value: unknown): MapOptions {
	try {
		if (value === undefined) return Object.freeze({});
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new Error();
		const keys = Reflect.ownKeys(value);
		if (keys.length > allowed.size) throw new Error();
		const result: Record<string, boolean> = {};
		for (const key of keys) {
			if (typeof key !== 'string' || !allowed.has(key)) throw new Error();
			const property = Object.getOwnPropertyDescriptor(value, key);
			if (!property || !property.enumerable || !('value' in property)) throw new Error();
			if (property.value === undefined) continue;
			if (typeof property.value !== 'boolean') throw new Error();
			result[key] = property.value;
		}
		return Object.freeze(result) as MapOptions;
	} catch {
		throw new Error('Native map options are invalid.');
	}
}
