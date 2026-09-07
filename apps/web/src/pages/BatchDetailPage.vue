<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useWorkspaceStore, type Batch, type BatchMember, type BatchRole } from '../stores/workspace';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const batch = ref<Batch | null>(null);
const members = ref<BatchMember[]>([]);
const loading = ref(true);
const error = ref('');
const name = ref('');
const saving = ref(false);
const showParticipant = ref(false);
const showMemberPicker = ref(false);
const participantUserId = ref('');
const participantRole = ref<Exclude<BatchRole, 'owner'>>('editor');
const removingId = ref('');
const pendingRemoval = ref<BatchMember | null>(null);
const showRemovalConfirm = ref(false);

const canManage = computed(() => Boolean(batch.value && (batch.value.role === 'owner' || store.canManageWorkspace)));
const roleText = (role: BatchRole) => ({ owner: '所有者', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : '--';
const memberOptions = computed(() => store.members.filter((member) => !members.value.some((item) => item.id === member.id)).map((member) => ({ text: member.username, value: member.id })));

async function load() {
  loading.value = true; error.value = '';
  try {
    const id = String(route.params.id);
    const [batchResponse, membersResponse] = await Promise.all([api.get<Batch & { created_by?: string }>(`/batches/${id}`), api.get<BatchMember[]>(`/batches/${id}/members`)]);
    batch.value = { ...batchResponse.data, role: store.batches.find((item) => item.id === id)?.role ?? 'viewer' };
    name.value = batchResponse.data.name;
    members.value = membersResponse.data;
  } catch { error.value = '批次详情加载失败，请重试'; }
  finally { loading.value = false; }
}

function close() { void router.back(); }
async function save() {
  if (!batch.value || !name.value.trim() || !canManage.value) return;
  saving.value = true;
  try { await api.patch(`/batches/${batch.value.id}`, { name: name.value.trim() }); batch.value.name = name.value.trim(); showSuccessToast('批次信息已保存'); }
  catch { showFailToast('保存失败'); }
  finally { saving.value = false; }
}
function chooseMember({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { participantUserId.value = selectedOptions[0]?.value ?? ''; showMemberPicker.value = false; }
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
      <header class="detail-header" data-ai-id="batch-detail-header"><div><h1>{{ batch.name }}</h1><van-tag :type="batch.status === 'open' ? 'success' : 'default'">{{ batch.status === 'open' ? '开放' : '已关闭' }}</van-tag></div></header>
      <section class="detail-summary" data-ai-id="batch-detail-summary">
        <div class="summary-row"><span>我的角色</span><strong>{{ roleText(batch.role) }}</strong></div>
        <div class="summary-row"><span>创建时间</span><strong>{{ formatDate(batch.created_at) }}</strong></div>
        <div class="summary-row"><span>参与人</span><strong>{{ members.length }} 人</strong></div>
      </section>
      <section class="detail-section" data-ai-id="batch-detail-form"><h2>基本信息</h2><van-field v-model="name" label="批次名称" :readonly="!canManage" data-ai-id="batch-detail-name" /></section>
      <section class="detail-section" data-ai-id="batch-member-list"><div class="section-head"><h2>批次成员</h2><van-button v-if="canManage" class="compact-button" type="primary" size="small" data-ai-id="participant-add" @click="showParticipant = true">添加参与人</van-button></div>
        <van-empty v-if="!members.length" description="暂无参与人" data-ai-id="batch-member-empty" />
        <div v-else class="member-list"><div v-for="member in members" :key="member.id" class="member-item" :data-ai-id="`batch-member-item-${member.id}`"><div class="member-main"><strong>{{ member.username }}</strong><span><van-tag :type="member.role === 'owner' ? 'primary' : member.role === 'editor' ? 'warning' : 'default'">{{ roleText(member.role) }}</van-tag><small>加入时间 {{ formatDate(member.created_at) }}</small></span></div><div v-if="member.role !== 'owner' && canManage" class="member-actions"><van-popover placement="top-end" :actions="[{ text: '编辑者' }, { text: '查看者' }]" @select="(action) => updateRole(member, action.text === '编辑者' ? 'editor' : 'viewer')"><van-button class="member-action" size="small" plain :data-ai-id="`batch-member-role-${member.id}`">角色</van-button></van-popover><van-button class="member-action danger-action" size="small" plain type="danger" :loading="removingId === member.id" :data-ai-id="`batch-member-remove-${member.id}`" @click="requestRemoveParticipant(member)">移除</van-button></div></div></div>
      </section>
      <div v-if="canManage" class="detail-footer"><van-button block type="primary" :loading="saving" data-ai-id="batch-detail-save" @click="save">保存信息</van-button></div>
    </main>
  </div>

  <van-dialog v-model:show="showParticipant" title="添加参与人" show-cancel-button data-ai-id="participant-add-dialog" @confirm="addParticipant">
    <van-field :model-value="store.members.find((member) => member.id === participantUserId)?.username || ''" label="工作区成员" placeholder="选择成员" readonly is-link data-ai-id="participant-user" @click="showMemberPicker = true" />
    <van-field v-model="participantRole" label="批次角色" readonly data-ai-id="participant-role" />
  </van-dialog>
  <van-popup v-model:show="showMemberPicker" position="bottom" round data-ai-id="participant-member-picker"><van-picker title="选择成员" :columns="memberOptions" @confirm="chooseMember" @cancel="showMemberPicker = false" /></van-popup>
  <DangerConfirmDialog v-model:show="showRemovalConfirm" title="移除参与人" :message="pendingRemoval ? `移除 ${pendingRemoval.username} 后将不能访问此批次。` : ''" confirm-text="移除" ai-id="participant-remove-confirm" :loading="Boolean(removingId)" @confirm="removeParticipant" />
</template>

<style scoped>
.detail-page { min-height:100vh; background:#f5f7fb; }
.detail-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:2; }
.detail-content { padding:20px 16px 32px; }
.detail-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:18px; }
.detail-header h1 { margin:0 0 8px; font-size:24px; line-height:1.25; }
.detail-summary { display:grid; gap:1px; margin-bottom:24px; overflow:hidden; border-radius:10px; background:#fff; }
.summary-row { display:grid; grid-template-columns:76px minmax(0,1fr); gap:14px; align-items:center; min-height:48px; padding:8px 12px; border-bottom:1px solid #e4e8f0; }
.summary-row:last-child { border-bottom:0; }
.summary-row span { color:#8993a7; font-size:12px; text-align:right; }
.summary-row strong { min-width:0; color:#172033; font-size:14px; font-weight:600; }
.detail-section { margin-bottom:24px; }
.detail-section h2,.section-head h2 { margin:0; color:#172033; font-size:17px; }
.detail-section > h2 { margin-bottom:8px; }
.detail-section :deep(.van-field) { display:flex; align-items:center; overflow:hidden; min-height:48px; padding:0 12px; border:1px solid #cfd6e2; border-radius:9px; background:#fff; }
.detail-section :deep(.van-field__label) { width:76px; margin-right:14px; color:#536078; font-size:13px; text-align:right; }
.detail-section :deep(.van-field__control) { min-height:42px; color:#172033; font-size:15px; text-align:left; }
.section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
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
.detail-footer { padding-top:4px; }
.detail-footer :deep(.van-button) { min-height:44px; }
.detail-state { display:grid; min-height:60vh; place-items:center; }
</style>
