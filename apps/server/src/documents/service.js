import { LIMITS } from '@syncspace/shared';
import { CloseCode } from '@syncspace/shared/protocol';
import { createInitialState, readDocumentInfo } from '../collab/ydoc.js';
import { DocVersion } from '../history/model.js';
import { Document } from './model.js';

export function createDocumentsService({ store, activity, getCollab }) {
  async function create({ workspaceId, title = '', userId }) {
    const cleanTitle = title.trim().slice(0, LIMITS.documentTitleMax);
    const document = await Document.create({
      workspaceId,
      title: cleanTitle,
      createdBy: userId,
      lastEditedBy: userId,
      lastEditedAt: new Date(),
    });
    try {
      await store.initialize(document._id, createInitialState(cleanTitle), userId);
    } catch (error) {
      await Document.deleteOne({ _id: document._id });
      throw error;
    }
    await activity.record('document.created', {
      workspaceId,
      actorId: userId,
      documentId: document._id,
      data: { title: cleanTitle },
    });
    return document;
  }

  /** Room hook: refresh the metadata derived from content (title, excerpt, search text). */
  async function onContentChanged(room, editors) {
    if (room.closed) return;
    const info = readDocumentInfo(room.ydoc);
    const update = {
      title: info.title.slice(0, LIMITS.documentTitleMax),
      excerpt: info.excerpt,
      contentText: info.text,
      wordCount: info.wordCount,
      lastEditedAt: new Date(),
    };
    if (room.lastEditorId) update.lastEditedBy = room.lastEditorId;
    await Document.updateOne({ _id: room.docId }, update);
    for (const actorId of editors) {
      await activity.recordEdit({ workspaceId: room.workspaceId, actorId, documentId: room.docId });
    }
  }

  /** Permanently removes documents and everything stored for them. */
  async function purge(docIds) {
    if (docIds.length === 0) return;
    const collab = getCollab();
    await Promise.all(
      docIds.map((docId) =>
        collab.closeDocument(String(docId), {
          code: CloseCode.DocumentGone,
          reason: 'document_deleted',
          message: 'This document was permanently deleted.',
          discard: true,
        }),
      ),
    );
    await Promise.all([store.purge(docIds), DocVersion.deleteMany({ docId: { $in: docIds } })]);
    await Document.deleteMany({ _id: { $in: docIds } });
  }

  return { create, onContentChanged, purge };
}
