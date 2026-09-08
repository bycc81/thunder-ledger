<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore, type Batch, type BatchMember, type WorkspaceRole } from '../stores/workspace';
import { formatDateTime } from '../utils/dateTime';

const emit = defineEmits<{
  openBatch: [batch: Batch];
  createBatch: [];
  openProducts: [];
  navigate: [page: 'batches' | 'members' | 'audit'];
}>();

const store = useWorkspaceStore();
const recentBatches = computed(() => store.batches.slice(0, 3));
const roleText = (role: WorkspaceRole | BatchMember['role']) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);
const formatDate = formatDateTime;
</script>

<template>
  <section class="workspace-overview" data-ai-id="workspace-overview">
    <div class="overview-header" data-ai-id="workspace-header">
      <div class="overview-title">
        <span class="overview-eyebrow">当前工作区</span>
        <h1>{{ store.selectedWorkspace?.name || '工作区' }}</h1>
        <span v-if="store.selectedWorkspace" class="overview-role">{{ roleText(store.selectedWorkspace.role) }}</span>
      </div>
      <van-button v-if="store.canCreateBatch" type="primary" data-ai-id="batch-create-overview" @click="emit('createBatch')">新建批次</van-button>
    </div>

    <div class="overview-stats" data-ai-id="workspace-stats">
      <div class="overview-stat"><small>成员</small><strong>{{ store.members.length }}</strong></div>
      <div class="overview-stat"><small>批次</small><strong>{{ store.batches.length }}</strong></div>
      <div class="overview-stat"><small>操作记录</small><strong>{{ store.audits.length }}</strong></div>
    </div>

    <section class="overview-section" data-ai-id="recent-batches">
      <div class="overview-section-head">
        <h2>最近批次</h2>
        <van-button v-if="store.batches.length" class="text-button" type="primary" size="small" data-ai-id="recent-batches-more" @click="emit('navigate', 'batches')">查看全部</van-button>
      </div>
      <van-empty v-if="!recentBatches.length" description="暂无批次" data-ai-id="batch-empty">
        <van-button v-if="store.canCreateBatch" type="primary" size="small" data-ai-id="batch-empty-create" @click="emit('createBatch')">新建批次</van-button>
      </van-empty>
      <div v-else class="overview-list">
        <article v-for="batch in recentBatches" :key="batch.id" class="overview-batch-item" :data-ai-id="`batch-item-${batch.id}`" tabindex="0" @click="emit('openBatch', batch)" @keydown.enter="emit('openBatch', batch)">
          <div class="overview-batch-main"><span class="overview-batch-title">{{ batch.name }}</span><span class="overview-batch-meta">创建于 {{ formatDate(batch.created_at) }} · {{ roleText(batch.role) }}</span></div>
          <div class="overview-batch-side"><van-tag :type="batch.status === 'open' ? 'success' : 'default'">{{ batch.status === 'open' ? '开放' : '已关闭' }}</van-tag><van-icon name="arrow" /></div>
        </article>
      </div>
    </section>

    <section class="overview-section" data-ai-id="quick-actions">
      <div class="overview-section-head"><h2>快捷操作</h2></div>
      <div class="overview-command-list">
        <van-button block class="command-action" data-ai-id="quick-products" @click="emit('openProducts')"><span class="command-content"><span class="command-title"><span class="command-icon"><van-icon name="goods-collect-o" /></span>商品</span><van-icon class="command-arrow" name="arrow" /></span></van-button>
        <van-button block class="command-action" data-ai-id="quick-members" @click="emit('navigate', 'members')"><span class="command-content"><span class="command-title"><span class="command-icon"><van-icon name="friends-o" /></span>管理成员</span><van-icon class="command-arrow" name="arrow" /></span></van-button>
        <van-button block class="command-action" data-ai-id="quick-batches" @click="emit('navigate', 'batches')"><span class="command-content"><span class="command-title"><span class="command-icon"><van-icon name="orders-o" /></span>查看批次</span><van-icon class="command-arrow" name="arrow" /></span></van-button>
        <van-button block class="command-action" data-ai-id="quick-audit" @click="emit('navigate', 'audit')"><span class="command-content"><span class="command-title"><span class="command-icon"><van-icon name="records" /></span>查看操作记录</span><van-icon class="command-arrow" name="arrow" /></span></van-button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.workspace-overview { padding-bottom: 8px; }
.overview-header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:22px; }
.overview-title { min-width:0; }
.overview-eyebrow { display:block; margin-bottom:5px; color:#8993a7; font-size:11px; }
.overview-title h1 { overflow:hidden; margin:0 0 5px; color:#172033; font-size:23px; line-height:1.2; text-overflow:ellipsis; white-space:nowrap; }
.overview-role { color:#536078; font-size:12px; }
.overview-header :deep(.van-button) { flex-shrink:0; min-height:38px; padding:0 11px; font-size:14px; }
.overview-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); overflow:hidden; margin:0 0 20px; border-radius:10px; background:#e4e8f0; }
.overview-stat { min-width:0; min-height:68px; padding:10px 8px; background:#fff; text-align:center; }
.overview-stat small { display:block; overflow:hidden; color:#8993a7; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.overview-stat strong { display:block; margin-top:6px; color:#172033; font-size:21px; line-height:1; }
.overview-section { margin-bottom:25px; }
.overview-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:9px; }
.overview-section-head h2 { margin:0; color:#172033; font-size:17px; line-height:1.3; }
.overview-section-head :deep(.van-button) { min-height:44px; }
.overview-list { display:grid; gap:8px; }
.overview-batch-item { position:relative; display:flex; align-items:flex-start; justify-content:space-between; min-height:76px; padding:14px 42px 12px 12px; border-radius:10px; background:#fff; color:#172033; box-shadow:0 1px 0 #e4e8f0; cursor:pointer; }
.overview-batch-item:active,.overview-batch-item:focus-visible { background:#edf1ff; outline:2px solid #3657c8; outline-offset:1px; }
.overview-batch-main { min-width:0; }
.overview-batch-title { display:block; overflow:hidden; margin-bottom:6px; font-size:15px; font-weight:700; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
.overview-batch-meta { color:#8993a7; font-size:12px; line-height:1.35; }
.overview-batch-side { position:absolute; top:12px; right:10px; display:flex; align-items:center; gap:3px; }
.overview-batch-side :deep(.van-tag) { min-height:22px; padding:2px 6px; font-size:11px; }
.overview-batch-side :deep(.van-icon) { position:absolute; top:29px; right:2px; color:#8993a7; font-size:16px; }
.overview-command-list { display:grid; gap:10px; overflow:visible; }
.command-action { min-height:56px; padding:9px 12px; border:0 !important; border-radius:10px; background:#fff; color:#172033; box-shadow:0 1px 0 rgba(23,32,51,.04); }
.command-action :deep(.van-button__content) { display:block; width:100%; }
.command-action:active { background:#edf1ff; }
.command-content { display:flex; width:100%; min-width:0; align-items:center; justify-content:space-between; }
.command-action :deep(.van-icon) { color:#8993a7; font-size:17px; }
.overview-command-list :deep(.van-cell__title) { display:flex; align-items:center; }
.command-title { display:flex; min-width:0; align-items:center; gap:10px; color:#172033; font-weight:700; }
.command-arrow { flex:0 0 auto; font-size:15px !important; }
.command-icon { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; background:#edf1ff; color:#3657c8; }
.command-icon :deep(.van-icon) { color:inherit; font-size:18px; }
.overview-section-head :deep(.text-button) { min-height:38px; padding:0 4px; border:0; background:transparent; box-shadow:none; font-size:13px; }
.workspace-overview :deep(.van-empty) { padding:24px 16px; border-radius:10px; background:#fff; }
</style>
