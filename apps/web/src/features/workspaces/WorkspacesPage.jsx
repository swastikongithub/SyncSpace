import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../app/auth.jsx';
import { DeskMessage } from '../../app/RootLayout.jsx';
import { api, fieldError, NetworkError } from '../../lib/api.js';
import { deviceMemory } from '../../lib/device-memory.js';
import { invalidate } from '../../lib/resource.js';
import { Brand } from '../../ui/Brand.jsx';
import { Button } from '../../ui/Button.jsx';
import { TextField } from '../../ui/TextField.jsx';
import { useWorkspaces } from '../data.js';

function CreateWorkspaceForm({ autoFocus }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.post('/workspaces', { name });
      invalidate('workspaces');
      navigate(`/w/${workspace.id}`);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Workspace name"
        hint="For example, the course, team or project it’s for."
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldError(error, 'name')}
        autoFocus={autoFocus}
        maxLength={80}
        required
      />
      {error && !fieldError(error, 'name') && (
        <p role="alert" className="text-sm font-semibold text-correction">
          {error instanceof NetworkError ? 'Creating a workspace needs a connection.' : error.message}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || !name.trim()} className="self-start">
        {busy ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}

export function WorkspacesPage() {
  const { user } = useAuth();
  const workspaces = useWorkspaces();
  const [params] = useSearchParams();
  const creating = params.get('new') === '1';

  if (workspaces.status === 'loading' || workspaces.status === 'idle') return <DeskMessage title="Opening your workspaces…" />;
  if (workspaces.status === 'error') {
    return (
      <DeskMessage title="Your workspaces couldn’t be loaded" action={<Button onClick={workspaces.reload}>Try again</Button>}>
        {workspaces.error instanceof NetworkError ? 'You’re offline and no workspace list is saved on this device yet.' : workspaces.error.message}
      </DeskMessage>
    );
  }

  const list = workspaces.data;
  const last = deviceMemory.lastWorkspace(user.id);
  if (!creating && list.length > 0 && list.some((workspace) => workspace.id === last)) return <Navigate to={`/w/${last}`} replace />;

  return (
    <div className="min-h-dvh bg-desk">
      <main id="main" className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-10">
        <Brand to="/w" />
        {list.length === 0 && !creating ? (
          <section className="rounded-lg bg-sheet p-6 shadow-sheet sm:p-8">
            <h1 className="font-writing text-[1.9rem] font-[620] leading-tight">Start a workspace, {user.name.split(' ')[0]}</h1>
            <p className="mt-2 max-w-prose text-graphite">
              A workspace holds documents and the people you write them with. You can invite others once it exists.
            </p>
            <div className="mt-6">
              <CreateWorkspaceForm autoFocus />
            </div>
          </section>
        ) : (
          <>
            <section>
              <h1 className="text-2xl font-bold">Your workspaces</h1>
              {workspaces.source === 'device' && (
                <p className="mt-1 text-sm text-graphite">You’re offline. This is the list saved on this device.</p>
              )}
              <ul className="mt-4 flex flex-col gap-2">
                {list.map((workspace) => (
                  <li key={workspace.id}>
                    <Link to={`/w/${workspace.id}`} className="flex items-center justify-between gap-4 rounded-lg bg-sheet px-5 py-4 shadow-sheet hover:outline hover:outline-2 hover:outline-carbon/40">
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-bold">{workspace.name}</span>
                        <span className="block text-sm text-graphite">
                          {workspace.documentCount} {workspace.documentCount === 1 ? 'document' : 'documents'}, {workspace.memberCount}{' '}
                          {workspace.memberCount === 1 ? 'person' : 'people'}
                        </span>
                      </span>
                      <span className="flex-none text-sm font-semibold capitalize text-graphite">{workspace.role}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-rule p-6">
              <h2 className="text-lg font-bold">New workspace</h2>
              <div className="mt-4">
                <CreateWorkspaceForm autoFocus={creating} />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
