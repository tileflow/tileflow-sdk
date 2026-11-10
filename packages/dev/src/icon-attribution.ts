import type {TileflowIconAttribution} from '@tileflow/core';

/** A winning icon's declared attribution, with the complete license text read beside it. */
export type TileflowIconAttributionNotice = TileflowIconAttribution & {
  id: string;
  licenseText: string;
};

/** Directory beside each built sprite that holds the credits its third-party icons require. */
export const tileflowIconAttributionDirectory = 'licenses';

/** The exact plain-text notice written beside a sprite for one attributed icon. */
export function formatTileflowIconAttributionNotice(
  attribution: TileflowIconAttributionNotice,
): string {
  return [
    `Icon: ${attribution.id}`,
    `Credit: ${attribution.credit}`,
    `Source: ${attribution.source}`,
    `License: ${attribution.license} (${attribution.licenseUrl})`,
    ...(attribution.changes ? [`Changes: ${attribution.changes}`] : []),
    '',
    attribution.licenseText.replace(/\s+$/u, ''),
    '',
  ].join('\n');
}
