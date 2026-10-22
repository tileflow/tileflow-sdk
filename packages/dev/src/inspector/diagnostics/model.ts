import type {LayerContribution} from '../types';

export type DiagnosticCategory = 'readability' | 'style' | 'assets' | 'performance';
export type DiagnosticKind = 'problem' | 'review';
export type DiagnosticScope = 'style' | 'view';
export type DiagnosticCamera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};
export type DiagnosticTarget = {
  layer: string;
  section: 'paint' | 'layout' | 'filter';
  property: string;
};
export type DiagnosticSample = {
  layer?: string;
  featureId?: string | number;
  coordinate?: [number, number];
  camera?: DiagnosticCamera;
  text?: string;
  value?: string | number;
};
export type DiagnosticEvidence = {label: string; value: string | number};
export type DiagnosticFinding = {
  /** Stable across repeated checks; dismissal also requires a matching fingerprint. */
  id: string;
  /** Changes when the relevant rule, resource or evidence changes. */
  fingerprint: string;
  check: string;
  category: DiagnosticCategory;
  kind: DiagnosticKind;
  title: string;
  summary: string;
  detail: string;
  scope: DiagnosticScope;
  layers: string[];
  target?: DiagnosticTarget;
  evidence: DiagnosticEvidence[];
  samples?: DiagnosticSample[];
  limitations: string[];
};
export type DiagnosticProvenance = {
  layers: {id: string; contributions: LayerContribution[]}[];
};

/** Sort object keys so property insertion order does not create a new finding. */
export function diagnosticSignature(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(diagnosticSignature).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${diagnosticSignature(entry)}`)
    .join(',')}}`;
}

/** Compact local identity, not a security hash. */
export function diagnosticFingerprint(value: unknown): string {
  const text = diagnosticSignature(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function diagnosticFinding(
  key: string,
  finding: Omit<DiagnosticFinding, 'id' | 'fingerprint'>,
  revision?: unknown,
): DiagnosticFinding {
  return {
    ...finding,
    id: `${finding.check}:${diagnosticFingerprint(key)}`,
    fingerprint: diagnosticFingerprint(revision ?? finding),
  };
}
