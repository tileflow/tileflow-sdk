/**
 * Freeze one official map definition without changing Core's public authoring helpers.
 *
 * Official maps are shared package singletons and can appear more than once in an `extends`
 * graph. The visited set makes shared references and accidental cycles safe while symbol keys
 * ensure nested semantic render-stack definitions become immutable with the public definition.
 */
export function freezeOfficialMap<const T>(map: T): T {
  freezeValue(map, new WeakSet<object>());
  return map;
}

function freezeValue(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) freezeValue(descriptor.value, visited);
  }

  Object.freeze(value);
}
