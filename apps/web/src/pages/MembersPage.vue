<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type Member, type WorkspaceRole } from '../stores/workspace';

type Page = 'overview' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const auth = useAuthStore();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const showInvite = ref(false);
const showInviteRole = ref(false);
const showMemberRole = ref(false);
const inviteUsername = ref('');
const inviteRole = ref<Exclude<WorkspaceRole, 'owner'>>('viewer');
const selectedMember = ref<Member | null>(null);
const selectedRole = ref<Exclude<WorkspaceRole, 'owner'>>('viewer');
const inviteToken = ref('');
const submitting = ref(false);
const removingId = ref('');
const roleOptions = [{ text: '管理员', value: 'admin' }, { text: '编辑者', value: 'editor' }, { text: '查看者', value: 'viewer' }];

const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : '--';
const permissionText = computed(() => store.canManageWorkspace ? `当前角色：${roleText(store.selectedWorkspace?.role ?? 'viewer')}，可管理成员和角色。` : `当前角色：${roleText(store.selectedWorkspace?.role ?? 'viewer')}，成员管理为只读。`);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function selectWorkspace(id: string) { showWorkspace.value = false; await store.select(id); }
function openRole(member: Member) { selectedMember.value = member; selectedRole.value = member.role === 'owner' ? 'viewer' : member.role; showMemberRole.value = true; }
function chooseInviteRole({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const value = selectedOptions[0]?.value; if (value && value !== 'owner') inviteRole.value = value as Exclude<WorkspaceRole, 'owner'>; showInviteRole.value = false; }
function chooseMemberRole({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const value = selectedOptions[0]?.value; if (value && value !== 'owner') selectedRole.value = value as Exclude<WorkspaceRole, 'owner'>; showMemberRole.value = false; void saveRole(); }

async function invite() {
  if (!inviteUsername.value.trim() || !store.selectedWorkspaceId || submitting.value) return;
  submitting.value = true;
  try {
    const { data } = await api.post<{ token?: string }>(`/workspaces/${store.selectedWorkspaceId}/invitations`, { username: inviteUsername.value.trim(), role: inviteRole.value });
    inviteToken.value = data.token ?? '';
    await store.loadScoped();
    showSuccessToast('邀请已创建');
  } catch { showFailToast('邀请创建失败'); }
  finally { submitting.value = false; }
}
function closeInvite() { showInvite.value = false; inviteUsername.value = ''; inviteToken.value = ''; }
async function saveRole() {
  if (!selectedMember.value || !store.selectedWorkspaceId || submitting.value) return;
  submitting.value = true;
  try { await api.patch(`/workspaces/${store.selectedWorkspaceId}/members/${selectedMember.value.id}`, { role: selectedRole.value }); await store.loadScoped(); showSuccessToast('角色已更新'); }
  catch { showFailToast('角色更新失败'); }
  finally { submitting.value = false; }
}
async function removeMember(member: Member) {
  if (!store.selectedWorkspaceId || member.role === 'owner') return;
  try { await showConfirmDialog({ title: '移除成员', message: `移除 ${member.username} 后将失去当前工作区访问权限。`, confirmButtonText: '移除', confirmButtonColor: '#b42318' }); }
  catch { return; }
  removingId.value = member.id;
  try { await api.delete(`/workspaces/${store.selectedWorkspaceId}/members/${member.id}`); await store.loadScoped(); showSuccessToast('成员已移除'); }
  catch { showFailToast('成员移除失败'); }
  finally { removingId.value = ''; }
}
onMounted(() => { if (!store.workspaces.length) void store.load(); });
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="members-page" data-ai-id="workspace-members-page">
      <header class="page-heading" data-ai-id="member-list-header"><div><span class="eyebrow">工作区管理</span><h1>成员</h1></div><van-button v-if="store.canManageWorkspace" type="primary" data-ai-id="member-invite" @click="showInvite = true">邀请成员</van-button></header>
      <p class="permission-notice" data-ai-id="member-permission-notice">{{ permissionText }}</p>
      <van-empty v-if="!store.members.length" description="暂无成员" data-ai-id="member-empty" />
      <div v-else class="member-list" data-ai-id="member-list">
        <article v-for="member in store.members" :key="member.id" class="member-item" :data-ai-id="`member-item-${member.id}`">
          <div class="member-main"><strong>{{ member.username }}</strong><div class="member-meta"><van-tag :type="member.role === 'owner' ? 'primary' : member.role === 'admin' ? 'warning' : 'default'">{{ roleText(member.role) }}</van-tag><span>邀请时间 {{ formatDate(member.invited_at) }}</span></div></div>
          <div v-if="member.role !== 'owner' && store.canManageWorkspace" class="member-actions"><van-button class="member-action" size="small" plain :data-ai-id="`member-role-${member.id}`" @click="openRole(member)">角色</van-button><van-button class="member-action danger-action" size="small" plain type="danger" :loading="removingId === member.id" :data-ai-id="`member-remove-${member.id}`" @click="removeMember(member)">移除</van-button></div>
        </article>
      </div>
    </section>
  </MobileShell>

  <van-popup v-model:show="showWorkspace" position="bottom" round data-ai-id="workspace-picker"><van-cell title="切换工作区" /><van-cell v-for="workspace in store.workspaces" :key="workspace.id" :title="workspace.name" :label="roleText(workspace.role)" is-link :data-ai-id="`workspace-option-${workspace.id}`" @click="selectWorkspace(workspace.id)" /></van-popup>
  <van-dialog v-model:show="showInvite" title="邀请成员" show-cancel-button :show-confirm-button="!inviteToken" :confirm-button-text="submitting ? '创建中…' : '创建邀请'" data-ai-id="member-invite-dialog" @confirm="invite" @cancel="closeInvite" @closed="closeInvite">
    <van-field v-model="inviteUsername" label="用户名" placeholder="输入工作区成员用户名" data-ai-id="member-invite-username" />
    <van-field :model-value="roleText(inviteRole)" label="工作区角色" readonly is-link data-ai-id="member-invite-role" @click="showInviteRole = true" />
    <div v-if="inviteToken" class="invite-result" data-ai-id="member-invite-result"><van-tag type="success">邀请已创建</van-tag><span>请安全传递以下一次性 token：</span><van-field :model-value="inviteToken" readonly data-ai-id="member-invite-token" /></div>
  </van-dialog>
  <van-popup v-model:show="showInviteRole" position="bottom" round data-ai-id="member-invite-role-picker"><van-picker title="选择工作区角色" :columns="roleOptions" :columns-field-names="{ text: 'text', value: 'value' }" @confirm="chooseInviteRole" @cancel="showInviteRole = false" /></van-popup>
  <van-popup v-model:show="showMemberRole" position="bottom" round data-ai-id="member-role-picker"><van-picker title="调整成员角色" :columns="roleOptions" :columns-field-names="{ text: 'text', value: 'value' }" @confirm="chooseMemberRole" @cancel="showMemberRole = false" /></van-popup>
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
.invite-result :deep(.van-field) { border:1px solid #d8dde8; border-radius:8px; }
</style>
