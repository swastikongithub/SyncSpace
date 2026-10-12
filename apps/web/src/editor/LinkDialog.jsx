import { useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { TextField } from '../ui/TextField.jsx';
import { isAllowedLink } from './extensions.js';

function normalise(input) {
  const value = input.trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

/** Mounted only while the dialog is open, so it starts from the link under the cursor. */
function LinkForm({ editor, onClose }) {
  const current = editor.getAttributes('link').href ?? '';
  const [value, setValue] = useState(current);
  const [error, setError] = useState(null);

  function save(event) {
    event.preventDefault();
    const href = normalise(value);
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onClose();
      return;
    }
    if (!isAllowedLink(href)) {
      setError('Links must start with https://, http:// or mailto:.');
      return;
    }
    const { empty } = editor.state.selection;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (empty && !current) chain.insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onClose();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Web address or email"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={error}
        autoFocus
        inputMode="url"
        autoComplete="off"
        placeholder="example.com"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {current && isAllowedLink(current) ? (
          <a href={current} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-semibold text-carbon underline underline-offset-2">
            Open link in a new tab
          </a>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {current && (
            <Button
              variant="quiet"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onClose();
              }}
            >
              Remove link
            </Button>
          )}
          <Button type="submit" variant="primary">
            {current ? 'Save link' : 'Add link'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function LinkDialog({ editor, open, onClose }) {
  const editing = open && editor.isActive('link');
  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit link' : 'Add link'} size="sm">
      <LinkForm editor={editor} onClose={onClose} />
    </Dialog>
  );
}
