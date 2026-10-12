import { Link } from 'react-router';

export function BrandMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
      <rect x="10" y="4" width="17" height="21" rx="2" fill="var(--carbon)" />
      <rect x="5" y="7" width="17" height="21" rx="2" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M9 14h9M9 18h9M9 22h5" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ to = '/', compact = false }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 rounded-md py-1 text-[1.05rem] font-extrabold tracking-[-0.01em] text-ink">
      <BrandMark />
      <span className={compact ? 'sr-only sm:not-sr-only' : ''}>SyncSpace</span>
    </Link>
  );
}
