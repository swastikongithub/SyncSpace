// The server reads and writes the editor's Yjs representation without the editor schema
// (titles, restores, search text, seed content). These tests hold that code to the real schema.
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildDocumentState } from '../../../server/src/collab/content.js';
import { createInitialState, readDocumentInfo, replaceContent, writeTitle } from '../../../server/src/collab/ydoc.js';
import { isAllowedLink, schemaExtensions } from './extensions.js';

const schema = getSchema(schemaExtensions());

function toNode(state) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const node = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('default'), schema);
  node.check();
  return { node, ydoc };
}

describe('server-built content against the editor schema', () => {
  it('a new document is a valid title + paragraph document', () => {
    const { node } = toNode(createInitialState('Lab report'));
    expect(node.toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'title', content: [{ type: 'text', text: 'Lab report' }] }, { type: 'paragraph' }],
    });
  });

  it('seed content round-trips with headings, marks, lists, checklists and links', () => {
    const state = buildDocumentState('Revision notes', [
      { type: 'heading', level: 2, text: 'First law' },
      { type: 'paragraph', runs: [{ text: 'Energy is ' }, { text: 'conserved', marks: { bold: true } }, { text: '.' }] },
      { type: 'bulletList', items: ['Heat', [{ text: 'Work', marks: { italic: true } }]] },
      { type: 'orderedList', items: ['Measure', 'Record'] },
      { type: 'taskList', items: [{ text: 'Revise', checked: true }, { text: 'Practice', checked: false }] },
      { type: 'paragraph', runs: [{ text: 'Source', marks: { link: 'https://example.org/thermo' } }] },
      { type: 'blockquote', text: 'Entropy never decreases.' },
      { type: 'horizontalRule' },
    ]);
    const { node } = toNode(state);
    const json = node.toJSON();
    expect(json.content.map((block) => block.type)).toEqual([
      'title',
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'taskList',
      'paragraph',
      'blockquote',
      'horizontalRule',
    ]);
    expect(json.content[1].attrs.level).toBe(2);
    expect(json.content[2].content).toEqual([
      { type: 'text', text: 'Energy is ' },
      { type: 'text', text: 'conserved', marks: [{ type: 'bold' }] },
      { type: 'text', text: '.' },
    ]);
    expect(json.content[5].content.map((item) => item.attrs.checked)).toEqual([true, false]);
    expect(json.content[6].content[0].marks[0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.org/thermo' } });
  });

  it('renaming on the server keeps the document valid', () => {
    const { ydoc } = toNode(createInitialState('Old'));
    ydoc.transact(() => writeTitle(ydoc, 'New title'));
    const node = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('default'), schema);
    node.check();
    expect(node.firstChild.textContent).toBe('New title');
  });

  it('restoring a version produces a valid document with the old content', () => {
    const current = toNode(buildDocumentState('Plan', [{ type: 'paragraph', text: 'new text' }])).ydoc;
    const old = toNode(buildDocumentState('Plan', [{ type: 'taskList', items: [{ text: 'old item', checked: true }] }])).ydoc;
    current.transact(() => replaceContent(current, old));
    const node = yXmlFragmentToProseMirrorRootNode(current.getXmlFragment('default'), schema);
    node.check();
    expect(node.textContent).toBe('Planold item');
  });
});

describe('search text extraction from editor-produced content', () => {
  it('reads title, body text, excerpt and word count from what the editor writes', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'title', content: [{ type: 'text', text: 'Thermodynamics' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Energy is ' }, { type: 'text', text: 'conserved', marks: [{ type: 'bold' }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heat flows' }] }] }] },
      ],
    };
    const ydoc = prosemirrorJSONToYDoc(schema, json, 'default');
    expect(readDocumentInfo(ydoc)).toEqual({
      title: 'Thermodynamics',
      text: 'Energy is conserved\nHeat flows',
      excerpt: 'Energy is conserved. Heat flows.',
      wordCount: 5,
    });
  });

  it('leaves headings out of the excerpt but keeps them searchable', () => {
    const state = buildDocumentState('Notes', [
      { type: 'paragraph', text: 'Intro sentence.' },
      { type: 'heading', level: 2, text: 'The first law' },
      { type: 'paragraph', text: 'Energy is conserved' },
    ]);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const info = readDocumentInfo(ydoc);
    expect(info.excerpt).toBe('Intro sentence. Energy is conserved.');
    expect(info.text).toContain('The first law');
  });
});

describe('link safety', () => {
  it('allows only web and mail links', () => {
    expect(isAllowedLink('https://example.org')).toBe(true);
    expect(isAllowedLink('mailto:ana@example.org')).toBe(true);
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedLink(' JAVASCRIPT:alert(1)')).toBe(false);
    expect(isAllowedLink('data:text/html,hi')).toBe(false);
    expect(isAllowedLink('vbscript:x')).toBe(false);
  });

  it('renders a hostile href stored in the document as an empty link', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'title', content: [{ type: 'text', text: 'x' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      ],
    };
    const link = schema.marks.link;
    const node = schema.nodeFromJSON(json);
    const mark = node.lastChild.firstChild.marks[0];
    const spec = link.spec.toDOM(mark, true);
    expect(spec[1].href).toBe('');
  });
});
