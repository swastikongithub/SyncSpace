import { cloneElement, useEffect, useId, useRef, useState } from 'react';

/**
 * A disclosure menu with keyboard support (arrow keys, Home/End, Escape returns focus).
 * `trigger` is a button element; `items` are { label, onSelect, icon?, danger?, disabled? }
 * or { separator: true } or { heading }.
 */
export function Menu({ trigger, items, align = 'end', label }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef(null);
  const list = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    list.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onKeyDown(event) {
    const entries = [...(list.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const index = entries.indexOf(document.activeElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: entries.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      entries[(move + entries.length) % entries.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  return (
    <div ref={root} className="relative">
      {cloneElement(trigger, {
        ref: button,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => setOpen((value) => !value),
      })}
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`absolute top-full z-40 mt-1.5 min-w-56 rounded-lg border border-rule bg-sheet p-1.5 shadow-sheet ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item, index) => {
            if (item.separator) return <div key={`sep-${index}`} role="separator" className="my-1.5 border-t border-rule" />;
            if (item.heading) {
              return (
                <p key={`heading-${index}`} className="px-3 pb-1 pt-2 text-xs font-semibold text-graphite">
                  {item.heading}
                </p>
              );
            }
            const Icon = item.icon;
            return (
              <button
                key={item.key ?? item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled ? 'true' : undefined}
                aria-current={item.current ? 'true' : undefined}
                tabIndex={-1}
                onClick={() => {
                  if (item.disabled) return;
                  close(!item.keepFocus);
                  item.onSelect?.();
                }}
                className={`flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-[0.95rem] focus-visible:outline-offset-0 ${
                  item.disabled ? 'cursor-not-allowed text-graphite/70' : item.danger ? 'text-correction hover:bg-correction-wash' : 'text-ink hover:bg-ink/6'
                } ${item.current ? 'font-bold' : ''}`}
              >
                {Icon && <Icon aria-hidden="true" size={17} className="flex-none" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="text-xs text-graphite">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
