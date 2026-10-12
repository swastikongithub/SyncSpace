import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Download, History, Link2, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { can } from '@syncspace/shared/roles';
import { useAuth } from '../../app/auth.jsx';
import { DocumentEditor } from '../../editor/DocumentEditor.jsx';
import { api, ApiError, NetworkError } from '../../lib/api.js';
import { useOnline } from '../../lib/online.js';
import { invalidate, setData } from '../../lib/resource.js';
import { describeSync, transitionMessage } from '../../sync/status.js';
import { useDocSession } from '../../sync/useDocSession.js';
import { usePresence } from '../../sync/usePresence.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';
import { Menu } from '../../ui/Menu.jsx';
import { Notice } from '../../ui/Notice.jsx';
import { plyClass } from '../../ui/Ply.jsx';
import { RegistrationMark } from '../../ui/RegistrationMark.jsx';
import { useDocumentMeta } from '../data.js';
import { HistoryPanel } from '../history/HistoryPanel.jsx';
import { useWorkspaceContext } from '../shell/WorkspaceLayout.jsx';
import { CopiesPanel } from './CopiesPanel.jsx';
import { LoadingSheet, LockedState, NotOnDeviceState, SheetMessage } from './DocumentStates.jsx';
import { VersionViewer } from './VersionViewer.jsx';

const WIDE_QUERY = '(min-width: 80rem)';

function useWideLayout() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const list = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/** Re-renders every second while a countdown is visible (e.g. "retrying in 4s"). */
function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

function downloadHtml(editor, title) {
  const name = (title || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled';
  const escapedTitle = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html>\n<meta charset="utf-8">\n<title>${escapedTitle}</title>\n${editor.getHTML()}\n`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${name}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PresenceStack({ people }) {
  if (people.length === 0) return null;
  return (
    <div className="hidden items-center sm:flex" aria-label={`Here now: ${people.map((p) => p.name).join(', ')}`} role="img">
      {people.slice(0, 3).map((person, index) => (
        <span
          key={person.id}
          title={person.name}
          className={`grid h-7 w-7 place-items-center rounded-[5px] border-2 border-desk bg-ply text-xs font-bold text-ply-ink ${plyClass(person.ply)} ${index > 0 ? '-ml-2' : ''}`}
        >
          {person.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {people.length > 3 && <span className="ml-1 text-xs font-semibold text-graphite">+{people.length - 3}</span>}
    </div>
  );
}

export function DocumentPage() {
  const { docId, workspaceId } = useParams();
  const { role: workspaceRole } = useWorkspaceContext();
  const auth = useAuth();
  const online = useOnline();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useWideLayout();
  const meta = useDocumentMeta(docId);
  const info = meta.data?.document ?? null;
  const role = meta.data?.role ?? workspaceRole;

  const [editor, setEditor] = useState(null);
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'copies' | 'history'
  const [version, setVersion] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmTrash, setConfirmTrash] = useState(false);

  const onRecovery = useCallback(
    ({ uploaded }) => {
      setNotice({ kind: 'recovered', uploaded });
      announce('Some offline text was removed by a collaborator’s deletion. Your offline copy was kept.', { urgent: true });
      invalidate(`versions:${docId}`);
    },
    [announce, docId],
  );
  const onRestored = useCallback(
    (event) => {
      setNotice({ kind: 'restored', by: event.by });
      announce(`${event.by?.name ?? 'Someone'} restored an earlier version of this document.`);
      invalidate(`versions:${docId}`);
    },
    [announce, docId],
  );

  const { phase, session, state, hasStorage, takeOver } = useDocSession(docId, {
    workspaceId,
    title: info?.title,
    onRecovery,
    onRestored,
  });
  const people = usePresence(session);
  useTicker(state.connection === 'waiting');
  const summary = session ? describeSync(state, { hasStorage }) : null;

  // Announce meaningful transitions (offline, back online, faults) for screen-reader users.
  const previous = useRef(null);
  useEffect(() => {
    if (!summary) return;
    const message = transitionMessage(previous.current, summary);
    previous.current = summary;
    if (message) announce(message, { visible: summary.mark === 'fault', urgent: summary.mark === 'fault' });
  });

  // A socket closed for an ended session shows the sign-in dialog instead of leaving the page.
  const blockedCode = state.blocked?.code;
  const { expire } = auth;
  useEffect(() => {
    if (blockedCode === 4401) expire();
  }, [blockedCode, expire]);
  useEffect(() => {
    if (auth.status === 'signed-in' && session && blockedCode === 4401) session.reconnect();
  }, [auth.status, session, blockedCode]);

  // Keep the title shown in lists in step with the content as people type it.
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      const title = editor.state.doc.firstChild?.textContent ?? '';
      setData(`doc:${docId}`, (current) =>
        current && current.document.title !== title ? { ...current, document: { ...current.document, title } } : current,
      );
      setData(`docs:${workspaceId}`, (list) =>
        list?.some((item) => item.id === docId && item.title !== title)
          ? list.map((item) => (item.id === docId ? { ...item, title } : item))
          : list,
      );
    };
    editor.on('update', update);
    return () => editor.off('update', update);
  }, [editor, docId, workspaceId]);

  const title = info?.title ?? '';
  const canEdit = Boolean(session?.canEdit) && !state.blocked;
  const canOrganize = can(role, 'doc.organize');

  async function togglePin() {
    try {
      const { document: updated } = await api.patch(`/documents/${docId}`, { pinned: !info.pinned });
      setData(`doc:${docId}`, (current) => ({ ...current, document: updated }));
      invalidate(`docs:${workspaceId}`);
    } catch (error) {
      announce(error instanceof NetworkError ? 'Pinning needs a connection.' : error.message, { urgent: true });
    }
  }

  async function moveToTrash() {
    try {
      await api.post(`/documents/${docId}/trash`);
      invalidate(`docs:${workspaceId}`);
      announce('Moved to the trash.');
      navigate(`/w/${workspaceId}`);
    } catch (error) {
      setConfirmTrash(false);
      announce(error instanceof NetworkError ? 'Moving to the trash needs a connection.' : error.message, { urgent: true });
    }
  }

  async function untrash() {
    try {
      await api.post(`/documents/${docId}/untrash`);
      invalidate(`docs:${workspaceId}`);
      await meta.reload();
      session?.reconnect();
    } catch (error) {
      announce(error.message, { urgent: true });
    }
  }

  // ---- Whole-page states ---------------------------------------------------------------
  let body = null;
  const metaMissing = meta.status === 'error' && meta.error instanceof ApiError && meta.error.status === 404;
  if (metaMissing || blockedCode === 4404) {
    body = (
      <SheetMessage
        title="This document isn’t available"
        actions={
          <Link to={`/w/${workspaceId}`} className="font-semibold text-carbon underline underline-offset-2">
            Back to documents
          </Link>
        }
      >
        It may have been deleted, or you may no longer have access to it.
      </SheetMessage>
    );
  } else if (info?.deletedAt || blockedCode === 4410) {
    body = (
      <SheetMessage
        title="This document is in the trash"
        actions={
          can(role, 'doc.untrash') ? (
            <Button variant="primary" onClick={untrash}>
              Restore from trash
            </Button>
          ) : null
        }
      >
        {can(role, 'doc.untrash') ? 'Restore it to open and edit it again.' : 'Ask an editor to restore it.'}
      </SheetMessage>
    );
  } else if (phase === 'locked' || phase === 'moved') {
    body = <LockedState moved={phase === 'moved'} onTakeOver={takeOver} workspaceId={workspaceId} />;
  } else if (!session) {
    body = <LoadingSheet />;
  } else if (!state.hasLocalCopy && !state.serverSynced) {
    body = state.connection === 'offline' ? <NotOnDeviceState workspaceId={workspaceId} /> : <LoadingSheet />;
  }
  const ready = !body;

  const historyPanel = (onPick) => (
    <HistoryPanel
      docId={docId}
      role={role}
      online={online}
      selectedId={version?.id}
      onSelect={onPick}
      onClose={() => setPanel(wide ? 'copies' : null)}
    />
  );

  const menuItems = [
    ...(canOrganize && info
      ? [
          {
            key: 'pin',
            label: info.pinned ? 'Unpin from top of list' : 'Pin to top of list',
            icon: info.pinned ? PinOff : Pin,
            onSelect: togglePin,
            disabled: !online,
          },
        ]
      : []),
    {
      key: 'link',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => navigator.clipboard?.writeText(window.location.href).then(() => announce('Link copied.')),
    },
    { key: 'download', label: 'Download as HTML', icon: Download, onSelect: () => editor && downloadHtml(editor, title), disabled: !editor },
    ...(can(role, 'doc.trash')
      ? [
          { separator: true },
          { key: 'trash', label: 'Move to trash…', icon: Trash2, danger: true, onSelect: () => setConfirmTrash(true), disabled: !online, keepFocus: true },
        ]
      : []),
  ];

  // The side panel sticks just below the app header and the document bar (plus its toolbar row).
  const toolbarVisible = ready && canEdit && !version;
  const stickyTop = toolbarVisible ? 'calc(3.5rem + 6.2rem)' : 'calc(3.5rem + 3.1rem)';

  const downloadAction = editor && (
    <Button size="sm" onClick={() => downloadHtml(editor, title)}>
      Download what’s on this device
    </Button>
  );
  const pendingPhrase = summary ? `${summary.pending} ${summary.pending === 1 ? 'edit' : 'edits'}` : '';

  return (
    <main id="main" className="flex min-h-full flex-col">
      <div className="sticky top-14 z-10 border-b border-rule bg-desk/95 backdrop-blur supports-[backdrop-filter]:bg-desk/85">
        <div className="flex h-12 items-center gap-1.5 px-2 sm:gap-2 sm:px-4">
          <Link
            to={`/w/${workspaceId}`}
            className="grid h-10 w-10 flex-none place-items-center rounded-md text-ink hover:bg-ink/6 lg:hidden"
            aria-label="Back to documents"
          >
            <ArrowLeft aria-hidden="true" size={19} />
          </Link>
          <p className="min-w-0 flex-1 truncate font-semibold">{title || 'Untitled'}</p>
          <PresenceStack people={people} />
          {summary && (
            <button
              type="button"
              onClick={() => setPanel(panel === 'copies' && !wide ? null : 'copies')}
              aria-label={`Sync status: ${summary.headline}. Show copies`}
              className="flex h-10 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-ink/6"
            >
              <RegistrationMark state={summary.mark} />
              <span
                className={`max-w-[11rem] truncate text-sm font-semibold ${
                  summary.mark === 'fault' ? 'text-correction' : summary.pending > 0 ? 'text-carbon' : 'text-graphite'
                }`}
              >
                {summary.headline}
              </span>
            </button>
          )}
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setPanel(panel === 'history' ? (wide ? 'copies' : null) : 'history')}
            aria-pressed={panel === 'history'}
            disabled={!ready}
          >
            <History aria-hidden="true" size={17} />
            <span className="hidden sm:inline">History</span>
          </Button>
          <Menu
            label="Document actions"
            items={menuItems}
            trigger={
              <button type="button" aria-label="Document actions" className="grid h-10 w-10 flex-none place-items-center rounded-md text-ink hover:bg-ink/6">
                <MoreHorizontal aria-hidden="true" size={19} />
              </button>
            }
          />
        </div>
        {/* The editor's formatting toolbar is portalled here so it stays in the sticky bar. */}
        <div ref={setToolbarTarget} className={toolbarVisible ? 'border-t border-rule/70' : 'hidden'} />
      </div>

      <div className={`grid flex-1 ${wide ? 'grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
        <div className="min-w-0 px-3 pb-16 pt-4 sm:px-6">
          {ready && (
            <div className="mx-auto flex max-w-[46rem] flex-col gap-3">
              {role === 'viewer' && !state.readOnlyRejected && (
                <Notice tone="info">You’re a viewer in this workspace: you can read and see who’s here, but not edit.</Notice>
              )}
              {state.readOnlyRejected && (
                <Notice tone="error" role="alert" title="Your edits can’t be saved" action={downloadAction}>
                  Your role is now viewer, so the {pendingPhrase} on this device can’t reach the server. They stay here until you
                  download them or an owner makes you an editor again.
                </Notice>
              )}
              {blockedCode === 4403 && (
                <Notice tone="error" role="alert" title="Your access to this workspace was removed" action={downloadAction}>
                  {summary.pending > 0 ? `${pendingPhrase} on this device can’t be sent.` : 'This copy will no longer update.'}
                </Notice>
              )}
              {notice?.kind === 'recovered' && (
                <Notice
                  tone="carbon"
                  role="alert"
                  title="Some of your offline text was deleted by a collaborator"
                  action={
                    <Button size="sm" onClick={() => setPanel('history')}>
                      Open history
                    </Button>
                  }
                >
                  While you were offline, someone deleted a passage you had edited.{' '}
                  {notice.uploaded
                    ? 'Your copy from before the merge is saved in History as “Offline copy before merge”.'
                    : 'Your copy from before the merge is kept on this device and will be added to History when you’re online.'}
                </Notice>
              )}
              {notice?.kind === 'restored' && (
                <Notice
                  tone="carbon"
                  title={`${notice.by?.name ?? 'Someone'} restored an earlier version`}
                  action={
                    <Button size="sm" onClick={() => setNotice(null)}>
                      Dismiss
                    </Button>
                  }
                >
                  The text before the restore is in History as “Before restoring…”, so the change can be undone.
                </Notice>
              )}
            </div>
          )}

          {body}
          {ready && version && (
            <VersionViewer key={version.id} docId={docId} version={version} role={role} online={online} onClose={() => setVersion(null)} />
          )}
          {ready && (
            <article
              className={`relative mx-auto mt-3 max-w-[46rem] rounded-md bg-sheet px-6 py-10 shadow-sheet sm:px-14 sm:py-14 ${version ? 'hidden' : ''}`}
            >
              <DocumentEditor
                session={session}
                user={auth.user}
                canEdit={canEdit}
                onReady={setEditor}
                focusTitle={Boolean(location.state?.focusTitle)}
                toolbarSlot={(toolbar) => (toolbarTarget ? createPortal(toolbar, toolbarTarget) : null)}
              />
            </article>
          )}
        </div>

        {wide && summary && (
          <aside className="sticky overflow-y-auto border-l border-rule p-5" style={{ top: stickyTop, height: `calc(100dvh - ${stickyTop})` }}>
            {panel === 'history' && ready ? historyPanel(setVersion) : <CopiesPanel summary={summary} state={state} people={people} />}
          </aside>
        )}
      </div>

      {!wide && summary && (
        <Dialog open={panel === 'copies'} onClose={() => setPanel(null)} title="Sync status">
          <CopiesPanel summary={summary} state={state} people={people} />
        </Dialog>
      )}
      {!wide && ready && (
        <Dialog open={panel === 'history'} onClose={() => setPanel(null)} title="History" size="lg">
          <div className="h-[65dvh]">
            {historyPanel((next) => {
              setVersion(next);
              setPanel(null);
            })}
          </div>
        </Dialog>
      )}

      <Dialog
        open={confirmTrash}
        onClose={() => setConfirmTrash(false)}
        title="Move this document to the trash?"
        description="Everyone in the workspace loses access to it until an editor restores it from the trash."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setConfirmTrash(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={moveToTrash}>
            Move to trash
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
