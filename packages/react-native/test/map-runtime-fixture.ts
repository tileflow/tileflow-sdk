import {execFile} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

/** Import isolation only; mounted React and native rendering are qualified in the local harness. */
export async function inspectPublicMapRuntime(): Promise<unknown> {
	const directory = await mkdtemp(join(tmpdir(), 'tileflow-map-runtime-'));
	try {
		const module = async (name: string, exports: Record<string, string>, source: string) => {
			const root = join(directory, 'node_modules', name);
			await mkdir(root, {recursive: true});
			await writeFile(join(root, 'package.json'), JSON.stringify({name, type: 'module', exports}));
			await writeFile(join(root, 'index.js'), source);
			return root;
		};
		await module(
			'react',
			{'.': './index.js', './jsx-runtime': './index.js'},
			`
			export const jsx = (type, props, key) => ({type, props, key});
			export const jsxs = jsx;
			export const Fragment = Symbol('Fragment');
			export const createElement = jsx;
			export const memo = (value) => value;
			export function isValidElement() { throw new Error('Marker content evaluated during import.'); }
			export function useRef() { throw new Error('A hook ran at import.'); }
			export const useState = useRef, useEffect = useRef, useLayoutEffect = useRef;
			export const useMemo = useRef, useCallback = useRef, useImperativeHandle = useRef;
			export const useSyncExternalStore = useRef;
		`,
		);
		await module(
			'react-native',
			{'.': './index.js'},
			`
			export const NativeModules = new Proxy({}, {get() { throw new Error('Native activation during import.'); }});
			export class NativeEventEmitter { constructor() { throw new Error('Event activation during import.'); } }
			export const Appearance = {getColorScheme() { throw new Error('Appearance read during import.'); }, addChangeListener() { throw new Error('Appearance subscription during import.'); }};
			export const AppState = {currentState: 'active', addEventListener() { throw new Error('Lifecycle subscription during import.'); }};
			export function View() { throw new Error('A native view was instantiated during import.'); }
			export const Pressable = View;
			export function processColor() { throw new Error('Marker color evaluated during import.'); }
			export function findNodeHandle() { throw new Error('A native ref was resolved during import.'); }
			export const StyleSheet = {create: (value) => value};
		`,
		);
		await module(
			'@maplibre/maplibre-react-native',
			{'.': './index.js'},
			`
			export function Map() { throw new Error('A renderer was instantiated during import.'); }
			export function Camera() { throw new Error('A camera was instantiated during import.'); }
			export function Marker() { throw new Error('A marker was instantiated during import.'); }
		`,
		);
		const core = await module('@tileflow/core', {'./native': './native.js'}, '');
		await copyFile(new URL('../../core/dist/native.js', import.meta.url), join(core, 'native.js'));
		// Resolve the real portable package and its existing dependencies, not a permissive stub.
		await symlink(
			fileURLToPath(new URL('../../interactions/', import.meta.url)),
			join(directory, 'node_modules', '@tileflow', 'interactions'),
			'junction',
		);
		const entry = join(directory, 'entry.mjs');
		await copyFile(new URL('../dist/index.js', import.meta.url), entry);
		const script = `
			for (const name of ['window', 'document', 'navigator', 'fetch', 'XMLHttpRequest', 'URL', 'TextEncoder', 'TextDecoder']) {
				Object.defineProperty(globalThis, name, {configurable: true, get() { throw new Error('Unexpected ambient service.'); }});
			}
			const value = await import(${JSON.stringify(pathToFileURL(entry).href)});
			console.log(JSON.stringify({exports: Object.keys(value), callable: typeof value.Map}));
		`;
		const {stdout, stderr} = await promisify(execFile)(
			process.execPath,
			['--input-type=module', '--eval', script],
			{cwd: directory, timeout: 10000},
		);
		if (stderr !== '') throw new Error('Unexpected public runtime diagnostics.');
		return JSON.parse(stdout);
	} finally {
		await rm(directory, {recursive: true, force: true});
	}
}
