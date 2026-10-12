import { Link } from 'react-router';
import { Pin, Trash2, Users } from 'lucide-react';
import { can } from '@syncspace/shared/roles';
import { useLocalData } from '../../app/local-data.jsx';
import { NetworkError } from '../../lib/api.js';
import { useOnline } from '../../lib/online.js';
import { clockTime, timeAgo } from '../../lib/time.js';
import { ButtonLink } from '../../ui/Button.jsx';
import { Notice } from '../../ui/Notice.jsx';
import { PlyChip } from '../../ui/Ply.jsx';
import { ActivitySentence } from '../activity/describe.jsx';
import { useActivity, useDocuments, useMembers } from '../data.js';
import { NewDocumentButton } from '../documents/NewDocumentButton.jsx';
import { useWorkspaceContext } from '../shell/WorkspaceLayout.jsx';

function DeviceBadges({ meta, online }) {
  if (meta?.pending > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-carbon">
        <span aria-hidden="true" className="h-3.5 w-1 rounded-full bg-wet" />
        {meta.pending} unsent {meta.pending === 1 ? 'edit' : 'edits'} on this device
      </span>
    );
  }
  if (meta) return <span className="text-sm text-graphite">On this device</span>;
  if (!online) return <span className="text-sm font-semibold text-caution">Not on this device</span>;
  return null;
}

function DocumentIndex({ workspaceId, documents, local, online }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {documents.map((document) => {
        const meta = local.get(document.id);
        const unavailable = !online && !meta;
        return (
          <li key={document.id}>
            <Link
              to={`/w/${workspaceId}/d/${document.id}`}
              className={`group relative block rounded-md bg-sheet px-5 py-4 shadow-sheet transition-[outline-color] hover:outline hover:outline-2 hover:outline-carbon/35 ${
                unavailable ? 'opacity-70' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <h3 className="min-w-0 font-writing text-[1.2rem] font-[620] leading-snug">
                  {document.pinned && <Pin aria-label="Pinned" size={15} className="mr-1.5 inline -translate-y-0.5 text-graphite" />}
                  {document.title || <span className="text-graphite">Untitled</span>}
                </h3>
              </div>
              {document.excerpt && <p className="mt-1 line-clamp-2 max-w-prose text-[0.95rem] leading-relaxed text-graphite">{document.excerpt}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-graphite">
                <span>
                  {document.lastEditedBy ? `Edited by ${document.lastEditedBy.name} ${timeAgo(document.lastEditedAt)}` : `Created ${timeAgo(document.createdAt)}`}
                </span>
                <DeviceBadges meta={meta} online={online} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityFeed({ workspaceId }) {
  const activity = useActivity(workspaceId);
  if (activity.status === 'error') {
    return <p className="text-sm text-graphite">{activity.error instanceof NetworkError ? 'Activity appears when you’re online.' : 'Activity couldn’t be loaded.'}</p>;
  }
  if (!activity.data) return <p className="text-sm text-graphite">Loading…</p>;
  if (activity.data.length === 0) return <p className="text-sm text-graphite">Nothing has happened here yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {activity.data.slice(0, 12).map((entry) => (
        <li key={entry.id} className="text-sm leading-snug">
          <ActivitySentence entry={entry} workspaceId={workspaceId} />
          <span className="block text-graphite">{timeAgo(entry.data?.lastAt ?? entry.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}

function People({ workspaceId, role }) {
  const members = useMembers(workspaceId);
  if (!members.data) return <p className="text-sm text-graphite">{members.status === 'error' ? 'People appear when you’re online.' : 'Loading…'}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {members.data.map((member) => (
          <li key={member.user.id} className="flex items-center justify-between gap-3 text-sm">
            <PlyChip person={member.user} />
            <span className="capitalize text-graphite">{member.role}</span>
          </li>
        ))}
      </ul>
      <Link to={`/w/${workspaceId}/members`} className="text-sm font-semibold text-carbon underline-offset-2 hover:underline">
        {can(role, 'members.manage') ? 'Invite and manage people' : 'See everyone'}
      </Link>
    </div>
  );
}

export function WorkspaceHome() {
  const { workspace, role } = useWorkspaceContext();
  const workspaceId = workspace?.id;
  const documents = useDocuments(workspaceId);
  const { docs: local } = useLocalData();
  const online = useOnline();

  if (!workspace) return <p className="p-8 text-graphite">Loading…</p>;
  const list = documents.data ?? [];

  return (
    <main id="main" className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-labelledby="workspace-title" className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 id="workspace-title" className="font-writing text-[2rem] font-[620] leading-tight tracking-[-0.01em]">
              {workspace.name}
            </h1>
            <p className="text-graphite">
              {list.length} {list.length === 1 ? 'document' : 'documents'}. You’re {role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : 'a viewer'}.
            </p>
          </div>
          <NewDocumentButton workspaceId={workspaceId} role={role} variant="primary" />
        </div>

        {documents.source === 'device' && (
          <Notice tone="caution" title="Showing the list saved on this device">
            {documents.savedAt ? `Saved at ${clockTime(documents.savedAt)}. ` : ''}Documents marked “On this device” open and stay editable
            offline.
          </Notice>
        )}
        {documents.status === 'error' && (
          <Notice tone="error" role="alert" title="Documents couldn’t be loaded">
            {documents.error instanceof NetworkError ? 'You’re offline and this list isn’t saved on this device yet.' : documents.error.message}
          </Notice>
        )}
        {documents.status === 'loading' && <p className="text-graphite">Loading documents…</p>}

        {documents.status === 'success' && list.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-rule-strong/60 px-6 py-10 text-center">
            <h2 className="text-lg font-bold">No documents yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-graphite">
              {can(role, 'doc.create')
                ? 'Start one. Every keystroke is saved on this device and on the server as you type.'
                : 'When an editor starts a document, it appears here.'}
            </p>
            <div className="mt-5 flex justify-center">
              <NewDocumentButton workspaceId={workspaceId} role={role} variant="primary" label="Start a document" />
            </div>
          </div>
        ) : (
          <DocumentIndex workspaceId={workspaceId} documents={list} local={local} online={online} />
        )}

        <div className="flex flex-wrap gap-2 lg:hidden">
          <ButtonLink to={`/w/${workspaceId}/members`} size="sm">
            <Users aria-hidden="true" size={16} /> Members
          </ButtonLink>
          <ButtonLink to={`/w/${workspaceId}/trash`} size="sm">
            <Trash2 aria-hidden="true" size={16} /> Trash
          </ButtonLink>
        </div>
      </section>

      <aside className="flex flex-col gap-8">
        <section aria-labelledby="people-heading">
          <h2 id="people-heading" className="mb-3 text-sm font-bold text-graphite">
            People
          </h2>
          <People workspaceId={workspaceId} role={role} />
        </section>
        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-3 text-sm font-bold text-graphite">
            Recent activity
          </h2>
          <ActivityFeed workspaceId={workspaceId} />
        </section>
        <Link to={`/w/${workspaceId}/trash`} className="hidden text-sm font-semibold text-graphite underline-offset-2 hover:underline lg:block">
          Trash
        </Link>
      </aside>
    </main>
  );
}
