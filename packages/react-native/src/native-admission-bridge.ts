import {NativeEventEmitter, NativeModules} from 'react-native';
import {createNativeAdmissionWire} from './native-admission-wire';
import {NativeAdmissionError} from './native-admission-owner';
import type {NativeAdmissionEvent} from './native-admission-contract';
import type {NativeAdmissionNativeModule} from './native-bootstrap-contract';

// Explicit internal installation only. Importing the package root never
// evaluates this module or changes the MapLibre networking seam.
export function createReactNativeAdmissionTransport() {
	const module = NativeModules.TileflowNativeAdmission;
	for (const name of ['install', 'registerContext', 'retireContext', 'completeBatch', 'remove', 'bootstrap', 'cancelBootstrap', 'addListener', 'removeListeners']) {
		if (!module || typeof module[name] !== 'function') throw new NativeAdmissionError('NATIVE_ADMISSION_UNAVAILABLE');
	}
	const emitter = new NativeEventEmitter(module);
	return createNativeAdmissionWire(module as NativeAdmissionNativeModule, (listener) => {
		const subscription = emitter.addListener('TileflowNativeAdmissionEvent', (event: NativeAdmissionEvent) => listener(event));
		return () => subscription.remove();
	});
}
