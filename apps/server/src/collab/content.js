// Builds document content as Yjs state in the shape the editor (y-prosemirror) produces,
// without needing the editor schema on the server. Used for seed and demo data.
//
// Blocks:
//   { type: 'paragraph', text }                 or { type: 'paragraph', runs: [{ text, marks }] }
//   { type: 'heading', level: 2|3, text }
//   { type: 'bulletList' | 'orderedList', items: [string | runs[]] }
//   { type: 'taskList', items: [{ text, checked }] }
//   { type: 'blockquote', text }
//   { type: 'horizontalRule' }
// Marks: { bold: true, italic: true, code: true, link: 'https://…' }
import * as Y from 'yjs';
import { FRAGMENT, TITLE_NODE } from './ydoc.js';

function markAttributes(marks = {}) {
  const attributes = {};
  if (marks.bold) attributes.bold = {};
  if (marks.italic) attributes.italic = {};
  if (marks.strike) attributes.strike = {};
  if (marks.code) attributes.code = {};
  if (marks.link) attributes.link = { href: marks.link };
  return attributes;
}

function textNode(content) {
  const runs = typeof content === 'string' ? [{ text: content }] : content;
  const text = new Y.XmlText();
  let index = 0;
  // Runs are inserted after the tree is integrated, each with explicit attributes so
  // formatting never carries over from the previous run.
  return {
    node: text,
    fill() {
      for (const run of runs) {
        text.insert(index, run.text, markAttributes(run.marks));
        index += run.text.length;
      }
    },
  };
}

function element(name, attributes, children) {
  const node = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (children.length > 0) node.insert(0, children.map((child) => child.node));
  return { node, fill: () => children.forEach((child) => child.fill()) };
}

const paragraph = (content) => element('paragraph', {}, content === '' ? [] : [textNode(content)]);

function block(spec) {
  switch (spec.type) {
    case 'paragraph':
      return paragraph(spec.runs ?? spec.text ?? '');
    case 'heading':
      return element('heading', { level: spec.level ?? 2 }, [textNode(spec.text)]);
    case 'blockquote':
      return element('blockquote', {}, [paragraph(spec.text)]);
    case 'horizontalRule':
      return element('horizontalRule', {}, []);
    case 'bulletList':
    case 'orderedList':
      return element(
        spec.type,
        spec.type === 'orderedList' ? { start: 1 } : {},
        spec.items.map((item) => element('listItem', {}, [paragraph(item)])),
      );
    case 'taskList':
      return element(
        'taskList',
        {},
        spec.items.map((item) => element('taskItem', { checked: Boolean(item.checked) }, [paragraph(item.text)])),
      );
    default:
      throw new Error(`Unknown block type: ${spec.type}`);
  }
}

/** Returns a Yjs update for a document with `title` and `blocks`. */
export function buildDocumentState(title, blocks) {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    const titleNode = element(TITLE_NODE, {}, title ? [textNode(title)] : []);
    const body = (blocks.length > 0 ? blocks : [{ type: 'paragraph', text: '' }]).map(block);
    const all = [titleNode, ...body];
    ydoc.getXmlFragment(FRAGMENT).insert(0, all.map((entry) => entry.node));
    all.forEach((entry) => entry.fill());
  });
  const state = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return state;
}
