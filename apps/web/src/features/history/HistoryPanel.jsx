import { useState } from 'react';
import { X } from 'lucide-react';
import { can } from '@syncspace/shared/roles';
import { api, NetworkError } from '../../lib/api.js';
import { invalidate } from '../../lib/resource.js';
import { clockTime, longDate, sameDay } from '../../lib/time.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';
import { useVersions } from '../data.js';

export function describeVersion(version) {
  const who = version.createdBy?.name;
  switch (version.kind) {
    case 'manual':
      return version.label ? `“${version.label}”, saved by ${who ?? 'someone'}` : `Saved by ${who ?? 'someone'}`;
    case 'pre-restore':
      return `${version.label || 'Before a restore'}${who ? ` (${who})` : ''}`;
    case 'restore':
      return `${version.label || 'Restored an earlier version'}${who ? ` (${who})` : ''}`;
    case 'recovered':
      return `Offline copy from ${who ?? 'someone'}, kept before a merge`;
    default:
      return 'Automatic snapshot';
  }
}

function groupByDay(versions) {
  const groups = [];
  for (const version of versions) {
    const last = groups.at(-1);
    if (last && sameDay(last.day, version.createdAt)) last.items.push(version);
    else groups.push({ day: version.createdAt, items: [version] });
  }
  return groups;
}

export function HistoryPanel({ docId, role, selectedId, onSelect, onClose, online }) {
  const versions = useVersions(docId);
  const announce = useAnnounce();
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const canSnapshot = can(role, 'history.snapshot');

  async function saveVersion(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`/documents/${docId}/versions`, { label });
      setLabel('');
      invalidate(`versions:${docId}`);
      announce('Version saved.');
    } catch (error) {
      announce(error instanceof NetworkError ? 'Saving a version needs a connection.' : error.message, { urgent: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="history-heading" className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="history-heading" className="text-base font-bold">
          History
        </h2>
        <button type="button" onClick={onClose} aria-label="Close history" className="-m-2 rounded-md p-2 text-graphite hover:text-ink">
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      {canSnapshot && (
        <form onSubmit={saveVersion} className="flex flex-col gap-2 rounded-md border border-rule p-3">
          <label htmlFor="version-label" className="text-sm font-semibold">
            Name this version <span className="font-normal text-graphite">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="version-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={80}
              placeholder="e.g. Sent to tutor"
              className="h-10 min-w-0 flex-1 rounded-md border border-rule-strong bg-sheet px-3 text-sm"
            />
            <Button type="submit" size="sm" variant="primary" disabled={saving || !online} className="h-10">
              {saving ? 'Saving…' : 'Save version'}
            </Button>
          </div>
        </form>
      )}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {!online && !versions.data && <p className="text-sm text-graphite">History is available when you’re online.</p>}
        {versions.status === 'error' && online && <p className="text-sm text-correction">History couldn’t be loaded.</p>}
        {versions.data?.length === 0 && (
          <p className="text-sm text-graphite">No versions yet. A snapshot is kept automatically after editing sessions, and you can save named versions.</p>
        )}
        {versions.data &&
          groupByDay(versions.data).map((group) => (
            <div key={group.day} className="mb-4">
              <h3 className="sticky top-0 bg-desk py-1 text-xs font-bold text-graphite">{longDate(group.day)}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(version)}
                      aria-current={version.id === selectedId ? 'true' : undefined}
                      className={`w-full rounded-md border px-3 py-2.5 text-left ${
                        version.id === selectedId ? 'border-carbon bg-carbon-wash' : 'border-rule bg-sheet hover:border-rule-strong'
                      }`}
                    >
                      <span className="block text-sm font-bold">{clockTime(version.createdAt)}</span>
                      <span className="block text-sm">{describeVersion(version)}</span>
                      <span className="mt-0.5 block truncate text-sm text-graphite">
                        {version.wordCount} {version.wordCount === 1 ? 'word' : 'words'}
                        {version.excerpt ? `: ${version.excerpt}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}
