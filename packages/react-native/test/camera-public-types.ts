import type {
	MapCameraProps,
	MapProps,
	MapRef,
	MapView,
	MapViewChangeEvent,
} from '@tileflow/react-native';

function accepts(value: MapProps): void { void value; }
const source = {kind: 'maplibre', style: 'https://maps.example.test/style.json'} as const;
const view: MapView = {center: [0, 20], zoom: 2, bearing: 0, pitch: 0};
const change = (event: MapViewChangeEvent) => { void event.view; };

accepts({source});
accepts({source, initialView: {zoom: 8}});
accepts({source, initialView: {center: [10, 30]}, onViewChange: change});
accepts({source, view, onViewChange: change});
accepts({source: {kind: 'tileflow', map: 'streets', manifestUrl: 'https://maps.example.test/manifest.json'}, theme: 'system', view, onViewChange: change});

// @ts-expect-error A controlled view requires observation/adoption by the parent.
accepts({source, view});
// @ts-expect-error A controlled view is complete, not a partial seed.
accepts({source, view: {zoom: 5}, onViewChange: change});
// @ts-expect-error Ownership modes are mutually exclusive.
accepts({source, initialView: {}, view, onViewChange: change});
// @ts-expect-error Direct styles cannot gain a theme through the camera contract.
accepts({source, theme: 'dark', view, onViewChange: change});
// @ts-expect-error No public animation policy has been introduced.
accepts({source, view, onViewChange: change, duration: 100});
// @ts-expect-error Bounds and padding are not initial-view props.
accepts({source, initialView: {bounds: [0, 1, 2, 3]}});
// @ts-expect-error View events do not accept a raw MapLibre callback signature.
accepts({source, view, onViewChange: (_native: {nativeEvent: unknown}) => undefined});

export function narrowsOwnership(props: MapCameraProps): void {
	if (props.view !== undefined) {
		const controlled: MapView = props.view;
		props.onViewChange({type: 'view-change', view: controlled});
		const absent: undefined = props.initialView;
		void absent;
	} else {
		const absent: undefined = props.view;
		void absent;
		props.onViewChange?.({type: 'view-change', view});
		const zoom: number | undefined = props.initialView?.zoom;
		void zoom;
	}
}

export function immutableEvent(event: MapViewChangeEvent, ref: MapRef): void {
	const type: 'view-change' = event.type;
	const complete: MapView = event.view;
	void type;
	void complete;
	// @ts-expect-error Events are immutable.
	event.view = view;
	// @ts-expect-error The tuple is also immutable.
	event.view.center[0] = 3;
	// @ts-expect-error Events contain no gesture or renderer handle.
	const native = event.nativeEvent;
	void native;
	// @ts-expect-error Command tokens are not public event metadata.
	const token = event.token;
	void token;
	// @ts-expect-error A public imperative camera escape hatch remains excluded.
	ref.setCamera(view);
}
