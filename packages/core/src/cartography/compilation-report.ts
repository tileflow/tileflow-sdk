import type {TileflowSourceRequirementsV1} from '../data/requirements';
import type {MapLibreStyle} from '../types';
import type {TileflowStyleInspection} from './compiler-inspection';
import type {TileflowSemanticModuleName} from './domain-registry';

export const tileflowCompilationReportSchemaVersion = 1 as const;

export const tileflowCompilationPhases = Object.freeze([
  'assembly',
  'assets',
  'config-validation',
  'data',
  'domain-ir',
  'domains',
  'finalization',
  'input',
  'lowering',
  'physical-planner',
  'render-stack',
  'theme',
  'theme-audit',
  'validation',
] as const);
export const tileflowCompilationPlannerStages = Object.freeze([
  'domain-ir',
  'assembly',
  'render-stack',
  'physical-planner',
  'lowering',
] as const);

export type TileflowCompilationPhase = (typeof tileflowCompilationPhases)[number];
export type TileflowCompilationPlannerStage = (typeof tileflowCompilationPlannerStages)[number];

export type TileflowCompilationDiagnostic = Readonly<{
  code: string;
  domain?: TileflowSemanticModuleName;
  message: string;
  path?: string;
  phase: TileflowCompilationPhase;
  severity: 'error' | 'warning';
  suggestion?: string;
  target?: string;
}>;

export type TileflowCompilationDomainReport = Readonly<{
  contributionCount: number;
  name: TileflowSemanticModuleName;
  renderOperationCount: number;
  status: 'emitted' | 'suppressed';
  suppressionReason?: 'disabled' | 'no-contributions';
  targets: readonly string[];
}>;

export type TileflowCompilationPlannerDecision = Readonly<{
  candidateCount?: number;
  inputCount: number;
  outputCount: number;
  selectedCount?: number;
  stage: TileflowCompilationPlannerStage;
}>;

export type TileflowCompilationReport = Readonly<{
  domains: readonly TileflowCompilationDomainReport[];
  map: string;
  planner: readonly TileflowCompilationPlannerDecision[];
  /** Opt-in read-only physical diagnostics; its IDs are not addressable authoring targets. */
  provenance?: TileflowStyleInspection;
  requirements?: TileflowSourceRequirementsV1;
  schemaVersion: typeof tileflowCompilationReportSchemaVersion;
  targets: readonly string[];
  theme?: string;
}>;

export type TileflowCompilationSuccess = Readonly<{
  diagnostics: readonly TileflowCompilationDiagnostic[];
  ok: true;
  report: TileflowCompilationReport;
  style: MapLibreStyle;
}>;

export type TileflowCompilationFailure = Readonly<{
  diagnostics: readonly TileflowCompilationDiagnostic[];
  ok: false;
  report: TileflowCompilationReport;
  style?: never;
}>;

export type TileflowCompilationResult = TileflowCompilationFailure | TileflowCompilationSuccess;

export function createTileflowCompilationFailure(input: {
  readonly error: unknown;
  readonly map: string;
  readonly phase?: TileflowCompilationPhase;
  readonly report?: Partial<TileflowCompilationReport>;
  readonly theme?: string;
}): TileflowCompilationFailure {
  return {
    diagnostics: diagnosticsFromError(input.error, input.phase ?? 'input'),
    ok: false,
    report: {
      domains: input.report?.domains ?? [],
      map: input.report?.map ?? input.map,
      planner: input.report?.planner ?? [],
      ...(input.report?.provenance ? {provenance: input.report.provenance} : {}),
      ...(input.report?.requirements ? {requirements: input.report.requirements} : {}),
      schemaVersion: tileflowCompilationReportSchemaVersion,
      targets: input.report?.targets ?? [],
      ...((input.report?.theme ?? input.theme) ? {theme: input.report?.theme ?? input.theme} : {}),
    },
  };
}

function diagnosticsFromError(
  error: unknown,
  fallbackPhase: TileflowCompilationPhase,
): readonly TileflowCompilationDiagnostic[] {
  const record = asRecord(error);
  const inheritedPhase = isTileflowCompilationPhase(record.phase) ? record.phase : fallbackPhase;
  const nested = Array.isArray(record.diagnostics) ? record.diagnostics : undefined;
  if (nested?.length) {
    return nested.map((item) =>
      diagnosticFromRecord(asRecord(item), error, inheritedPhase, record),
    );
  }
  const messages = Array.isArray(record.messages) ? record.messages : undefined;
  if (messages?.length) {
    return messages.map((item) =>
      diagnosticFromRecord(asRecord(item), error, inheritedPhase, record),
    );
  }
  return [diagnosticFromRecord(record, error, inheritedPhase)];
}

function diagnosticFromRecord(
  record: Record<string, unknown>,
  fallback: unknown,
  fallbackPhase: TileflowCompilationPhase,
  inherited: Record<string, unknown> = {},
): TileflowCompilationDiagnostic {
  const code = inheritedString(record, inherited, 'code');
  const domain =
    inheritedString(record, inherited, 'domain') ?? inheritedString(record, inherited, 'owner');
  const message = inheritedString(record, inherited, 'message');
  const path = inheritedString(record, inherited, 'path');
  const phase = record.phase ?? inherited.phase;
  const severity = record.severity ?? record.level ?? inherited.severity ?? inherited.level;
  const suggestion = inheritedString(record, inherited, 'suggestion');
  const target = inheritedString(record, inherited, 'target');
  return {
    code: code ?? 'TILEFLOW_COMPILATION_FAILED',
    ...(domain ? {domain: domain as TileflowSemanticModuleName} : {}),
    message:
      message !== undefined
        ? message
        : fallback instanceof Error
          ? fallback.message
          : String(fallback),
    ...(path ? {path} : {}),
    phase: isTileflowCompilationPhase(phase) ? phase : fallbackPhase,
    severity: severity === 'warning' ? 'warning' : 'error',
    ...(suggestion ? {suggestion} : {}),
    ...(target ? {target} : {}),
  };
}

function inheritedString(
  record: Record<string, unknown>,
  inherited: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key] ?? inherited[key];
  return typeof value === 'string' ? value : undefined;
}

export function isTileflowCompilationPhase(value: unknown): value is TileflowCompilationPhase {
  return (
    typeof value === 'string' && (tileflowCompilationPhases as readonly string[]).includes(value)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
