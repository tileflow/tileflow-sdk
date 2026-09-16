import {useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {Map as MapLibreMap} from '@maplibre/maplibre-react-native';
import {createReactNativeAdmissionTransport} from '../src/native-admission-bridge';
import {createNativeAdmissionOwner, type NativeMapAdmission} from '../src/native-admission-owner';
import type {HostedNativeSessionBinding} from '../src/session-controller';

type Observation = Readonly<{
	map: 'first' | 'second' | 'third-party';
	kind: 'response' | 'style-ready' | 'renderer-failed';
	status?: number;
}>;
type Slot = Readonly<{key: string; url: string; map: Observation['map']}>;

// Source-checkout development harness, deliberately excluded from package
// exports and tsup entries. Invoke before mounting any native Map view.
export async function createAdmissionHarness(input: {
	binding: Extract<HostedNativeSessionBinding, {kind: 'hosted'}>;
	styleUrl: string;
	alternateStyleUrl: string;
	thirdPartyStyleUrl: string;
	observe: (event: Observation) => void;
}) {
	if (!__DEV__) throw new Error('The admission harness requires a development host.');
	const transport = createReactNativeAdmissionTransport();
	let first: NativeMapAdmission | undefined;
	let second: NativeMapAdmission | undefined;
	const report = (event: Observation) => {
		try { input.observe(Object.freeze(event)); } catch { /* Observers do not own transport. */ }
	};
	const owner = createNativeAdmissionOwner({bridge: transport.bridge, sessionFetch: transport.fetchForContext,
		onObservation(event) {
			const map = event.context === first?.context ? 'first' : event.context === second?.context ? 'second' : undefined;
			if (map) report({map, kind: 'response', status: event.status});
		},
	});
	let session = 0;
	let active = true;
	let alternate = false;
	let slots: readonly Slot[] = [];
	const listeners = new Set<() => void>();
	const publish = (next: readonly Slot[]) => {
		slots = Object.freeze(next.map((slot) => Object.freeze(slot)));
		for (const listener of [...listeners]) listener();
	};
	let stopping: ReturnType<typeof owner.dispose> | undefined;
	const stop = () => {
		if (stopping) return stopping;
		active = false; publish([]);
		stopping = owner.dispose();
		return stopping;
	};
	try {
		const installed = await owner.install();
		const open = () => owner.openMap({
			binding: input.binding,
			resources: [
				{url: input.styleUrl, scope: 'style'},
				{url: input.alternateStyleUrl, scope: 'style'},
			],
			now: () => new Date(),
			sessionIdFactory: () => `${installed.installation}.${++session}`,
		});
		first = await open(); second = await open();
		publish([
			{key: first.context, url: first.discriminateForTest(input.styleUrl), map: 'first'},
			{key: second.context, url: second.discriminateForTest(input.styleUrl), map: 'second'},
			{key: 'third-party', url: input.thirdPartyStyleUrl, map: 'third-party'},
		]);
		function Screen() {
			const views = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => slots, () => slots);
			return <View style={{flex: 1}}>{views.map((slot) => <MapLibreMap
				key={slot.key} testID={`native-admission-${slot.map}`} style={{flex: 1}} mapStyle={slot.url}
				onDidFinishLoadingStyle={() => report({map: slot.map, kind: 'style-ready'})}
				onDidFailLoadingMap={() => report({map: slot.map, kind: 'renderer-failed'})}
			/>)}</View>;
		}
		let transition = Promise.resolve();
		const serial = (operation: () => Promise<void>) => {
			const next = transition.then(async () => {
				if (!active) throw new Error('The admission harness is stopped.');
				await operation();
			});
			transition = next.catch(() => undefined);
			return next;
		};
		return Object.freeze({
			Screen,
			// A style change retains the real Map key and admission context.
			changeFirstStyle: () => serial(async () => {
				if (!first || first.state.status !== 'active') throw new Error('The first Map is retired.');
				alternate = !alternate;
				const url = first.discriminateForTest(alternate ? input.alternateStyleUrl : input.styleUrl);
				publish(slots.map((slot) => slot.map === 'first' ? {...slot, url} : slot));
			}),
			retireFirst: () => serial(async () => {
				if (first) await first.retire();
				publish(slots.filter((slot) => slot.map !== 'first'));
			}),
			// A new real Map always receives a new context and React key.
			replaceFirst: () => serial(async () => {
				if (first) await first.retire();
				first = await open(); alternate = false;
				if (!active) { await first.retire(); return; }
				publish([{key: first.context, url: first.discriminateForTest(input.styleUrl), map: 'first'}, ...slots.filter((slot) => slot.map !== 'first')]);
			}),
			stop,
		});
	} catch {
		await stop().catch(() => undefined);
		throw new Error('The native admission harness could not start.');
	}
}
