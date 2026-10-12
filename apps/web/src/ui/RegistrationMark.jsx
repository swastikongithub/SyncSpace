// The registration mark: two plates, the server's and this device's. They sit in register when
// the copies agree; this device's plate slips out of register while it holds changes the server
// has not confirmed; the server plate turns dashed while it cannot be reached.
// Always rendered next to a text label: the shape reinforces the words, never replaces them.
const STATES = {
  register: { offset: 0, dashed: false },
  sending: { offset: 2, dashed: false },
  held: { offset: 5, dashed: true },
  idle: { offset: 0, dashed: true },
  fault: { offset: 0, dashed: false },
};

export function RegistrationMark({ state = 'register', size = 22, className = '' }) {
  const { offset, dashed } = STATES[state] ?? STATES.register;
  const deviceColor = state === 'fault' ? 'var(--correction)' : offset > 0 ? 'var(--wet)' : 'var(--ink)';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`flex-none overflow-visible ${className}`}>
      <rect x="5" y="5" width="13" height="13" rx="1.5" fill="none" stroke="var(--graphite)" strokeWidth="1.6" strokeDasharray={dashed ? '2.6 2.2' : undefined} />
      <g className="ss-plate" style={{ transform: `translate(${offset}px, ${-offset}px)` }}>
        <rect x="5" y="5" width="13" height="13" rx="1.5" fill="none" stroke={deviceColor} strokeWidth="2" />
        <path d="M11.5 2.5v4M11.5 16.5v4M2.5 11.5h4M16.5 11.5h4" stroke={deviceColor} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {state === 'fault' && <path d="M6 18 18 6" stroke="var(--correction)" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
