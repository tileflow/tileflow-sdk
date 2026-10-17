/** Changing scoring never changes the navigation or frame-sampling protocol. */
export const inspectorScoringPolicy = 'measured-evidence-v3' as const;

// Structural counts, design preferences and incomplete proxies are useful diagnostics,
// but cannot establish a defect. Keep their evidence without grading the map on it.
const diagnostics = new Set([
  'render-3',
  'render-4',
  'render-6',
  'render-8',
  'loading-0',
  'loading-1',
  'loading-2',
  'loading-5',
  'loading-6',
  'loading-7',
  'legibility-0',
  'legibility-1',
  'legibility-2',
  'legibility-4',
  'legibility-5',
  'legibility-6',
  'legibility-7',
  'a11y-2',
  'a11y-4',
  'a11y-5',
  'a11y-6',
  'a11y-7',
  'carto-0',
  'carto-1',
  'carto-2',
  'carto-3',
  'carto-5',
  'carto-6',
  'integrity-2',
  'integrity-4',
  'integrity-5',
]);

export function inspectorAssessment(id: string): 'diagnostic' | 'measured' {
  return diagnostics.has(id) ? 'diagnostic' : 'measured';
}

/** Spread a bounded sample across the input instead of favouring its first tile/features. */
export function inspectionSample<T>(items: readonly T[]): T[] {
  const limit = 24;
  if (items.length <= limit) return [...items];
  return Array.from(
    {length: limit},
    (_, index) => items[Math.floor((index * (items.length - 1)) / (limit - 1))]!,
  );
}
