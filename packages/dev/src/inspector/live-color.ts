export const colorPreviewInterval = 120;

/** Keep the native picker mounted and apply only the latest color in each time window. */
export function bindLiveColorInput(
  input: HTMLInputElement,
  apply: (color: string, gesture: symbol) => void,
  isCurrent: () => boolean,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | undefined;
  let gesture: symbol | undefined;
  let disposed = false;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const color = pending;
    pending = undefined;
    if (color !== undefined && !disposed && isCurrent())
      apply(color, (gesture ??= Symbol('color gesture')));
  };
  const preview = () => {
    pending = input.value;
    timer ??= setTimeout(flush, colorPreviewInterval);
  };
  const commit = () => {
    pending = input.value;
    flush();
    gesture = undefined;
  };
  const blur = () => {
    flush();
    gesture = undefined;
  };
  input.addEventListener('input', preview);
  input.addEventListener('change', commit);
  input.addEventListener('blur', blur);
  return () => {
    disposed = true;
    clearTimeout(timer);
    pending = undefined;
    input.removeEventListener('input', preview);
    input.removeEventListener('change', commit);
    input.removeEventListener('blur', blur);
  };
}
