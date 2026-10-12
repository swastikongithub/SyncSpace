import { PLY_KEYS } from '@syncspace/shared/plies';

export function plyClass(ply) {
  return `ply-${PLY_KEYS.includes(ply) ? ply : 'pewter'}`;
}

/** A person, shown as the tinted edge of their sheet followed by their name. */
export function PlyChip({ person, detail, size = 'md', className = '' }) {
  if (!person) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${plyClass(person.ply)} ${className}`}>
      <span
        aria-hidden="true"
        className={`flex-none rounded-[3px] border border-ply-ink/45 bg-ply ${size === 'sm' ? 'h-4 w-3' : 'h-5 w-4'}`}
      />
      <span className="min-w-0 truncate font-semibold">{person.name}</span>
      {detail && <span className="truncate text-graphite">{detail}</span>}
    </span>
  );
}

/** Initials-free identity mark: a small tinted sheet edge (used in dense lists). */
export function PlyEdge({ ply, className = '' }) {
  return <span aria-hidden="true" className={`inline-block h-4 w-1.5 rounded-full bg-ply-ink ${plyClass(ply)} ${className}`} />;
}
