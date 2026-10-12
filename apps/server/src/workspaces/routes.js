import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { INVITABLE_ROLES, LIMITS, ROLES } from '@syncspace/shared';
import { Activity } from '../activity/model.js';
import { requireAuth } from '../auth/middleware.js';
import { Document } from '../documents/model.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { idParam, parse } from '../http/validate.js';
import { peopleById } from '../users/lookup.js';
import { publicUser, User } from '../users/model.js';
import { authorizeWorkspace } from './access.js';
import { Invitation, Membership, Workspace } from './models.js';

const INVITE_TTL_MS = 7 * 24 * 3_600_000;

const nameSchema = z.object({ name: z.string().trim().min(1, 'Give the workspace a name.').max(LIMITS.workspaceNameMax) });
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(LIMITS.emailMax).pipe(z.email('Enter a valid email address.')),
  role: z.enum(INVITABLE_ROLES),
});
const roleSchema = z.object({ role: z.enum(ROLES) });
const deleteSchema = z.object({ confirmName: z.string() });

export const hashInviteToken = (token) => createHash('sha256').update(token).digest('hex');

function workspaceSummary(workspace, role, counts = {}) {
  return {
    id: String(workspace._id),
    name: workspace.name,
    role,
    memberCount: counts.members ?? 0,
    documentCount: counts.documents ?? 0,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

function invitationSummary(invitation, people) {
  return {
    id: String(invitation._id),
    email: invitation.email,
    role: invitation.role,
    createdBy: people.get(String(invitation.createdBy)) ?? null,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  };
}

async function countOwners(workspaceId) {
  return Membership.countDocuments({ workspaceId, role: 'owner' });
}

export function workspaceRoutes(ctx) {
  const { activity } = ctx;
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const memberships = await Membership.find({ userId: req.auth.user._id }).lean();
    const ids = memberships.map((membership) => membership.workspaceId);
    const [workspaces, memberCounts, documentCounts] = await Promise.all([
      Workspace.find({ _id: { $in: ids } }).lean(),
      Membership.aggregate([{ $match: { workspaceId: { $in: ids } } }, { $group: { _id: '$workspaceId', n: { $sum: 1 } } }]),
      Document.aggregate([
        { $match: { workspaceId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
      ]),
    ]);
    const roleOf = new Map(memberships.map((membership) => [String(membership.workspaceId), membership.role]));
    const members = new Map(memberCounts.map((row) => [String(row._id), row.n]));
    const documents = new Map(documentCounts.map((row) => [String(row._id), row.n]));
    const list = workspaces
      .map((workspace) => {
        const id = String(workspace._id);
        return workspaceSummary(workspace, roleOf.get(id), { members: members.get(id), documents: documents.get(id) });
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ workspaces: list });
  });

  router.post('/', async (req, res) => {
    const { name } = parse(nameSchema, req.body);
    const workspace = await Workspace.create({ name, createdBy: req.auth.user._id });
    await Membership.create({ workspaceId: workspace._id, userId: req.auth.user._id, role: 'owner' });
    await activity.record('workspace.created', { workspaceId: workspace._id, actorId: req.auth.user._id, data: { name } });
    res.status(201).json({ workspace: workspaceSummary(workspace, 'owner', { members: 1, documents: 0 }) });
  });

  router.get('/:workspaceId', async (req, res) => {
    const { workspace, role } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'workspace.read');
    const [members, documents] = await Promise.all([
      Membership.countDocuments({ workspaceId: workspace._id }),
      Document.countDocuments({ workspaceId: workspace._id, deletedAt: null }),
    ]);
    res.json({ workspace: workspaceSummary(workspace, role, { members, documents }) });
  });

  router.patch('/:workspaceId', async (req, res) => {
    const { workspace, role } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'workspace.rename');
    const { name } = parse(nameSchema, req.body);
    const updated = await Workspace.findByIdAndUpdate(workspace._id, { name }, { new: true }).lean();
    await activity.record('workspace.renamed', {
      workspaceId: workspace._id,
      actorId: req.auth.user._id,
      data: { from: workspace.name, to: name },
    });
    res.json({ workspace: workspaceSummary(updated, role) });
  });

  router.delete('/:workspaceId', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'workspace.delete');
    const { confirmName } = parse(deleteSchema, req.body);
    if (confirmName.trim() !== workspace.name) {
      throw badRequest('confirmation_mismatch', 'Type the workspace name exactly to confirm deletion.');
    }
    const documents = await Document.find({ workspaceId: workspace._id }, { _id: 1 }).lean();
    await ctx.documentsService.purge(documents.map((document) => document._id));
    await Promise.all([
      Membership.deleteMany({ workspaceId: workspace._id }),
      Invitation.deleteMany({ workspaceId: workspace._id }),
      Activity.deleteMany({ workspaceId: workspace._id }),
    ]);
    await Workspace.deleteOne({ _id: workspace._id });
    res.status(204).end();
  });

  // ---- Members -------------------------------------------------------------------------

  router.get('/:workspaceId/members', async (req, res) => {
    const { workspace, role } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'members.read');
    const memberships = await Membership.find({ workspaceId: workspace._id }).sort({ createdAt: 1 }).lean();
    const users = await User.find({ _id: { $in: memberships.map((membership) => membership.userId) } }).lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    // Only owners, who manage membership, see members' email addresses.
    const showEmail = role === 'owner';
    const members = memberships
      .filter((membership) => byId.has(String(membership.userId)))
      .map((membership) => {
        const { email, ...identity } = publicUser(byId.get(String(membership.userId)));
        return {
          user: showEmail || identity.id === String(req.auth.user._id) ? { ...identity, email } : identity,
          role: membership.role,
          joinedAt: membership.createdAt,
        };
      });
    res.json({ members });
  });

  router.patch('/:workspaceId/members/:userId', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'members.manage');
    const userId = idParam(req.params.userId, 'member_not_found', 'That person is not a member of this workspace.');
    const { role } = parse(roleSchema, req.body);
    const membership = await Membership.findOne({ workspaceId: workspace._id, userId }).lean();
    if (!membership) throw notFound('member_not_found', 'That person is not a member of this workspace.');
    if (membership.role === 'owner' && role !== 'owner' && (await countOwners(workspace._id)) <= 1) {
      throw conflict('last_owner', 'A workspace needs at least one owner. Make someone else an owner first.');
    }
    await Membership.updateOne({ _id: membership._id }, { role });
    ctx.collab.updateMemberRole(String(workspace._id), userId, role);
    await activity.record('member.role_changed', {
      workspaceId: workspace._id,
      actorId: req.auth.user._id,
      data: { userId, from: membership.role, to: role },
    });
    res.json({ member: { userId, role } });
  });

  router.delete('/:workspaceId/members/:userId', async (req, res) => {
    const userId = idParam(req.params.userId, 'member_not_found', 'That person is not a member of this workspace.');
    const leaving = userId === String(req.auth.user._id);
    const { workspace } = await authorizeWorkspace(
      req.auth.user,
      req.params.workspaceId,
      leaving ? 'workspace.read' : 'members.manage',
    );
    const membership = await Membership.findOne({ workspaceId: workspace._id, userId }).lean();
    if (!membership) throw notFound('member_not_found', 'That person is not a member of this workspace.');
    if (membership.role === 'owner' && (await countOwners(workspace._id)) <= 1) {
      throw conflict('last_owner', 'A workspace needs at least one owner. Make someone else an owner first.');
    }
    await Membership.deleteOne({ _id: membership._id });
    ctx.collab.revokeMember(String(workspace._id), userId);
    await activity.record(leaving ? 'member.left' : 'member.removed', {
      workspaceId: workspace._id,
      actorId: req.auth.user._id,
      data: { userId },
    });
    res.status(204).end();
  });

  // ---- Invitations ---------------------------------------------------------------------

  router.get('/:workspaceId/invitations', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'members.manage');
    const invitations = await Invitation.find({
      workspaceId: workspace._id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .lean();
    const people = await peopleById(invitations.map((invitation) => invitation.createdBy));
    res.json({ invitations: invitations.map((invitation) => invitationSummary(invitation, people)) });
  });

  router.post('/:workspaceId/invitations', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'members.manage');
    const { email, role } = parse(inviteSchema, req.body);
    const existingUser = await User.findOne({ email }, { _id: 1 }).lean();
    if (existingUser && (await Membership.exists({ workspaceId: workspace._id, userId: existingUser._id }))) {
      throw conflict('already_member', 'That person is already a member of this workspace.');
    }
    // One live invitation per address: issuing a new link retires the previous one.
    await Invitation.updateMany(
      { workspaceId: workspace._id, email, acceptedAt: null, revokedAt: null },
      { revokedAt: new Date() },
    );
    const token = randomBytes(32).toString('base64url');
    const invitation = await Invitation.create({
      workspaceId: workspace._id,
      email,
      role,
      tokenHash: hashInviteToken(token),
      createdBy: req.auth.user._id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await activity.record('member.invited', {
      workspaceId: workspace._id,
      actorId: req.auth.user._id,
      data: { email, role },
    });
    const people = await peopleById([req.auth.user._id]);
    // The token is returned exactly once; only its hash is stored.
    res.status(201).json({ invitation: invitationSummary(invitation, people), token });
  });

  router.delete('/:workspaceId/invitations/:invitationId', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'members.manage');
    const invitationId = idParam(req.params.invitationId, 'invitation_not_found', 'Invitation not found.');
    const result = await Invitation.updateOne(
      { _id: invitationId, workspaceId: workspace._id, acceptedAt: null, revokedAt: null },
      { revokedAt: new Date() },
    );
    if (result.matchedCount === 0) throw notFound('invitation_not_found', 'Invitation not found.');
    res.status(204).end();
  });

  // ---- Activity ------------------------------------------------------------------------

  router.get('/:workspaceId/activity', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'activity.read');
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && Number.isNaN(before.getTime())) throw badRequest('invalid_cursor', 'Invalid activity cursor.');
    const filter = { workspaceId: workspace._id, ...(before ? { createdAt: { $lt: before } } : {}) };
    const entries = await Activity.find(filter).sort({ createdAt: -1 }).limit(40).lean();
    const userIds = entries.flatMap((entry) => [entry.actorId, entry.data?.userId]);
    const [people, documents] = await Promise.all([
      peopleById(userIds),
      Document.find({ _id: { $in: entries.map((entry) => entry.documentId).filter(Boolean) } }, { title: 1, deletedAt: 1 }).lean(),
    ]);
    const documentById = new Map(documents.map((document) => [String(document._id), document]));
    res.json({
      activity: entries.map((entry) => {
        const document = entry.documentId ? documentById.get(String(entry.documentId)) : null;
        const { userId, ...data } = entry.data ?? {};
        return {
          id: String(entry._id),
          type: entry.type,
          actor: people.get(String(entry.actorId)) ?? null,
          subject: userId ? (people.get(String(userId)) ?? null) : null,
          document: entry.documentId
            ? { id: String(entry.documentId), title: document?.title ?? data.title ?? '', available: Boolean(document && !document.deletedAt) }
            : null,
          data,
          createdAt: entry.createdAt,
        };
      }),
    });
  });

  return router;
}

export function invitationRoutes(ctx) {
  const { activity } = ctx;
  const router = Router();

  async function findInvitation(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    return Invitation.findOne({ tokenHash: hashInviteToken(token) }).lean();
  }

  function invitationStatus(invitation) {
    if (invitation.revokedAt) return 'revoked';
    if (invitation.acceptedAt) return 'accepted';
    if (invitation.expiresAt.getTime() <= Date.now()) return 'expired';
    return 'pending';
  }

  // Preview is available to the link holder before signing in, so they know which account to use.
  router.get('/:token', async (req, res) => {
    const invitation = await findInvitation(req.params.token);
    if (!invitation) throw notFound('invitation_not_found', 'This invitation link is not valid.');
    const [workspace, inviter] = await Promise.all([
      Workspace.findById(invitation.workspaceId, { name: 1 }).lean(),
      User.findById(invitation.createdBy, { name: 1 }).lean(),
    ]);
    if (!workspace) throw notFound('invitation_not_found', 'This invitation link is not valid.');
    res.json({
      invitation: {
        workspaceName: workspace.name,
        role: invitation.role,
        email: invitation.email,
        invitedBy: inviter?.name ?? null,
        expiresAt: invitation.expiresAt,
        status: invitationStatus(invitation),
      },
    });
  });

  router.post('/:token/accept', requireAuth, async (req, res) => {
    const invitation = await findInvitation(req.params.token);
    if (!invitation) throw notFound('invitation_not_found', 'This invitation link is not valid.');
    const status = invitationStatus(invitation);
    if (status !== 'pending') {
      throw conflict(`invitation_${status}`, {
        revoked: 'This invitation was withdrawn. Ask for a new link.',
        accepted: 'This invitation has already been used.',
        expired: 'This invitation has expired. Ask for a new link.',
      }[status]);
    }
    if (invitation.email !== req.auth.user.email) {
      throw forbidden(
        'invitation_email_mismatch',
        `This invitation is for ${invitation.email}. Sign in with that account to accept it.`,
      );
    }
    // Claim atomically so a link can be used once even under concurrent requests.
    const claimed = await Invitation.findOneAndUpdate(
      { _id: invitation._id, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { acceptedAt: new Date(), acceptedBy: req.auth.user._id },
    ).lean();
    if (!claimed) throw conflict('invitation_accepted', 'This invitation has already been used.');

    const existing = await Membership.findOne({ workspaceId: invitation.workspaceId, userId: req.auth.user._id }).lean();
    if (!existing) {
      try {
        await Membership.create({
          workspaceId: invitation.workspaceId,
          userId: req.auth.user._id,
          role: invitation.role,
          invitedBy: invitation.createdBy,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      await activity.record('member.joined', {
        workspaceId: invitation.workspaceId,
        actorId: req.auth.user._id,
        data: { role: invitation.role },
      });
    }
    res.json({ workspaceId: String(invitation.workspaceId), role: existing?.role ?? invitation.role });
  });

  return router;
}
