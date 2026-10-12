import { NavLink } from 'react-router';
import { Pin, Trash2, Users } from 'lucide-react';
import { useLocalData } from '../../app/local-data.jsx';
import { useDocuments } from '../data.js';
import { NewDocumentButton } from '../documents/NewDocumentButton.jsx';

/** Desktop-only list of the workspace's documents, beside the open one. */
export function DocumentTray({ workspaceId, role, activeId }) {
  const documents = useDocuments(workspaceId);
  const { docs: local } = useLocalData();
  const list = documents.data ?? [];

  return (
    <nav aria-label="Documents in this workspace" className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-72 flex-none flex-col border-r border-rule lg:flex">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className="text-sm font-bold text-graphite">Documents</h2>
        <NewDocumentButton workspaceId={workspaceId} role={role} size="sm" />
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-4">
        {list.map((document) => {
          const meta = local.get(document.id);
          return (
            <li key={document.id}>
              <NavLink
                to={`/w/${workspaceId}/d/${document.id}`}
                aria-current={document.id === activeId ? 'page' : undefined}
                className={`group flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-[0.95rem] ${
                  document.id === activeId ? 'bg-sheet font-bold text-ink shadow-sheet' : 'text-ink hover:bg-ink/5'
                }`}
              >
                {document.pinned && <Pin aria-label="Pinned" size={14} className="flex-none text-graphite" />}
                <span className="min-w-0 flex-1 truncate">{document.title || 'Untitled'}</span>
                {meta?.pending > 0 && (
                  <span title="Has edits not yet stored on the server" className="h-4 w-1 flex-none rounded-full bg-wet">
                    <span className="sr-only">(unsent edits)</span>
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
        {documents.status === 'success' && list.length === 0 && <li className="px-3 py-2 text-sm text-graphite">No documents yet.</li>}
      </ul>
      <div className="flex flex-col gap-0.5 border-t border-rule px-2 py-2">
        <NavLink to={`/w/${workspaceId}/members`} className="flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink hover:bg-ink/5">
          <Users aria-hidden="true" size={16} /> Members
        </NavLink>
        <NavLink to={`/w/${workspaceId}/trash`} className="flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink hover:bg-ink/5">
          <Trash2 aria-hidden="true" size={16} /> Trash
        </NavLink>
      </div>
    </nav>
  );
}
