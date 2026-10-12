import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { can } from '@syncspace/shared/roles';
import { api, NetworkError } from '../../lib/api.js';
import { invalidate } from '../../lib/resource.js';
import { useOnline } from '../../lib/online.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';

/** Creates a document and opens it. Creation needs the server (it assigns the id and checks access). */
export function NewDocumentButton({ workspaceId, role, size = 'md', variant = 'outline', label = 'New document' }) {
  const navigate = useNavigate();
  const online = useOnline();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  if (!role || !can(role, 'doc.create')) return null;

  async function create() {
    setBusy(true);
    try {
      const { document } = await api.post(`/workspaces/${workspaceId}/documents`, { title: '' });
      invalidate(`docs:${workspaceId}`);
      navigate(`/w/${workspaceId}/d/${document.id}`, { state: { focusTitle: true } });
    } catch (error) {
      announce(error instanceof NetworkError ? 'New documents need a connection. Try again when you’re online.' : error.message, { urgent: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={create}
      disabled={busy || !online}
      title={online ? undefined : 'Creating a document needs a connection'}
    >
      <Plus aria-hidden="true" size={size === 'sm' ? 16 : 18} />
      {size === 'sm' ? <span className="sr-only sm:not-sr-only">New</span> : label}
    </Button>
  );
}
