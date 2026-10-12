import { useId } from 'react';

/** A labelled input with hint and error text wired up for assistive technology. */
export function TextField({ label, hint, error, className = '', inputClassName = '', ref, ...props }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={`h-11 rounded-md border bg-sheet px-3 text-base text-ink placeholder:text-graphite/80 ${
          error ? 'border-correction' : 'border-rule-strong'
        } focus-visible:border-carbon ${inputClassName}`}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="text-sm text-graphite">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-correction">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, children, className = '', ...props }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select id={id} className="h-11 rounded-md border border-rule-strong bg-sheet px-3 text-base text-ink" {...props}>
        {children}
      </select>
    </div>
  );
}
