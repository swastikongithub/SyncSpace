import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Copy } from 'lucide-react';
import { can, INVITABLE_ROLES, ROLES } from '@syncspace/shared/roles';
import { useAuth } from '../../app/auth.jsx';
import { api, ApiError, fieldError, NetworkError } from '../../lib/api.js';
import { invalidate } from '../../lib/resource.js';
import { shortDateTime } from '../../lib/time.js';
import { useAnnounce } from '../../ui/Announcer.jsx';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';
import { Notice } from '../../ui/Notice.jsx';
import { PlyChip } from '../../ui/Ply.jsx';
import { SelectField, TextField } from '../../ui/TextField.jsx';
import { useInvitations, useMembers } from '../data.js';
import { useWorkspaceContext } from '../shell/WorkspaceLayout.jsx';

const ROLE_PHRASE = { owner: 'an owner', editor: 'an editor', viewer: 'a viewer' };

const ROLE_HELP = {
  owner: 'Manages people and the workspace, and can delete documents permanently.',
  editor: 'Creates, edits, restores and trashes documents.',
  viewer: 'Reads documents and sees who is here. Cannot edit.',
};

function errorText(error, fallback) {
  if (error instanceof NetworkError) return 'This needs a connection.';
  return error instanceof ApiError ? error.message : fallback;
}

function InviteForm({ workspaceId }) {
  const announce = useAnnounce();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { invitation, token } = await api.post(`/workspaces/${workspaceId}/invitations`, { email, role });
      setCreated({ ...invitation, link: `${window.location.origin}/invite/${token}` });
      setEmail('');
      invalidate(`invitations:${workspaceId}`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError(error, 'email')} autoComplete="off" />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          {INVITABLE_ROLES.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
          {busy ? 'Creating link…' : 'Create invite link'}
        </Button>
      </form>
      <p className="text-sm text-graphite">{ROLE_HELP[role]}</p>
      {error && !fieldError(error, 'email') && (
        <p role="alert" className="text-sm font-semibold text-correction">
          {errorText(error, 'The invitation could not be created.')}
        </p>
      )}
      {created && (
        <Notice tone="carbon" title={`Invite link for ${created.email}`}>
          <p>Send this link to them. It works once, only for that email address, until {shortDateTime(created.expiresAt)}.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={created.link} aria-label="Invite link" onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 rounded-md border border-rule-strong bg-sheet px-3 text-sm" />
            <Button
              size="sm"
              className="h-10"
              onClick={() => navigator.clipboard?.writeText(created.link).then(() => announce('Invite link copied.'))}
            >
              <Copy aria-hidden="true" size={16} /> Copy link
            </Button>
          </div>
        </Notice>
      )}
    </div>
  );
}

function WorkspaceSettings({ workspace }) {
  const announce = useAnnounce();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState(null);

  async function rename(event) {
    event.preventDefault();
    try {
      await api.patch(`/workspaces/${workspace.id}`, { name });
      invalidate('workspace');
      announce('Workspace renamed.');
    } catch (failure) {
      announce(errorText(failure, 'Could not rename the workspace.'), { urgent: true });
    }
  }

  async function remove() {
    try {
      await api.delete(`/workspaces/${workspace.id}`, { confirmName });
      invalidate('workspaces');
      navigate('/w', { replace: true });
    } catch (failure) {
      setError(errorText(failure, 'Could not delete the workspace.'));
    }
  }

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4 rounded-lg border border-rule p-5">
      <h2 id="settings-heading" className="text-lg font-bold">
        Workspace settings
      </h2>
      <form onSubmit={rename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" maxLength={80} />
        <Button type="submit" disabled={!name.trim() || name.trim() === workspace.name}>
          Rename
        </Button>
      </form>
      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <p className="font-semibold">Delete this workspace</p>
        <p className="text-sm text-graphite">Removes every document, version and membership for everyone. This can’t be undone.</p>
        <Button variant="danger-outline" className="self-start" onClick={() => setConfirmOpen(true)}>
          Delete workspace…
        </Button>
      </div>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Delete ${workspace.name}?`} size="sm">
        <TextField
          label={`Type “${workspace.name}” to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          error={error}
          autoComplete="off"
        />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={confirmName.trim() !== workspace.name} onClick={remove}>
            Delete workspace
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function MembersPage() {
  const { workspace, role } = useWorkspaceContext();
  const { user } = useAuth();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const workspaceId = workspace?.id;
  const manage = can(role, 'members.manage');
  const members = useMembers(workspaceId);
  const invitations = useInvitations(workspaceId, manage);
  const [leaving, setLeaving] = useState(false);

  async function changeRole(member, next) {
    try {
      await api.patch(`/workspaces/${workspaceId}/members/${member.user.id}`, { role: next });
      invalidate(`members:${workspaceId}`);
      announce(`${member.user.name} is now ${ROLE_PHRASE[next]}.`);
    } catch (failure) {
      announce(errorText(failure, 'Could not change the role.'), { urgent: true });
      invalidate(`members:${workspaceId}`);
    }
  }

  async function removeMember(member) {
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${member.user.id}`);
      if (member.user.id === user.id) {
        invalidate('workspaces');
        navigate('/w', { replace: true });
        return;
      }
      invalidate(`members:${workspaceId}`);
      announce(`${member.user.name} was removed from the workspace.`);
    } catch (failure) {
      announce(errorText(failure, 'Could not remove that person.'), { urgent: true });
    }
  }

  if (!workspace) return null;
  const owners = members.data?.filter((member) => member.role === 'owner') ?? [];
  const soleOwner = role === 'owner' && owners.length === 1;

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8">
      <div>
        <Link to={`/w/${workspaceId}`} className="text-sm font-semibold text-carbon underline-offset-2 hover:underline">
          {workspace.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Members</h1>
      </div>

      {manage && (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-4 rounded-lg bg-sheet p-5 shadow-sheet">
          <h2 id="invite-heading" className="text-lg font-bold">
            Invite someone
          </h2>
          <InviteForm workspaceId={workspaceId} />
        </section>
      )}

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-lg font-bold">
          People in this workspace
        </h2>
        {members.status === 'error' && <p className="text-correction">{errorText(members.error, 'Members could not be loaded.')}</p>}
        <ul className="flex flex-col divide-y divide-rule rounded-lg bg-sheet shadow-sheet">
          {members.data?.map((member) => {
            const self = member.user.id === user.id;
            return (
              <li key={member.user.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <PlyChip person={member.user} detail={self ? '(you)' : null} />
                  {member.user.email && <p className="truncate pl-6 text-sm text-graphite">{member.user.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {manage ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${member.user.id}`}>
                        Role for {member.user.name}
                      </label>
                      <select
                        id={`role-${member.user.id}`}
                        value={member.role}
                        onChange={(event) => changeRole(member, event.target.value)}
                        className="h-10 rounded-md border border-rule-strong bg-sheet px-2 text-sm"
                      >
                        {ROLES.map((value) => (
                          <option key={value} value={value}>
                            {value[0].toUpperCase() + value.slice(1)}
                          </option>
                        ))}
                      </select>
                      {!self && (
                        <Button size="sm" variant="quiet" onClick={() => removeMember(member)}>
                          Remove
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-sm font-semibold capitalize text-graphite">{member.role}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {soleOwner ? (
          <p className="text-sm text-graphite">You’re the only owner. Make someone else an owner before you can leave.</p>
        ) : (
          <Button variant="danger-outline" size="sm" className="self-start" onClick={() => setLeaving(true)}>
            Leave this workspace…
          </Button>
        )}
      </section>

      {manage && invitations.data?.length > 0 && (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
          <h2 id="pending-heading" className="text-lg font-bold">
            Pending invitations
          </h2>
          <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{invitation.email}</p>
                  <p className="text-sm text-graphite">
                    As {invitation.role}, until {shortDateTime(invitation.expiresAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={async () => {
                    try {
                      await api.delete(`/workspaces/${workspaceId}/invitations/${invitation.id}`);
                      invalidate(`invitations:${workspaceId}`);
                      announce('Invitation withdrawn.');
                    } catch (failure) {
                      announce(errorText(failure, 'Could not withdraw the invitation.'), { urgent: true });
                    }
                  }}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manage && <WorkspaceSettings workspace={workspace} />}

      <Dialog open={leaving} onClose={() => setLeaving(false)} title={`Leave ${workspace.name}?`} size="sm">
        <p className="text-sm">You’ll lose access to its documents until someone invites you again.</p>
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setLeaving(false)}>
            Stay
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setLeaving(false);
              void removeMember({ user: { id: user.id, name: user.name } });
            }}
          >
            Leave workspace
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
