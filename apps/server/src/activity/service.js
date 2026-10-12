import { Activity } from './model.js';

const EDIT_SESSION_MS = 30 * 60_000;

/**
 * Records an activity entry. Activity is supplementary: a failure is logged and never fails
 * the action that produced it.
 */
export function createActivityRecorder(logger) {
  async function record(type, { workspaceId, actorId, documentId, data }) {
    try {
      await Activity.create({ type, workspaceId, actorId, documentId, data });
    } catch (error) {
      logger.warn({ err: { message: error.message }, type }, 'Could not record activity');
    }
  }

  /** Collapses continuous editing into one "edited" entry per person, per document, per half hour. */
  async function recordEdit({ workspaceId, actorId, documentId }) {
    try {
      const since = new Date(Date.now() - EDIT_SESSION_MS);
      const recent = await Activity.findOneAndUpdate(
        { workspaceId, actorId, documentId, type: 'document.edited', createdAt: { $gte: since } },
        { $set: { 'data.lastAt': new Date() } },
      ).lean();
      if (!recent) await Activity.create({ type: 'document.edited', workspaceId, actorId, documentId, data: { lastAt: new Date() } });
    } catch (error) {
      logger.warn({ err: { message: error.message } }, 'Could not record edit activity');
    }
  }

  return { record, recordEdit };
}
