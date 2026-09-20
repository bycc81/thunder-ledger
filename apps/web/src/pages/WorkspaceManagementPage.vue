<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';
import { useWorkspaceStore } from '../stores/workspace';

type WorkspaceManagement = { id: string; name: string; kind: 'personal' | 'collaborative'; isCreator: boolean; batchCount: number };
type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const management = ref<WorkspaceManagement | null>(null);
const name = ref('');
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const showLeaveConfirm = ref(false);
const showDeleteConfirm = ref(false);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
function apiMessage(requestError: unknown, fallback: string) { return (requestError as { response?: { data?: { message?: string } } }).response?.data?.message || fallback; }
async function load() {
  if (!store.workspaces.length) await store.load();
  const id = store.selectedWorkspaceId;
  if (!id) { void router.replace('/workspace'); return; }
  loading.value = true; error.value = '';
  try {
    const { data } = await api.get<WorkspaceManagement>(`/workspaces/${id}/management`);
    management.value = data;
    name.value = data.name;
  } catch (requestError: unknown) {
    error.value = apiMessage(requestError, '工作区信息加载失败');
  } finally { loading.value = false; }
}
async function saveName() {
  const workspace = management.value;
  if (!workspace || !workspace.isCreator || saving.value) return;
  const nextName = name.value.trim();
  if (!nextName) { showFailToast('请填写工作区名称'); return; }
  saving.value = true;
  try {
    await api.patch(`/workspaces/${workspace.id}`, { name: nextName });
    await store.load();
    management.value = { ...workspace, name: nextName };
    showSuccessToast('工作区名称已保存');
  } catch (requestError: unknown) { showFailToast(apiMessage(requestError, '工作区名称保存失败')); }
  finally { saving.value = false; }
}
async function leaveWorkspace() {
  const workspace = management.value;
  if (!workspace || saving.value) return;
  saving.value = true;
  try {
    await api.post(`/workspaces/${workspace.id}/leave`);
    showLeaveConfirm.value = false;
    await store.load();
    showSuccessToast('已退出工作区');
    await router.replace('/workspace');
  } catch (requestError: unknown) { showFailToast(apiMessage(requestError, '退出工作区失败')); }
  finally { saving.value = false; }
}
async function deleteWorkspace() {
  const workspace = management.value;
  if (!workspace || saving.value) return;
  saving.value = true;
  try {
    await api.delete(`/workspaces/${workspace.id}`);
    showDeleteConfirm.value = false;
    await store.load();
    showSuccessToast('工作区已删除');
    await router.replace('/workspace');
  } catch (requestError: unknown) { showFailToast(apiMessage(requestError, '工作区删除失败')); await load(); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="workspace-management-page" data-ai-id="workspace-management-page">
      <header class="page-heading"><button type="button" class="back-button" data-ai-id="workspace-management-back" @click="router.push('/workspace')"><van-icon name="arrow-left" /> 返回</button><h1>工作区管理</h1></header>
      <div v-if="loading" class="state-card" data-ai-id="workspace-management-loading"><van-loading>正在加载工作区…</van-loading></div>
      <van-empty v-else-if="error" :description="error" data-ai-id="workspace-management-error"><van-button type="primary" size="small" data-ai-id="workspace-management-retry" @click="load">重试</van-button></van-empty>
      <template v-else-if="management">
        <section class="management-section" data-ai-id="workspace-management-info"><h2>基本信息</h2><div class="management-list"><van-field v-model="name" label="工作区名称" :readonly="!management.isCreator" :disabled="saving" data-ai-id="workspace-management-name" /><div class="management-row"><span>我的身份</span><strong>{{ management.isCreator ? '创建人' : '成员' }}</strong></div></div><van-button v-if="management.isCreator" block plain type="primary" :loading="saving" data-ai-id="workspace-management-rename" @click="saveName">保存名称</van-button></section>
        <p v-if="management.isCreator && management.batchCount > 0" class="delete-blocked" data-ai-id="workspace-delete-blocked">已有 {{ management.batchCount }} 个批次，暂时不能删除此工作区。</p>
        <section class="management-action"><van-button v-if="management.isCreator" block plain type="danger" :disabled="management.batchCount > 0" data-ai-id="workspace-delete" @click="showDeleteConfirm = true">删除工作区</van-button><van-button v-else block plain type="danger" data-ai-id="workspace-leave" @click="showLeaveConfirm = true">退出工作区</van-button></section>
      </template>
    </section>
  </MobileShell>
  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" @selected="load" />
  <DangerConfirmDialog v-model:show="showLeaveConfirm" title="退出工作区" :message="management ? `退出“${management.name}”后，你将不能进入该工作区，也看不到其中的批次；历史记录不会删除。` : ''" confirm-text="确认退出" ai-id="workspace-leave-confirm" :loading="saving" @confirm="leaveWorkspace" />
  <DangerConfirmDialog v-model:show="showDeleteConfirm" title="删除工作区" :message="management ? `删除“${management.name}”后，该工作区将不再显示；历史记录不会删除。` : ''" confirm-text="确认删除" ai-id="workspace-delete-confirm" :loading="saving" @confirm="deleteWorkspace" />
</template>

<style scoped>
.workspace-management-page { padding-bottom:8px; }
.page-heading { display:flex; min-height:44px; align-items:center; gap:10px; margin-bottom:20px; }
.page-heading h1 { margin:0; color:#172033; font-size:24px; }
.back-button { display:flex; min-width:44px; min-height:44px; align-items:center; gap:3px; padding:0; border:0; background:transparent; color:#3657c8; font:inherit; font-size:13px; font-weight:700; }
.management-section { margin-bottom:22px; }
.management-section h2 { margin:0 0 10px; color:#172033; font-size:17px; }
.management-list { overflow:hidden; margin-bottom:10px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.management-row { display:flex; min-height:52px; align-items:center; justify-content:space-between; gap:12px; padding:8px 16px; border-top:1px solid #e4e8f0; }
.management-row span { color:#8993a7; font-size:12px; }.management-row strong { color:#172033; font-size:14px; }
.management-section :deep(.van-field__label) { color:#8993a7; font-size:12px; }.management-section :deep(.van-field__control) { color:#172033; font-size:14px; font-weight:700; text-align:right; }
.management-section :deep(.van-button),.management-action :deep(.van-button) { min-height:44px; background:#fff; }
.delete-blocked { margin:0 0 8px; padding:10px 12px; border-radius:9px; background:#f1f3f6; color:#68717d; font-size:12px; line-height:1.5; }
.management-action { margin-top:8px; }.management-action :deep(.van-button--disabled) { border-color:#e4e8f0; color:#b3bac7; opacity:1; }
.state-card { display:grid; min-height:180px; place-items:center; border-radius:10px; background:#fff; }
</style>
