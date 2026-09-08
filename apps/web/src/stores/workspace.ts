import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type BatchRole = 'owner' | 'editor' | 'viewer';
export type Workspace = { id: string; name: string; kind: 'personal' | 'collaborative'; role: WorkspaceRole };
export type Member = { id: string; username: string; role: WorkspaceRole; invited_at: string | null };
export type Batch = { id: string; workspace_id: string; name: string; status: 'open' | 'closed'; role: BatchRole; created_at: string };
export type BatchMember = { id: string; username: string; role: BatchRole; created_at: string };
export type Audit = { id: string; action: string; entity_type: string; entity_id: string | null; actor_username?: string | null; created_at: string };

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([]);
  const selectedWorkspaceId = ref('');
  const members = ref<Member[]>([]);
  const batches = ref<Batch[]>([]);
  const audits = ref<Audit[]>([]);
  const loading = ref(false);
  const error = ref('');
  const selectedWorkspace = computed(() => workspaces.value.find((w) => w.id === selectedWorkspaceId.value));
  const canManageWorkspace = computed(() => ['owner', 'admin'].includes(selectedWorkspace.value?.role ?? ''));
  const canCreateBatch = computed(() => ['owner', 'admin', 'editor'].includes(selectedWorkspace.value?.role ?? ''));
  const canEditProducts = computed(() => ['owner', 'admin', 'editor'].includes(selectedWorkspace.value?.role ?? ''));

  async function load() {
    loading.value = true; error.value = '';
    try {
      const { data } = await api.get<Workspace[]>('/workspaces');
      workspaces.value = data;
      if (!data.some((w) => w.id === selectedWorkspaceId.value)) selectedWorkspaceId.value = data[0]?.id ?? '';
      await loadScoped();
    } catch { error.value = '工作区加载失败，请重试'; }
    finally { loading.value = false; }
  }
  async function loadScoped() {
    if (!selectedWorkspaceId.value) return;
    const id = selectedWorkspaceId.value;
    try {
      const requests: Promise<unknown>[] = [api.get<Member[]>(`/workspaces/${id}/members`), api.get<Batch[]>('/batches', { params: { workspaceId: id } })];
      if (canManageWorkspace.value) requests.push(api.get<Audit[]>('/audit', { params: { workspaceId: id } }));
      const [memberResponse, batchResponse, auditResponse] = await Promise.all(requests);
      members.value = (memberResponse as { data: Member[] }).data;
      batches.value = (batchResponse as { data: Batch[] }).data.filter((b) => b.workspace_id === id);
      audits.value = auditResponse ? (auditResponse as { data: Audit[] }).data : [];
    } catch { error.value = '工作区数据加载失败，请重试'; }
  }
  async function select(id: string) { selectedWorkspaceId.value = id; await loadScoped(); }
  function clear() { workspaces.value = []; selectedWorkspaceId.value = ''; members.value = []; batches.value = []; audits.value = []; }
  return { workspaces, selectedWorkspaceId, members, batches, audits, loading, error, selectedWorkspace, canManageWorkspace, canCreateBatch, canEditProducts, load, loadScoped, select, clear };
});
