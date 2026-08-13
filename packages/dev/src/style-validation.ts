import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import type {MapLibreStyle} from '@tileflow/core';
import {sanitizeDiagnosticSecrets} from './diagnostic-sanitization';

export type TileflowStyleValidationIssue = {
  map: string;
  message: string;
  path: string;
};

export class TileflowStyleValidationError extends Error {
  readonly code = 'STYLE_INVALID' as const;
  readonly issues: TileflowStyleValidationIssue[];
  readonly phase = 'style-validation' as const;

  constructor(issues: readonly TileflowStyleValidationIssue[]) {
    super('Compiled Tileflow styles are not valid MapLibre styles.');
    this.name = 'TileflowStyleValidationError';
    this.issues = normalizeIssues(issues);
  }
}

const maxIssues = 32;
const maxMessageLength = 300;
const maxPathLength = 300;

export function assertValidTileflowStyle(style: MapLibreStyle, map: string): void {
  const issues = validateTileflowStyle(style, map);
  if (issues.length > 0) throw new TileflowStyleValidationError(issues);
}

export function validateTileflowStyle(
  style: MapLibreStyle,
  map: string,
): TileflowStyleValidationIssue[] {
  const jsonIssues: TileflowStyleValidationIssue[] = [];
  collectJsonIssues(
    style,
    `maps.${sanitizePathSegment(map)}.style`,
    map,
    jsonIssues,
    new Set<object>(),
  );
  if (jsonIssues.length > 0) return normalizeIssues(jsonIssues);

  const semanticIssues = validateStyleMin(style as Parameters<typeof validateStyleMin>[0]).map(
    (issue) => createSemanticIssue(style, map, issue.message),
  );
  return normalizeIssues(semanticIssues);
}

export function normalizeTileflowStyleValidationIssues(
  issues: readonly TileflowStyleValidationIssue[],
): TileflowStyleValidationIssue[] {
  return normalizeIssues(issues);
}

function createSemanticIssue(
  style: MapLibreStyle,
  map: string,
  rawMessage: string,
): TileflowStyleValidationIssue {
  const normalized = rawMessage.replace(/[\r\n]+/g, ' ').trim();
  const separator = normalized.indexOf(':');
  const rawPath = separator >= 0 ? normalized.slice(0, separator).trim() : '';
  const detail = separator >= 0 ? normalized.slice(separator + 1).trim() : normalized;

  return {
    map,
    message: boundText(sanitizeDiagnosticSecrets(sanitizeUrls(detail)), maxMessageLength),
    path: boundText(stableStylePath(style, map, rawPath), maxPathLength),
  };
}

function stableStylePath(style: MapLibreStyle, map: string, rawPath: string): string {
  const fallback = `maps.${sanitizePathSegment(map)}.style`;
  if (!rawPath) return fallback;

  const path = rawPath.replace(/layers\[(\d+)]/g, (_match, index: string) => {
    const layer = style.layers[Number(index)];
    const id = typeof layer?.id === 'string' && layer.id ? layer.id : index;
    return `layers.${sanitizePathSegment(id)}`;
  });
  return `${fallback}.${path}`;
}

function sanitizePathSegment(value: string): string {
  let sanitized = '';
  let replacing = false;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAsciiLetter =
      (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
    const isDigit = codePoint >= 0x30 && codePoint <= 0x39;
    const shouldReplace = !isAsciiLetter && !isDigit && character !== '-' && character !== '_';
    if (shouldReplace) {
      if (!replacing) sanitized += '-';
      replacing = true;
    } else {
      sanitized += character;
      replacing = false;
    }
  }

  return sanitized.slice(0, 128) || '(unknown)';
}

function collectJsonIssues(
  value: unknown,
  path: string,
  map: string,
  issues: TileflowStyleValidationIssue[],
  ancestors: Set<object>,
): void {
  if (issues.length >= maxIssues) return;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addJsonIssue(map, path, 'non-finite number', issues);
    return;
  }
  if (typeof value !== 'object') {
    addJsonIssue(map, path, typeof value, issues);
    return;
  }
  if (ancestors.has(value)) {
    addJsonIssue(map, path, 'cyclic object', issues);
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const layerId =
        path.endsWith('.layers') && item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : undefined;
      const childPath =
        typeof layerId === 'string' && layerId
          ? `${path}.${sanitizePathSegment(layerId)}`
          : `${path}[${index}]`;
      collectJsonIssues(item, childPath, map, issues, ancestors);
    });
  } else {
    for (const [key, item] of Object.entries(value)) {
      collectJsonIssues(item, `${path}.${sanitizePathSegment(key)}`, map, issues, ancestors);
    }
  }
  ancestors.delete(value);
}

function addJsonIssue(
  map: string,
  path: string,
  type: string,
  issues: TileflowStyleValidationIssue[],
): void {
  issues.push({
    map,
    message: `Expected a recursive JSON value; found ${type}.`,
    path: boundText(path, maxPathLength),
  });
}

function normalizeIssues(
  issues: readonly TileflowStyleValidationIssue[],
): TileflowStyleValidationIssue[] {
  const normalized = issues.map((issue) => ({
    map: boundText(sanitizePathSegment(issue.map), 128),
    message: boundText(
      sanitizeDiagnosticSecrets(issue.message.replace(/[\r\n]+/g, ' ').trim()),
      maxMessageLength,
    ),
    path: boundText(issue.path.replaceAll('\\', '/'), maxPathLength),
  }));
  normalized.sort((left, right) =>
    left.path < right.path
      ? -1
      : left.path > right.path
        ? 1
        : left.message < right.message
          ? -1
          : left.message > right.message
            ? 1
            : 0,
  );

  return normalized
    .filter(
      (issue, index) =>
        index === 0 ||
        issue.path !== normalized[index - 1]?.path ||
        issue.message !== normalized[index - 1]?.message,
    )
    .slice(0, maxIssues);
}

function sanitizeUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s'"<>]+/gi, (value) => {
    try {
      return new URL(value.replace(/[),.;]+$/, '')).origin;
    } catch {
      return '(resource URL)';
    }
  });
}

function boundText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
