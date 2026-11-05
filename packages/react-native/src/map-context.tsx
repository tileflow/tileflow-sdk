import {createContext, useContext, useLayoutEffect, useRef} from 'react';
import type {CameraProps} from './contract';
import type {MapController} from './map-controller';
import {mapError} from './map-error';
import type {
  MapCommandPayloads,
  NativeImage,
  NativePointAnnotation,
  NativeUserLocation,
} from './native-map-contract';
import type {MapMethod} from './specs/NativeTileflowMapModule';
import type {StyleRegistry} from './style-registry';

export class MapCollection<T> {
  private readonly values = new Map<symbol, readonly T[]>();
  private scheduled = false;
  private revision = 0;
  private signature: string | undefined;

  constructor(
    private readonly map: MapController,
    private readonly apply: (values: readonly T[]) => Promise<unknown>,
  ) {
    map.subscribe((type) => {
      if (type === 'contentReady') this.schedule();
    });
  }

  set(owner: symbol, values?: readonly T[]): void {
    if (values) this.values.set(owner, values);
    else this.values.delete(owner);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.map.isDisposed) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      const values = [...this.values.values()].flat();
      const signature = JSON.stringify(values);
      if (signature === this.signature || this.map.isDisposed) return;
      this.signature = signature;
      const revision = ++this.revision;
      void this.apply(values).catch((error: unknown) => {
        if (revision !== this.revision || this.map.isDisposed) return;
        this.signature = undefined;
        this.map.report(mapError(error));
      });
    });
  }
}

export type MapContextValue = Readonly<{
  controller: MapController;
  style: StyleRegistry;
  points: MapCollection<NativePointAnnotation>;
  images: MapCollection<NativeImage>;
  setCamera: (owner: symbol, options?: CameraProps) => void;
  setLocation: (owner: symbol, options?: NativeUserLocation) => void;
}>;

export const MapContext = createContext<MapContextValue | null>(null);
export const SourceContext = createContext<string | undefined>(undefined);

export function useMap(): MapContextValue {
  const value = useContext(MapContext);
  if (!value) throw new Error('Place this Tileflow component inside MapView.');
  return value;
}

export function useCommittedValue<T>(value: T): {current: T} {
  const reference = useRef(value);
  useLayoutEffect(() => {
    reference.current = value;
  });
  return reference;
}

export function useMapCommand<M extends MapMethod>(method: M, value: MapCommandPayloads[M]): void {
  const {controller} = useMap();
  const committed = useCommittedValue(value);
  const signature = JSON.stringify(value);
  useLayoutEffect(() => {
    let active = true;
    void controller.call(method, committed.current).catch((error: unknown) => {
      if (active && !controller.isDisposed) controller.report(mapError(error));
    });
    return () => {
      active = false;
    };
  }, [controller, method, signature, committed]);
}
