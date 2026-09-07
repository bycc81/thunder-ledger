<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MobileShell from '../layouts/MobileShell.vue';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type WorkspaceRole } from '../stores/workspace';
import DangerConfirmDialog from '../components/DangerConfirmDialog.vue';

type Page = 'overview' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const auth = useAuthStore();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const showLogoutConfirm = ref(false);
const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function selectWorkspace(id: string) { showWorkspace.value = false; await store.select(id); }
async function logout() {
  auth.logout();
  store.clear();
  await router.replace('/login');
}
onMounted(() => { if (!store.workspaces.length) void store.load(); });
</script>

<template>
  <MobileShell page="profile" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="profile-page" data-ai-id="profile-page">
      <header class="page-heading" data-ai-id="profile-header"><div><span class="eyebrow">账号</span><h1>我的</h1></div></header>
      <section class="profile-section" data-ai-id="profile-account-section"><h2>账号信息</h2><div class="profile-list"><div class="profile-row" data-ai-id="profile-account"><span>用户名</span><strong>{{ auth.username }}</strong></div><div class="profile-row" data-ai-id="profile-workspace"><span>当前工作区</span><strong>{{ store.selectedWorkspace?.name || '--' }}</strong></div><div class="profile-row" data-ai-id="profile-role"><span>当前角色</span><strong>{{ store.selectedWorkspace ? roleText(store.selectedWorkspace.role) : '--' }}</strong></div></div></section>
      <section class="profile-section" data-ai-id="profile-actions"><h2>账户操作</h2><van-button block class="logout-button" plain type="danger" data-ai-id="profile-logout" @click="showLogoutConfirm = true">退出登录</van-button></section>
    </section>
  </MobileShell>
  <van-popup v-model:show="showWorkspace" position="bottom" round data-ai-id="workspace-picker"><van-cell title="切换工作区" /><van-cell v-for="workspace in store.workspaces" :key="workspace.id" :title="workspace.name" :label="roleText(workspace.role)" is-link :data-ai-id="`workspace-option-${workspace.id}`" @click="selectWorkspace(workspace.id)" /></van-popup>
  <DangerConfirmDialog v-model:show="showLogoutConfirm" title="退出登录" message="退出后需要重新登录才能继续操作。" confirm-text="退出" ai-id="profile-logout-confirm" @confirm="logout" />
</template>

<style scoped>
.profile-page { padding-bottom:8px; }
.page-heading { margin-bottom:22px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.profile-section { margin-bottom:24px; }
.profile-section h2 { margin:0 0 10px; color:#172033; font-size:17px; }
.profile-list { overflow:hidden; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.profile-row { display:grid; grid-template-columns:90px minmax(0,1fr); gap:12px; align-items:center; min-height:52px; padding:8px 12px; border-bottom:1px solid #e4e8f0; }
.profile-row:last-child { border-bottom:0; }
.profile-row span { color:#8993a7; font-size:12px; text-align:right; }
.profile-row strong { overflow:hidden; color:#172033; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
.logout-button { min-height:44px; border-color:#efc5c1; background:#fff; }
</style>
