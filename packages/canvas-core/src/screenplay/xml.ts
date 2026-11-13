/**
 * A small, strict XML reader: enough of XML 1.0 for a Final Draft file, without the DOM, so it
 * runs where `DOMParser` does not (Node, Hermes). It keeps elements, their attributes and their
 * text; comments and processing instructions are dropped, CDATA is text. Like the browser's
 * parser it refuses a document that is not well formed. It never reads a DTD: a document type
 * declaration is an error, so only the five predefined entities and character references exist.
 *
 * Names keep their prefix (`fd:Text`), as the DOM's `nodeName` does; a prefix must be declared.
 *
 * shortcut: namespaces are only checked for declared prefixes, not resolved to their URIs, and
 * attribute values are not normalised beyond whitespace, as a DTD could ask; upgrade if a
 * format that needs either is read.
 */
export interface XmlElement {
  name: string;
  attributes: ReadonlyMap<string, string>;
  /** Child elements, in order. */
  children: XmlElement[];
  /** Child elements and text, in order. */
  content: Array<XmlElement | string>;
}

export class XmlError extends Error {}

/** XML's name characters, written as escapes (joiners left out: a name with one is refused). */
const NAME_START =
  'A-Za-z_:\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\uD800-\\uDBFF';
const NAME = new RegExp(
  `[${NAME_START}][${NAME_START}\\w.\\-\\u00B7\\u0300-\\u036F\\u203F\\u2040\\uDC00-\\uDFFF]*`,
  'y',
);
const SPACE = /[ \t\n]*/y;
const ATTRIBUTE_VALUE = /"([^<"]*)"|'([^<']*)'/y;
/** Characters XML does not allow, written or referenced. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is the point.
const NOT_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
const PREDEFINED = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** Parses a document and returns its root element; throws `XmlError` when it is not XML. */
export function parseXml(source: string): XmlElement {
  // Line ends are read as one newline, as XML requires before parsing.
  const s = source.replace(/\r\n?/g, '\n');
  if (NOT_CHAR.test(s)) throw new XmlError('character');
  let i = 0;
  const fail = (why: string): never => {
    throw new XmlError(why);
  };
  const at = (text: string) => s.startsWith(text, i);
  const match = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m) i = re.lastIndex;
    return m;
  };
  const space = () => {
    const before = i;
    match(SPACE);
    return i > before;
  };
  const skipPast = (end: string, why: string) => {
    const found = s.indexOf(end, i);
    if (found < 0) fail(why);
    const inner = s.slice(i, found);
    i = found + end.length;
    return inner;
  };
  /** A comment or processing instruction, which the reader drops. */
  const misc = () => {
    if (at('<!--')) {
      i += 4;
      const comment = skipPast('-->', 'comment');
      if (comment.includes('--') || comment.endsWith('-')) fail('comment');
      return true;
    }
    if (at('<?')) {
      i += 2;
      const target = match(NAME)?.[0];
      if (!target || target.toLowerCase() === 'xml') fail('instruction');
      if (!at('?>') && !space()) fail('instruction');
      skipPast('?>', 'instruction');
      return true;
    }
    return false;
  };

  if (at('<?xml') && /[ \t\n?]/.test(s[i + 5] ?? '')) {
    i += 5;
    const declaration = skipPast('?>', 'declaration');
    if (!/^\s+version\s*=\s*(["'])1\.\d+\1/.test(declaration)) fail('declaration');
  }
  while (space() || misc());
  if (!at('<') || at('<!') || at('</')) fail('root');

  let root: XmlElement | undefined;
  const open: XmlElement[] = [];
  /** Prefixes declared by each open element and its ancestors. */
  const scopes: Array<ReadonlySet<string>> = [];
  let text = '';
  const flush = () => {
    const parent = open.at(-1);
    if (text && parent) parent.content.push(text);
    text = '';
  };
  do {
    if (at('</')) {
      i += 2;
      const name = match(NAME)?.[0];
      space();
      if (!at('>') || name !== open.at(-1)?.name) fail('end tag');
      i += 1;
      flush();
      open.pop();
      scopes.pop();
    } else if (at('<![CDATA[')) {
      i += 9;
      text += skipPast(']]>', 'cdata');
    } else if (at('<!--') || at('<?')) {
      misc();
    } else if (at('<')) {
      i += 1;
      const name = match(NAME)?.[0] ?? fail('name');
      const attributes = new Map<string, string>();
      for (;;) {
        const spaced = space();
        if (at('>') || at('/>')) break;
        const key = match(NAME)?.[0];
        if (!spaced || !key || attributes.has(key)) fail('attribute');
        space();
        if (s[i] !== '=') fail('attribute');
        i += 1;
        space();
        const value = match(ATTRIBUTE_VALUE) ?? fail('attribute');
        attributes.set(key as string, decode((value[1] ?? value[2] ?? '').replace(/[\t\n]/g, ' ')));
      }
      const scope = new Set(scopes.at(-1));
      for (const key of attributes.keys()) if (key.startsWith('xmlns:')) scope.add(key.slice(6));
      for (const qualified of [name, ...attributes.keys()]) {
        const parts = qualified.split(':');
        const prefix = parts.length === 2 ? parts[0] : undefined;
        if (parts.length > 2 || parts.some((p) => !p)) fail('name');
        if (prefix && prefix !== 'xml' && prefix !== 'xmlns' && !scope.has(prefix)) fail('prefix');
      }
      const element: XmlElement = { name, attributes, children: [], content: [] };
      flush();
      const parent = open.at(-1);
      if (parent) {
        parent.children.push(element);
        parent.content.push(element);
      } else root = element;
      if (at('/>')) i += 2;
      else {
        i += 1;
        open.push(element);
        scopes.push(scope);
      }
    } else {
      const next = s.indexOf('<', i);
      const raw = s.slice(i, next < 0 ? s.length : next);
      if (raw.includes(']]>')) fail('text');
      text += decode(raw);
      i += raw.length;
    }
  } while (open.length && i < s.length);
  if (open.length || !root) fail('unclosed');
  while (space() || misc());
  if (i < s.length) fail('after root');
  return root as XmlElement;
}

/** Replaces entity and character references; anything else after `&` is an error. */
function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&]*);?/g, (all, ref: string) => {
    if (!all.endsWith(';')) throw new XmlError('reference');
    const predefined = PREDEFINED.get(ref);
    if (predefined) return predefined;
    const code = /^#x([0-9a-fA-F]{1,6})$/.exec(ref)?.[1] ?? /^#([0-9]{1,7})$/.exec(ref)?.[1];
    const point = code === undefined ? NaN : Number.parseInt(code, ref[1] === 'x' ? 16 : 10);
    if (!(point <= 0x10ffff) || (point >= 0xd800 && point <= 0xdfff))
      throw new XmlError('reference');
    const char = String.fromCodePoint(point);
    if (NOT_CHAR.test(char)) throw new XmlError('reference');
    return char;
  });
}

/** The element's text and its descendants', in order: the DOM's `textContent`. */
export function textContent(element: XmlElement): string {
  let text = '';
  const stack: Array<XmlElement | string> = [element];
  while (stack.length) {
    const node = stack.pop() as XmlElement | string;
    if (typeof node === 'string') text += node;
    else for (let j = node.content.length - 1; j >= 0; j--) stack.push(node.content[j] ?? '');
  }
  return text;
}

/** Descendants with this name, in document order: the DOM's `getElementsByTagName`. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const stack = [...element.children].reverse();
  while (stack.length) {
    const node = stack.pop() as XmlElement;
    if (node.name === name) found.push(node);
    for (let j = node.children.length - 1; j >= 0; j--) stack.push(node.children[j] as XmlElement);
  }
  return found;
}
