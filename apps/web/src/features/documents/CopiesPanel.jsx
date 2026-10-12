import { HardDrive, Server } from 'lucide-react';
import { RegistrationMark } from '../../ui/RegistrationMark.jsx';
import { PlyChip } from '../../ui/Ply.jsx';

const TONE_TEXT = {
  ok: 'text-ink',
  busy: 'text-ink',
  away: 'text-caution',
  error: 'text-correction',
  none: 'text-caution',
};

function Replica({ icon: Icon, name, label, detail, tone, offset }) {
  return (
    <li
      className="ss-plate relative rounded-md border border-rule bg-sheet px-4 py-3"
      style={{ transform: offset ? 'translate(6px, -4px)' : 'none', borderLeft: `4px solid ${offset ? 'var(--wet)' : 'var(--rule-strong)'}` }}
    >
      <div className="flex items-center gap-2 text-sm font-bold text-graphite">
        <Icon aria-hidden="true" size={15} />
        {name}
      </div>
      <p className={`mt-0.5 font-semibold ${TONE_TEXT[tone] ?? 'text-ink'}`}>{label}</p>
      {detail && <p className="mt-0.5 text-sm leading-snug text-graphite">{detail}</p>}
    </li>
  );
}

export function CopiesPanel({ summary, state, people, diagnostics = true }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="copies-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <RegistrationMark state={summary.mark} size={24} />
          <h2 id="copies-heading" className="text-base font-bold">
            Copies of this document
          </h2>
        </div>
        <ul className="flex flex-col gap-2.5">
          <Replica icon={HardDrive} name="This device" {...summary.device} offset={summary.pending > 0} />
          <Replica icon={Server} name="Server" {...summary.server} />
        </ul>
        {summary.pending > 0 && (
          <p className="text-sm text-graphite">
            Paragraphs marked with a <span className="mx-0.5 inline-block h-3.5 w-1 translate-y-0.5 rounded-full bg-wet" aria-hidden="true" /> carbon line
            have edits the server hasn’t confirmed yet.
          </p>
        )}
      </section>

      <section aria-labelledby="present-heading" className="flex flex-col gap-3">
        <h2 id="present-heading" className="text-base font-bold">
          Here now
        </h2>
        {people.length === 0 ? (
          <p className="text-sm text-graphite">{summary.connected ? 'No one else has this document open.' : 'Shown when you’re connected.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <li key={person.id} className="flex flex-col text-sm">
                <PlyChip person={person} />
                <span className="pl-6 text-graphite">
                  {person.role === 'viewer' ? 'Reading' : 'Editing'}
                  {person.unsynced ? ', has edits still on the way' : ''}
                  {person.tabs > 1 ? ` in ${person.tabs} windows` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {diagnostics && (
        <details className="rounded-md border border-rule px-4 py-2 text-sm">
          <summary className="py-1 font-semibold text-graphite">Connection details</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-2">
            <dt className="text-graphite">Connection</dt>
            <dd>{state.connection}</dd>
            <dt className="text-graphite">Edits made here</dt>
            <dd>{state.localVersion}</dd>
            <dt className="text-graphite">Saved on device</dt>
            <dd>{state.savedVersion}</dd>
            <dt className="text-graphite">Stored on server</dt>
            <dd>{state.durableVersion}</dd>
            <dt className="text-graphite">Last confirmation</dt>
            <dd>{state.lastAckLatencyMs === null ? '—' : `${state.lastAckLatencyMs} ms round trip`}</dd>
            <dt className="text-graphite">Reconnects</dt>
            <dd>{state.reconnects}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}
