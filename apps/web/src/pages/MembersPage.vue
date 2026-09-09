<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type Member, type WorkspaceRole } from '../stores/workspace';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';
import { formatDateTime } from '../utils/dateTime';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const auth = useAuthStore();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const showInvite = ref(false);
const addMode = ref<'invite' | 'existing'>('invite');
const showInviteRole = ref(false);
const showMemberRole = ref(false);
const inviteUsername = ref('');
const inviteRole = ref<Exclude<WorkspaceRole, 'owner'>>('viewer');
const selectedMember = ref<Member | null>(null);
const selectedRole = ref<Exclude<WorkspaceRole, 'owner'>>('viewer');
const inviteToken = ref('');
const inviteLinkInput = ref<HTMLTextAreaElement | null>(null);
const submitting = ref(false);
const removingId = ref('');
const pendingRemoval = ref<Member | null>(null);
const showRemovalConfirm = ref(false);
const roleOptions = [{ text: '管理员', value: 'admin' }, { text: '编辑者', value: 'editor' }, { text: '查看者', value: 'viewer' }];

const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = formatDateTime;
const permissionText = computed(() => store.canManageWorkspace ? `当前角色：${roleText(store.selectedWorkspace?.role ?? 'viewer')}，可管理成员和角色。` : `当前角色：${roleText(store.selectedWorkspace?.role ?? 'viewer')}，成员管理为只读。`);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
function openRole(member: Member) { selectedMember.value = member; selectedRole.value = member.role === 'owner' ? 'viewer' : member.role; showMemberRole.value = true; }
function chooseInviteRole({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const value = selectedOptions[0]?.value; if (value && value !== 'owner') inviteRole.value = value as Exclude<WorkspaceRole, 'owner'>; showInviteRole.value = false; }
function chooseMemberRole({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const value = selectedOptions[0]?.value; if (value && value !== 'owner') selectedRole.value = value as Exclude<WorkspaceRole, 'owner'>; showMemberRole.value = false; void saveRole(); }

async function invite() {
  if (!inviteUsername.value.trim() || !store.selectedWorkspaceId || submitting.value) return;
  submitting.value = true;
  try {
    if (addMode.value === 'existing') { await api.post(`/workspaces/${store.selectedWorkspaceId}/members/by-username`, { username: inviteUsername.value.trim(), role: inviteRole.value }); showInvite.value = false; showSuccessToast('成员已加入'); }
    else { const { data } = await api.post<{ token?: string }>(`/workspaces/${store.selectedWorkspaceId}/invitations`, { username: inviteUsername.value.trim(), role: inviteRole.value }); inviteToken.value = data.token ? `${window.location.origin}/register#token=${data.token}` : ''; showSuccessToast('注册链接已创建'); }
    await store.loadScoped();
  } catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || (addMode.value === 'existing' ? '成员加入失败' : '邀请创建失败')); }
  finally { submitting.value = false; }
}
function openInvite() { addMode.value = 'invite'; inviteUsername.value = ''; inviteRole.value = 'viewer'; inviteToken.value = ''; showInvite.value = true; }
function closeInvite() { showInvite.value = false; inviteUsername.value = ''; inviteToken.value = ''; }
function selectInvitationLink() {
  inviteLinkInput.value?.focus();
  inviteLinkInput.value?.select();
  inviteLinkInput.value?.setSelectionRange(0, inviteToken.value.length);
}
function legacyCopyInvitationLink(): boolean {
  let copied = false;
  const writeText = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', inviteToken.value);
    event.preventDefault();
    copied = true;
  };
  document.addEventListener('copy', writeText);
  document.execCommand('copy');
  document.removeEventListener('copy', writeText);
  return copied;
}
async function copyInvitationLink() {
  if (!inviteToken.value) return;
  selectInvitationLink();
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteToken.value);
      showSuccessToast('注册链接已复制');
      return;
    }
  } catch { /* 非 HTTPS 或浏览器拒绝剪贴板权限时，继续使用兼容复制。 */ }
  if (legacyCopyInvitationLink()) { showSuccessToast('注册链接已复制'); return; }
  showFailToast('请长按链接后选择复制');
}
async function saveRole() {
  if (!selectedMember.value || !store.selectedWorkspaceId || submitting.value) return;
  submitting.value = true;
  try { await api.patch(`/workspaces/${store.selectedWorkspaceId}/members/${selectedMember.value.id}`, { role: selectedRole.value }); await store.loadScoped(); showSuccessToast('角色已更新'); }
  catch { showFailToast('角色更新失败'); }
  finally { submitting.value = false; }
}
function requestRemoveMember(member: Member) {
  if (member.role === 'owner') return;
  pendingRemoval.value = member;
  showRemovalConfirm.value = true;
}
async function removeMember() {
  const member = pendingRemoval.value;
  if (!store.selectedWorkspaceId || !member) return;
  removingId.value = member.id;
  try { await api.delete(`/workspaces/${store.selectedWorkspaceId}/members/${member.id}`); await store.loadScoped(); showRemovalConfirm.value = false; pendingRemoval.value = null; showSuccessToast('成员已移除'); }
  catch { showFailToast('成员移除失败'); }
  finally { removingId.value = ''; }
}
onMounted(() => { if (!store.workspaces.length) void store.load(); });
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="members-page" data-ai-id="workspace-members-page">
      <header class="page-heading" data-ai-id="member-list-header"><div><span class="eyebrow">工作区管理</span><h1>成员</h1></div><div v-if="store.canManageWorkspace" data-ai-id="member-add"><van-button type="primary" data-ai-id="member-invite" @click="openInvite">添加成员</van-button></div></header>
      <p class="permission-notice" data-ai-id="member-permission-notice">{{ permissionText }}</p>
      <van-empty v-if="!store.members.length" description="暂无成员" data-ai-id="member-empty" />
      <div v-else class="member-list" data-ai-id="member-list">
        <article v-for="member in store.members" :key="member.id" class="member-item" :data-ai-id="`member-item-${member.id}`">
          <div class="member-main"><strong>{{ member.username }}</strong><div class="member-meta"><van-tag :type="member.role === 'owner' ? 'primary' : member.role === 'admin' ? 'warning' : 'default'">{{ roleText(member.role) }}</van-tag><span>邀请时间 {{ formatDate(member.invited_at) }}</span></div></div>
          <div v-if="member.role !== 'owner' && store.canManageWorkspace" class="member-actions"><van-button class="member-action" size="small" plain :data-ai-id="`member-role-${member.id}`" @click="openRole(member)">角色</van-button><van-button class="member-action danger-action" size="small" plain type="danger" :loading="removingId === member.id" :data-ai-id="`member-remove-${member.id}`" @click="requestRemoveMember(member)">移除</van-button></div>
        </article>
      </div>
    </section>
  </MobileShell>

  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" />
  <van-dialog v-model:show="showInvite" title="添加成员" :show-confirm-button="false" :show-cancel-button="false" :close-on-click-overlay="false" data-ai-id="member-invite-dialog" @closed="closeInvite">
    <van-field :model-value="addMode === 'invite' ? '邀请新账号' : '加入已有账号'" label="添加方式" readonly is-link data-ai-id="member-add-mode" @click="addMode = addMode === 'invite' ? 'existing' : 'invite'; inviteToken = ''" />
    <van-field v-model="inviteUsername" label="用户名" :placeholder="addMode === 'invite' ? '由邀请人设置用户名' : '输入已注册用户名'" data-ai-id="member-add-username" />
    <van-field :model-value="roleText(inviteRole)" label="工作区角色" readonly is-link data-ai-id="member-invite-role" @click="showInviteRole = true" />
    <div v-if="inviteToken" class="invite-result" data-ai-id="member-invitation-link"><van-tag type="success">注册链接已创建</van-tag><span>请安全传递以下链接；链接仅本次显示。复制不成功时，可长按链接后选择复制。</span><textarea ref="inviteLinkInput" class="invite-link-input" :value="inviteToken" readonly aria-label="注册链接" data-ai-id="member-invite-token" @focus="selectInvitationLink" /><div class="invite-actions"><van-button size="small" plain type="primary" data-ai-id="member-invitation-link-copy" @click="copyInvitationLink">复制链接</van-button><van-button size="small" plain type="primary" :url="inviteToken" data-ai-id="member-invitation-link-open">打开链接</van-button></div></div>
    <div v-if="inviteToken" class="invite-dialog-footer"><van-button block plain data-ai-id="member-invitation-close" @click="closeInvite">关闭</van-button></div>
    <div v-else class="invite-dialog-footer invite-dialog-footer-split"><van-button plain data-ai-id="member-invite-cancel" @click="closeInvite">取消</van-button><van-button type="primary" :loading="submitting" data-ai-id="member-add-submit" @click="invite">{{ addMode === 'invite' ? '创建注册链接' : '加入成员' }}</van-button></div>
  </van-dialog>
  <van-popup v-model:show="showInviteRole" position="bottom" round data-ai-id="member-invite-role-picker"><van-picker title="选择工作区角色" :columns="roleOptions" :columns-field-names="{ text: 'text', value: 'value' }" @confirm="chooseInviteRole" @cancel="showInviteRole = false" /></van-popup>
  <van-popup v-model:show="showMemberRole" position="bottom" round data-ai-id="member-role-picker"><van-picker title="调整成员角色" :columns="roleOptions" :columns-field-names="{ text: 'text', value: 'value' }" @confirm="chooseMemberRole" @cancel="showMemberRole = false" /></van-popup>
  <DangerConfirmDialog v-model:show="showRemovalConfirm" title="移除成员" :message="pendingRemoval ? `移除 ${pendingRemoval.username} 后将失去当前工作区访问权限。` : ''" confirm-text="移除" ai-id="member-remove-confirm" :loading="Boolean(removingId)" @confirm="removeMember" />
</template>

<style scoped>
.members-page { padding-bottom:8px; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:14px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.page-heading :deep(.van-button) { min-height:38px; padding:0 10px; font-size:13px; }
.permission-notice { margin:0 0 14px; padding:10px 12px; border-radius:8px; background:#edf1ff; color:#536078; font-size:12px; line-height:1.5; }
.member-list { display:grid; gap:8px; }
.member-item { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:76px; padding:13px 12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.member-main { min-width:0; }
.member-main strong { display:block; overflow:hidden; margin-bottom:7px; color:#172033; font-size:15px; text-overflow:ellipsis; white-space:nowrap; }
.member-meta { display:flex; align-items:center; flex-wrap:wrap; gap:7px; color:#8993a7; font-size:11px; }
.member-meta :deep(.van-tag) { min-height:22px; padding:2px 6px; font-size:11px; }
.member-actions { display:flex; flex-shrink:0; gap:4px; }
.member-action { min-height:34px; padding:0 7px; font-size:12px; }
.danger-action { color:#b42318 !important; }
.invite-result { padding:4px 16px 14px; }
.invite-result > span { display:block; margin:8px 0 4px; color:#8993a7; font-size:12px; }
.invite-link-input { display:block; width:100%; min-height:64px; margin:6px 0 8px; resize:none; border:1px solid #d8dde8; border-radius:8px; padding:8px; background:#fff; color:#536078; font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; }
.invite-actions { display:flex; gap:8px; }
.invite-dialog-footer { padding:12px 16px; }
.invite-dialog-footer-split { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
</style>
