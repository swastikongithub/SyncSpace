import { mergeAttributes, Node } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Document from '@tiptap/extension-document';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { plyClass } from '../ui/Ply.jsx';
import { PendingInk } from './pending-ink.js';

/** Every document starts with its title, then at least one block. */
const SyncDocument = Document.extend({ content: 'title block+' });

/** The title is plain text: no marks, one line. Enter moves to the body. */
const Title = Node.create({
  name: 'title',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'h1[data-ss-title]' }],
  renderHTML: ({ HTMLAttributes }) => ['h1', mergeAttributes(HTMLAttributes, { 'data-ss-title': '', class: 'ss-title' }), 0],
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        if (state.selection.$from.parent.type.name !== 'title') return false;
        const after = state.doc.firstChild.nodeSize;
        editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(after + 1))).scrollIntoView());
        return true;
      },
    };
  },
});

const ALLOWED_LINK = /^(https?:\/\/|mailto:)/i;

/** Only http(s) and mailto links are rendered; anything else (javascript:, data:) is dropped. */
export function isAllowedLink(url) {
  return typeof url === 'string' && ALLOWED_LINK.test(url.trim());
}

function caret(user) {
  const element = document.createElement('span');
  element.className = `ss-caret ${plyClass(user.ply)}`;
  const label = document.createElement('span');
  label.className = 'ss-caret__label';
  label.textContent = user.name ?? 'Someone';
  element.append(label);
  return element;
}

function remoteSelection(user) {
  return { class: `ss-remote-selection ${plyClass(user.ply)}` };
}

/** The document schema, shared by the live editor and read-only version previews. */
export function schemaExtensions() {
  return [
    StarterKit.configure({
      document: false,
      undoRedo: false, // Collaboration provides a Yjs-aware undo that only undoes your own edits.
      heading: { levels: [2, 3] },
      dropcursor: { color: 'var(--carbon)', width: 2 },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isAllowedLink(url),
        shouldAutoLink: (url) => isAllowedLink(url) || /^[\w.-]+\.[a-z]{2,}/i.test(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    SyncDocument,
    Title,
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

export function buildExtensions({ session, user }) {
  return [
    ...schemaExtensions(),
    Placeholder.configure({
      showOnlyWhenEditable: false,
      showOnlyCurrent: false,
      placeholder: ({ node, editor }) => {
        if (node.type.name === 'title') return 'Untitled';
        const doc = editor.state.doc;
        return doc.childCount === 2 && doc.lastChild === node ? 'Start writing…' : '';
      },
    }),
    Collaboration.configure({ document: session.doc, field: 'default' }),
    CollaborationCaret.configure({
      provider: session,
      user: { name: user.name, ply: user.ply },
      render: caret,
      selectionRender: remoteSelection,
    }),
    PendingInk,
  ];
}
