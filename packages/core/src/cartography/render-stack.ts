import type {
  OpenMapTilesFieldBindings,
  OpenMapTilesLayerBindings,
  ResolvedTileflowData,
} from '../data';
import {
  type TileflowLayerSlot,
  tileflowLayerSlots,
  tileflowRenderStackOperationNamePattern,
  tileflowSemanticTargetPattern,
} from './contributions';
import {
  createTileflowLayerTemplateIR,
  materializeTileflowLayerFamilyIR,
  type TileflowLayerFamilyIR,
  type TileflowLayerPatchIR,
  type TileflowLayerTemplateIR,
} from './domain-ir';
import {type TileflowLayerDomain, tileflowLayerDomains} from './domains';
import {
  applyBackgroundStyle,
  applyCircleStyle,
  applyExtrusionStyle,
  applyFillStyle,
  applyLineStyle,
  applySymbolStyle,
} from './layer-style';
import {dataLayer, field} from './semantic-bindings';
import type {
  TileflowBackgroundStyle,
  TileflowCircleStyle,
  TileflowExtrusionStyle,
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowSymbolStyle,
} from './styles';

export const tileflowRenderStackPhases = [
  'underlay',
  'overlay',
  'postRelief',
  'annotation',
  'finish',
] as const;
export const tileflowRenderStackRenderers = [
  'background',
  'circle',
  'extrusion',
  'fill',
  'line',
  'symbol',
] as const;
export const tileflowRenderSelectorKinds = [
  'all',
  'any',
  'compare',
  'geometry',
  'has',
  'in',
  'literal',
  'match',
  'not',
  'step',
] as const;
export const tileflowRenderSelectorComparisons = ['eq', 'gt', 'gte', 'lt', 'lte', 'ne'] as const;
export const tileflowRenderSelectorGeometries = ['line', 'point', 'polygon'] as const;
export const tileflowRenderStackLimits = Object.freeze({
  maxMatchBranches: 16,
  maxOperations: 64,
  maxRequirements: tileflowLayerDomains.length,
  maxScalarValues: 16,
  maxSelectorChildren: 16,
  maxSelectorDepth: 64,
  maxSelectorNodes: 256,
  maxStepStops: 16,
} as const);

export type TileflowRenderStackPhase = (typeof tileflowRenderStackPhases)[number];
export type TileflowRenderStackRenderer = (typeof tileflowRenderStackRenderers)[number];
export type TileflowRenderFeature = keyof OpenMapTilesLayerBindings;
export type TileflowRenderField = keyof OpenMapTilesFieldBindings;
export type TileflowRenderScalar = boolean | number | string;
export type TileflowRenderGeometry = (typeof tileflowRenderSelectorGeometries)[number];
export type TileflowRenderComparison = (typeof tileflowRenderSelectorComparisons)[number];

export type TileflowRenderSelectorConstraintIssue = Readonly<{
  code: 'invalid-selector' | 'selector-too-deep' | 'selector-too-large';
  message: string;
  path: readonly (number | string)[];
}>;

type TileflowNormalizedRenderField = {
  /** Convert the bound field before comparing it. */
  readonly coerce?: 'number';
  /** Coalesced value, or the numeric conversion fallback when `coerce` is `number`. */
  readonly fallback?: TileflowRenderScalar;
  readonly field: TileflowRenderField;
};

export type TileflowRenderSelector =
  | {
      readonly kind: 'all' | 'any';
      readonly selectors: readonly TileflowRenderSelector[];
    }
  | (TileflowNormalizedRenderField & {
      readonly kind: 'compare';
      readonly operator: TileflowRenderComparison;
      readonly value: TileflowRenderScalar;
    })
  | {
      readonly geometry: TileflowRenderGeometry;
      readonly kind: 'geometry';
    }
  | {
      readonly field: TileflowRenderField;
      readonly kind: 'has';
    }
  | (TileflowNormalizedRenderField & {
      readonly kind: 'in';
      readonly values: readonly TileflowRenderScalar[];
    })
  | {
      readonly kind: 'literal';
      readonly value: boolean;
    }
  | (TileflowNormalizedRenderField & {
      readonly branches: readonly {
        readonly result: boolean;
        readonly values: readonly TileflowRenderScalar[];
      }[];
      readonly kind: 'match';
      readonly otherwise: boolean;
    })
  | {
      readonly kind: 'not';
      readonly selector: TileflowRenderSelector;
    }
  | {
      readonly fallback: TileflowRenderSelector;
      readonly kind: 'step';
      readonly stops: readonly {
        readonly selector: TileflowRenderSelector;
        readonly zoom: number;
      }[];
    };

/**
 * Validate recursive selector budgets and the ordered zoom-stop contract.
 * Structural and vocabulary validation remains with the closed selector compiler/schema.
 */
export function validateTileflowRenderSelectorConstraints(
  input: unknown,
): readonly TileflowRenderSelectorConstraintIssue[] {
  const issues: TileflowRenderSelectorConstraintIssue[] = [];
  const pending: {depth: number; path: (number | string)[]; selector: unknown}[] = [
    {depth: 1, path: [], selector: input},
  ];
  let nodeCount = 0;

  const addIssue = (
    code: TileflowRenderSelectorConstraintIssue['code'],
    message: string,
    path: readonly (number | string)[],
  ): void => {
    issues.push({code, message, path});
  };
  const requireBoundedArray = (
    value: unknown,
    path: readonly (number | string)[],
    description: string,
    maximum: number,
  ): value is unknown[] => {
    if (!Array.isArray(value)) {
      addIssue('invalid-selector', `${description} must be an array`, path);
      return false;
    }
    if (value.length === 0) {
      addIssue('invalid-selector', `${description} requires at least one item`, path);
    }
    if (value.length > maximum) {
      addIssue('invalid-selector', `${description} may contain at most ${maximum} items`, path);
    }
    return true;
  };
  const pushChild = (selector: unknown, depth: number, path: (number | string)[]): void => {
    pending.push({depth, path, selector});
  };

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!isRecord(current.selector) || typeof current.selector.kind !== 'string') {
      addIssue(
        'invalid-selector',
        'a render selector must be a semantic selector node',
        current.path,
      );
      continue;
    }

    nodeCount += 1;
    if (nodeCount > tileflowRenderStackLimits.maxSelectorNodes) {
      addIssue(
        'selector-too-large',
        `a render selector may contain at most ${tileflowRenderStackLimits.maxSelectorNodes} nodes`,
        current.path,
      );
      break;
    }
    if (current.depth > tileflowRenderStackLimits.maxSelectorDepth) {
      addIssue(
        'selector-too-deep',
        `a render selector may contain at most ${tileflowRenderStackLimits.maxSelectorDepth} levels`,
        current.path,
      );
      continue;
    }

    switch (current.selector.kind) {
      case 'all':
      case 'any': {
        const path = [...current.path, 'selectors'];
        if (
          requireBoundedArray(
            current.selector.selectors,
            path,
            `${current.selector.kind} selector`,
            tileflowRenderStackLimits.maxSelectorChildren,
          )
        ) {
          for (let index = current.selector.selectors.length - 1; index >= 0; index -= 1) {
            pushChild(current.selector.selectors[index], current.depth + 1, [...path, index]);
          }
        }
        break;
      }
      case 'in':
        requireBoundedArray(
          current.selector.values,
          [...current.path, 'values'],
          'in selector values',
          tileflowRenderStackLimits.maxScalarValues,
        );
        break;
      case 'match': {
        const branchesPath = [...current.path, 'branches'];
        if (
          !requireBoundedArray(
            current.selector.branches,
            branchesPath,
            'match selector branches',
            tileflowRenderStackLimits.maxMatchBranches,
          )
        ) {
          break;
        }
        for (const [index, branch] of current.selector.branches.entries()) {
          const branchPath = [...branchesPath, index];
          if (!isRecord(branch)) {
            addIssue('invalid-selector', 'match selector branch must be an object', branchPath);
            continue;
          }
          requireBoundedArray(
            branch.values,
            [...branchPath, 'values'],
            'match selector branch values',
            tileflowRenderStackLimits.maxScalarValues,
          );
        }
        break;
      }
      case 'not':
        pushChild(current.selector.selector, current.depth + 1, [...current.path, 'selector']);
        break;
      case 'step': {
        pushChild(current.selector.fallback, current.depth + 1, [...current.path, 'fallback']);
        const stopsPath = [...current.path, 'stops'];
        if (
          !requireBoundedArray(
            current.selector.stops,
            stopsPath,
            'step selector stops',
            tileflowRenderStackLimits.maxStepStops,
          )
        ) {
          break;
        }
        let previousZoom: number | undefined;
        for (let index = current.selector.stops.length - 1; index >= 0; index -= 1) {
          const stop = current.selector.stops[index];
          const stopPath = [...stopsPath, index];
          if (!isRecord(stop)) {
            addIssue('invalid-selector', 'step selector stop must be an object', stopPath);
            continue;
          }
          pushChild(stop.selector, current.depth + 1, [...stopPath, 'selector']);
        }
        for (const [index, stop] of current.selector.stops.entries()) {
          if (!isRecord(stop)) continue;
          const zoom = stop.zoom;
          const zoomPath = [...stopsPath, index, 'zoom'];
          if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0 || zoom > 24) {
            addIssue(
              'invalid-selector',
              'step selector zoom must be finite and between 0 and 24',
              zoomPath,
            );
            continue;
          }
          if (previousZoom !== undefined && zoom <= previousZoom) {
            addIssue(
              'invalid-selector',
              'step selector zooms must be strictly increasing',
              zoomPath,
            );
          }
          previousZoom = zoom;
        }
        break;
      }
      case 'compare':
      case 'geometry':
      case 'has':
      case 'literal':
        break;
      default:
        addIssue('invalid-selector', `unknown selector kind ${String(current.selector.kind)}`, [
          ...current.path,
          'kind',
        ]);
    }
  }

  return issues;
}

export type TileflowRenderVisibilityGroup = 'building';
type TileflowRenderStyle<TStyle> = TStyle & {
  /** Runtime-controlled group; hidden initially and toggled without raw metadata authoring. */
  readonly visibilityGroup?: TileflowRenderVisibilityGroup;
};

type TileflowRenderPassCommon = {
  readonly attachTo: string;
  readonly phase: TileflowRenderStackPhase;
  /** Additional rendered domains required by this pass. Data `feature` bindings are independent. */
  readonly requirements?: readonly TileflowLayerDomain[];
};

type TileflowVectorRenderPass<TRenderer extends string, TStyle> = TileflowRenderPassCommon & {
  readonly feature?: TileflowRenderFeature;
  readonly renderer: TRenderer;
  readonly selector?: TileflowRenderSelector;
  readonly style: TileflowRenderStyle<TStyle>;
};

export type TileflowRenderPassInput =
  | (TileflowRenderPassCommon & {
      readonly feature?: never;
      readonly renderer: 'background';
      readonly selector?: never;
      readonly style: TileflowRenderStyle<TileflowBackgroundStyle>;
    })
  | TileflowVectorRenderPass<'circle', TileflowCircleStyle>
  | TileflowVectorRenderPass<'extrusion', TileflowExtrusionStyle>
  | TileflowVectorRenderPass<'fill', TileflowFillStyle>
  | TileflowVectorRenderPass<'line', TileflowLineStyle>
  | TileflowVectorRenderPass<'symbol', TileflowSymbolStyle>;

export type TileflowRenderPass = TileflowRenderPassInput & {readonly kind: 'render-pass'};

type TileflowRefinementCommon<TRenderer extends string, TStyle> = {
  /** Rendered domains required for this refinement's semantic target to exist. */
  readonly requirements?: readonly TileflowLayerDomain[];
  readonly renderer: TRenderer;
  readonly selector?: TileflowRenderSelector;
  readonly style: TileflowRenderStyle<TStyle>;
  readonly target: string;
};

export type TileflowRenderTargetRefinementInput =
  | (Omit<TileflowRefinementCommon<'background', TileflowBackgroundStyle>, 'selector'> & {
      readonly selector?: never;
    })
  | TileflowRefinementCommon<'circle', TileflowCircleStyle>
  | TileflowRefinementCommon<'extrusion', TileflowExtrusionStyle>
  | TileflowRefinementCommon<'fill', TileflowFillStyle>
  | TileflowRefinementCommon<'line', TileflowLineStyle>
  | TileflowRefinementCommon<'symbol', TileflowSymbolStyle>;

export type TileflowRenderTargetRefinement = TileflowRenderTargetRefinementInput & {
  readonly kind: 'refine-render-target';
};

export type TileflowRenderStackOperation = TileflowRenderPass | TileflowRenderTargetRefinement;
export type TileflowNamedRenderStack = Readonly<Record<string, TileflowRenderStackOperation>>;

export type TileflowRenderStackModule<
  TOwner extends TileflowLayerDomain = TileflowLayerDomain,
  TStack extends TileflowNamedRenderStack = TileflowNamedRenderStack,
> = {
  readonly renderStack: TStack;
  readonly type: TOwner;
};

export type TileflowModuleWithRenderStack<
  TModule extends {readonly type: TileflowLayerDomain},
  TStack extends TileflowNamedRenderStack,
> = TModule & {readonly renderStack: TStack};

export type TileflowCompiledRenderLayer = {
  readonly attachTo: string;
  readonly kind: 'layer';
  readonly name: string;
  readonly order: number;
  readonly owner: TileflowLayerDomain;
  readonly phase: TileflowRenderStackPhase;
  readonly renderer: TileflowRenderPassInput['renderer'];
  readonly requirements: readonly TileflowLayerDomain[];
  readonly target: string;
  readonly template: TileflowLayerTemplateIR;
};

export type TileflowCompiledRenderRefinement = {
  readonly kind: 'refinement';
  readonly name: string;
  readonly order: number;
  readonly owner: TileflowLayerDomain;
  readonly patch: TileflowLayerPatchIR;
  readonly renderer: TileflowRenderTargetRefinementInput['renderer'];
  readonly requirements: readonly TileflowLayerDomain[];
  readonly target: string;
};

export type TileflowCompiledRenderOperation =
  | TileflowCompiledRenderLayer
  | TileflowCompiledRenderRefinement;

const comparisonOperators: Record<TileflowRenderComparison, string> = {
  eq: '==',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  ne: '!=',
};
const geometryTypes: Record<TileflowRenderGeometry, string> = {
  line: 'LineString',
  point: 'Point',
  polygon: 'Polygon',
};
const phaseOrder = new Map(tileflowRenderStackPhases.map((phase, index) => [phase, index]));

/** Define one ownerless render pass. Its owner and stable name are assigned by `withRenderStack`. */
export function renderPass(input: TileflowRenderPassInput): TileflowRenderPass {
  assertOnlyKeys(
    input,
    ['attachTo', 'feature', 'phase', 'renderer', 'requirements', 'selector', 'style'],
    'renderPass',
  );
  requireRenderer(input.renderer);
  requirePhase(input.phase);
  validateStyle(input.renderer, input.style);
  if (input.renderer === 'background' && ('feature' in input || 'selector' in input)) {
    throw renderStackError(
      'invalid-background-pass',
      'A background render pass cannot select vector features.',
    );
  }
  normalizeRequirements(input.requirements);
  if (input.selector !== undefined) assertRenderSelectorConstraints(input.selector);
  return cloneJson({...input, kind: 'render-pass'} as TileflowRenderPass);
}

/** Define an owner-local refinement without exposing a raw layer patch. */
export function refineRenderTarget(
  input: TileflowRenderTargetRefinementInput,
): TileflowRenderTargetRefinement {
  assertOnlyKeys(
    input,
    ['renderer', 'requirements', 'selector', 'style', 'target'],
    'refineRenderTarget',
  );
  requireRenderer(input.renderer);
  validateStyle(input.renderer, input.style);
  if (input.renderer === 'background' && 'selector' in input) {
    throw renderStackError(
      'invalid-background-refinement',
      'A background refinement cannot select vector features.',
    );
  }
  normalizeRequirements(input.requirements);
  if (input.selector !== undefined) assertRenderSelectorConstraints(input.selector);
  return cloneJson({...input, kind: 'refine-render-target'} as TileflowRenderTargetRefinement);
}

/** Attach a named render stack while retaining the module's exact inferred owner and options. */
export function withRenderStack<
  const TModule extends {readonly type: TileflowLayerDomain},
  const TStack extends TileflowNamedRenderStack,
>(
  module: TModule & {readonly renderStack?: never},
  namedRecord: TStack,
): TileflowModuleWithRenderStack<TModule, TStack> {
  if (!tileflowLayerDomains.includes(module.type)) {
    throw renderStackError('invalid-owner', `Unknown render-stack owner: ${String(module.type)}.`);
  }
  if (Object.hasOwn(module, 'renderStack')) {
    throw renderStackError(
      'duplicate-stack',
      'withRenderStack cannot replace an existing module render stack.',
    );
  }
  const entries = requireRenderStackEntries(namedRecord);
  for (const [name, operation] of entries) {
    requireOperationName(name);
    if (
      !operation ||
      (operation.kind !== 'render-pass' && operation.kind !== 'refine-render-target')
    ) {
      throw renderStackError(
        'invalid-operation',
        `Render-stack operation "${name}" was not created by renderPass or refineRenderTarget.`,
      );
    }
  }
  return cloneJson({...module, renderStack: namedRecord}) as TileflowModuleWithRenderStack<
    TModule,
    TStack
  >;
}

/** Lower one owner-local stack to physical layer templates and exact typed refinements. */
export function compileRenderStack(
  module: TileflowRenderStackModule,
  data: ResolvedTileflowData,
): readonly TileflowCompiledRenderOperation[] {
  if (!tileflowLayerDomains.includes(module.type)) {
    throw renderStackError('invalid-owner', `Unknown render-stack owner: ${String(module.type)}.`);
  }
  return requireRenderStackEntries(module.renderStack).map(([name, operation], order) =>
    compileOperation(module.type, name, operation, order, data),
  );
}

/** Lower several stacks with one stable global declaration order. */
export function compileRenderStacks(
  modules: readonly TileflowRenderStackModule[],
  data: ResolvedTileflowData,
): readonly TileflowCompiledRenderOperation[] {
  return modules
    .flatMap((module) => compileRenderStack(module, data))
    .map((operation, order) => ({...operation, order}));
}

/** Lower a closed semantic selector through the active OpenMapTiles field bindings. */
export function compileRenderSelector(
  selector: TileflowRenderSelector,
  data: ResolvedTileflowData,
): unknown {
  assertRenderSelectorConstraints(selector);
  return lowerSelector(selector, data);
}

/**
 * Materialize compiled passes around their semantic anchors and apply refinements exactly.
 * Input families retain semantic ownership and provenance directly; no Style
 * metadata or physical ID exists at this stage.
 */
export function applyCompiledRenderStacks(
  input: readonly TileflowLayerFamilyIR[],
  operations: readonly TileflowCompiledRenderOperation[],
): TileflowLayerFamilyIR[] {
  let layers = input.map(cloneJson);
  const activeOwners = new Set(layers.map(({owner}) => owner));
  const layerOperations = operations.filter(
    (operation): operation is TileflowCompiledRenderLayer => operation.kind === 'layer',
  );
  const suppressedTargets = new Set(
    layerOperations
      .filter((operation) =>
        operation.requirements.some((requirement) => !activeOwners.has(requirement)),
      )
      .map((operation) => operation.target),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of layerOperations) {
      if (!suppressedTargets.has(operation.target) && suppressedTargets.has(operation.attachTo)) {
        suppressedTargets.add(operation.target);
        changed = true;
      }
    }
  }
  const pending = layerOperations
    .filter((operation) => !suppressedTargets.has(operation.target))
    .sort(compareCompiledOperations);

  requireUniqueCompiledLayers(layers, pending);
  while (pending.length > 0) {
    const ready = pending.find((operation) => findTargetIndex(layers, operation.attachTo) >= 0);
    if (!ready) {
      throw renderStackError(
        'unknown-or-circular-anchor',
        `Render passes target unknown or circular anchors: ${pending
          .map((operation) => `${operation.target}->${operation.attachTo}`)
          .join(', ')}.`,
      );
    }
    const anchorTarget = ready.attachTo;
    const group = pending
      .filter((operation) => operation.attachTo === anchorTarget)
      .sort(compareCompiledOperations);
    const anchorIndex = findTargetIndex(layers, anchorTarget);
    const anchor = layers[anchorIndex]!;
    const before = group
      .filter((operation) => operation.phase === 'underlay')
      .map((operation) => materializeRenderLayer(operation, anchor));
    const after = group
      .filter((operation) => operation.phase !== 'underlay')
      .map((operation) => materializeRenderLayer(operation, anchor));
    layers = [
      ...layers.slice(0, anchorIndex),
      ...before,
      anchor,
      ...after,
      ...layers.slice(anchorIndex + 1),
    ];
    for (const operation of group) pending.splice(pending.indexOf(operation), 1);
  }

  const refinements = operations
    .filter(
      (operation): operation is TileflowCompiledRenderRefinement => operation.kind === 'refinement',
    )
    .filter((operation) =>
      operation.requirements.every((requirement) => activeOwners.has(requirement)),
    )
    .sort(compareCompiledOperations);
  for (const refinement of refinements) {
    const index = findTargetIndex(layers, refinement.target);
    if (index < 0) {
      throw renderStackError(
        'unknown-refinement-target',
        `Render refinement targets unknown semantic contribution: ${refinement.target}.`,
      );
    }
    const previous = layers[index]!;
    const actualOwner = previous.owner;
    if (actualOwner !== refinement.owner) {
      throw renderStackError(
        'refinement-owner-mismatch',
        `Render refinement ${refinement.target} belongs to ${actualOwner ?? 'no owner'}, not ${refinement.owner}.`,
      );
    }
    const expectedType = rendererLayerType(refinement.renderer);
    if (previous.renderer !== expectedType) {
      throw renderStackError(
        'refinement-renderer-mismatch',
        `Render refinement ${refinement.target} expects ${expectedType}, found ${String(previous.renderer)}.`,
      );
    }
    layers[index] = applyRefinement(previous, refinement);
  }
  return layers;
}

function compileOperation(
  owner: TileflowLayerDomain,
  name: string,
  operation: TileflowRenderStackOperation,
  order: number,
  data: ResolvedTileflowData,
): TileflowCompiledRenderOperation {
  requireOperationName(name);
  if (operation.kind === 'render-pass') {
    validateRenderPassOperation(operation);
    const requirements = normalizeRequirements(operation.requirements);
    requireAttachTarget(owner, operation.attachTo, requirements);
    const target = `${owner}.render.${name}`;
    requirePortableTarget(target, 'generated render target');
    const template = compileRenderLayer(target, operation, data);
    return {
      attachTo: operation.attachTo,
      kind: 'layer',
      name,
      order,
      owner,
      phase: operation.phase,
      renderer: operation.renderer,
      requirements,
      target,
      template,
    };
  }

  validateRefinementOperation(operation);
  requireOwnedTarget(owner, operation.target, 'refinement target');
  const requirements = normalizeRequirements(operation.requirements);
  const template = applyRendererStyle(
    {id: 'tileflow-render-refinement-template', type: rendererLayerType(operation.renderer)},
    operation.renderer,
    operation.style,
  );
  if (operation.selector) template.filter = compileRenderSelector(operation.selector, data);
  const patch = templateToPatch(createTileflowLayerTemplateIR(template, operation.target));
  return {
    kind: 'refinement',
    name,
    order,
    owner,
    patch,
    renderer: operation.renderer,
    requirements,
    target: operation.target,
  };
}

function compileRenderLayer(
  target: string,
  operation: TileflowRenderPass,
  data: ResolvedTileflowData,
): TileflowLayerTemplateIR {
  const base: Record<string, unknown> & {id: string; type: string} = {
    id: target,
    type: rendererLayerType(operation.renderer),
  };
  if (operation.renderer !== 'background' && operation.feature !== undefined) {
    const sourceLayer = data.schema.layers[operation.feature];
    if (!Object.hasOwn(data.schema.layers, operation.feature) || !sourceLayer) {
      throw renderStackError(
        'missing-feature-binding',
        `Tileflow data schema does not provide feature ${operation.feature}.`,
      );
    }
    base.source = data.sourceId;
    base['source-layer'] = dataLayer(operation.feature);
  }
  if (operation.renderer !== 'background' && operation.selector) {
    base.filter = compileRenderSelector(operation.selector, data);
  }
  return createTileflowLayerTemplateIR(
    applyRendererStyle(base, operation.renderer, operation.style),
    target,
  );
}

function applyRendererStyle(
  layer: Record<string, unknown> & {id: string; type: string},
  renderer: TileflowRenderPassInput['renderer'],
  style: TileflowRenderPassInput['style'],
): Record<string, unknown> & {id: string; type: string} {
  const visibilityGroup = style.visibilityGroup;
  let result: Record<string, unknown> & {id: string; type: string};
  switch (renderer) {
    case 'background':
      result = applyBackgroundStyle(layer, style as TileflowBackgroundStyle);
      break;
    case 'circle':
      result = applyCircleStyle(layer, style as TileflowCircleStyle);
      break;
    case 'extrusion':
      result = applyExtrusionStyle(layer, style as TileflowExtrusionStyle);
      break;
    case 'fill':
      result = applyFillStyle(layer, style as TileflowFillStyle);
      break;
    case 'line':
      result = applyLineStyle(layer, style as TileflowLineStyle);
      break;
    case 'symbol':
      result = applySymbolStyle(layer, style as TileflowSymbolStyle);
      break;
  }
  if (!visibilityGroup) return result;
  return {
    ...result,
    layout: {...asRecord(result.layout), visibility: 'none'},
    metadata: {...asRecord(result.metadata), 'tileflow:3d-toggle': visibilityGroup},
  };
}

function lowerSelector(selector: TileflowRenderSelector, data: ResolvedTileflowData): unknown {
  if (!isRecord(selector) || typeof selector.kind !== 'string') {
    throw renderStackError(
      'invalid-selector',
      'A render selector must be a semantic selector node.',
    );
  }
  const selectorKind = selector.kind;
  switch (selector.kind) {
    case 'literal':
      assertOnlyKeys(selector, ['kind', 'value'], 'literal selector');
      if (typeof selector.value !== 'boolean') invalidSelector('literal value must be boolean');
      return selector.value;
    case 'geometry':
      assertOnlyKeys(selector, ['geometry', 'kind'], 'geometry selector');
      if (!Object.hasOwn(geometryTypes, selector.geometry)) {
        invalidSelector(`unknown geometry ${String(selector.geometry)}`);
      }
      return ['==', ['geometry-type'], geometryTypes[selector.geometry]];
    case 'has':
      assertOnlyKeys(selector, ['field', 'kind'], 'has selector');
      return ['has', requireFieldBinding(selector.field, data)];
    case 'compare': {
      assertOnlyKeys(
        selector,
        ['coerce', 'fallback', 'field', 'kind', 'operator', 'value'],
        'compare selector',
      );
      requireScalar(selector.value, 'comparison value');
      validateNormalization(selector, [selector.value]);
      if (!Object.hasOwn(comparisonOperators, selector.operator)) {
        invalidSelector(`unknown comparison operator ${String(selector.operator)}`);
      }
      const operator = comparisonOperators[selector.operator];
      return [operator, lowerNormalizedField(selector, data), selector.value];
    }
    case 'in':
      assertOnlyKeys(selector, ['coerce', 'fallback', 'field', 'kind', 'values'], 'in selector');
      requireScalarList(selector.values, 'in selector');
      validateNormalization(selector, selector.values);
      return ['match', lowerNormalizedField(selector, data), [...selector.values], true, false];
    case 'match':
      assertOnlyKeys(
        selector,
        ['branches', 'coerce', 'fallback', 'field', 'kind', 'otherwise'],
        'match selector',
      );
      if (!Array.isArray(selector.branches) || selector.branches.length === 0) {
        invalidSelector('match selector requires at least one branch');
      }
      if (typeof selector.otherwise !== 'boolean') {
        invalidSelector('match selector otherwise must be boolean');
      }
      for (const branch of selector.branches) {
        assertOnlyKeys(branch, ['result', 'values'], 'match selector branch');
        requireScalarList(branch.values, 'match selector branch');
        if (typeof branch.result !== 'boolean') {
          invalidSelector('match selector branch result must be boolean');
        }
        validateNormalization(selector, branch.values);
      }
      return [
        'match',
        lowerNormalizedField(selector, data),
        ...selector.branches.flatMap((branch) => [
          branch.values.length === 1 ? branch.values[0] : [...branch.values],
          branch.result,
        ]),
        selector.otherwise,
      ];
    case 'not':
      assertOnlyKeys(selector, ['kind', 'selector'], 'not selector');
      return ['!', lowerSelector(selector.selector, data)];
    case 'all':
    case 'any':
      assertOnlyKeys(selector, ['kind', 'selectors'], `${selector.kind} selector`);
      if (!Array.isArray(selector.selectors) || selector.selectors.length === 0) {
        invalidSelector(`${selector.kind} selector requires at least one child`);
      }
      return [selector.kind, ...selector.selectors.map((child) => lowerSelector(child, data))];
    case 'step': {
      assertOnlyKeys(selector, ['fallback', 'kind', 'stops'], 'step selector');
      const stops = selector.stops.flatMap((stop) => {
        assertOnlyKeys(stop, ['selector', 'zoom'], 'step selector stop');
        return [stop.zoom, lowerSelector(stop.selector, data)];
      });
      return ['step', ['zoom'], lowerSelector(selector.fallback, data), ...stops];
    }
    default:
      return invalidSelector(`unknown selector kind ${String(selectorKind)}`);
  }
}

function lowerNormalizedField(
  selector: TileflowNormalizedRenderField,
  data: ResolvedTileflowData,
): unknown {
  const field = ['get', requireFieldBinding(selector.field, data)];
  if (selector.coerce === 'number') {
    return selector.fallback === undefined
      ? ['to-number', field]
      : ['to-number', field, selector.fallback];
  }
  return selector.fallback === undefined ? field : ['coalesce', field, selector.fallback];
}

function validateNormalization(
  selector: TileflowNormalizedRenderField,
  comparedValues: readonly TileflowRenderScalar[],
): void {
  if (selector.coerce !== undefined && selector.coerce !== 'number') {
    invalidSelector(`unknown field coercion ${String(selector.coerce)}`);
  }
  if (selector.fallback !== undefined) requireScalar(selector.fallback, 'field fallback');
  if (
    selector.coerce === 'number' &&
    ((selector.fallback !== undefined && typeof selector.fallback !== 'number') ||
      comparedValues.some((value) => typeof value !== 'number'))
  ) {
    invalidSelector('numeric field coercion requires numeric fallback and comparison values');
  }
}

function requireFieldBinding(
  fieldName: TileflowRenderField,
  data: ResolvedTileflowData,
): ReturnType<typeof field> {
  const binding = data.schema.fields[fieldName];
  if (!Object.hasOwn(data.schema.fields, fieldName) || !binding) {
    throw renderStackError(
      'missing-field-binding',
      `Tileflow data schema does not provide field ${String(fieldName)}.`,
    );
  }
  return field(fieldName);
}

function materializeRenderLayer(
  operation: TileflowCompiledRenderLayer,
  anchor: TileflowLayerFamilyIR,
): TileflowLayerFamilyIR {
  let template = cloneJson(operation.template);
  if (operation.renderer !== 'background' && template.feature?.dataSource === undefined) {
    if (anchor.feature?.dataSource === undefined || anchor.feature.dataLayer === undefined) {
      throw renderStackError(
        'missing-inherited-feature',
        `Render pass ${operation.target} has no feature and anchor ${operation.attachTo} has no vector feature to inherit.`,
      );
    }
    template = {...template, feature: cloneJson(anchor.feature)};
  }
  const slot = requireSemanticSlot(anchor, operation.attachTo);
  return materializeTileflowLayerFamilyIR(template, {
    operations: [{kind: 'pass', owner: operation.owner, target: operation.target}],
    order: anchor.order,
    owner: operation.owner,
    slot,
    target: operation.target,
  });
}

function applyRefinement(
  previous: TileflowLayerFamilyIR,
  refinement: TileflowCompiledRenderRefinement,
): TileflowLayerFamilyIR {
  const patch = refinement.patch;
  const operation = {
    kind: 'refinement' as const,
    owner: refinement.owner,
    target: refinement.target,
  };
  return {
    ...previous,
    ...(patch.annotations === undefined
      ? {}
      : {annotations: {...(previous.annotations ?? {}), ...patch.annotations}}),
    ...(patch.feature === undefined ? {} : {feature: cloneJson(patch.feature)}),
    ...(patch.properties === undefined
      ? {}
      : {properties: {...(previous.properties ?? {}), ...patch.properties}}),
    ...(patch.range === undefined ? {} : {range: {...(previous.range ?? {}), ...patch.range}}),
    ...(!Object.hasOwn(patch, 'selector') ? {} : {selector: cloneJson(patch.selector)}),
    origins: previous.origins.map((origin) =>
      origin.owner === refinement.owner && origin.target === refinement.target
        ? {...origin, operations: [...origin.operations, operation]}
        : origin,
    ),
    style: {
      ...previous.style,
      ...(patch.style?.placement === undefined
        ? {}
        : {
            placement: {
              ...(previous.style.placement ?? {}),
              ...patch.style.placement,
            },
          }),
      ...(patch.style?.appearance === undefined
        ? {}
        : {
            appearance: {
              ...(previous.style.appearance ?? {}),
              ...patch.style.appearance,
            },
          }),
    },
  };
}

function templateToPatch(template: TileflowLayerTemplateIR): TileflowLayerPatchIR {
  const {key: _key, renderer: _renderer, style, ...patch} = template;
  return {...patch, ...(Object.keys(style).length > 0 ? {style} : {})};
}

function rendererLayerType(renderer: TileflowRenderPassInput['renderer']): string {
  return renderer === 'extrusion' ? 'fill-extrusion' : renderer;
}

function requireRenderer(value: string): asserts value is TileflowRenderPassInput['renderer'] {
  if (!tileflowRenderStackRenderers.includes(value as TileflowRenderStackRenderer)) {
    throw renderStackError('invalid-renderer', `Unknown render-stack renderer: ${String(value)}.`);
  }
}

function requirePhase(value: string): asserts value is TileflowRenderStackPhase {
  if (!tileflowRenderStackPhases.includes(value as TileflowRenderStackPhase)) {
    throw renderStackError('invalid-phase', `Unknown render-stack phase: ${String(value)}.`);
  }
}

function validateStyle(
  renderer: TileflowRenderPassInput['renderer'],
  style: TileflowRenderPassInput['style'],
): void {
  if (!isRecord(style)) {
    throw renderStackError(
      'invalid-style',
      `A ${renderer} render operation requires a style object.`,
    );
  }
  const common = ['maxZoom', 'minZoom', 'visible', 'visibilityGroup'];
  const keys: Record<TileflowRenderPassInput['renderer'], readonly string[]> = {
    background: [...common, 'color', 'opacity', 'pattern'],
    circle: [
      ...common,
      'blur',
      'color',
      'opacity',
      'pitchAlignment',
      'pitchScale',
      'priority',
      'priorityOrder',
      'radius',
      'strokeColor',
      'strokeOpacity',
      'strokeWidth',
      'translate',
      'translateAnchor',
    ],
    extrusion: [...common, 'base', 'color', 'height', 'opacity', 'pattern', 'verticalGradient'],
    fill: [...common, 'antialias', 'color', 'opacity', 'pattern', 'translate', 'translateAnchor'],
    line: [
      ...common,
      'blur',
      'cap',
      'color',
      'dash',
      'gapWidth',
      'join',
      'miterLimit',
      'offset',
      'opacity',
      'pattern',
      'roundLimit',
      'translate',
      'translateAnchor',
      'width',
    ],
    symbol: [
      ...common,
      'icon',
      'placement',
      'priority',
      'priorityOrder',
      'spacing',
      'text',
      'zOrder',
    ],
  };
  assertOnlyKeys(style, keys[renderer], `${renderer} render style`);
  if (style.visibilityGroup !== undefined && style.visibilityGroup !== 'building') {
    throw renderStackError(
      'invalid-visibility-group',
      `Unknown render visibility group: ${String(style.visibilityGroup)}.`,
    );
  }
}

function assertRenderSelectorConstraints(selector: unknown): void {
  const issue = validateTileflowRenderSelectorConstraints(selector)[0];
  if (!issue) return;
  const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
  throw renderStackError(issue.code, `Invalid render selector${path}: ${issue.message}.`);
}

function normalizeRequirements(
  requirements: readonly TileflowLayerDomain[] | undefined,
): readonly TileflowLayerDomain[] {
  if (requirements === undefined) return [];
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw renderStackError(
      'invalid-requirements',
      'Render-stack requirements must be a non-empty array when provided.',
    );
  }
  if (requirements.length > tileflowRenderStackLimits.maxRequirements) {
    throw renderStackError(
      'too-many-requirements',
      `A render operation may declare at most ${tileflowRenderStackLimits.maxRequirements} requirements.`,
    );
  }
  const seen = new Set<TileflowLayerDomain>();
  for (const requirement of requirements) {
    if (!tileflowLayerDomains.includes(requirement)) {
      throw renderStackError(
        'invalid-requirement',
        `Unknown render-stack requirement: ${String(requirement)}.`,
      );
    }
    if (seen.has(requirement)) {
      throw renderStackError(
        'duplicate-requirement',
        `Render-stack requirement ${requirement} may be declared only once.`,
      );
    }
    seen.add(requirement);
  }
  return [...requirements];
}

function requireRenderStackEntries(stack: unknown): [string, TileflowRenderStackOperation][] {
  if (!isRecord(stack)) {
    throw renderStackError('invalid-stack', 'A render stack must be a named operation record.');
  }
  const entries = Object.entries(stack) as [string, TileflowRenderStackOperation][];
  if (entries.length === 0) {
    throw renderStackError('empty-stack', 'A render stack requires at least one named operation.');
  }
  if (entries.length > tileflowRenderStackLimits.maxOperations) {
    throw renderStackError(
      'too-many-operations',
      `A render stack may contain at most ${tileflowRenderStackLimits.maxOperations} named operations.`,
    );
  }
  return entries;
}

function requireAttachTarget(
  owner: TileflowLayerDomain,
  target: string,
  requirements: readonly TileflowLayerDomain[],
): void {
  requirePortableTarget(target, 'render attachment target');
  const targetOwner = target.split('.')[0] as TileflowLayerDomain;
  if (targetOwner !== owner && !requirements.includes(targetOwner)) {
    throw renderStackError(
      'cross-owner-attachment',
      `Render pass owner ${owner} may attach to ${target} only with an explicit ${targetOwner} requirement.`,
    );
  }
}

function requireOwnedTarget(owner: TileflowLayerDomain, target: string, description: string): void {
  requirePortableTarget(target, description);
  if (target !== owner && !target.startsWith(`${owner}.`)) {
    throw renderStackError(
      'cross-owner-refinement',
      `Render refinement target ${target} must belong to owner ${owner}.`,
    );
  }
}

function requirePortableTarget(target: string, description: string): void {
  if (typeof target !== 'string' || !tileflowSemanticTargetPattern.test(target)) {
    throw renderStackError('invalid-target', `Invalid ${description}: ${String(target)}.`);
  }
}

function requireOperationName(name: string): void {
  if (!tileflowRenderStackOperationNamePattern.test(name)) {
    throw renderStackError(
      'invalid-operation-name',
      `Render-stack operation name must be a portable semantic name: ${name}.`,
    );
  }
}

function requireUniqueCompiledLayers(
  layers: readonly TileflowLayerFamilyIR[],
  operations: readonly TileflowCompiledRenderLayer[],
): void {
  const keys = new Set(layers.map(({key}) => key));
  const targets = new Set(layers.map(({target}) => target));
  for (const operation of operations) {
    if (keys.has(operation.template.key)) {
      throw renderStackError(
        'duplicate-layer-key',
        `Render pass generated duplicate layer-family key: ${operation.template.key}.`,
      );
    }
    if (targets.has(operation.target)) {
      throw renderStackError(
        'duplicate-render-target',
        `Render pass generated duplicate semantic target: ${operation.target}.`,
      );
    }
    keys.add(operation.template.key);
    targets.add(operation.target);
  }
}

function compareCompiledOperations(
  left: TileflowCompiledRenderOperation,
  right: TileflowCompiledRenderOperation,
): number {
  const leftPhase = left.kind === 'layer' ? phaseOrder.get(left.phase)! : Number.MAX_SAFE_INTEGER;
  const rightPhase =
    right.kind === 'layer' ? phaseOrder.get(right.phase)! : Number.MAX_SAFE_INTEGER;
  return (
    leftPhase - rightPhase ||
    left.order - right.order ||
    compareCodeUnits(left.owner, right.owner) ||
    compareCodeUnits(left.name, right.name)
  );
}

function validateRenderPassOperation(operation: TileflowRenderPass): void {
  assertOnlyKeys(
    operation,
    ['attachTo', 'feature', 'kind', 'phase', 'renderer', 'requirements', 'selector', 'style'],
    'render pass operation',
  );
  requireRenderer(operation.renderer);
  requirePhase(operation.phase);
  validateStyle(operation.renderer, operation.style);
  if (operation.renderer === 'background' && ('feature' in operation || 'selector' in operation)) {
    throw renderStackError(
      'invalid-background-pass',
      'A background render pass cannot select vector features.',
    );
  }
}

function validateRefinementOperation(operation: TileflowRenderTargetRefinement): void {
  assertOnlyKeys(
    operation,
    ['kind', 'renderer', 'requirements', 'selector', 'style', 'target'],
    'render refinement operation',
  );
  requireRenderer(operation.renderer);
  validateStyle(operation.renderer, operation.style);
  if (operation.renderer === 'background' && 'selector' in operation) {
    throw renderStackError(
      'invalid-background-refinement',
      'A background refinement cannot select vector features.',
    );
  }
}

function requireSemanticSlot(layer: TileflowLayerFamilyIR, target: string): TileflowLayerSlot {
  if (!tileflowLayerSlots.includes(layer.slot)) {
    throw renderStackError(
      'missing-anchor-provenance',
      `Semantic render target ${target} has no compiler slot provenance.`,
    );
  }
  return layer.slot;
}

function findTargetIndex(layers: readonly TileflowLayerFamilyIR[], target: string): number {
  return layers.findIndex((layer) => layer.target === target);
}

function requireScalar(value: unknown, description: string): asserts value is TileflowRenderScalar {
  if (
    (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    invalidSelector(`${description} must be a finite scalar`);
  }
}

function requireScalarList(
  values: readonly unknown[],
  description: string,
): asserts values is readonly TileflowRenderScalar[] {
  if (!Array.isArray(values) || values.length === 0) {
    invalidSelector(`${description} requires at least one scalar value`);
  }
  for (const value of values) requireScalar(value, `${description} value`);
}

function invalidSelector(message: string): never {
  throw renderStackError('invalid-selector', `Invalid render selector: ${message}.`);
}

function assertOnlyKeys(input: object, allowed: readonly string[], description: string): void {
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw renderStackError(
      'unknown-authoring-key',
      `${description} does not accept ${unexpected.join(', ')}.`,
    );
  }
}

function renderStackError(code: string, message: string): Error & {code: string} {
  return Object.assign(new Error(message), {code, name: 'TileflowRenderStackError'});
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
