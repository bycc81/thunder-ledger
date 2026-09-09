<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type Batch, type BatchMember, type WorkspaceRole } from '../stores/workspace';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';
import { formatDateTime } from '../utils/dateTime';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const auth = useAuthStore();
const store = useWorkspaceStore();
const search = ref('');
const status = ref<'all' | 'open' | 'closed'>('all');
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const showCreate = ref(false);
const batchName = ref('');
const deletingId = ref('');
const pendingDelete = ref<Batch | null>(null);
const showDeleteConfirm = ref(false);

const roleText = (role: WorkspaceRole | BatchMember['role']) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = formatDateTime;
const filteredBatches = computed(() => store.batches.filter((batch) => {
  const keyword = search.value.trim().toLowerCase();
  return (!keyword || batch.name.toLowerCase().includes(keyword)) && (status.value === 'all' || batch.status === status.value);
}));

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function createBatch() {
  if (!batchName.value.trim() || !store.selectedWorkspaceId) return;
  try {
    await api.post('/batches', { workspaceId: store.selectedWorkspaceId, name: batchName.value.trim() });
    batchName.value = '';
    showCreate.value = false;
    await store.loadScoped();
    showSuccessToast('批次已创建');
  } catch { showFailToast('批次创建失败'); }
}
function requestDelete(batch: Batch) { pendingDelete.value = batch; showDeleteConfirm.value = true; }
async function deleteBatch() {
  const batch = pendingDelete.value;
  if (!batch) return;
  deletingId.value = batch.id;
  try {
    await api.delete(`/batches/${batch.id}`);
    await store.loadScoped();
    showDeleteConfirm.value = false;
    pendingDelete.value = null;
    showSuccessToast('批次已删除');
  } catch { showFailToast('批次删除失败'); }
  finally { deletingId.value = ''; }
}
onMounted(() => { if (!store.workspaces.length) void store.load(); });
</script>

<template>
  <MobileShell page="batches" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="batches-page" data-ai-id="batches-page">
      <header class="page-heading" data-ai-id="batch-list-header">
        <div><span class="eyebrow">当前工作区</span><h1>批次</h1></div>
        <van-button v-if="store.canCreateBatch" type="primary" data-ai-id="batch-create" @click="showCreate = true">新建批次</van-button>
      </header>
      <div class="filters" data-ai-id="batch-filters">
        <van-search v-model="search" shape="round" placeholder="搜索批次" data-ai-id="batch-search" />
        <van-dropdown-menu data-ai-id="batch-status-filter"><van-dropdown-item v-model="status" :options="[{ text: '全部', value: 'all' }, { text: '开放', value: 'open' }, { text: '已关闭', value: 'closed' }]" /></van-dropdown-menu>
      </div>
      <van-empty v-if="!filteredBatches.length" description="暂无批次" data-ai-id="batch-empty">
        <van-button v-if="store.canCreateBatch" type="primary" size="small" data-ai-id="batch-empty-create" @click="showCreate = true">新建批次</van-button>
      </van-empty>
      <div v-else class="batch-list" data-ai-id="batch-list">
        <article v-for="batch in filteredBatches" :key="batch.id" class="batch-item" :data-ai-id="`batch-item-${batch.id}`" tabindex="0" @click="router.push(`/batches/${batch.id}`)" @keydown.enter="router.push(`/batches/${batch.id}`)">
          <div class="batch-main"><span class="batch-title">{{ batch.name }}</span><span class="batch-meta">创建于 {{ formatDate(batch.created_at) }} · {{ roleText(batch.role) }}</span></div>
          <div class="batch-side"><van-tag :type="batch.status === 'open' ? 'success' : 'default'">{{ batch.status === 'open' ? '开放' : '已关闭' }}</van-tag><van-popover v-if="batch.role === 'owner' || store.canManageWorkspace" placement="left-start" :actions="[{ text: '删除批次', danger: true }]" @select="requestDelete(batch)"><van-button class="more-button" icon="ellipsis" plain type="default" :loading="deletingId === batch.id" :data-ai-id="`batch-more-${batch.id}`" @click.stop /></van-popover><van-icon name="arrow" class="batch-arrow" /></div>
        </article>
      </div>
    </section>
  </MobileShell>

  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" />
  <van-dialog v-model:show="showCreate" title="新建批次" show-cancel-button data-ai-id="batch-create-dialog" @confirm="createBatch">
    <van-field v-model="batchName" label="名称" placeholder="批次名称" data-ai-id="batch-create-name" />
  </van-dialog>
  <DangerConfirmDialog v-model:show="showDeleteConfirm" title="删除批次" :message="pendingDelete ? `删除“${pendingDelete.name}”后将不再显示，确认继续？` : ''" confirm-text="删除" ai-id="batch-delete-confirm" :loading="Boolean(deletingId)" @confirm="deleteBatch" />
</template>

<style scoped>
.batches-page { padding-bottom: 8px; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:18px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.page-heading :deep(.van-button) { min-height:38px; padding:0 11px; font-size:14px; }
.filters { display:flex; align-items:center; gap:8px; margin:0 -4px 14px; }
.filters :deep(.van-search) { flex:1; padding:0; }
.filters :deep(.van-search__content) { min-height:40px; border:1px solid #d8dde8; border-radius:10px; background:#fff; }
.filters :deep(.van-dropdown-menu) { flex:0 0 88px; }
.filters :deep(.van-dropdown-menu__bar) { height:40px !important; min-height:40px; border:1px solid #d8dde8; border-radius:10px; background:#fff; box-shadow:none; }
.filters :deep(.van-dropdown-menu__title) { padding:0 8px; font-size:13px; }
.batch-list { display:grid; gap:8px; }
.batch-item { position:relative; display:flex; align-items:flex-start; justify-content:space-between; min-height:76px; padding:14px 42px 12px 12px; border:0; border-radius:10px; background:#fff; color:#172033; text-align:left; box-shadow:0 1px 0 #e4e8f0; cursor:pointer; }
.batch-item:active,.batch-item:focus-visible { background:#edf1ff; outline:2px solid #3657c8; outline-offset:1px; }
.batch-main { min-width:0; padding-top:1px; }
.batch-title { display:block; overflow:hidden; max-width:100%; margin-bottom:6px; color:#172033; font-size:15px; font-weight:700; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
.batch-meta { color:#8993a7; font-size:12px; line-height:1.35; }
.batch-side { position:absolute; top:12px; right:10px; display:flex; align-items:center; gap:4px; }
.batch-side :deep(.van-tag) { min-height:22px; padding:2px 6px; font-size:11px; }
.more-button { width:30px; height:30px; padding:0; color:#8993a7; }
.more-button :deep(.van-icon) { font-size:18px; }
.batch-arrow { position:absolute; top:40px; right:12px; color:#8993a7; font-size:16px; }
</style>
