import type {TileflowSemanticModules} from '../cartography/domain-registry';

declare const tileflowResetBrand: unique symbol;

/** Serializable sentinel that removes one inherited override during `refine()`. */
export type TileflowReset = Readonly<{
  readonly $tileflow: 'reset';
  readonly [tileflowResetBrand]: true;
}>;

type TileflowPatchValue<TValue> =
  | TileflowReset
  | (TValue extends readonly unknown[]
      ? TValue
      : TValue extends object
        ? TileflowNestedPatch<TValue>
        : TValue);

type TileflowNestedPatch<TValue extends object> = {
  readonly [TKey in keyof TValue]?: TileflowPatchValue<TValue[TKey]>;
};

/**
 * A recursive semantic patch. Records merge; arrays and scalar values replace.
 * Module ownership and compiler visibility are immutable only at the patch root;
 * nested domain options named `type` or `enabled` retain their ordinary meaning.
 */
export type TileflowModulePatch<TModule extends object> = {
  readonly [TKey in Exclude<keyof TModule, 'enabled' | 'type'>]?: TileflowPatchValue<TModule[TKey]>;
};

export type TileflowRefineOperation<TPatch extends object = object> = Readonly<{
  readonly op: 'refine';
  readonly patches: readonly TPatch[];
}>;

export type TileflowDisableOperation = Readonly<{
  readonly op: 'disable';
}>;

export type TileflowModuleOperation<TModule extends object> =
  | TileflowDisableOperation
  | TileflowRefineOperation<TileflowModulePatch<TModule>>;

export type TileflowAuthoringModules = {
  readonly [TName in keyof TileflowSemanticModules]?:
    | NonNullable<TileflowSemanticModules[TName]>
    | TileflowModuleOperation<NonNullable<TileflowSemanticModules[TName]>>;
};

const resetValue = deepFreeze({$tileflow: 'reset'} as const) as TileflowReset;
const disableValue = deepFreeze({op: 'disable'} as const) as TileflowDisableOperation;

/** Deeply refine an inherited module; arrays and scalar values replace atomically. */
export function refine<const TPatch extends object>(
  ...patches: readonly [TPatch, ...TPatch[]]
): TileflowRefineOperation<TPatch> {
  return deepFreeze({op: 'refine', patches: cloneSerializable(patches)});
}

/** Disable a complete semantic module while retaining an explicit compiler decision. */
export function disable(): TileflowDisableOperation {
  return disableValue;
}

/** Remove an inherited override so the domain registry can supply its semantic default. */
export function reset(): TileflowReset {
  return resetValue;
}

export function isTileflowReset(value: unknown): value is TileflowReset {
  if (!isPlainRecord(value)) return false;
  return value.$tileflow === 'reset' && Object.keys(value).length === 1;
}

export function isTileflowModuleOperation(
  value: unknown,
): value is TileflowModuleOperation<object> {
  if (!isPlainRecord(value) || typeof value.op !== 'string') return false;
  return value.op === 'disable' || value.op === 'refine';
}

function cloneSerializable<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
