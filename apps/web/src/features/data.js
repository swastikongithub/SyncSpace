// Data hooks for server resources. Lists that are useful offline (workspaces, documents) are
// saved to this user's IndexedDB catalog on every successful fetch and served from it when the
// server cannot be reached, with `source: 'device'` so the UI can say the list may be stale.
//
// Every hook waits until local data is ready (the database is open, or known to be unavailable)
// before its first load; otherwise an offline start would fail before the fallback exists.
import { useLocalData } from '../app/local-data.jsx';
import { api } from '../lib/api.js';
import { useResource } from '../lib/resource.js';

function catalogOptions(store, catalogKey) {
  if (!store) return {};
  return {
    onData: (data) => void store.putCatalog(catalogKey, data).catch(() => {}),
    fallback: async () => {
      const entry = await store.getCatalogEntry(catalogKey);
      return entry ? { data: entry.value, savedAt: entry.savedAt } : null;
    },
  };
}

export function useWorkspaces() {
  const { store, ready } = useLocalData();
  return useResource(ready ? 'workspaces' : null, () => api.get('/workspaces').then((body) => body.workspaces), catalogOptions(store, 'workspaces'));
}

export function useWorkspace(workspaceId) {
  const { store, ready } = useLocalData();
  return useResource(
    ready && workspaceId ? `workspace:${workspaceId}` : null,
    () => api.get(`/workspaces/${workspaceId}`).then((body) => body.workspace),
    store
      ? {
          onData: (workspace) => void store.putCatalog(`workspace:${workspaceId}`, workspace).catch(() => {}),
          fallback: async () => {
            const own = await store.getCatalogEntry(`workspace:${workspaceId}`);
            if (own) return { data: own.value, savedAt: own.savedAt };
            const list = await store.getCatalogEntry('workspaces');
            const found = list?.value?.find((workspace) => workspace.id === workspaceId);
            return found ? { data: found, savedAt: list.savedAt } : null;
          },
        }
      : {},
  );
}

export function useDocuments(workspaceId, { trash = false } = {}) {
  const { store, ready } = useLocalData();
  const key = ready && workspaceId ? `docs:${workspaceId}${trash ? ':trash' : ''}` : null;
  return useResource(
    key,
    () => api.get(`/workspaces/${workspaceId}/documents${trash ? '?trash=1' : ''}`).then((body) => body.documents),
    trash ? {} : catalogOptions(store, `docs:${workspaceId}`),
  );
}

export function useDocumentMeta(docId) {
  const { store, ready } = useLocalData();
  return useResource(ready && docId ? `doc:${docId}` : null, () => api.get(`/documents/${docId}`), catalogOptions(store, `doc:${docId}`));
}

export function useMembers(workspaceId) {
  return useResource(workspaceId ? `members:${workspaceId}` : null, () =>
    api.get(`/workspaces/${workspaceId}/members`).then((body) => body.members),
  );
}

export function useInvitations(workspaceId, enabled) {
  return useResource(enabled && workspaceId ? `invitations:${workspaceId}` : null, () =>
    api.get(`/workspaces/${workspaceId}/invitations`).then((body) => body.invitations),
  );
}

export function useActivity(workspaceId) {
  return useResource(workspaceId ? `activity:${workspaceId}` : null, () =>
    api.get(`/workspaces/${workspaceId}/activity`).then((body) => body.activity),
  );
}

export function useVersions(docId, enabled = true) {
  return useResource(enabled && docId ? `versions:${docId}` : null, () =>
    api.get(`/documents/${docId}/versions`).then((body) => body.versions),
  );
}
