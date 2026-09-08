<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast } from 'vant';
import { useRouter } from 'vue-router';
import MobileShell from '../layouts/MobileShell.vue';
import { useWorkspaceStore, type Audit, type WorkspaceRole } from '../stores/workspace';
import { formatDateTime } from '../utils/dateTime';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const refreshing = ref(false);
const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const actionText = (action: string) => ({
  'workspace.create': '创建工作区',
  'batch.create': '创建批次',
  'batch.update': '修改批次信息',
  'batch.delete': '删除批次',
  'batch.close': '关闭批次',
  'batch.member.add': '添加批次参与人',
  'batch.member.role.update': '调整批次成员角色',
  'batch.member.remove': '移除批次参与人',
  'inventory.purchase.create': '新增采购',
  'inventory.purchase.update': '修改采购',
  'inventory.adjustment.create': '减少库存',
  'invitation.create': '邀请成员',
  'member.role.update': '调整成员角色',
  'member.remove': '移除成员',
  register: '注册账号',
}[action] ?? action);
const entityText = (record: Audit) => ({ batch: '批次', batch_member: '批次成员', workspace_member: '工作区成员', invitation: '邀请' }[record.entity_type] ?? record.entity_type);
const formatDate = formatDateTime;
const canView = computed(() => store.canManageWorkspace);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function selectWorkspace(id: string) { showWorkspace.value = false; await store.select(id); }
async function refresh() {
  if (refreshing.value || !canView.value) return;
  refreshing.value = true;
  try { await store.loadScoped(); }
  catch { showFailToast('操作记录刷新失败'); }
  finally { refreshing.value = false; }
}
onMounted(() => { if (!store.workspaces.length) void store.load(); });
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="records-page" data-ai-id="operation-record-page">
      <header class="page-heading" data-ai-id="operation-record-header"><div><span class="eyebrow">当前工作区</span><h1>操作记录</h1></div><van-button v-if="canView" class="refresh-button" plain icon="replay" :loading="refreshing" data-ai-id="operation-record-refresh" @click="refresh">刷新</van-button></header>
      <p v-if="!canView" class="permission-notice" data-ai-id="operation-record-permission">当前角色：{{ roleText(store.selectedWorkspace?.role ?? 'viewer') }}，无权查看操作记录。</p>
      <van-empty v-else-if="!store.audits.length" description="暂无操作记录" data-ai-id="operation-record-empty" />
      <div v-else class="record-list" data-ai-id="operation-record-list">
        <article v-for="record in store.audits" :key="record.id" class="record-item" :data-ai-id="`operation-record-${record.id}`">
          <div class="record-main"><strong>{{ actionText(record.action) }}</strong><span>{{ entityText(record) }}<template v-if="record.entity_id"> · {{ record.entity_id }}</template></span></div>
          <div class="record-meta"><span>{{ record.actor_username || '--' }}</span><time>{{ formatDate(record.created_at) }}</time></div>
        </article>
      </div>
    </section>
  </MobileShell>

  <van-popup v-model:show="showWorkspace" position="bottom" round data-ai-id="workspace-picker"><van-cell title="切换工作区" /><van-cell v-for="workspace in store.workspaces" :key="workspace.id" :title="workspace.name" :label="roleText(workspace.role)" is-link :data-ai-id="`workspace-option-${workspace.id}`" @click="selectWorkspace(workspace.id)" /></van-popup>
</template>

<style scoped>
.records-page { width:100%; max-width:100%; min-width:0; overflow-x:hidden; padding-bottom:8px; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:14px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.refresh-button { min-height:38px; padding:0 10px; color:#3657c8; font-size:13px; }
.permission-notice { margin:0 0 14px; padding:10px 12px; border-radius:8px; background:#f1f3f6; color:#68717d; font-size:12px; line-height:1.5; }
.record-list { display:grid; width:100%; max-width:100%; min-width:0; gap:8px; }
.record-item { display:flex; width:100%; max-width:100%; min-width:0; align-items:flex-start; justify-content:space-between; gap:10px; min-height:76px; padding:14px 12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.record-main { min-width:0; max-width:calc(100% - 92px); overflow:hidden; }
.record-main strong { display:block; overflow:hidden; margin-bottom:6px; color:#172033; font-size:15px; text-overflow:ellipsis; white-space:nowrap; }
.record-main span { display:block; max-width:100%; overflow:hidden; color:#8993a7; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.record-meta { display:flex; width:82px; max-width:82px; flex-shrink:0; flex-direction:column; align-items:flex-end; gap:6px; overflow:hidden; color:#8993a7; font-size:11px; }
.record-meta time { white-space:nowrap; }
</style>
