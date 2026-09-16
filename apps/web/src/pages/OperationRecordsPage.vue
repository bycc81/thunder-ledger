<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast } from 'vant';
import { useRouter } from 'vue-router';
import MobileShell from '../layouts/MobileShell.vue';
import { api, type AuditResponse } from '../api';
import { useWorkspaceStore, type Audit, type WorkspaceRole } from '../stores/workspace';
import { formatDateTime } from '../utils/dateTime';
import WorkspacePicker from '../components/WorkspacePicker.vue';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const refreshing = ref(false);
const action = ref('');
const actorUserId = ref('');
const from = ref('');
const to = ref('');
const page = ref(1);
const total = ref(0);
const audits = ref<Audit[]>([]);
const error = ref('');
const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const actionText = (action: string) => ({
  'workspace.create': '创建工作区',
  'workspace.update': '修改工作区名称',
  'workspace.leave': '退出工作区',
  'workspace.delete': '删除工作区',
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
  'sale.create': '新增销售',
  'sale.reverse': '撤销销售',
  'expense.create': '新增费用',
  'expense.reverse': '撤销费用',
  'settlement.confirm': '确认结算',
  'settlement.adjustment.confirm': '确认结算调整',
  'report.export': '导出报表',
  'report.export.failed': '报表导出失败',
  'invitation.create': '邀请成员',
  'member.role.update': '调整成员角色',
  'member.remove': '移除成员',
  register: '注册账号',
}[action] ?? action);
const entityText = (record: Audit) => ({ batch: '批次', batch_member: '批次成员', workspace_member: '工作区成员', invitation: '邀请' }[record.entity_type] ?? record.entity_type);
const formatDate = formatDateTime;
const canView = computed(() => store.canManageWorkspace);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function handleWorkspaceSelected() {
  page.value = 1;
  total.value = 0;
  audits.value = [];
  error.value = '';
  if (canView.value) await refresh();
}
async function refresh() {
  if (refreshing.value || !canView.value) return;
  refreshing.value = true;
  error.value = '';
  try {
    const response = await api.get<AuditResponse>('/audit', { params: { workspaceId: store.selectedWorkspaceId, action: action.value || undefined, actorUserId: actorUserId.value || undefined, from: from.value || undefined, to: to.value || undefined, page: page.value, pageSize: 50 } });
    audits.value = response.data.items;
    total.value = response.data.total;
  }
  catch { error.value = '操作记录刷新失败，请重试'; showFailToast(error.value); }
  finally { refreshing.value = false; }
}
onMounted(async () => { if (!store.workspaces.length) await store.load(); if (canView.value) await refresh(); });
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="records-page" data-ai-id="operation-record-page">
      <header class="page-heading" data-ai-id="operation-record-header"><div><span class="eyebrow">当前工作区</span><h1>操作记录</h1></div><van-button v-if="canView" class="refresh-button" plain icon="replay" :loading="refreshing" data-ai-id="operation-record-refresh" @click="refresh">刷新</van-button></header>
      <p v-if="!canView" class="permission-notice" data-ai-id="operation-record-permission">当前角色：{{ roleText(store.selectedWorkspace?.role ?? 'viewer') }}，无权查看操作记录。</p>
      <section v-else class="record-filter" data-ai-id="operation-record-filter">
        <van-dropdown-menu>
          <van-dropdown-item v-model="action" :options="[{ text: '全部动作', value: '' }, { text: '新增销售', value: 'sale.create' }, { text: '新增采购', value: 'inventory.purchase.create' }, { text: '确认结算', value: 'settlement.confirm' }, { text: '导出报表', value: 'report.export' }]" data-ai-id="operation-record-action" />
          <van-dropdown-item v-model="actorUserId" :options="[{ text: '全部操作者', value: '' }, ...store.members.map((member) => ({ text: member.username, value: member.id }))]" data-ai-id="operation-record-actor" />
        </van-dropdown-menu>
        <div class="record-date-range" data-ai-id="operation-record-date-range"><input v-model="from" type="date" aria-label="开始日期"><span>至</span><input v-model="to" type="date" aria-label="结束日期"></div>
        <van-button type="primary" block :loading="refreshing" data-ai-id="operation-record-query" @click="page = 1; refresh()">查询</van-button>
      </section>
      <template v-if="canView">
        <div v-if="refreshing && !audits.length" class="page-state" data-ai-id="operation-record-loading"><van-loading>正在加载操作记录</van-loading></div>
        <van-empty v-else-if="error" :description="error" data-ai-id="operation-record-error"><van-button type="primary" size="small" @click="refresh">重试</van-button></van-empty>
        <van-empty v-else-if="!audits.length" description="暂无操作记录" data-ai-id="operation-record-empty" />
        <div v-else class="record-list" data-ai-id="operation-record-list">
          <article v-for="record in audits" :key="record.id" class="record-item" :data-ai-id="`operation-record-${record.id}`">
            <div class="record-main"><strong>{{ actionText(record.action) }}</strong><span>{{ entityText(record) }}<template v-if="record.entity_id"> · {{ record.entity_id }}</template></span></div>
            <div class="record-meta"><span>{{ record.actor_username || '--' }}</span><time>{{ formatDate(record.created_at) }}</time></div>
          </article>
        </div>
      </template>
      <div v-if="canView && total > 50" class="record-pagination"><van-button plain size="small" :disabled="page <= 1 || refreshing" @click="page -= 1; refresh()">上一页</van-button><span>第 {{ page }} 页</span><van-button plain size="small" :disabled="page * 50 >= total || refreshing" @click="page += 1; refresh()">下一页</van-button></div>
    </section>
  </MobileShell>

  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" @selected="handleWorkspaceSelected" />
</template>

<style scoped>
.records-page { width:100%; max-width:100%; min-width:0; overflow-x:hidden; padding-bottom:8px; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:14px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.refresh-button { min-height:38px; padding:0 10px; color:#3657c8; font-size:13px; }
.permission-notice { margin:0 0 14px; padding:10px 12px; border-radius:8px; background:#f1f3f6; color:#68717d; font-size:12px; line-height:1.5; }
.record-list { display:grid; width:100%; max-width:100%; min-width:0; gap:8px; }
.record-filter { display:grid; gap:10px; margin-bottom:14px; }.record-filter :deep(.van-dropdown-menu__bar) { height:44px; border:1px solid #d8dde8; border-radius:10px; box-shadow:none; }.record-date-range { display:flex; align-items:center; gap:8px; color:#71809a; font-size:13px; }.record-date-range input { width:100%; min-width:0; min-height:44px; padding:0 9px; border:1px solid #d8dde8; border-radius:8px; background:#fff; color:#172033; }.record-filter :deep(.van-button) { min-height:44px; }.record-pagination { display:flex; align-items:center; justify-content:center; gap:10px; margin-top:14px; color:#71809a; font-size:12px; }.record-pagination :deep(.van-button) { min-height:38px; }
.record-item { display:flex; width:100%; max-width:100%; min-width:0; align-items:flex-start; justify-content:space-between; gap:10px; min-height:76px; padding:14px 12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.record-main { min-width:0; max-width:calc(100% - 92px); overflow:hidden; }
.record-main strong { display:block; overflow:hidden; margin-bottom:6px; color:#172033; font-size:15px; text-overflow:ellipsis; white-space:nowrap; }
.record-main span { display:block; max-width:100%; overflow:hidden; color:#8993a7; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.record-meta { display:flex; width:82px; max-width:82px; flex-shrink:0; flex-direction:column; align-items:flex-end; gap:6px; overflow:hidden; color:#8993a7; font-size:11px; }
.record-meta time { white-space:nowrap; }
</style>
