import express, { Router } from 'express';
import * as Y from 'yjs';
import { z } from 'zod';
import { LIMITS } from '@syncspace/shared';
import { requireAuth } from '../auth/middleware.js';
import { ServerChange } from '../collab/room.js';
import { toBytes } from '../collab/store.js';
import { readDocumentInfo, replaceContent } from '../collab/ydoc.js';
import { badRequest, notFound } from '../http/errors.js';
import { idParam, parse } from '../http/validate.js';
import { peopleById } from '../users/lookup.js';
import { authorizeDocument } from '../workspaces/access.js';
import { DocVersion } from './model.js';
import { versionSummary } from './service.js';

const labelSchema = z.object({ label: z.string().trim().max(LIMITS.versionLabelMax).optional().default('') });

const versionNotFound = () => notFound('version_not_found', 'That version does not exist.');

async function findVersion(document, versionId, { withState = false } = {}) {
  const id = idParam(versionId, 'version_not_found', 'That version does not exist.');
  const query = DocVersion.findOne({ _id: id, docId: document._id });
  if (withState) query.select('+state');
  const version = await query.lean();
  if (!version) throw versionNotFound();
  return version;
}

async function summarize(versions) {
  const people = await peopleById(versions.flatMap((version) => [version.createdBy, ...(version.contributors ?? [])]));
  return versions.map((version) => versionSummary(version, people));
}

/** Routes under /api/documents/:documentId/versions */
export function historyRoutes(ctx) {
  const { collab, history, activity } = ctx;
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'history.read');
    const versions = await DocVersion.find({ docId: document._id }).sort({ createdAt: -1 }).limit(150).lean();
    res.json({ versions: await summarize(versions) });
  });

  router.get('/:versionId/content', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'history.read');
    const version = await findVersion(document, req.params.versionId, { withState: true });
    res.type('application/octet-stream').set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(Buffer.from(toBytes(version.state)));
  });

  router.post('/', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'history.snapshot');
    const { label } = parse(labelSchema, req.body);
    const version = await collab.withRoom(String(document._id), document.workspaceId, (room) =>
      room.runTask(() => room.snapshotVersion({ kind: 'manual', label, createdBy: req.auth.user._id })),
    );
    await activity.record('version.saved', {
      workspaceId: document.workspaceId,
      actorId: req.auth.user._id,
      documentId: document._id,
      data: { label, versionId: String(version._id) },
    });
    const [summary] = await summarize([version.toObject()]);
    res.status(201).json({ version: summary });
  });

  router.post('/:versionId/restore', async (req, res) => {
    const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'history.restore');
    const target = await findVersion(document, req.params.versionId, { withState: true });
    const source = new Y.Doc();
    Y.applyUpdate(source, toBytes(target.state));
    const actorId = req.auth.user._id;
    const label = target.label || new Date(target.createdAt).toISOString();

    const { preRestore, restored } = await collab.withRoom(String(document._id), document.workspaceId, async (room) => {
      // Capture the current state and apply the restore in one synchronous step, so no edit can
      // land between the safety copy and the change it protects against.
      const beforeState = Y.encodeStateAsUpdate(room.ydoc);
      const beforeInfo = readDocumentInfo(room.ydoc);
      room.ydoc.transact(() => replaceContent(room.ydoc, source), new ServerChange({ userId: actorId, reason: 'restore' }));
      const changesAtRestore = room.changeCount;
      const afterState = Y.encodeStateAsUpdate(room.ydoc);
      await room.barrier();

      const savedBefore = await history.saveVersion({
        docId: document._id,
        workspaceId: document.workspaceId,
        state: beforeState,
        info: beforeInfo,
        kind: 'pre-restore',
        label: `Before restoring ${label}`.slice(0, LIMITS.versionLabelMax),
        createdBy: actorId,
        contributors: [...room.contributors],
      });
      const savedRestore = await history.saveVersion({
        docId: document._id,
        workspaceId: document.workspaceId,
        state: afterState,
        kind: 'restore',
        label: `Restored ${label}`.slice(0, LIMITS.versionLabelMax),
        createdBy: actorId,
        restoredFrom: target._id,
      });
      if (room.changeCount === changesAtRestore) {
        room.changedSinceVersion = false;
        room.contributors.clear();
      }
      return { preRestore: savedBefore, restored: savedRestore };
    });
    source.destroy();

    const people = await peopleById([actorId]);
    collab.broadcastControl(String(document._id), {
      kind: 'restored',
      by: people.get(String(actorId)) ?? null,
      versionId: String(target._id),
      versionCreatedAt: target.createdAt,
      preRestoreVersionId: String(preRestore._id),
    });
    await activity.record('version.restored', {
      workspaceId: document.workspaceId,
      actorId,
      documentId: document._id,
      data: { versionId: String(target._id), versionCreatedAt: target.createdAt, preRestoreVersionId: String(preRestore._id) },
    });
    const [preSummary, restoredSummary] = await summarize([preRestore.toObject(), restored.toObject()]);
    res.json({ preRestore: preSummary, restored: restoredSummary });
  });

  // A client that finds its unsynced offline edits were removed by a collaborator's deletion
  // uploads its pre-merge state here, so the work is recoverable by anyone in the workspace.
  router.post(
    '/recovered',
    express.raw({ type: 'application/octet-stream', limit: LIMITS.recoveredStateMaxBytes }),
    async (req, res) => {
      const { document } = await authorizeDocument(req.auth.user, req.params.documentId, 'doc.edit');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('missing_state', 'Send the document state as application/octet-stream.');
      const state = new Uint8Array(req.body);
      let info;
      try {
        const probe = new Y.Doc();
        Y.applyUpdate(probe, state);
        info = readDocumentInfo(probe);
        probe.destroy();
      } catch {
        throw badRequest('invalid_state', 'The uploaded data is not a valid document state.');
      }
      const version = await history.saveVersion({
        docId: document._id,
        workspaceId: document.workspaceId,
        state,
        info,
        kind: 'recovered',
        label: String(req.get('x-syncspace-label') ?? 'Offline copy before merge').slice(0, LIMITS.versionLabelMax),
        createdBy: req.auth.user._id,
      });
      await activity.record('version.recovered', {
        workspaceId: document.workspaceId,
        actorId: req.auth.user._id,
        documentId: document._id,
        data: { versionId: String(version._id) },
      });
      const [summary] = await summarize([version.toObject()]);
      res.status(201).json({ version: summary });
    },
  );

  return router;
}
