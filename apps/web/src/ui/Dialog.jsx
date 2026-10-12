import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Modal dialog on the native <dialog> element: focus trapping, Escape and the inert background
 * come from the browser. Focus returns to whatever opened it.
 */
export function Dialog({ open, onClose, title, description, children, size = 'md', dismissible = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const opener = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      opener.current?.focus?.();
    }
  }, [open]);

  useEffect(() => () => opener.current?.focus?.(), []);

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose?.();
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose?.();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-lg border border-rule bg-sheet p-0 text-ink shadow-sheet backdrop:bg-ink/35`}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-lg font-bold leading-snug">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-sm text-graphite">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} className="-m-2 rounded-md p-2 text-graphite hover:text-ink" aria-label="Close">
                <X aria-hidden="true" size={20} />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
