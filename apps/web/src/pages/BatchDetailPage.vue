<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useWorkspaceStore, type Batch, type BatchMember, type BatchRole } from '../stores/workspace';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';
import { formatDateTime } from '../utils/dateTime';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';

const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const batch = ref<Batch | null>(null);
const members = ref<BatchMember[]>([]);
const loading = ref(true);
const error = ref('');
const editingName = ref('');
const savingName = ref(false);
const showNameEditor = ref(false);
const showParticipant = ref(false);
const showMemberPicker = ref(false);
const showParticipantRolePicker = ref(false);
const participantUserId = ref('');
const participantRole = ref<Exclude<BatchRole, 'owner'>>('editor');
const removingId = ref('');
const pendingRemoval = ref<BatchMember | null>(null);
const showRemovalConfirm = ref(false);

const canManage = computed(() => Boolean(batch.value && (batch.value.role === 'owner' || store.canManageWorkspace)));
const canEditInventory = computed(() => Boolean(batch.value && (batch.value.role === 'owner' || batch.value.role === 'editor' || store.canManageWorkspace)));
const roleText = (role: BatchRole) => ({ owner: '所有者', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = formatDateTime;
const memberOptions = computed(() => store.members.filter((member) => !members.value.some((item) => item.id === member.id)).map((member) => ({ text: member.username, value: member.id })));
const participantRoleOptions: Array<{ text: string; value: Exclude<BatchRole, 'owner'> }> = [
  { text: '编辑者', value: 'editor' },
  { text: '查看者', value: 'viewer' },
];

async function load() {
  loading.value = true; error.value = '';
  try {
    const id = String(route.params.id);
    const [batchResponse, membersResponse] = await Promise.all([api.get<Batch & { created_by?: string }>(`/batches/${id}`), api.get<BatchMember[]>(`/batches/${id}/members`)]);
    batch.value = { ...batchResponse.data, role: store.batches.find((item) => item.id === id)?.role ?? 'viewer' };
    members.value = membersResponse.data;
  } catch { error.value = '批次详情加载失败，请重试'; }
  finally { loading.value = false; }
}

function close() { void router.back(); }
function openNameEditor() {
  if (!batch.value || !canManage.value) return;
  editingName.value = batch.value.name;
  showNameEditor.value = true;
}
async function saveName() {
  if (!batch.value || !editingName.value.trim() || !canManage.value) {
    showFailToast('请输入批次名称');
    return;
  }
  savingName.value = true;
  try {
    const nextName = editingName.value.trim();
    await api.patch(`/batches/${batch.value.id}`, { name: nextName });
    batch.value.name = nextName;
    showNameEditor.value = false;
    showSuccessToast('批次名称已修改');
  } catch { showFailToast('修改失败'); }
  finally { savingName.value = false; }
}
function chooseMember({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { participantUserId.value = selectedOptions[0]?.value ?? ''; showMemberPicker.value = false; }
function chooseParticipantRole({ selectedOptions }: { selectedOptions: Array<{ value?: Exclude<BatchRole, 'owner'> }> }) {
  participantRole.value = selectedOptions[0]?.value ?? 'editor';
  showParticipantRolePicker.value = false;
}
async function addParticipant() {
  if (!batch.value || !participantUserId.value) return;
  try { await api.post(`/batches/${batch.value.id}/members`, { userId: participantUserId.value, role: participantRole.value }); const response = await api.get<BatchMember[]>(`/batches/${batch.value.id}/members`); members.value = response.data; showParticipant.value = false; participantUserId.value = ''; showSuccessToast('参与人已添加'); }
  catch { showFailToast('参与人添加失败'); }
}
async function updateRole(member: BatchMember, role: BatchRole) {
  if (!batch.value || member.role === 'owner' || !canManage.value) return;
  try { await api.patch(`/batches/${batch.value.id}/members/${member.id}`, { role }); member.role = role; showSuccessToast('角色已更新'); }
  catch { showFailToast('角色更新失败'); }
}
function requestRemoveParticipant(member: BatchMember) {
  if (member.role === 'owner') return;
  pendingRemoval.value = member;
  showRemovalConfirm.value = true;
}
async function removeParticipant() {
  const member = pendingRemoval.value;
  if (!batch.value || !member) return;
  removingId.value = member.id;
  try { await api.delete(`/batches/${batch.value.id}/members/${member.id}`); members.value = members.value.filter((item) => item.id !== member.id); showRemovalConfirm.value = false; pendingRemoval.value = null; showSuccessToast('参与人已移除'); }
  catch { showFailToast('参与人移除失败'); }
  finally { removingId.value = ''; }
}
onMounted(load);
</script>

<template>
  <div class="detail-page" data-ai-id="batch-detail-page">
    <van-nav-bar title="批次详情" left-text="返回" left-arrow data-ai-id="batch-detail-topbar" @click-left="close" />
    <div v-if="loading" class="detail-state"><van-loading data-ai-id="batch-detail-loading" /></div>
    <div v-else-if="error" class="detail-state"><van-empty :description="error" data-ai-id="batch-detail-error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty></div>
    <main v-else-if="batch" class="detail-content">
      <header class="detail-header" data-ai-id="batch-detail-header"><div><div class="batch-name-row" data-ai-id="batch-detail-name"><h1>{{ batch.name }}</h1><van-button v-if="canManage" class="name-edit-button" plain data-ai-id="batch-name-edit" aria-label="修改批次名称" @click="openNameEditor"><van-icon name="edit" /></van-button></div><van-tag :type="batch.status === 'open' ? 'success' : 'default'">{{ batch.status === 'open' ? '开放' : '已关闭' }}</van-tag></div></header>
      <section class="detail-summary" data-ai-id="batch-detail-summary">
        <div class="summary-row"><span>我的角色</span><strong>{{ roleText(batch.role) }}</strong></div>
        <div class="summary-row"><span>创建时间</span><strong>{{ formatDate(batch.created_at) }}</strong></div>
        <div class="summary-row"><span>参与人</span><strong>{{ members.length }} 人</strong></div>
      </section>
      <section class="detail-section" data-ai-id="batch-inventory-section"><div class="section-head"><h2>库存</h2><span v-if="!canEditInventory" class="readonly-label">只读</span></div><van-cell title="库存与采购" label="查看库存数量和采购记录" is-link clickable data-ai-id="batch-inventory-entry" @click="router.push(`/batches/${batch.id}/inventory`)" /></section>
      <section class="detail-section" data-ai-id="batch-sales-section"><div class="section-head"><h2>交易</h2><span v-if="!canEditInventory" class="readonly-label">只读</span></div><van-cell title="交易记录" label="记录销售和费用" is-link clickable data-ai-id="batch-transactions-entry" @click="router.push(`/batches/${batch.id}/transactions`)" /></section>
      <section class="detail-section" data-ai-id="batch-member-list"><div class="section-head"><h2>批次成员</h2><van-button v-if="canManage" class="compact-button" type="primary" size="small" data-ai-id="participant-add" @click="showParticipant = true">添加参与人</van-button></div>
        <van-empty v-if="!members.length" description="暂无参与人" data-ai-id="batch-member-empty" />
        <div v-else class="member-list"><div v-for="member in members" :key="member.id" class="member-item" :data-ai-id="`batch-member-item-${member.id}`"><div class="member-main"><strong>{{ member.username }}</strong><span><van-tag :type="member.role === 'owner' ? 'primary' : member.role === 'editor' ? 'warning' : 'default'">{{ roleText(member.role) }}</van-tag><small>加入时间 {{ formatDate(member.created_at) }}</small></span></div><div v-if="member.role !== 'owner' && canManage" class="member-actions"><van-popover placement="top-end" :actions="[{ text: '编辑者' }, { text: '查看者' }]" @select="(action) => updateRole(member, action.text === '编辑者' ? 'editor' : 'viewer')"><van-button class="member-action" size="small" plain :data-ai-id="`batch-member-role-${member.id}`">角色</van-button></van-popover><van-button class="member-action danger-action" size="small" plain type="danger" :loading="removingId === member.id" :data-ai-id="`batch-member-remove-${member.id}`" @click="requestRemoveParticipant(member)">移除</van-button></div></div></div>
      </section>
    </main>
  </div>

  <van-dialog v-model:show="showNameEditor" title="修改批次名称" show-cancel-button :confirm-button-text="savingName ? '修改中' : '确认修改'" :confirm-button-disabled="savingName" data-ai-id="batch-name-edit-dialog" @confirm="saveName">
    <van-field v-model="editingName" label="批次名称" placeholder="输入批次名称" data-ai-id="batch-name-edit-input" />
  </van-dialog>
  <van-dialog v-model:show="showParticipant" title="添加参与人" show-cancel-button data-ai-id="participant-add-dialog" @confirm="addParticipant">
    <van-field :model-value="store.members.find((member) => member.id === participantUserId)?.username || ''" label="工作区成员" placeholder="选择成员" readonly is-link data-ai-id="participant-user" @click="showMemberPicker = true" />
    <van-field :model-value="roleText(participantRole)" label="批次角色" readonly is-link data-ai-id="participant-role" @click="showParticipantRolePicker = true" />
  </van-dialog>
  <van-popup v-model:show="showMemberPicker" position="bottom" round data-ai-id="participant-member-picker"><van-picker title="选择成员" :columns="memberOptions" @confirm="chooseMember" @cancel="showMemberPicker = false" /></van-popup>
  <van-popup v-model:show="showParticipantRolePicker" position="bottom" round data-ai-id="participant-role-picker"><van-picker title="选择批次角色" :columns="participantRoleOptions" @confirm="chooseParticipantRole" @cancel="showParticipantRolePicker = false" /></van-popup>
  <DangerConfirmDialog v-model:show="showRemovalConfirm" title="移除参与人" :message="pendingRemoval ? `移除 ${pendingRemoval.username} 后将不能访问此批次。` : ''" confirm-text="移除" ai-id="participant-remove-confirm" :loading="Boolean(removingId)" @confirm="removeParticipant" />
  <AppBottomNavigation />
</template>

<style scoped>
.detail-page { min-height:100vh; padding-bottom:66px; background:#f5f7fb; }
.detail-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:2; }
.detail-content { padding:20px 16px 32px; }
.detail-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:18px; }
.batch-name-row { display:flex; align-items:center; gap:10px; }
.detail-header h1 { margin:0 0 8px; font-size:24px; line-height:1.25; }
.detail-summary { display:grid; gap:1px; margin-bottom:24px; overflow:hidden; border-radius:10px; background:#fff; }
.summary-row { display:grid; grid-template-columns:76px minmax(0,1fr); gap:14px; align-items:center; min-height:48px; padding:8px 12px; border-bottom:1px solid #e4e8f0; }
.summary-row:last-child { border-bottom:0; }
.summary-row span { color:#8993a7; font-size:12px; text-align:right; }
.summary-row strong { min-width:0; color:#172033; font-size:14px; font-weight:600; }
.detail-section { margin-bottom:24px; }
.detail-section h2,.section-head h2 { margin:0; color:#172033; font-size:17px; }
.detail-section > h2 { margin-bottom:8px; }
.detail-section :deep(.van-cell) { min-height:64px; padding:12px; border-radius:9px; background:#fff; }.detail-section :deep(.van-cell__title) { color:#172033; font-size:15px; font-weight:600; }.detail-section :deep(.van-cell__value) { color:#536078; font-size:14px; }.name-edit-button { flex:0 0 auto; width:44px; min-width:44px; height:44px; min-height:44px; margin:-5px 0 3px -5px; padding:0; border:0; color:#3657c8; font-size:18px; }
.section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.readonly-label { color:#71809a; font-size:12px; }.detail-section :deep(.van-cell__label) { margin-top:4px; color:#71809a; font-size:12px; }.detail-section :deep(.van-cell__right-icon) { color:#8993a7; }
.compact-button { min-height:38px; padding:0 10px; }
.member-list { overflow:hidden; border-radius:10px; background:#fff; }
.member-item { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:72px; padding:12px; border-bottom:1px solid #e4e8f0; }
.member-item:last-child { border-bottom:0; }
.member-main { min-width:0; }
.member-main strong { display:block; overflow:hidden; margin-bottom:7px; text-overflow:ellipsis; white-space:nowrap; font-size:15px; }
.member-main span { display:flex; align-items:center; gap:8px; }
.member-main small { color:#8993a7; font-size:11px; }
.member-actions { display:flex; flex-shrink:0; gap:4px; }
.member-action { min-height:34px; padding:0 7px; font-size:12px; }
.danger-action { color:#b42318 !important; }
.detail-state { display:grid; min-height:60vh; place-items:center; }
</style>
