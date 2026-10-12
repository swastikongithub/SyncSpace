const TONES = {
  info: 'border-rule bg-sheet text-ink',
  carbon: 'border-carbon/40 bg-carbon-wash text-ink',
  caution: 'border-caution/40 bg-caution-wash text-ink',
  error: 'border-correction/50 bg-correction-wash text-ink',
};

/** An inline message with an optional action. `role` defaults to status (polite). */
export function Notice({ tone = 'info', title, children, action, icon: Icon, role = 'status', className = '' }) {
  return (
    <div role={role} className={`flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center ${TONES[tone]} ${className}`}>
      <div className="flex min-w-0 flex-1 gap-3">
        {Icon && <Icon aria-hidden="true" size={20} className="mt-0.5 flex-none" />}
        <div className="min-w-0">
          {title && <p className="font-bold">{title}</p>}
          {children && <div className="text-sm leading-relaxed text-ink/90">{children}</div>}
        </div>
      </div>
      {action && <div className="flex flex-none flex-wrap gap-2">{action}</div>}
    </div>
  );
}
