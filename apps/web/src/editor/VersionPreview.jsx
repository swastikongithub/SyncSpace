import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { schemaExtensions } from './extensions.js';

/** Read-only rendering of a stored version (its Yjs state), with the same schema as the editor. */
export function VersionPreview({ state }) {
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc;
  }, [state]);

  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: true,
      extensions: [...schemaExtensions(), Collaboration.configure({ document: ydoc, field: 'default' })],
      editorProps: { attributes: { class: 'ss-prose', 'aria-label': 'Earlier version (read only)' } },
    },
    [ydoc],
  );

  useEffect(() => () => ydoc.destroy(), [ydoc]);
  return <EditorContent editor={editor} />;
}
