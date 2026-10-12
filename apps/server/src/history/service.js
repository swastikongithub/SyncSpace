import * as Y from 'yjs';
import { readDocumentInfo } from '../collab/ydoc.js';
import { DocVersion } from './model.js';

/** Automatic versions kept per document; manual, restore and recovery versions are never pruned. */
export const AUTO_VERSIONS_KEPT = 50;

export function infoFromState(state) {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    return readDocumentInfo(ydoc);
  } finally {
    ydoc.destroy();
  }
}

export function createHistoryService() {
  async function saveVersion({ docId, workspaceId, state, info, kind, label = '', createdBy, contributors = [], restoredFrom }) {
    const details = info ?? infoFromState(state);
    const version = await DocVersion.create({
      docId,
      workspaceId,
      kind,
      label,
      state: Buffer.from(state.buffer, state.byteOffset, state.byteLength),
      sizeBytes: state.byteLength,
      title: details.title,
      excerpt: details.excerpt,
      wordCount: details.wordCount,
      createdBy,
      contributors,
      restoredFrom,
    });
    if (kind === 'auto') await prune(docId);
    return version;
  }

  async function prune(docId) {
    const stale = await DocVersion.find({ docId, kind: 'auto' }, { _id: 1 })
      .sort({ createdAt: -1 })
      .skip(AUTO_VERSIONS_KEPT)
      .lean();
    if (stale.length > 0) await DocVersion.deleteMany({ _id: { $in: stale.map((version) => version._id) } });
  }

  /** Room hook: snapshot the room's current in-memory (and stored) state. */
  function createVersionForRoom(room, { kind, label, createdBy, restoredFrom }) {
    return saveVersion({
      docId: room.docId,
      workspaceId: room.workspaceId,
      state: Y.encodeStateAsUpdate(room.ydoc),
      info: readDocumentInfo(room.ydoc),
      kind,
      label,
      createdBy: createdBy ?? room.lastEditorId ?? undefined,
      contributors: [...room.contributors],
      restoredFrom,
    });
  }

  return { saveVersion, createVersionForRoom };
}

export function versionSummary(version, people = new Map()) {
  return {
    id: String(version._id),
    kind: version.kind,
    label: version.label,
    title: version.title,
    excerpt: version.excerpt,
    wordCount: version.wordCount,
    sizeBytes: version.sizeBytes,
    createdAt: version.createdAt,
    createdBy: version.createdBy ? (people.get(String(version.createdBy)) ?? null) : null,
    contributors: (version.contributors ?? []).map((id) => people.get(String(id))).filter(Boolean),
    restoredFrom: version.restoredFrom ? String(version.restoredFrom) : null,
  };
}
