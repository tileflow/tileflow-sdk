/** Style metadata key for notices that must stay visible whenever the map is displayed. */
export const tileflowNoticesMetadataKey = 'tileflow:notices' as const;

/**
 * A short plain-text notice the compiled style declares for the sources it names. Runtimes render
 * it on the map, next to the attribution; it never replaces a source's own attribution.
 */
export type TileflowMapNotice = Readonly<{
  id: string;
  sources: readonly string[];
  text: string;
}>;

export const tileflowNoticeLimits = Object.freeze({
  maxNotices: 8,
  maxSources: 16,
  maxTextLength: 120,
});

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

/** Read bounded notices from style metadata; malformed entries are ignored, never rendered. */
export function readTileflowNotices(metadata: unknown): readonly TileflowMapNotice[] {
  if (!isRecord(metadata)) return [];
  const value = metadata[tileflowNoticesMetadataKey];
  if (!Array.isArray(value)) return [];
  const notices: TileflowMapNotice[] = [];
  const ids = new Set<string>();
  for (const entry of value.slice(0, tileflowNoticeLimits.maxNotices)) {
    const notice = readNotice(entry);
    if (!notice || ids.has(notice.id)) continue;
    ids.add(notice.id);
    notices.push(notice);
  }
  return Object.freeze(notices);
}

function readNotice(value: unknown): TileflowMapNotice | undefined {
  if (!isRecord(value)) return undefined;
  const {id, sources, text} = value;
  if (typeof id !== 'string' || !identifierPattern.test(id)) return undefined;
  if (
    typeof text !== 'string' ||
    text.trim() !== text ||
    !text ||
    text.length > tileflowNoticeLimits.maxTextLength ||
    /\p{Cc}/u.test(text)
  ) {
    return undefined;
  }
  if (
    !Array.isArray(sources) ||
    sources.length > tileflowNoticeLimits.maxSources ||
    !sources.every((source) => typeof source === 'string' && identifierPattern.test(source))
  ) {
    return undefined;
  }
  return Object.freeze({id, sources: Object.freeze([...sources]), text});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
