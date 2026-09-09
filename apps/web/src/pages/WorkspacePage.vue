<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type Batch } from '../stores/workspace';
import MobileShell from '../layouts/MobileShell.vue';
import WorkspaceOverview from '../components/WorkspaceOverview.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';

const router = useRouter();
const auth = useAuthStore();
const store = useWorkspaceStore();
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const showBatchCreate = ref(false);
const batchName = ref('');

async function createBatch() {
  if (!batchName.value.trim() || !store.selectedWorkspaceId) return;
  try {
    await api.post('/batches', { workspaceId: store.selectedWorkspaceId, name: batchName.value.trim() });
    batchName.value = '';
    showBatchCreate.value = false;
    await store.loadScoped();
    showSuccessToast('批次已创建');
    await router.push('/batches');
  } catch {
    showFailToast('批次创建失败');
  }
}

function navigate(page: 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile') {
  if (page === 'overview') void router.push('/workspace');
  else void router.push(`/${page}`);
}

function openBatch(batch: Batch) {
  void router.push(`/batches/${batch.id}`);
}

function expired() {
  auth.logout();
  void router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
}

onMounted(async () => {
  window.addEventListener('auth:expired', expired);
  await store.load();
});
onBeforeUnmount(() => window.removeEventListener('auth:expired', expired));
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <WorkspaceOverview @create-batch="showBatchCreate = true" @create-workspace="showWorkspaceCreate = true" @open-batch="openBatch" @open-products="router.push('/products')" @navigate="navigate" />
  </MobileShell>

  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" />

  <van-dialog v-model:show="showBatchCreate" title="新建批次" show-cancel-button data-ai-id="batch-create-dialog" @confirm="createBatch">
    <van-field v-model="batchName" label="名称" placeholder="批次名称" data-ai-id="batch-create-name" />
  </van-dialog>
</template>
