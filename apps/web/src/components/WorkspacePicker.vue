<script setup lang="ts">
import { ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { useWorkspaceStore, type WorkspaceRole } from '../stores/workspace';

defineProps<{ show: boolean; showCreate: boolean }>();
const emit = defineEmits<{
  'update:show': [value: boolean];
  'update:showCreate': [value: boolean];
  selected: [workspaceId: string];
}>();

const store = useWorkspaceStore();
const router = useRouter();
const name = ref('');
const submitting = ref(false);
const roleText = (role: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role]);

function openCreate() {
  emit('update:show', false);
  name.value = '';
  emit('update:showCreate', true);
}

function openManagement() {
  emit('update:show', false);
  void router.push('/workspace/manage');
}

async function selectWorkspace(id: string) {
  emit('update:show', false);
  await store.select(id);
  emit('selected', id);
}

async function createWorkspace() {
  const workspaceName = name.value.trim();
  if (!workspaceName || submitting.value) {
    if (!workspaceName) showFailToast('请填写工作区名称');
    return;
  }
  submitting.value = true;
  try {
    const id = await store.createWorkspace(workspaceName);
    name.value = '';
    emit('update:showCreate', false);
    showSuccessToast('工作区已创建');
    emit('selected', id);
  } catch (error: unknown) {
    showFailToast((error as { response?: { data?: { message?: string } } }).response?.data?.message || '工作区创建失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup :show="show" position="bottom" round data-ai-id="workspace-picker" @update:show="emit('update:show', $event)">
    <van-cell v-if="store.selectedWorkspaceId" title="管理当前工作区" is-link data-ai-id="workspace-manage-entry" @click="openManagement" />
    <van-cell title="创建工作区" is-link data-ai-id="workspace-create-entry" @click="openCreate" />
    <van-cell v-for="workspace in store.workspaces" :key="workspace.id" :title="workspace.name" :label="roleText(workspace.role)" is-link :data-ai-id="`workspace-option-${workspace.id}`" @click="selectWorkspace(workspace.id)" />
  </van-popup>
  <van-dialog :show="showCreate" title="创建工作区" :show-cancel-button="true" :confirm-button-text="submitting ? '创建中' : '创建'" :confirm-button-disabled="submitting" data-ai-id="workspace-create-dialog" @update:show="emit('update:showCreate', $event)" @confirm="createWorkspace">
    <p class="workspace-create-note">创建后你是负责人，可继续添加成员和新建批次。</p>
    <van-field v-model="name" label="名称" placeholder="例如：小卡合买" maxlength="120" data-ai-id="workspace-create-name" />
  </van-dialog>
</template>

<style scoped>
.workspace-create-note { margin:0; padding:4px 16px 12px; color:#8993a7; font-size:12px; line-height:1.5; }
</style>
