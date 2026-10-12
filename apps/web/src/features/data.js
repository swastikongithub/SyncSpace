// Data hooks for server resources. Lists that are useful offline (workspaces, documents) are
// saved to this user's IndexedDB catalog on every successful fetch and served from it when the
// server cannot be reached, with `source: 'device'` so the UI can say the list may be stale.
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
  const { store } = useLocalData();
  return useResource('workspaces', () => api.get('/workspaces').then((body) => body.workspaces), catalogOptions(store, 'workspaces'));
}

export function useWorkspace(workspaceId) {
  const { store } = useLocalData();
  return useResource(
    workspaceId ? `workspace:${workspaceId}` : null,
    () => api.get(`/workspaces/${workspaceId}`).then((body) => body.workspace),
    store
      ? {
          fallback: async () => {
            const entry = await store.getCatalogEntry('workspaces');
            const found = entry?.value?.find((workspace) => workspace.id === workspaceId);
            return found ? { data: found, savedAt: entry.savedAt } : null;
          },
        }
      : {},
  );
}

export function useDocuments(workspaceId, { trash = false } = {}) {
  const { store } = useLocalData();
  const key = workspaceId ? `docs:${workspaceId}${trash ? ':trash' : ''}` : null;
  return useResource(
    key,
    () => api.get(`/workspaces/${workspaceId}/documents${trash ? '?trash=1' : ''}`).then((body) => body.documents),
    trash ? {} : catalogOptions(store, `docs:${workspaceId}`),
  );
}

export function useDocumentMeta(docId) {
  const { store } = useLocalData();
  return useResource(
    docId ? `doc:${docId}` : null,
    () => api.get(`/documents/${docId}`),
    store
      ? {
          onData: (data) => void store.putCatalog(`doc:${docId}`, data).catch(() => {}),
          fallback: async () => {
            const entry = await store.getCatalogEntry(`doc:${docId}`);
            return entry ? { data: entry.value, savedAt: entry.savedAt } : null;
          },
        }
      : {},
  );
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
