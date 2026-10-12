import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions } from './extensions.js';
import { bindPendingInk } from './pending-ink.js';
import { Toolbar } from './Toolbar.jsx';

/**
 * The collaborative editor for one sync session. It must only be mounted once the session has
 * content (a local copy or the server's state): mounting on an empty replica and typing would
 * create a second title block that later merges with the server's.
 */
export function DocumentEditor({ session, user, canEdit, toolbarSlot, onReady, focusTitle = false }) {
  const editor = useEditor(
    {
      extensions: buildExtensions({ session, user }),
      editable: canEdit,
      // Created after render: the caret plugin publishes presence on init, which notifies the
      // page, and React forbids updating another component mid-render.
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: 'ss-prose',
          'aria-label': 'Document',
          spellcheck: 'true',
        },
      },
    },
    [session],
  );

  useEffect(() => (editor ? bindPendingInk(editor, session) : undefined), [editor, session]);
  useEffect(() => {
    if (!editor) return undefined;
    onReady?.(editor);
    if (focusTitle && canEdit) editor.commands.focus(1);
    return () => onReady?.(null);
    // focusTitle only matters when the editor is first created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  useEffect(() => {
    if (editor && editor.isEditable !== canEdit) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  return (
    <>
      {toolbarSlot?.(<Toolbar editor={editor} disabled={!canEdit} />)}
      <EditorContent editor={editor} />
    </>
  );
}
