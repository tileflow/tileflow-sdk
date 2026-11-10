import {createReadStream} from 'node:fs';
import {TilesetBuildError, yieldToEventLoop} from './errors';

/**
 * A small pull-free XML scanner for KML and GPX. It exists because the parsers on npm buffer a whole
 * text node before reporting it, which would let one hostile element exhaust memory. Here every
 * token is bounded, and there is nothing to expand: a document with a DTD is refused outright.
 */
export type XmlHandler = Readonly<{
  close: (name: string) => void;
  open: (name: string, attributes: ReadonlyMap<string, string>) => void;
  /** Character data in fragments; one text node can arrive in several calls. */
  text: (fragment: string) => void;
}>;

const chunkBytes = 4 * 1024 * 1024;
const maximumDepth = 128;
const maximumAttributes = 256;
/** A tag with all its attributes. Text and comments stream, so they have no such limit here. */
const maximumMarkupCharacters = 1024 * 1024;
const longestReference = 64;

export function fileChunks(path: string): AsyncIterable<Buffer> {
  return createReadStream(path, {highWaterMark: chunkBytes}) as AsyncIterable<Buffer>;
}

export async function readXml(source: AsyncIterable<Buffer>, handler: XmlHandler): Promise<void> {
  let decoder: TextDecoder | null = null;
  const scanner = new XmlScanner(handler);
  try {
    for await (const chunk of source) {
      decoder ??= decoderFor(chunk);
      scanner.write(decoder.decode(chunk, {stream: true}));
      await yieldToEventLoop();
    }
    if (decoder) scanner.write(decoder.decode());
  } catch (error) {
    if ((error as {code?: unknown}).code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
      throw invalid("the file's bytes do not match its declared text encoding.");
    }
    throw error;
  }
  scanner.end();
}

/**
 * Element names in the document's own vocabulary. The root's prefix decides what counts as ours, so
 * `<ns0:kml>` works and an extension's `<atom:name>` is not mistaken for a feature's `<name>`.
 * Anything else resolves to `''`.
 */
export function documentVocabulary(
  root: string,
  label: string,
  /** Namespace URIs of extensions we read, with the prefix they are written under in our code. */
  extensions: ReadonlyMap<string, string> = new Map(),
): (name: string, attributes: ReadonlyMap<string, string>) => string {
  let prefix: string | null = null;
  const bound = new Map([...extensions.values()].map((value) => [value, value]));
  return (name, attributes) => {
    const colon = name.indexOf(':');
    const namePrefix = colon < 0 ? '' : name.slice(0, colon);
    const local = name.slice(colon + 1);
    if (prefix === null) {
      if (local !== root) throw invalid(`the file is not ${label}: its root is <${name}>.`);
      prefix = namePrefix;
      for (const [attribute, value] of attributes) {
        const canonical = extensions.get(value);
        if (canonical && attribute.startsWith('xmlns:')) bound.set(attribute.slice(6), canonical);
      }
    }
    if (namePrefix === prefix) return local;
    const canonical = bound.get(namePrefix);
    return canonical ? `${canonical}:${local}` : '';
  };
}

/** Collects one element's text up to a size that a build can reasonably store in a tile. */
export class TextCapture {
  #parts: string[] = [];
  #size = 0;

  constructor(
    private readonly limit: number,
    private readonly location: () => string,
  ) {}

  write(fragment: string): void {
    this.#size += fragment.length;
    if (this.#size > this.limit) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_LIMIT',
        'input',
        `${this.location()}: a text value is longer than ${this.limit} characters.`,
      );
    }
    this.#parts.push(fragment);
  }

  value(): string {
    return this.#parts.join('').trim();
  }
}

function invalid(detail: string): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_INVALID',
    'input',
    `The XML could not be read: ${detail}`,
  );
}

function decoderFor(first: Buffer): TextDecoder {
  const label = bomEncoding(first) ?? declaredEncoding(first) ?? 'utf-8';
  try {
    return new TextDecoder(label, {fatal: true});
  } catch {
    throw invalid(`it declares an unknown text encoding, "${label}".`);
  }
}

function bomEncoding(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

function declaredEncoding(bytes: Buffer): string | null {
  const prolog = bytes.subarray(0, 256).toString('latin1');
  return /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/u.exec(prolog)?.[1] ?? null;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function decodeReferences(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(
    /&(#x[0-9a-fA-F]{1,60}|#[0-9]{1,60}|[A-Za-z][A-Za-z0-9]{0,59});|&/gu,
    (match, reference: string | undefined) => {
      switch (reference) {
        case undefined:
          throw invalid('a bare "&" must be written as "&amp;".');
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          break;
      }
      if (!reference.startsWith('#')) {
        throw invalid(`the entity ${match} is not defined; only the five XML entities are read.`);
      }
      const hex = reference.startsWith('#x');
      const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw invalid(`${match} is not a valid character.`);
      }
      return String.fromCodePoint(code);
    },
  );
}

class XmlScanner {
  #buffer = '';
  #position = 0;
  #consumed = 0;
  #mode: 'cdata' | 'comment' | 'content' = 'content';
  #stack: string[] = [];
  #sawRoot = false;

  constructor(private readonly handler: XmlHandler) {}

  write(text: string): void {
    this.#consumed += this.#position;
    this.#buffer = this.#buffer.slice(this.#position) + text;
    this.#position = 0;
    this.#scan();
  }

  end(): void {
    if (this.#mode !== 'content' || this.#position < this.#buffer.length) {
      throw this.#malformed('the document ends inside a tag, comment or CDATA section');
    }
    if (!this.#sawRoot) throw invalid('the file has no XML elements.');
    if (this.#stack.length > 0) {
      throw this.#malformed(`<${this.#stack.at(-1)}> is never closed; the file may be truncated`);
    }
  }

  #scan(): void {
    for (;;) {
      if (this.#mode === 'comment') {
        const end = this.#buffer.indexOf('-->', this.#position);
        if (end < 0) {
          this.#position = Math.max(this.#position, this.#buffer.length - 2);
          return;
        }
        this.#position = end + 3;
        this.#mode = 'content';
      } else if (this.#mode === 'cdata') {
        const end = this.#buffer.indexOf(']]>', this.#position);
        if (end < 0) {
          const safe = Math.max(this.#position, this.#buffer.length - 2);
          this.#emitRaw(safe);
          return;
        }
        this.#emitRaw(end);
        this.#position = end + 3;
        this.#mode = 'content';
      } else {
        const open = this.#buffer.indexOf('<', this.#position);
        if (open < 0) {
          this.#emitText(this.#safeTextEnd());
          return;
        }
        this.#emitText(open);
        if (!this.#markup()) return;
      }
    }
  }

  #emitRaw(end: number): void {
    if (end > this.#position) this.handler.text(this.#buffer.slice(this.#position, end));
    this.#position = end;
  }

  #emitText(end: number): void {
    if (end <= this.#position) return;
    const text = this.#buffer.slice(this.#position, end);
    this.#position = end;
    if (this.#stack.length > 0) {
      this.handler.text(decodeReferences(text));
    } else if (text.trim() !== '') {
      throw this.#malformed('text appears outside the root element');
    }
  }

  /** Holds back a trailing `&...` so that a reference split across chunks stays whole. */
  #safeTextEnd(): number {
    const length = this.#buffer.length;
    const ampersand = this.#buffer.lastIndexOf('&');
    if (ampersand < Math.max(this.#position, length - longestReference)) return length;
    return this.#buffer.includes(';', ampersand) ? length : ampersand;
  }

  /** Consumes one markup token at `#position`, or returns false if it needs more input. */
  #markup(): boolean {
    const buffer = this.#buffer;
    const start = this.#position;
    const next = buffer[start + 1];
    if (next === undefined) return false;
    if (next === '?') {
      const end = buffer.indexOf('?>', start + 2);
      if (end < 0) return this.#wait();
      this.#checkTagLength(end - start);
      this.#position = end + 2;
      return true;
    }
    if (next === '!') return this.#declaration();
    if (next === '/') {
      const end = buffer.indexOf('>', start + 2);
      if (end < 0) return this.#wait();
      this.#checkTagLength(end - start);
      const name = buffer.slice(start + 2, end).trimEnd();
      const expected = this.#stack.pop();
      if (name !== expected) {
        throw this.#malformed(`</${name}> does not close <${expected ?? 'anything'}>`);
      }
      this.#position = end + 1;
      this.handler.close(name);
      return true;
    }
    return this.#startTag();
  }

  #declaration(): boolean {
    const buffer = this.#buffer;
    const start = this.#position;
    if (buffer.startsWith('<!--', start)) {
      this.#mode = 'comment';
      this.#position = start + 4;
      return true;
    }
    if (buffer.startsWith('<![CDATA[', start)) {
      if (this.#stack.length === 0) throw this.#malformed('CDATA appears outside the root element');
      this.#mode = 'cdata';
      this.#position = start + 9;
      return true;
    }
    const head = buffer.slice(start, start + 9);
    if ('<!--'.startsWith(head) || '<![CDATA['.startsWith(head)) return false;
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_UNSAFE',
      'input',
      'The XML has a DOCTYPE or entity declaration. KML and GPX never need one, and it is how entity-expansion attacks work, so the file is refused.',
    );
  }

  #startTag(): boolean {
    const buffer = this.#buffer;
    const length = buffer.length;
    const start = this.#position;
    let index = start + 1;
    while (index < length && !this.#endsName(buffer.charCodeAt(index))) index += 1;
    if (index >= length) return this.#wait();
    const name = buffer.slice(start + 1, index);
    if (name === '') throw this.#malformed('a "<" does not start a tag');
    const attributes = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      while (index < length && isSpace(buffer.charCodeAt(index))) index += 1;
      if (index >= length) return this.#wait();
      const character = buffer[index];
      if (character === '>') {
        index += 1;
        break;
      }
      if (character === '/') {
        if (index + 1 >= length) return this.#wait();
        if (buffer[index + 1] !== '>') throw this.#malformed(`<${name}> has a stray "/"`);
        selfClosing = true;
        index += 2;
        break;
      }
      const nameStart = index;
      while (index < length && buffer[index] !== '=' && !this.#endsName(buffer.charCodeAt(index))) {
        index += 1;
      }
      if (index >= length) return this.#wait();
      const attribute = buffer.slice(nameStart, index);
      while (index < length && isSpace(buffer.charCodeAt(index))) index += 1;
      if (index >= length) return this.#wait();
      if (buffer[index] !== '=' || attribute === '') {
        throw this.#malformed(`<${name}> has a malformed attribute`);
      }
      index += 1;
      while (index < length && isSpace(buffer.charCodeAt(index))) index += 1;
      if (index >= length) return this.#wait();
      const quote = buffer[index];
      if (quote !== '"' && quote !== "'") {
        throw this.#malformed(`attribute "${attribute}" of <${name}> is not quoted`);
      }
      const valueEnd = buffer.indexOf(quote, index + 1);
      if (valueEnd < 0) return this.#wait();
      const raw = buffer.slice(index + 1, valueEnd);
      if (raw.includes('<')) throw this.#malformed(`attribute "${attribute}" contains "<"`);
      attributes.set(attribute, decodeReferences(raw));
      if (attributes.size > maximumAttributes) {
        throw limit(`<${name}> has more than ${maximumAttributes} attributes.`);
      }
      index = valueEnd + 1;
    }
    this.#checkTagLength(index - start);
    if (this.#stack.length === 0 && this.#sawRoot) {
      throw this.#malformed('the document has more than one root element');
    }
    if (this.#stack.length >= maximumDepth) {
      throw limit(`elements nest more than ${maximumDepth} levels deep.`);
    }
    this.#sawRoot = true;
    this.#position = index;
    this.handler.open(name, attributes);
    if (selfClosing) this.handler.close(name);
    else this.#stack.push(name);
    return true;
  }

  #endsName(code: number): boolean {
    return isSpace(code) || code === 0x2f || code === 0x3e;
  }

  /** An incomplete token waits for the next chunk, unless it has already grown past reason. */
  #wait(): boolean {
    this.#checkTagLength(this.#buffer.length - this.#position);
    return false;
  }

  /** Checked on complete tags too, so that the answer does not depend on where chunks fall. */
  #checkTagLength(length: number): void {
    if (length > maximumMarkupCharacters) {
      throw limit(`one tag is longer than ${maximumMarkupCharacters} characters.`);
    }
  }

  #malformed(reason: string): TilesetBuildError {
    return invalid(`near character ${this.#consumed + this.#position}: ${reason}.`);
  }
}

function limit(detail: string): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_LIMIT',
    'input',
    `The XML exceeds a safety limit: ${detail}`,
  );
}
