import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { useLocalData } from '../../app/local-data.jsx';
import { api, NetworkError } from '../../lib/api.js';
import { Dialog } from '../../ui/Dialog.jsx';

async function searchLocally(store, text) {
  const docs = await store.listDocs();
  const needle = text.toLowerCase();
  return docs
    .filter((meta) => (meta.title || '').toLowerCase().includes(needle))
    .map((meta) => ({ id: meta.docId, workspaceId: meta.workspaceId, title: meta.title, snippet: null, workspaceName: null }));
}

/** Mounted each time the dialog opens, so it always starts empty. */
function SearchPanel({ onClose, workspaceId }) {
  const navigate = useNavigate();
  const { store } = useLocalData();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ query: '', status: 'idle', items: [], offline: false });
  const [active, setActive] = useState(0);
  const listId = useId();
  const text = query.trim();

  useEffect(() => {
    if (text.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setResult({ query: text, status: 'loading', items: [], offline: false });
      try {
        const { results } = await api.get(`/search?q=${encodeURIComponent(text)}`);
        if (!cancelled) setResult({ query: text, status: 'done', items: results, offline: false });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof NetworkError && store) {
          setResult({ query: text, status: 'done', items: await searchLocally(store, text), offline: true });
        } else {
          setResult({ query: text, status: 'error', items: [], offline: false, message: error.message });
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, store]);

  // Results for an older query are not shown once the query has changed.
  const current = text.length >= 2 && result.query === text ? result : { status: text.length >= 2 ? 'loading' : 'idle', items: [] };
  const items = workspaceId
    ? [...current.items].sort((a, b) => Number(b.workspaceId === workspaceId) - Number(a.workspaceId === workspaceId))
    : current.items;

  function go(item) {
    if (!item?.workspaceId) return;
    onClose();
    navigate(`/w/${item.workspaceId}/d/${item.id}`);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(items[active]);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite" />
        <input
          autoFocus
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          aria-label="Search titles and text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search titles and text in your workspaces"
          className="h-12 w-full rounded-md border border-rule-strong bg-sheet pl-10 pr-3 text-base"
        />
      </div>
      <p className="text-sm text-graphite" aria-live="polite">
        {current.status === 'idle' && 'Type at least two characters.'}
        {current.status === 'loading' && 'Searching…'}
        {current.status === 'done' && current.offline && 'Offline: searching titles of documents saved on this device. '}
        {current.status === 'done' && items.length === 0 && `No documents match “${text}”.`}
        {current.status === 'error' && current.message}
      </p>
      <ul id={listId} role="listbox" aria-label="Results" className="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
        {items.map((item, index) => (
          <li
            key={item.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onClick={() => go(item)}
            onMouseEnter={() => setActive(index)}
            className={`cursor-pointer rounded-md px-3 py-2.5 ${index === active ? 'bg-carbon-wash' : ''}`}
          >
            <p className="font-writing font-[620]">{item.title || 'Untitled'}</p>
            {item.snippet && <p className="line-clamp-2 text-sm text-graphite">{item.snippet}</p>}
            {item.workspaceName && <p className="text-xs font-semibold text-graphite">{item.workspaceName}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Search across every workspace you belong to; falls back to titles saved on this device offline. */
export function SearchDialog({ open, onClose, workspaceId }) {
  return (
    <Dialog open={open} onClose={onClose} title="Search documents" size="lg">
      <SearchPanel onClose={onClose} workspaceId={workspaceId} />
    </Dialog>
  );
}
