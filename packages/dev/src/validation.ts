import {realpathSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep, win32} from 'node:path';
import {compareCodeUnits} from '@tileflow/core';
import {sanitizeDiagnosticSecrets} from './diagnostic-sanitization';

export {
  assertValidTileflowStyle,
  TileflowStyleValidationError,
  validateTileflowStyle,
} from './style-validation';
export type {TileflowStyleValidationIssue} from './style-validation';

export const tileflowCommandDocumentSchemaVersion = 1 as const;

export type TileflowDiagnosticSeverity = 'error' | 'info' | 'warning';

/** Stable, bounded diagnostic contract intended for tools and coding agents. */
export type TileflowStructuredDiagnostic = {
  phase: string;
  code: string;
  path: string;
  severity: TileflowDiagnosticSeverity;
  message: string;
  suggestion: string;
};

export type TileflowCommandSummary = TileflowStructuredDiagnostic & {
  schemaVersion: typeof tileflowCommandDocumentSchemaVersion;
  command: string;
  ok: boolean;
};

export type TileflowCommandFailureDocument = TileflowCommandSummary & {
  ok: false;
  diagnostics: TileflowStructuredDiagnostic[];
};

type TileflowDiagnosticDefaults = {
  code: string;
  phase: string;
  severity?: TileflowDiagnosticSeverity;
};

type RawDiagnostic = {
  code?: string;
  level?: string;
  message: string;
  path?: string;
  phase?: string;
  severity?: string;
};

export function createTileflowCommandSummary(input: {
  code: string;
  command: string;
  message: string;
  ok: boolean;
  path?: string;
  phase: string;
  severity: TileflowDiagnosticSeverity;
  suggestion: string;
}): TileflowCommandSummary {
  return {
    schemaVersion: tileflowCommandDocumentSchemaVersion,
    command: normalizeCommandField(input.command, 'command'),
    ok: input.ok,
    phase: normalizePhase(input.phase, 'command'),
    code: normalizeCode(input.code, input.ok ? 'COMMAND_OK' : 'COMMAND_FAILED'),
    path: boundText(input.path ?? '', 300),
    severity: input.severity,
    message: boundText(input.message.replace(/[\r\n]+/gu, ' ').trim(), 300),
    suggestion: boundText(input.suggestion.replace(/[\r\n]+/gu, ' ').trim(), 300),
  };
}

/** Convert arbitrary SDK failures to sorted diagnostics without leaking paths, URLs, or secrets. */
export function createTileflowStructuredDiagnostics(
  error: unknown,
  cwd: string,
  defaults: TileflowDiagnosticDefaults,
): TileflowStructuredDiagnostic[] {
  const inheritedCode = optionalField(error, 'code');
  const inheritedPhase = optionalField(error, 'phase') ?? optionalNestedField(error, 'phase');
  const issues = getIssues(error);
  const candidates = issues.length
    ? issues
    : [
        {
          message: error instanceof Error ? error.message : 'The Tileflow command failed.',
          path: '',
        },
      ];
  const diagnostics = candidates.map((issue) => {
    const phase = normalizePhase(issue.phase ?? inheritedPhase, defaults.phase);
    const code = normalizeCode(issue.code ?? inheritedCode, defaults.code);
    const severity = normalizeSeverity(issue.severity ?? issue.level, defaults.severity ?? 'error');
    return {
      phase,
      code,
      path: boundText(sanitizePath(issue.path ?? '', cwd), 300),
      severity,
      message: boundText(sanitizeMessage(issue.message, cwd), 300),
      suggestion: suggestionForDiagnostic(code, phase),
    } satisfies TileflowStructuredDiagnostic;
  });

  diagnostics.sort(compareDiagnostics);
  return diagnostics
    .filter(
      (diagnostic, index) =>
        index === 0 || JSON.stringify(diagnostic) !== JSON.stringify(diagnostics[index - 1]),
    )
    .slice(0, 32);
}

export function createTileflowCommandFailureDocument(
  command: string,
  error: unknown,
  cwd: string,
  defaults: TileflowDiagnosticDefaults,
): TileflowCommandFailureDocument {
  const diagnostics = createTileflowStructuredDiagnostics(error, cwd, defaults);
  const primary = diagnostics[0] ?? {
    phase: normalizePhase(defaults.phase, 'command'),
    code: normalizeCode(defaults.code, 'COMMAND_FAILED'),
    path: '',
    severity: defaults.severity ?? 'error',
    message: 'The Tileflow command failed.',
    suggestion: 'Review the command input and run it again.',
  };
  return {
    schemaVersion: tileflowCommandDocumentSchemaVersion,
    command: normalizeCommandField(command, 'command'),
    ok: false,
    phase: primary.phase,
    code: primary.code,
    path: primary.path,
    severity: primary.severity,
    message: primary.message,
    suggestion: primary.suggestion,
    diagnostics,
  };
}

export function serializeTileflowCommandDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function getIssues(error: unknown): RawDiagnostic[] {
  if (!error || typeof error !== 'object') return [];
  const containers: unknown[][] = [];
  for (const key of ['messages', 'issues'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (Array.isArray(value)) containers.push(value);
  }
  const details = (error as Record<string, unknown>).details;
  if (details && typeof details === 'object') {
    const diagnostics = (details as Record<string, unknown>).diagnostics;
    if (Array.isArray(diagnostics)) containers.push(diagnostics);
  }

  return containers.flatMap((container) =>
    container.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.message !== 'string') return [];
      return [
        {
          ...(typeof candidate.code === 'string' ? {code: candidate.code} : {}),
          ...(typeof candidate.level === 'string' ? {level: candidate.level} : {}),
          message: candidate.message,
          ...(typeof candidate.path === 'string' ? {path: candidate.path} : {}),
          ...(typeof candidate.phase === 'string' ? {phase: candidate.phase} : {}),
          ...(typeof candidate.severity === 'string' ? {severity: candidate.severity} : {}),
        },
      ];
    }),
  );
}

function sanitizeMessage(value: string, cwd: string): string {
  let sanitized = value;
  for (const root of localPathAliases(cwd)) sanitized = sanitized.replaceAll(root, '.');
  sanitized = sanitized.replace(/[\r\n]+/gu, ' ').trim();
  sanitized = sanitized.replace(/https?:\/\/[^\s'")<>]+/giu, (url) => {
    try {
      return new URL(url.replace(/[),.;]+$/u, '')).origin;
    } catch {
      return '(resource URL)';
    }
  });
  sanitized = sanitized.replace(/(^|[\s'"(])[A-Za-z]:[\\/][^\s'")]+/gu, '$1(external path)');
  sanitized = sanitized.replace(/(^|[\s'"(])(?:\\\\|\/\/)[^\s'")]+/gu, '$1(external path)');
  sanitized = sanitized.replace(/(^|[\s'"(])\/[^\s'")]+/gu, '$1(external path)');
  return sanitizeDiagnosticSecrets(sanitized);
}

function sanitizePath(value: string, cwd: string): string {
  if (!value) return '';
  if (win32.isAbsolute(value) && !isAbsolute(value)) return '(external)';
  if (!isAbsolute(value)) return sanitizeDiagnosticSecrets(value.replaceAll('\\', '/'));
  const local = relative(canonicalPath(cwd), canonicalPath(value)).replaceAll(sep, '/');
  return local.startsWith('../') || local === '..' ? '(external)' : local || '.';
}

function localPathAliases(path: string): string[] {
  return [...new Set([resolve(path), canonicalPath(path)])].sort(
    (left, right) => right.length - left.length,
  );
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}

function suggestionForDiagnostic(code: string, phase: string): string {
  if (code === 'INVALID_TARGET' || phase === 'command-validation') {
    return 'Use a documented command option and run the command again.';
  }
  if (phase === 'config-load') {
    return 'Check the config path and its installed imports, then run the command again.';
  }
  if (phase === 'config-validation' || code === 'CONFIG_INVALID') {
    return 'Edit the reported config path to match the Tileflow config reference, then validate again.';
  }
  if (phase.includes('icon') || code.includes('ICON')) {
    return 'Fix the reported icon input and run validation again.';
  }
  if (phase.includes('font') || code.includes('FONT') || code.includes('GLYPH')) {
    return 'Fix the reported font or glyph input and run validation again.';
  }
  if (phase === 'style-validation' || code === 'STYLE_INVALID') {
    return 'Adjust the reported semantic map value and run validation again.';
  }
  if (phase === 'hosted-validation' || code === 'HOSTED_INCOMPATIBLE') {
    return 'Use a supported Hosted input or validate with the local target.';
  }
  if (phase === 'config-inspection') {
    return 'Resolve the reported config diagnostic before inspecting the map again.';
  }
  return 'Review the reported path and run the command again.';
}

function compareDiagnostics(
  left: TileflowStructuredDiagnostic,
  right: TileflowStructuredDiagnostic,
): number {
  return (
    diagnosticSeverityRank(left.severity) - diagnosticSeverityRank(right.severity) ||
    compareCodeUnits(left.path, right.path) ||
    compareCodeUnits(left.phase, right.phase) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.message, right.message) ||
    compareCodeUnits(left.suggestion, right.suggestion)
  );
}

function diagnosticSeverityRank(severity: TileflowDiagnosticSeverity): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

function normalizeSeverity(
  value: string | undefined,
  fallback: TileflowDiagnosticSeverity,
): TileflowDiagnosticSeverity {
  return value === 'error' || value === 'info' || value === 'warning' ? value : fallback;
}

function normalizeCode(value: string | undefined, fallback: string): string {
  const normalized = sanitizeDiagnosticSecrets(value ?? fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, '_')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizePhase(value: string | undefined, fallback: string): string {
  const normalized = sanitizeDiagnosticSecrets(value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, '-')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeCommandField(value: string, fallback: string): string {
  const normalized = sanitizeDiagnosticSecrets(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ._-]/gu, '')
    .trim()
    .slice(0, 64);
  return normalized || fallback;
}

function optionalField(value: unknown, key: 'code' | 'phase'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function optionalNestedField(value: unknown, key: 'code' | 'phase'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return optionalField((value as Record<string, unknown>).details, key);
}

function boundText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
