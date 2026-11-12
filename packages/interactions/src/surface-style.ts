/** The name of a CSS variable an application sets to restyle one role of the interaction overlays. */
export type TileflowInteractionRole = 'cluster' | 'marker' | 'popup' | 'tooltip';

/**
 * `var()` for one property of one role: the role's own variable first, then the shared variable
 * every role has always read, then the built-in value. An application sets only what it needs.
 */
export function roleVariable(
  role: TileflowInteractionRole,
  name: string,
  fallback: string,
): string {
  return `var(--tileflow-interaction-${role}-${name}, var(--tileflow-interaction-${name}, ${fallback}))`;
}

/** The popup's close button: a real button that shows a cross and keeps its accessible name. */
export function configurePopupCloseButton(
  button: HTMLButtonElement,
  document: Pick<Document, 'createElement'>,
): void {
  const glyph = document.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = '×';
  glyph.style.display = 'block';
  glyph.style.fontSize = '1.25rem';
  glyph.style.lineHeight = '1';
  button.append(glyph);
  button.style.alignItems = 'center';
  button.style.background = 'transparent';
  button.style.border = '0';
  button.style.borderRadius = '0.25rem';
  button.style.color = 'var(--tileflow-interaction-popup-close-color, inherit)';
  button.style.cursor = 'pointer';
  button.style.display = 'inline-flex';
  button.style.height = '1.5rem';
  button.style.justifyContent = 'center';
  button.style.padding = '0';
  button.style.position = 'absolute';
  button.style.right = '0.25rem';
  button.style.top = '0.25rem';
  button.style.width = '1.5rem';
}
