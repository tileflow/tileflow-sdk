import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';
import type {NativeAdmissionResource} from './native-admission-contract';

const decimal = '(?:0|[1-9][0-9]{0,9})';
const coordinate = '-?(?:0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,16})?';
const slots: Readonly<Record<string, string>> = Object.freeze({
  z: '(?:0|[1-9][0-9]?)',
  x: decimal,
  y: decimal,
  ratio: '(?:@2x|@3x)?',
  quadkey: '[0-3]{0,30}',
  prefix: '[0-9a-f]{2}',
  'bbox-epsg-3857': `${coordinate},${coordinate},${coordinate},${coordinate}`,
  fontstack: '(?:[A-Za-z0-9_.~,+-]|%[0-9a-fA-F]{2}){1,768}',
  range: `${decimal}-${decimal}`,
});
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const invalid = () => new Error('Invalid native resource template');

type Compiled = Readonly<{pattern: RegExp; names: readonly string[]}>;
const compiled = new WeakMap<NativeAdmissionResource, Compiled>();

function compile(resource: NativeAdmissionResource): Compiled {
  const names: string[] = [];
  let cursor = 0;
  let pattern = '^';
  for (const match of resource.url.matchAll(/\{([a-z0-9-]+)\}/gu)) {
    const name = match[1]!;
    if (!Object.hasOwn(slots, name) || names.length >= 16 || (names.length > 0 && match.index === cursor)) {
      throw invalid();
    }
    if (resource.template === 'glyphs' ? !['fontstack', 'range'].includes(name) : ['fontstack', 'range'].includes(name)) {
      throw invalid();
    }
    pattern += escape(resource.url.slice(cursor, match.index)) + `(${slots[name]})`;
    cursor = match.index + match[0].length;
    names.push(name);
  }
  if (!names.length || /[{}]/u.test(resource.url.replace(/\{[a-z0-9-]+\}/gu, ''))) throw invalid();
  pattern += escape(resource.url.slice(cursor)) + '$';
  return {pattern: new RegExp(pattern, 'u'), names: Object.freeze(names)};
}

/** Called only after Core has validated the URL, including its fixed authority. */
export function normalizeNativeTemplate(resource: NativeAdmissionResource): Partial<NativeAdmissionResource> {
  if (resource.template === undefined) {
    if (resource.fontStacks !== undefined || /[{}]/u.test(resource.url)) throw invalid();
    return {};
  }
  if (resource.template !== 'tile' && resource.template !== 'glyphs') throw invalid();
  if (resource.template === 'tile') {
    if (resource.scope !== 'tile' || resource.fontStacks !== undefined) throw invalid();
    compile(resource);
    return {template: 'tile'};
  }
  const stacks = resource.fontStacks;
  if (
    resource.scope !== 'glyph' || !Array.isArray(stacks) || stacks.length === 0 || stacks.length > 16 ||
    !resource.url.includes('{fontstack}') || !resource.url.includes('{range}') ||
    stacks.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 256 ||
      value !== value.trim() || /[\p{Cc}\\/?#%&=]|tf_native_|tf_public_/iu.test(value) ||
      value.split(',').some((part) => part.length === 0 || part !== part.trim())) ||
    new Set(stacks).size !== stacks.length
  ) throw invalid();
  compile(resource);
  return {template: 'glyphs', fontStacks: Object.freeze([...stacks])};
}

function expansionMatches(resource: NativeAdmissionResource, url: string): boolean {
  if (resource.template === undefined) return resource.url === url;
  let grammar = compiled.get(resource);
  if (!grammar) {
    grammar = compile(resource);
    compiled.set(resource, grammar);
  }
  const match = grammar.pattern.exec(url);
  if (!match) return false;
  const values = new Map<string, string>();
  for (let index = 0; index < grammar.names.length; index++) {
    const name = grammar.names[index]!;
    const value = match[index + 1]!;
    if (values.has(name) && values.get(name) !== value) return false;
    values.set(name, value);
  }
  const z = values.get('z');
  if (z !== undefined && Number(z) > 30) return false;
  for (const name of ['x', 'y']) {
    const value = values.get(name);
    if (value !== undefined && Number(value) >= 2 ** (z === undefined ? 30 : Number(z))) return false;
  }
  const quadkey = values.get('quadkey');
  if (quadkey !== undefined && z !== undefined && quadkey.length !== Number(z)) return false;
  const box = values.get('bbox-epsg-3857');
  if (box !== undefined) {
    const [west, south, east, north] = box.split(',').map(Number);
    if ([west, south, east, north].some((value) => !Number.isFinite(value) || Math.abs(value!) > 20037508.343) ||
      west! >= east! || south! >= north!) return false;
  }
  const range = values.get('range');
  if (range !== undefined) {
    const [start, end] = range.split('-').map(Number);
    if (start! % 256 !== 0 || end !== start! + 255 || end! > 1114111) return false;
  }
  const stack = values.get('fontstack');
  if (stack !== undefined) {
    try {
      if (!resource.fontStacks?.includes(decodeURIComponent(stack))) return false;
    } catch { return false; }
  }
  return true;
}

/** A unique match yields concrete identity; no authority is attached by this function. */
export function matchNativeResource(
  resources: Iterable<NativeAdmissionResource>,
  url: string,
): NativeAdmissionResource | undefined {
  try {
    if (url.length > 2048 || resolveTileflowNativeManifestUrl(url) !== url || /[{}]/u.test(url)) return undefined;
  } catch { return undefined; }
  let found: NativeAdmissionResource | undefined;
  for (const resource of resources) {
    if (!expansionMatches(resource, url)) continue;
    if (found) throw invalid();
    found = Object.freeze({url, scope: resource.scope,
      ...(resource.tilesetId === undefined ? {} : {tilesetId: resource.tilesetId})});
  }
  return found;
}
