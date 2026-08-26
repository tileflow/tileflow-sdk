import type {MapLibreStyle} from '../types';

export type TileflowDataFieldType = 'Boolean' | 'Number' | 'String';

export type TileflowDataFieldRequirement = Readonly<{
  name: string;
  type?: TileflowDataFieldType;
}>;

export type TileflowDataLayerRequirement = Readonly<{
  fields: readonly TileflowDataFieldRequirement[];
  id: string;
}>;

export type TileflowDataRequirementsV1 = Readonly<{
  complete: boolean;
  dynamicAccesses: readonly string[];
  schemaVersion: 1;
  sourceId: string;
  sourceLayers: readonly TileflowDataLayerRequirement[];
}>;

export type TileflowObservedDataContractV1 = Readonly<{
  sourceLayers: readonly Readonly<{
    fields: readonly Readonly<{name: string; type: TileflowDataFieldType}>[];
    id: string;
  }>[];
}>;

export type TileflowDataCompatibilityIssue = Readonly<{
  code: 'dynamic-field-access' | 'field-missing' | 'field-type-mismatch' | 'source-layer-missing';
  field?: string;
  message: string;
  sourceLayer?: string;
}>;

/**
 * Infer the effective data surface from finalized MapLibre layers. Disabled modules contribute no
 * requirements, and fields hidden by map inheritance never reach this compiler output.
 */
export function inferTileflowDataRequirements(
  style: MapLibreStyle,
  options: {
    additional?: readonly TileflowDataLayerRequirement[];
    sourceId?: string;
  } = {},
): TileflowDataRequirementsV1 {
  const sourceId = options.sourceId ?? 'tileflow';
  const fieldsByLayer = new Map<string, Map<string, TileflowDataFieldType | undefined>>();
  const dynamicAccesses = new Set<string>();

  for (const [index, layer] of (style.layers ?? []).entries()) {
    if (layer.source !== sourceId || typeof layer['source-layer'] !== 'string') continue;
    const sourceLayer = layer['source-layer'];
    const fields = getOrCreate(fieldsByLayer, sourceLayer);
    for (const key of ['filter', 'layout', 'paint'] as const) {
      collectFieldAccesses(layer[key], fields, dynamicAccesses, `layers[${index}].${key}`);
    }
  }

  for (const requirement of options.additional ?? []) {
    requirePortableName(requirement.id, 'additional source layer');
    const fields = getOrCreate(fieldsByLayer, requirement.id);
    for (const field of requirement.fields) {
      requirePortableName(field.name, `additional field on ${requirement.id}`);
      const existing = fields.get(field.name);
      if (existing !== undefined && field.type !== undefined && existing !== field.type) {
        throw new TypeError(
          `Conflicting manual data types for ${requirement.id}.${field.name}: ${existing} and ${field.type}.`,
        );
      }
      fields.set(field.name, field.type ?? existing);
    }
  }

  return {
    complete: dynamicAccesses.size === 0,
    dynamicAccesses: [...dynamicAccesses].sort(compareCodeUnits),
    schemaVersion: 1,
    sourceId,
    sourceLayers: [...fieldsByLayer]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([id, fields]) => ({
        fields: [...fields]
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([name, type]) => ({name, ...(type === undefined ? {} : {type})})),
        id,
      })),
  };
}

/** Compare inferred use with producer-observed layers and fields; no editorial allowlist exists. */
export function validateTileflowDataCompatibility(
  requirements: TileflowDataRequirementsV1,
  contract: TileflowObservedDataContractV1,
): readonly TileflowDataCompatibilityIssue[] {
  const issues: TileflowDataCompatibilityIssue[] = requirements.dynamicAccesses.map((path) => ({
    code: 'dynamic-field-access',
    message: `The data field at ${path} cannot be inferred statically.`,
  }));
  const contractLayers = new Map(contract.sourceLayers.map((layer) => [layer.id, layer]));
  for (const requiredLayer of requirements.sourceLayers) {
    const observedLayer = contractLayers.get(requiredLayer.id);
    if (!observedLayer) {
      issues.push({
        code: 'source-layer-missing',
        message: `World does not declare required source layer ${requiredLayer.id}.`,
        sourceLayer: requiredLayer.id,
      });
      continue;
    }
    const observedFields = new Map(
      observedLayer.fields.map((field) => [field.name, field.type] as const),
    );
    for (const requiredField of requiredLayer.fields) {
      const observedType = observedFields.get(requiredField.name);
      if (observedType === undefined) {
        issues.push({
          code: 'field-missing',
          field: requiredField.name,
          message: `World does not declare required field ${requiredLayer.id}.${requiredField.name}.`,
          sourceLayer: requiredLayer.id,
        });
      } else if (requiredField.type !== undefined && observedType !== requiredField.type) {
        issues.push({
          code: 'field-type-mismatch',
          field: requiredField.name,
          message: `World declares ${requiredLayer.id}.${requiredField.name} as ${observedType}; ${requiredField.type} is required.`,
          sourceLayer: requiredLayer.id,
        });
      }
    }
  }
  return issues;
}

function collectFieldAccesses(
  value: unknown,
  fields: Map<string, TileflowDataFieldType | undefined>,
  dynamicAccesses: Set<string>,
  path: string,
): void {
  if (Array.isArray(value)) {
    const operator = value[0];
    if (operator === 'get' || operator === 'has') {
      if (typeof value[1] === 'string') fields.set(value[1], fields.get(value[1]));
      else dynamicAccesses.add(`${path}[1]`);
    }
    for (let index = 1; index < value.length; index += 1) {
      collectFieldAccesses(value[index], fields, dynamicAccesses, `${path}[${index}]`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectFieldAccesses(child, fields, dynamicAccesses, `${path}.${key}`);
  }
}

function getOrCreate(
  map: Map<string, Map<string, TileflowDataFieldType | undefined>>,
  key: string,
): Map<string, TileflowDataFieldType | undefined> {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Map<string, TileflowDataFieldType | undefined>();
  map.set(key, created);
  return created;
}

function requirePortableName(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(value)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
