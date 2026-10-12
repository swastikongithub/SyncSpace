import { Link } from 'react-router';

const ROLE = { owner: 'an owner', editor: 'an editor', viewer: 'a viewer' };

function DocumentName({ entry, workspaceId }) {
  const doc = entry.document;
  if (!doc) return <span>a document</span>;
  const title = doc.title || 'Untitled';
  if (!doc.available) return <span className="font-semibold">{title}</span>;
  return (
    <Link to={`/w/${workspaceId}/d/${doc.id}`} className="font-semibold text-carbon underline-offset-2 hover:underline">
      {title}
    </Link>
  );
}

/** One activity entry as a plain sentence. */
export function ActivitySentence({ entry, workspaceId }) {
  const actor = <span className="font-semibold">{entry.actor?.name ?? 'Someone'}</span>;
  const subject = <span className="font-semibold">{entry.subject?.name ?? 'someone'}</span>;
  const doc = <DocumentName entry={entry} workspaceId={workspaceId} />;
  const data = entry.data ?? {};
  switch (entry.type) {
    case 'workspace.created':
      return <>{actor} created the workspace</>;
    case 'workspace.renamed':
      return <>{actor} renamed the workspace to “{data.to}”</>;
    case 'member.invited':
      return <>{actor} invited {data.email} as {ROLE[data.role] ?? data.role}</>;
    case 'member.joined':
      return <>{actor} joined as {ROLE[data.role] ?? data.role}</>;
    case 'member.role_changed':
      return <>{actor} made {subject} {ROLE[data.to] ?? data.to}</>;
    case 'member.removed':
      return <>{actor} removed {subject} from the workspace</>;
    case 'member.left':
      return <>{actor} left the workspace</>;
    case 'document.created':
      return <>{actor} started {doc}</>;
    case 'document.edited':
      return <>{actor} edited {doc}</>;
    case 'document.renamed':
      return <>{actor} renamed “{data.from || 'Untitled'}” to {doc}</>;
    case 'document.trashed':
      return <>{actor} moved {doc} to the trash</>;
    case 'document.untrashed':
      return <>{actor} brought {doc} back from the trash</>;
    case 'document.purged':
      return <>{actor} permanently deleted “{data.title || 'Untitled'}”</>;
    case 'version.saved':
      return <>{actor} saved a version of {doc}{data.label ? <> named “{data.label}”</> : null}</>;
    case 'version.restored':
      return <>{actor} restored an earlier version of {doc}</>;
    case 'version.recovered':
      return <>An offline copy of {doc} from {actor} was saved to its history</>;
    default:
      return <>{actor} made a change</>;
  }
}
