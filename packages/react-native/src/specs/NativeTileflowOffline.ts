import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

// The native offline store and network switch. Regions and their events cross as plain objects.
export interface Spec extends TurboModule {
  estimateRegion(options: CodegenTypes.UnsafeObject): Promise<CodegenTypes.UnsafeObject>;
  loadRegion(id: string, options: CodegenTypes.UnsafeObject): Promise<CodegenTypes.UnsafeObject>;
  updateRegionMetadata(id: string, metadata: CodegenTypes.UnsafeObject): Promise<void>;
  allRegions(): Promise<CodegenTypes.UnsafeObject[]>;
  /** Resolves with `{region}`, without the key when no region has the ID. */
  region(id: string): Promise<CodegenTypes.UnsafeObject>;
  pauseRegion(id: string): Promise<void>;
  resumeRegion(id: string): Promise<void>;
  cancelRegion(id: string): Promise<void>;
  removeRegion(id: string): Promise<void>;
  automaticUpdatesEnabled(): Promise<boolean>;
  setAutomaticUpdates(enabled: boolean): Promise<void>;
  isNetworkEnabled(): boolean;
  setNetworkEnabled(enabled: boolean): void;
  /** Starts and stops the region events. JS keeps one native subscription for all listeners. */
  startObserving(): void;
  stopObserving(): void;
  readonly onRegionEvent: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

/** Looks the native module up on first use, so that importing the package reads nothing. */
export default function nativeTileflowOffline(): Spec | null {
  return TurboModuleRegistry.get<Spec>('TileflowOffline');
}
