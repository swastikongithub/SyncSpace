import { Router } from 'express';
import { z } from 'zod';
import { LIMITS } from '@syncspace/shared';
import { CloseCode } from '@syncspace/shared/protocol';
import { requireAuth } from '../auth/middleware.js';
import { writeTitle } from '../collab/ydoc.js';
import { conflict } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { peopleById } from '../users/lookup.js';
import { authorizeDocument, authorizeWorkspace, userWorkspaceIds } from '../workspaces/access.js';
import { Workspace } from '../workspaces/models.js';
import { Document, documentSummary } from './model.js';

const titleSchema = z.string().trim().max(LIMITS.documentTitleMax, `Keep titles under ${LIMITS.documentTitleMax} characters.`);
const createSchema = z.object({ title: titleSchema.optional().default('') });
const patchSchema = z
  .object({ title: titleSchema.optional(), pinned: z.boolean().optional() })
  .refine((value) => value.title !== undefined || value.pinned !== undefined, 'Nothing to update.');
const listSchema = z.object({ trash: z.enum(['0', '1']).optional().default('0') });
const searchSchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for.').max(LIMITS.searchQueryMax),
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
});

async function summarize(documents) {
  const people = await peopleById(documents.flatMap((document) => [document.createdBy, document.lastEditedBy]));
  return documents.map((document) => documentSummary(document, people));
}

/** Routes nested under /api/workspaces/:workspaceId/documents */
export function workspaceDocumentRoutes(ctx) {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'doc.read');
    const { trash } = parse(listSchema, req.query);
    const documents = await Document.find({
      workspaceId: workspace._id,
      deletedAt: trash === '1' ? { $ne: null } : null,
    })
      .sort(trash === '1' ? { deletedAt: -1 } : { pinned: -1, lastEditedAt: -1 })
      .limit(500)
      .lean();
    res.json({ documents: await summarize(documents) });
  });

  router.post('/', async (req, res) => {
    const { workspace } = await authorizeWorkspace(req.auth.user, req.params.workspaceId, 'doc.create');
    const { title } = parse(createSchema, req.body);
    const document = await ctx.documentsService.create({ workspaceId: workspace._id, title, userId: req.auth.user._id });
    const [summary] = await summarize([document.toObject()]);
    res.status(201).json({ document: summary });
  });

  return router;
}

/** Routes under /api/documents/:documentId */
export function documentRoutes(ctx) {
  const { activity, collab } = ctx;
  const router = Router();
  router.use(requireAuth);

  router.get('/:documentId', async (req, res) => {
    const { document, role } = await authorizeDocument(req.auth.user, req.params.documentId, 'doc.read', { allowTrashed: true });
    const workspace = await Workspace.findById(document.workspaceId, { name: 1 }).lean();
    const [summary] = await summarize([document]);
    res.json({ document: summary, role, workspace: { id: String(workspace._id), name: workspace.name } });
  });

  router.patch('/:documentId', async (req, res) => {
    const input = parse(patchSchema, req.body);
    const permission = input.title !== undefined ? 'doc.edit' : 'doc.organize';
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, permission);
    const changes = {};
    if (input.title !== undefined && input.title !== document.title) {
      // The title is part of the collaborative content; change it there so every replica,
      // including offline ones, converges on it. Mongo's copy is derived from the content.
      await collab.applyServerChange(String(document._id), document.workspaceId, (ydoc) => writeTitle(ydoc, input.title), {
        userId: req.auth.user._id,
        reason: 'rename',
      });
      changes.title = input.title;
      await activity.record('document.renamed', {
        workspaceId: document.workspaceId,
        actorId: req.auth.user._id,
        documentId: document._id,
        data: { from: document.title, to: input.title },
      });
    }
    if (input.pinned !== undefined) changes.pinned = input.pinned;
    const updated = await Document.findByIdAndUpdate(document._id, changes, { new: true }).lean();
    const [summary] = await summarize([updated]);
    res.json({ document: summary });
  });

  router.post('/:documentId/trash', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'doc.trash');
    const updated = await Document.findByIdAndUpdate(
      document._id,
      { deletedAt: new Date(), deletedBy: req.auth.user._id },
      { new: true },
    ).lean();
    await collab.closeDocument(String(document._id), {
      code: CloseCode.DocumentGone,
      reason: 'document_trashed',
      message: 'This document was moved to the trash.',
    });
    await activity.record('document.trashed', {
      workspaceId: document.workspaceId,
      actorId: req.auth.user._id,
      documentId: document._id,
      data: { title: document.title },
    });
    const [summary] = await summarize([updated]);
    res.json({ document: summary });
  });

  router.post('/:documentId/untrash', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'doc.untrash', { allowTrashed: true });
    const updated = await Document.findByIdAndUpdate(document._id, { deletedAt: null, deletedBy: null }, { new: true }).lean();
    if (document.deletedAt) {
      await activity.record('document.untrashed', {
        workspaceId: document.workspaceId,
        actorId: req.auth.user._id,
        documentId: document._id,
        data: { title: document.title },
      });
    }
    const [summary] = await summarize([updated]);
    res.json({ document: summary });
  });

  router.delete('/:documentId', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'doc.purge', { allowTrashed: true });
    if (!document.deletedAt) {
      throw conflict('not_in_trash', 'Move the document to the trash before deleting it permanently.');
    }
    await ctx.documentsService.purge([document._id]);
    await activity.record('document.purged', {
      workspaceId: document.workspaceId,
      actorId: req.auth.user._id,
      data: { title: document.title },
    });
    res.status(204).end();
  });

  return router;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippetAround(text, query) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + query.length + 90);
  const slice = text.slice(start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}

/** /api/search — documents in every workspace the user belongs to (and only those). */
export function searchRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { q, workspaceId } = parse(searchSchema, req.query);
    let workspaceIds = await userWorkspaceIds(req.auth.user._id);
    if (workspaceId) workspaceIds = workspaceIds.filter((id) => String(id) === workspaceId.toLowerCase());
    if (workspaceIds.length === 0) return res.json({ results: [] });
    const pattern = new RegExp(escapeRegExp(q), 'i');
    const documents = await Document.find(
      { workspaceId: { $in: workspaceIds }, deletedAt: null, $or: [{ title: pattern }, { contentText: pattern }] },
      { title: 1, workspaceId: 1, excerpt: 1, contentText: 1, lastEditedAt: 1 },
    )
      .sort({ lastEditedAt: -1 })
      .limit(25)
      .lean();
    const workspaces = await Workspace.find({ _id: { $in: workspaceIds } }, { name: 1 }).lean();
    const workspaceName = new Map(workspaces.map((workspace) => [String(workspace._id), workspace.name]));
    const results = documents
      .map((document) => {
        const inTitle = pattern.test(document.title);
        return {
          id: String(document._id),
          workspaceId: String(document.workspaceId),
          workspaceName: workspaceName.get(String(document.workspaceId)) ?? '',
          title: document.title,
          snippet: snippetAround(document.contentText ?? '', q) ?? document.excerpt,
          matchedIn: inTitle ? 'title' : 'content',
          lastEditedAt: document.lastEditedAt,
        };
      })
      .sort((a, b) => (a.matchedIn === b.matchedIn ? 0 : a.matchedIn === 'title' ? -1 : 1));
    res.json({ results });
  });

  return router;
}
