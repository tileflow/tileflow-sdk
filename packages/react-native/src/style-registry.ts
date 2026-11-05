import type {MapController} from './map-controller';
import {mapError, TileflowMapError} from './map-error';
import type {JsonObject, JsonValue, NativeLayerPosition} from './native-map-contract';

type Source = {properties: JsonObject; fields: Readonly<Record<string, string>>};
type Layer = {
  properties: JsonObject;
  position?: NativeLayerPosition;
  signature: string;
  positionSignature: string;
};
type Entry<T> = {owner: symbol; desired?: T; applied?: T};

function invalid(message: string): TileflowMapError {
  return new TileflowMapError({code: 'invalidRequest', message, recoverable: false});
}

/** Owns declarations; theme restoration remains in the native SDK. */
export class StyleRegistry {
  private readonly sources = new Map<string, Entry<Source>>();
  private readonly layers = new Map<string, Entry<Layer>>();
  private dirty = false;
  private scheduled = false;
  private running: Promise<void> | null = null;

  constructor(private readonly map: MapController) {
    map.subscribe((type) => {
      if (type === 'contentReady') this.schedule();
    });
  }

  source(id: string, owner: symbol, properties: JsonObject): void {
    this.set(this.sources, id, owner, {
      properties,
      fields: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, JSON.stringify(value)]),
      ),
    });
  }

  layer(id: string, owner: symbol, properties: JsonObject, position?: NativeLayerPosition): void {
    this.set(this.layers, id, owner, {
      properties,
      ...(position ? {position} : {}),
      signature: JSON.stringify(properties),
      positionSignature: JSON.stringify(position ?? {}),
    });
  }

  removeSource(id: string, owner: symbol): void {
    this.remove(this.sources, id, owner);
  }
  removeLayer(id: string, owner: symbol): void {
    this.remove(this.layers, id, owner);
  }

  private set<T>(entries: Map<string, Entry<T>>, id: string, owner: symbol, value: T): void {
    const entry = entries.get(id);
    if (entry?.desired && entry.owner !== owner)
      throw invalid('A map declaration already uses this id.');
    if (entry) {
      entry.owner = owner;
      entry.desired = value;
    } else {
      entries.set(id, {owner, desired: value});
    }
    this.schedule();
  }

  private remove<T>(entries: Map<string, Entry<T>>, id: string, owner: symbol): void {
    const entry = entries.get(id);
    if (!entry || entry.owner !== owner) return;
    delete entry.desired;
    this.schedule();
  }

  private schedule(): void {
    this.dirty = true;
    if (this.scheduled || this.running || this.map.isDisposed) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      void this.synchronize().catch((error: unknown) => {
        if (!this.map.isDisposed) this.map.report(mapError(error));
      });
    });
  }

  synchronize(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.dirty) this.schedule();
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.dirty && !this.map.isDisposed) {
      this.dirty = false;
      await this.apply();
    }
  }

  private async apply(): Promise<void> {
    for (const [id, entry] of this.layers) {
      if (entry.desired) continue;
      if (entry.applied) await this.map.call('removeLayer', {id});
      delete entry.applied;
      if (!entry.desired) this.layers.delete(id);
    }
    for (const [id, entry] of this.sources) {
      if (entry.desired) continue;
      if (entry.applied) await this.map.call('removeSource', {id});
      delete entry.applied;
      if (!entry.desired) this.sources.delete(id);
    }
    for (const [id, entry] of this.sources) {
      const desired = entry.desired;
      if (!desired) continue;
      if (!entry.applied) {
        await this.map.call('addSource', {id, properties: desired.properties});
      } else {
        const properties: Record<string, JsonValue> = {};
        for (const key of new Set([
          ...Object.keys(entry.applied.fields),
          ...Object.keys(desired.fields),
        ])) {
          if (entry.applied.fields[key] !== desired.fields[key])
            properties[key] = desired.properties[key] ?? null;
        }
        const changed = Object.keys(properties);
        if (changed.length === 0) continue;
        if (
          changed.length === 1 &&
          changed[0] === 'data' &&
          desired.properties.type === 'geojson'
        ) {
          const data = properties.data;
          if (
            typeof data !== 'string' &&
            (typeof data !== 'object' || data === null || Array.isArray(data))
          )
            throw invalid('GeoJSON data must be an object or URL.');
          await this.map.call('setGeoJSONSourceData', {id, data: data as JsonObject | string});
        } else {
          await this.map.call('updateSource', {id, properties});
        }
      }
      entry.applied = desired;
    }
    for (const [id, entry] of this.layers) {
      const desired = entry.desired;
      if (!desired) continue;
      if (!entry.applied) {
        await this.map.call('addLayer', {
          properties: desired.properties,
          ...(desired.position ? {position: desired.position} : {}),
        });
        entry.applied = desired;
        continue;
      }
      if (desired.signature !== entry.applied.signature) {
        await this.map.call('updateLayer', {properties: desired.properties});
        entry.applied = {
          ...entry.applied,
          properties: desired.properties,
          signature: desired.signature,
        };
      }
      if (desired.positionSignature !== entry.applied.positionSignature) {
        await this.map.call('moveLayer', {id, position: desired.position ?? {}});
        entry.applied = desired;
      }
    }
  }
}
