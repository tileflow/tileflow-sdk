/** `setCamera` → `SET_CAMERA`. */
export const constantName = (name) =>
  name
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .toUpperCase();
/** A documentation comment wrapped to 100 columns. */
export function documentation(text, indent, style) {
  const [open, middle, close] = style === 'kotlin' ? ['/**', ' *', ' */'] : ['///', '///', ''];
  const width = 100 - indent.length - middle.length - 1;
  const rows = [];
  for (const word of text.split(' ')) {
    if (rows.length && `${rows.at(-1)} ${word}`.length <= width)
      rows[rows.length - 1] += ` ${word}`;
    else rows.push(word);
  }
  if (
    style === 'kotlin' &&
    rows.length === 1 &&
    `${open} ${rows[0]} */`.length + indent.length <= 100
  )
    return `${indent}${open} ${rows[0]} */`;
  if (style === 'kotlin')
    return [
      `${indent}${open}`,
      ...rows.map((row) => `${indent}${middle} ${row}`),
      `${indent}${close}`,
    ].join('\n');
  return rows.map((row) => `${indent}${middle} ${row}`).join('\n');
}
/** `requestTimeoutMs` → `requestTimeoutMilliseconds` in Swift, `REQUEST_TIMEOUT_MILLIS` in Kotlin. */
