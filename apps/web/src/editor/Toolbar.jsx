import { useState } from 'react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import { LinkDialog } from './LinkDialog.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

function ToolButton({ label, shortcut, icon: Icon, active, onClick, disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`grid h-10 w-10 flex-none place-items-center rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-carbon-wash text-carbon' : 'text-ink hover:bg-ink/6'
      }`}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={2.1} />
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-6 w-px flex-none bg-rule" />;
}

export function Toolbar({ editor, disabled }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        block: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
        inTitle: e.isActive('title'),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        blockquote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'),
        canUndo: e.can().undo?.() ?? false,
        canRedo: e.can().redo?.() ?? false,
      };
    },
  });
  if (!editor || !state) return null;
  const off = disabled || state.inTitle;
  const chain = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      // On narrow screens the row scrolls sideways; the fading edge shows there is more.
      className="flex items-center gap-0.5 overflow-x-auto px-1 py-1 pr-10 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] lg:pr-1 lg:[mask-image:none]"
    >
      <label className="sr-only" htmlFor="ss-block-style">
        Text style
      </label>
      <select
        id="ss-block-style"
        value={state.block}
        disabled={off}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'p') chain().setParagraph().run();
          else chain().setHeading({ level: value === 'h2' ? 2 : 3 }).run();
        }}
        className="h-10 flex-none rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-ink hover:bg-ink/6 disabled:opacity-40"
      >
        <option value="p">Body text</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <Divider />
      <ToolButton label="Bold" shortcut={`${mod}B`} icon={Bold} active={state.bold} disabled={off} onClick={() => chain().toggleBold().run()} />
      <ToolButton label="Italic" shortcut={`${mod}I`} icon={Italic} active={state.italic} disabled={off} onClick={() => chain().toggleItalic().run()} />
      <ToolButton label="Strikethrough" shortcut={`${mod}Shift+S`} icon={Strikethrough} active={state.strike} disabled={off} onClick={() => chain().toggleStrike().run()} />
      <ToolButton label="Inline code" shortcut={`${mod}E`} icon={Code} active={state.code} disabled={off} onClick={() => chain().toggleCode().run()} />
      <ToolButton label={state.link ? 'Edit link' : 'Add link'} icon={Link2} active={state.link} disabled={off} onClick={() => setLinkOpen(true)} />
      <Divider />
      <ToolButton label="Bulleted list" shortcut={`${mod}Shift+8`} icon={List} active={state.bulletList} disabled={off} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton label="Numbered list" shortcut={`${mod}Shift+7`} icon={ListOrdered} active={state.orderedList} disabled={off} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton label="Checklist" shortcut={`${mod}Shift+9`} icon={ListChecks} active={state.taskList} disabled={off} onClick={() => chain().toggleTaskList().run()} />
      <ToolButton label="Quote" shortcut={`${mod}Shift+B`} icon={Quote} active={state.blockquote} disabled={off} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton label="Code block" shortcut={`${mod}Alt+C`} icon={SquareCode} active={state.codeBlock} disabled={off} onClick={() => chain().toggleCodeBlock().run()} />
      <ToolButton label="Divider" icon={Minus} disabled={off} onClick={() => chain().setHorizontalRule().run()} />
      <Divider />
      <ToolButton label="Undo" shortcut={`${mod}Z`} icon={Undo2} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()} />
      <ToolButton label="Redo" shortcut={isMac ? '⌘Shift+Z' : 'Ctrl+Y'} icon={Redo2} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()} />
      <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
    </div>
  );
}
