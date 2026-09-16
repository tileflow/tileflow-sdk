import type {MapView} from './contract';
import type {NativeReadinessEvidence} from './native-readiness';

export type NativeSurfaceEvent =
	| (NativeReadinessEvidence & Readonly<{surface: string}>)
	| Readonly<{
		surface: string;
		style: string;
		sequence: number;
		layout: number;
		kind: 'gesture-start' | 'gesture-change' | 'gesture-end';
		gesture: number;
		view: MapView;
	}>;

// There is no renderer handle or imperative command in the public Map ref.
export type NativeSurfaceModule = {
	attachSurface(root: number): Promise<Readonly<{surface: string}>>;
	expectStyle(surface: string, style: string): Promise<Readonly<{accepted: true}>>;
	commitLayout(surface: string, style: string): Promise<Readonly<{layout: number}>>;
	requestFrame(surface: string, style: string): Promise<Readonly<{requested: true}>>;
	applyCamera(surface: string, command: number, view: MapView): Promise<Readonly<{command: number; view: MapView}>>;
	cancelCamera(surface: string, command: number): Promise<Readonly<{cancelled: true}>>;
	acknowledgeSurface(surface: string, sequence: number): Promise<Readonly<{acknowledged: true}>>;
	retireSurface(surface: string): Promise<Readonly<{detached: true}>>;
	retireRoot(root: number): Promise<Readonly<{detached: true}>>;
};

export type NativeSurface = Readonly<{
	id: string;
	expectStyle(style: string): Promise<void>;
	commitLayout(style: string): Promise<number>;
	requestFrame(style: string): Promise<void>;
	applyCamera(command: number, view: MapView): Promise<Readonly<{command: number; view: MapView}>>;
	cancelCamera(command: number): Promise<Readonly<{cancelled: true}>>;
	retire(): Promise<void>;
}>;

export class NativeSurfaceError extends Error {
	readonly code = 'NATIVE_SURFACE_UNAVAILABLE';
	constructor() { super('Native surface operation failed.'); this.name = 'NativeSurfaceError'; }
}
