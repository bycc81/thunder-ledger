<script setup lang="ts">
type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';

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
    <header class="mobile-shell-bar" data-ai-id="topbar">
      <strong class="mobile-shell-brand" data-ai-id="app-brand">ThunderLedger</strong>
      <button class="mobile-shell-workspace" type="button" data-ai-id="workspace-selector" @click="emit('openWorkspace')">
        <span>{{ workspaceName || '选择工作区' }}</span><span aria-hidden="true">⌄</span>
      </button>
    </header>

    <main class="mobile-shell-main">
      <div class="mobile-shell-content"><slot /></div>
    </main>

    <van-tabbar :model-value="page" fixed data-ai-id="bottom-navigation" @change="(value) => emit('navigate', value as Page)">
      <van-tabbar-item name="overview" icon="home-o" data-ai-id="nav-workspace">工作区</van-tabbar-item>
      <van-tabbar-item name="products" icon="goods-collect-o" data-ai-id="nav-products">商品</van-tabbar-item>
      <van-tabbar-item name="batches" icon="orders-o" data-ai-id="nav-batches">批次</van-tabbar-item>
      <van-tabbar-item name="profile" icon="contact" data-ai-id="nav-profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.mobile-shell { width:100%; max-width:100%; min-height:100vh; overflow-x:hidden; padding-bottom:70px; background:#f5f7fb; }
.mobile-shell-bar { position:sticky; top:0; z-index:3; display:flex; height:56px; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; border-bottom:1px solid #e4e8f0; background:#fff; }
.mobile-shell-brand { min-width:0; overflow:hidden; color:#172033; font-size:15px; font-weight:800; text-overflow:ellipsis; white-space:nowrap; }
.mobile-shell-workspace { display:flex; min-width:0; max-width:58%; align-items:center; gap:4px; min-height:44px; padding:0; border:0; background:transparent; color:#3657c8; font:inherit; font-size:13px; font-weight:700; }
.mobile-shell-workspace span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mobile-shell-main { width:100%; max-width:100%; min-height:calc(100vh - 56px); overflow-x:hidden; }
.mobile-shell-content { width:100%; max-width:100%; padding:20px 16px 28px; overflow-x:hidden; }
.mobile-shell-content :deep(.content) { width:100%; margin:0; padding:0; }
.mobile-shell :deep(.van-tabbar) { left:0; right:0; width:100%; transform:none; display:flex; }
.mobile-shell :deep(.van-tabbar-item) { flex:1; min-width:0; }
.mobile-shell :deep(.van-tabbar) { --van-tabbar-height:58px; --van-tabbar-item-icon-size:19px; --van-tabbar-item-font-size:11px; }
</style>
