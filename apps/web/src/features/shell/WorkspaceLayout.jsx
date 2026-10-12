import { useEffect } from 'react';
import { Outlet, useMatch, useOutletContext, useParams } from 'react-router';
import { useAuth } from '../../app/auth.jsx';
import { DeskMessage } from '../../app/RootLayout.jsx';
import { ApiError } from '../../lib/api.js';
import { deviceMemory } from '../../lib/device-memory.js';
import { ButtonLink } from '../../ui/Button.jsx';
import { useWorkspace } from '../data.js';
import { AppHeader } from './AppHeader.jsx';
import { DocumentTray } from './DocumentTray.jsx';
import { OfflineStrip } from './OfflineStrip.jsx';

export function useWorkspaceContext() {
  return useOutletContext();
}

export function WorkspaceLayout() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const workspace = useWorkspace(workspaceId);
  const inDocument = useMatch('/w/:workspaceId/d/:docId');

  useEffect(() => {
    if (workspace.data && user) deviceMemory.setLastWorkspace(user.id, workspaceId);
  }, [workspace.data, user, workspaceId]);

  if (workspace.status === 'error' && !workspace.data) {
    const missing = workspace.error instanceof ApiError && workspace.error.status === 404;
    if (missing && user) deviceMemory.setLastWorkspace(user.id, null);
    return (
      <DeskMessage
        title={missing ? 'Workspace not found' : 'This workspace isn’t on this device'}
        action={<ButtonLink to="/w" variant="primary">See your workspaces</ButtonLink>}
      >
        {missing
          ? 'It may have been deleted, or you may no longer be a member.'
          : 'You’re offline and this workspace hasn’t been opened on this device before.'}
      </DeskMessage>
    );
  }

  const context = {
    workspace: workspace.data ?? null,
    role: workspace.data?.role ?? null,
    fromDevice: workspace.source === 'device',
  };

  return (
    <div className="flex min-h-dvh flex-col bg-desk">
      <AppHeader workspace={workspace.data} />
      <OfflineStrip />
      <div className="flex min-h-0 flex-1">
        {inDocument && <DocumentTray workspaceId={workspaceId} role={context.role} activeId={inDocument.params.docId} />}
        <div className="min-w-0 flex-1">
          <Outlet context={context} />
        </div>
      </div>
    </div>
  );
}
