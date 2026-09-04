<script setup lang="ts">
type Page = 'overview' | 'batches' | 'members' | 'audit' | 'profile';

defineProps<{
  page: Page;
  workspaceName?: string;
}>();

const emit = defineEmits<{
  openWorkspace: [];
  navigate: [page: Page];
}>();
</script>

<template>
  <div class="mobile-shell" data-ai-id="app-shell">
    <van-nav-bar class="mobile-shell-bar" data-ai-id="topbar">
      <template #title>
        <div class="mobile-shell-brand" data-ai-id="app-brand">
          <strong>ThunderLedger</strong>
          <small>工作台</small>
        </div>
      </template>
      <template #right>
        <van-button class="mobile-shell-workspace" size="small" type="primary" data-ai-id="workspace-selector" @click="emit('openWorkspace')">
          <span>{{ workspaceName || '选择工作区' }}</span><span aria-hidden="true">⌄</span>
        </van-button>
      </template>
    </van-nav-bar>

    <main class="mobile-shell-main">
      <div class="mobile-shell-content"><slot /></div>
    </main>

    <van-tabbar :model-value="page" fixed data-ai-id="bottom-navigation" @change="(value) => emit('navigate', value as Page)">
      <van-tabbar-item name="overview" icon="home-o" data-ai-id="nav-workspace">工作区</van-tabbar-item>
      <van-tabbar-item name="batches" icon="orders-o" data-ai-id="nav-batches">批次</van-tabbar-item>
      <van-tabbar-item name="audit" icon="records" data-ai-id="nav-audit">操作记录</van-tabbar-item>
      <van-tabbar-item name="profile" icon="contact" data-ai-id="nav-profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.mobile-shell { width:100%; max-width:100%; min-height:100vh; overflow-x:hidden; padding-bottom:70px; background:#f5f7fb; }
.mobile-shell-bar { position:sticky; top:0; z-index:3; height:62px; background:#fff; border-bottom:1px solid #e4e8f0; }
.mobile-shell-bar :deep(.van-nav-bar__title) { max-width:46%; margin:0; }
.mobile-shell-brand { min-width:0; text-align:left; line-height:1.1; }
.mobile-shell-brand strong,.mobile-shell-brand small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mobile-shell-brand strong { color:#172033; font-size:12px; font-weight:800; }
.mobile-shell-brand small { margin-top:2px; color:#8993a7; font-size:9px; font-weight:500; }
.mobile-shell-workspace { display:flex; align-items:center; gap:4px; max-width:156px; min-height:38px; padding:5px 8px; border:0; border-radius:8px; background:transparent !important; color:#3657c8 !important; font-size:13px; font-weight:700; }
.mobile-shell-workspace span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mobile-shell-main { width:100%; max-width:100%; min-height:calc(100vh - 62px); overflow-x:hidden; }
.mobile-shell-content { width:100%; max-width:100%; padding:20px 16px 28px; overflow-x:hidden; }
.mobile-shell-content :deep(.content) { width:100%; margin:0; padding:0; }
.mobile-shell :deep(.van-tabbar) { left:0; right:0; width:100%; transform:none; display:flex; }
.mobile-shell :deep(.van-tabbar-item) { flex:1; min-width:0; }
.mobile-shell :deep(.van-tabbar) { --van-tabbar-height:58px; --van-tabbar-item-icon-size:19px; --van-tabbar-item-font-size:11px; }
</style>
