import {
	resolveTileflowNativeInitialView,
	type TileflowNativeInitialView,
	type TileflowNativeSource,
	type TileflowNativeSourceState,
} from '@tileflow/core/native';

const input: TileflowNativeSource = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
void input;
// @ts-expect-error A native source requires an explicit manifest URL.
const missingUrl: TileflowNativeSource = {map: 'main'};
void missingUrl;
// @ts-expect-error Renderer selectors are not part of a Tileflow source.
const rendererSource: TileflowNativeSource = {...input, kind: 'tileflow'};
void rendererSource;
// @ts-expect-error Arbitrary style data is not a Tileflow source.
const styleSource: TileflowNativeSource = {style: 'https://maps.example.test/style.json'};
void styleSource;

export function narrow(state: TileflowNativeSourceState): string | undefined {
	if (state.status !== 'ready') return undefined;
	const url: string = state.manifestUrl;
	const map: string = state.map.name;
	const theme: string = state.theme.name;
	const version: 1 = state.manifest.version;
	const view: TileflowNativeInitialView = resolveTileflowNativeInitialView({manifestView: state.map.view});
	// @ts-expect-error Sources do not carry raw style data.
	void state.source.style;
	// @ts-expect-error Selections have no renderer discriminator.
	void state.kind;
	// @ts-expect-error Ready source snapshots are immutable.
	state.source.map = 'changed';
	// @ts-expect-error Manifest selections are deeply immutable.
	state.map.themes.light!.styleUrl = 'changed';
	return `${url}:${map}:${theme}:${version}:${view.zoom}`;
}

const view = resolveTileflowNativeInitialView({view: {center: [1, 2]}, mapOptionsView: {zoom: 5}});
const tuple: readonly [number, number] = view.center;
void tuple;
// @ts-expect-error A canonical view is immutable.
view.zoom = 4;
// @ts-expect-error The coordinate order is a two-element tuple, not an upstream camera object.
resolveTileflowNativeInitialView({view: {center: {lat: 1, lng: 2}}});
