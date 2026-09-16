import {
	Camera as NativeCamera,
	Map as NativeMap,
	type CameraProps as NativeCameraProps,
	type CameraRef as NativeCameraRef,
	type MapProps as NativeMapProps,
} from '@maplibre/maplibre-react-native';
import {
	type ReactElement,
	type ReactNode,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {AppState, findNodeHandle, View} from 'react-native';
import type {MapProps} from './contract';
import {createMapLifecycle} from './map-lifecycle';
import {createNativeMapOwner, retireNativeMapOwner} from './native-runtime';

type Lifecycle = ReturnType<typeof createMapLifecycle>;
type Scene = NonNullable<ReturnType<Lifecycle['getSnapshot']>['renderer']>;
const fill = Object.freeze({flex: 1});

function NativeScene({scene, lifecycle, mapOptions, children}: {
	scene: Scene;
	lifecycle: Lifecycle;
	mapOptions: ReturnType<Lifecycle['getSnapshot']>['mapOptions'];
	children?: ReactNode;
}): ReactElement {
	const view = useRef<View | null>(null);
	const camera = useRef<NativeCameraRef | null>(null);
	const tag = useRef<number | null>(null);
	const laidOut = useRef(false);
	const styleLoaded = useRef(false);
	const attachRequested = useRef(false);
	const [initialViewState] = useState<NonNullable<NativeCameraProps['initialViewState']>>(() => {
		const center: [number, number] = [scene.initialView.center[0], scene.initialView.center[1]];
		Object.freeze(center);
		return Object.freeze({
			center,
			zoom: scene.initialView.zoom,
			bearing: scene.initialView.bearing,
			pitch: scene.initialView.pitch,
		});
	});
	const attach = () => {
		if (!tag.current || !laidOut.current || !styleLoaded.current || attachRequested.current) return;
		attachRequested.current = true;
		lifecycle.nativeStyleLoaded(scene.key, tag.current);
	};
	const bind = (node: View | null) => {
		view.current = node;
		if (!node) return;
		const value = findNodeHandle(node);
		if (!Number.isSafeInteger(value) || !value || value < 1) return;
		tag.current = value;
		lifecycle.rootMounted(scene.key, value);
		attach();
	};
	return (
		<View
			ref={bind}
			collapsable={false}
			style={fill}
			onLayout={(event) => {
				const {width, height} = event.nativeEvent.layout;
				laidOut.current = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
				if (view.current) bind(view.current);
				lifecycle.layoutChanged(scene.key);
				attach();
			}}
		>
			<NativeMap
				{...mapOptions}
				style={fill}
				mapStyle={scene.style as NativeMapProps['mapStyle']}
				onDidFinishLoadingStyle={() => {
					// This wakes the private adapter only. A JS callback is not readiness evidence.
					styleLoaded.current = true;
					attach();
				}}
			>
				<NativeCamera
					key="tileflow-camera"
					ref={camera}
					initialViewState={initialViewState}
					minZoom={0}
					maxZoom={24}
				/>
				{children}
			</NativeMap>
		</View>
	);
}

/** A Tileflow-only native Map. Its imperative ref exposes safe source state only. */
export function Map(props: MapProps): ReactElement {
	const [lifecycle] = useState(() => createMapLifecycle(createNativeMapOwner, retireNativeMapOwner));
	const snapshot = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
	useImperativeHandle(props.ref, () => Object.freeze({getSourceState: lifecycle.getSourceState}), [lifecycle]);

	useLayoutEffect(() => {
		const unmount = lifecycle.mount();
		if (AppState.currentState !== 'active') lifecycle.background();
		const subscription = AppState.addEventListener('change', (state) => {
			if (state === 'active') lifecycle.resume();
			else lifecycle.background();
		});
		return () => {
			subscription.remove();
			unmount();
		};
	}, [lifecycle]);
	useLayoutEffect(() => {
		// This includes the React commit following a gesture callback, even when props are equal.
		lifecycle.update(props);
	});

	return (
		<View style={props.style} testID={props.testID}>
			{snapshot.renderer ? (
				<NativeScene
					key={snapshot.renderer.key}
					scene={snapshot.renderer}
					lifecycle={lifecycle}
					mapOptions={snapshot.mapOptions}
				>
					{props.children}
				</NativeScene>
			) : null}
		</View>
	);
}
