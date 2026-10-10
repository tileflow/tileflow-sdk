import {validateTileflowThemeBlendSelection} from '@tileflow/core/native';
import type {MapThemeBlend} from './contract';
import {NativePreparationError} from './native-style-document';

const maximumTransitionMs = 5000;

function own(value: object, keys: readonly string[]): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) || (prototype !== Object.prototype && prototype !== null))
    throw new NativePreparationError();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new NativePreparationError();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property)) throw new NativePreparationError();
    result[key] = property.value;
  }
  return result;
}

/** The transition duration in whole milliseconds; invalid input throws without echoing it. */
export function snapshotThemeTransition(value: unknown): number {
  if (value === undefined) return 0;
  if (!value || typeof value !== 'object') throw new NativePreparationError();
  const {duration = 0} = own(value, ['duration']);
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > maximumTransitionMs
  )
    throw new NativePreparationError();
  return Math.round(duration);
}

/** A detached, frozen blend selection, or undefined; invalid input throws without echoing it. */
export function snapshotThemeBlend(value: unknown): MapThemeBlend | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new NativePreparationError();
  const {themes, position} = own(value, ['themes', 'position']);
  if (!Array.isArray(themes)) throw new NativePreparationError();
  const blend = {themes: Object.freeze([...themes]), position};
  if (!validateTileflowThemeBlendSelection(blend)) throw new NativePreparationError();
  return Object.freeze(blend);
}

/** Identity of a blend's theme list; positions within it change without preparation. */
export function themeBlendKey(blend: MapThemeBlend): string {
  return JSON.stringify(blend.themes);
}
