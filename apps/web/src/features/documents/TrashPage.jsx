import { useState } from 'react';
import { Link } from 'react-router';
import { can } from '@syncspace/shared/roles';
import { api, NetworkError } from '../../lib/api.js';
import { invalidate } from '../../lib/resource.js';
import { timeAgo } from '../../lib/time.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';
import { useDocuments } from '../data.js';
import { useWorkspaceContext } from '../shell/WorkspaceLayout.jsx';

export function TrashPage() {
  const { workspace, role } = useWorkspaceContext();
  const workspaceId = workspace?.id;
  const trash = useDocuments(workspaceId, { trash: true });
  const announce = useAnnounce();
  const [purging, setPurging] = useState(null);

  async function act(promise, message) {
    try {
      await promise;
      invalidate(`docs:${workspaceId}`);
      announce(message);
    } catch (error) {
      announce(error instanceof NetworkError ? 'The trash needs a connection.' : error.message, { urgent: true });
    }
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-8">
      <div>
        <Link to={`/w/${workspaceId}`} className="text-sm font-semibold text-carbon underline-offset-2 hover:underline">
          {workspace?.name ?? 'Workspace'}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Trash</h1>
        <p className="text-graphite">Documents here are hidden from everyone until restored. Owners can delete them permanently.</p>
      </div>

      {trash.status === 'error' && (
        <p role="alert" className="text-correction">
          {trash.error instanceof NetworkError ? 'The trash is available when you’re online.' : trash.error.message}
        </p>
      )}
      {trash.data?.length === 0 && <p className="rounded-lg border border-dashed border-rule-strong/60 px-6 py-8 text-center text-graphite">The trash is empty.</p>}
      <ul className="flex flex-col gap-2">
        {trash.data?.map((document) => (
          <li key={document.id} className="flex flex-col gap-3 rounded-md bg-sheet px-5 py-4 shadow-sheet sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-writing text-lg font-[620]">{document.title || 'Untitled'}</p>
              <p className="text-sm text-graphite">Moved to the trash {timeAgo(document.deletedAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(role, 'doc.untrash') && (
                <Button size="sm" onClick={() => act(api.post(`/documents/${document.id}/untrash`), `Restored “${document.title || 'Untitled'}”.`)}>
                  Restore
                </Button>
              )}
              {can(role, 'doc.purge') && (
                <Button size="sm" variant="danger-outline" onClick={() => setPurging(document)}>
                  Delete permanently
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={Boolean(purging)}
        onClose={() => setPurging(null)}
        title="Delete permanently?"
        description="The document, its history and all stored versions are removed for everyone. This can’t be undone."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setPurging(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const target = purging;
              setPurging(null);
              await act(api.delete(`/documents/${target.id}`), `Deleted “${target.title || 'Untitled'}” permanently.`);
            }}
          >
            Delete permanently
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
