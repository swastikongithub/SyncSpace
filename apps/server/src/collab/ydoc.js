// Helpers that read and write the Yjs representation produced by the editor (y-prosemirror):
// one XmlFragment whose children are block elements named after ProseMirror node types,
// with text in XmlText children. The first block is always the `title` node.
import * as Y from 'yjs';

export const FRAGMENT = 'default';
export const TITLE_NODE = 'title';

const EXCERPT_LENGTH = 240;
const CONTENT_TEXT_MAX = 200_000;

export function fragmentOf(ydoc) {
  return ydoc.getXmlFragment(FRAGMENT);
}

/** The initial state of a new document: a title block and one empty paragraph. */
export function createInitialState(title = '') {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    const titleNode = new Y.XmlElement(TITLE_NODE);
    if (title) titleNode.insert(0, [new Y.XmlText(title)]);
    fragmentOf(ydoc).insert(0, [titleNode, new Y.XmlElement('paragraph')]);
  });
  const state = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return state;
}

function inlineText(node) {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
      .join('');
  }
  if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardBreak') return '\n';
    return node
      .toArray()
      .map((child) => (child instanceof Y.XmlElement && !isInline(child) ? `${inlineText(child)}\n` : inlineText(child)))
      .join('')
      .replace(/\n$/, '');
  }
  return '';
}

const INLINE_ELEMENTS = new Set(['hardBreak']);
const isInline = (element) => INLINE_ELEMENTS.has(element.nodeName);

export function titleOf(ydoc) {
  const first = fragmentOf(ydoc).get(0);
  if (first instanceof Y.XmlElement && first.nodeName === TITLE_NODE) return inlineText(first).trim();
  return '';
}

/** Plain-text projection used for listing, search and version previews. */
export function readDocumentInfo(ydoc) {
  const blocks = fragmentOf(ydoc).toArray();
  let title = '';
  let body = blocks;
  if (blocks[0] instanceof Y.XmlElement && blocks[0].nodeName === TITLE_NODE) {
    title = inlineText(blocks[0]).trim();
    body = blocks.slice(1);
  }
  const text = body
    .map((block) => inlineText(block))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const collapsed = text.replace(/\s+/g, ' ').trim();
  // The excerpt previews prose: headings are skipped and each block reads as its own sentence.
  const prose = body
    .filter((block) => !(block instanceof Y.XmlElement && block.nodeName === 'heading'))
    .flatMap((block) => inlineText(block).split('\n'))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;…)]$/.test(line) ? line : `${line}.`))
    .join(' ');
  return {
    title,
    text: text.slice(0, CONTENT_TEXT_MAX),
    excerpt: prose.length > EXCERPT_LENGTH ? `${prose.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : prose,
    wordCount: collapsed ? collapsed.split(' ').length : 0,
  };
}

/** Replaces the title text in place. Must run inside a transaction. */
export function writeTitle(ydoc, title) {
  const fragment = fragmentOf(ydoc);
  let titleNode = fragment.get(0);
  if (!(titleNode instanceof Y.XmlElement) || titleNode.nodeName !== TITLE_NODE) {
    titleNode = new Y.XmlElement(TITLE_NODE);
    fragment.insert(0, [titleNode]);
  }
  const children = titleNode.toArray();
  let text = children.find((child) => child instanceof Y.XmlText);
  if (children.length > 1 || !text) {
    titleNode.delete(0, titleNode.length);
    text = new Y.XmlText();
    titleNode.insert(0, [text]);
  }
  if (text.toString() === title) return;
  text.delete(0, text.length);
  if (title) text.insert(0, title);
}

/**
 * Makes `target` show the content of `source` (version restore). This is a forward change:
 * current blocks are deleted and copies of the old blocks are inserted, so every replica
 * receives it as an ordinary CRDT update and nothing is rewritten underneath collaborators.
 * Must run inside a transaction on `target`.
 */
export function replaceContent(target, source) {
  const destination = fragmentOf(target);
  const copies = fragmentOf(source)
    .toArray()
    .map((node) => node.clone());
  destination.delete(0, destination.length);
  destination.insert(0, copies);
}
