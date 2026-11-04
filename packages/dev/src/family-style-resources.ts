import type {MapLibreStyle} from '@tileflow/core';

/** Families live one level above their standalone theme documents. */
export function rebaseTileflowFamilyStyle(
  style: MapLibreStyle,
  mapName: string,
  themeName: string,
): MapLibreStyle {
  const rebase = (value: string) => {
    let start = 0;
    let end = value.length;
    while (start < end && value.charCodeAt(start) <= 0x20) start++;
    while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
    const reference = value.slice(start, end);
    if (/^[\\/]/u.test(reference) || /^[a-z][a-z\d+.-]*:/iu.test(reference)) return value;
    const target =
      !reference || /^[?#]/u.test(reference) ? `${themeName}.json${reference}` : reference;
    // Keep the original reference lexical, including encoded dot segments and nested URL queries.
    // Resolving it from its original owner also preserves paths above the artifact root.
    return `../styles/${mapName}/${target}`;
  };
  const property = (value: unknown, key: string) => {
    if (record(value) && typeof value[key] === 'string') value[key] = rebase(value[key]);
  };
  const result = structuredClone(style);
  property(result, 'glyphs');
  if (typeof result.sprite === 'string') result.sprite = rebase(result.sprite);
  else if (Array.isArray(result.sprite))
    for (const sprite of result.sprite) property(sprite, 'url');
  const fontFaces = (result as unknown as Record<string, unknown>)['font-faces'];
  if (record(fontFaces))
    for (const [family, face] of Object.entries(fontFaces)) {
      if (typeof face === 'string') fontFaces[family] = rebase(face);
      else property(face, 'url');
    }
  for (const source of Object.values(result.sources)) {
    property(source, 'url');
    if (source.type === 'geojson') property(source, 'data');
    for (const key of ['tiles', 'urls']) {
      const value = (source as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value))
        (source as unknown as Record<string, unknown>)[key] = value.map((url) =>
          typeof url === 'string' ? rebase(url) : url,
        );
    }
  }
  const fonts = result.metadata?.['tileflow:fontFaces'];
  if (Array.isArray(fonts)) for (const face of fonts) property(face, 'source');
  for (const key of ['tileflow:buildings', 'tileflow:vegetation']) {
    const descriptor = result.metadata?.[key];
    if (!record(descriptor)) continue;
    if (Array.isArray(descriptor.models))
      for (const model of descriptor.models) property(model, 'url');
    property(descriptor.landmarks, 'url');
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
