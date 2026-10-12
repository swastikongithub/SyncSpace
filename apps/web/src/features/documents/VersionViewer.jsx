import { useEffect, useState } from 'react';
import { can } from '@syncspace/shared/roles';
import { VersionPreview } from '../../editor/VersionPreview.jsx';
import { api, ApiError } from '../../lib/api.js';
import { invalidate } from '../../lib/resource.js';
import { shortDateTime } from '../../lib/time.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';
import { describeVersion } from '../history/HistoryPanel.jsx';

/** Shows a stored version in place of the live document, with a safe restore. Keyed by version. */
export function VersionViewer({ docId, version, role, online, onClose }) {
  const announce = useAnnounce();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getBytes(`/documents/${docId}/versions/${version.id}/content`)
      .then((bytes) => !cancelled && setState(bytes))
      .catch((failure) => !cancelled && setError(failure));
    return () => {
      cancelled = true;
    };
  }, [docId, version.id]);

  async function restore() {
    setRestoring(true);
    try {
      await api.post(`/documents/${docId}/versions/${version.id}/restore`);
      invalidate(`versions:${docId}`);
      announce('Version restored. The text from before is saved in History.');
      setConfirming(false);
      onClose();
    } catch (failure) {
      announce(failure instanceof ApiError ? failure.message : 'Restoring needs a connection.', { urgent: true });
      setRestoring(false);
    }
  }

  return (
    <section aria-labelledby="version-heading" className="mx-auto mt-3 max-w-[46rem]">
      <div className="flex flex-col gap-3 rounded-t-md border border-b-0 border-carbon/40 bg-carbon-wash px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id="version-heading" className="font-bold">
            Earlier version from {shortDateTime(version.createdAt)}
          </h2>
          <p className="text-sm text-graphite">{describeVersion(version)}. Read only.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(role, 'history.restore') && (
            <Button size="sm" variant="primary" onClick={() => setConfirming(true)} disabled={!online || !state}>
              Restore this version
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Back to current
          </Button>
        </div>
      </div>
      <div className="rounded-b-md bg-sheet px-6 py-10 shadow-sheet sm:px-14">
        {error && (
          <p role="alert" className="font-semibold text-correction">
            {error instanceof ApiError ? error.message : 'This version can only be opened while you’re online.'}
          </p>
        )}
        {!error && !state && <p className="text-graphite">Opening version…</p>}
        {state && <VersionPreview state={state} />}
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Restore this version?"
        description="Everyone with the document open sees the change straight away."
        size="sm"
      >
        <p className="text-sm">
          The document will match the version from {shortDateTime(version.createdAt)}. The current text is saved first as “Before
          restoring…”, so you can undo this from History.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={restore} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore version'}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
