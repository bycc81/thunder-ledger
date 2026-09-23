<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api, type ProductGroupTemplate } from '../api';
import { useWorkspaceStore } from '../stores/workspace';

type TemplateDraft = { id: string; name: string; variants: string[] };
const router = useRouter();
const store = useWorkspaceStore();
const templates = ref<ProductGroupTemplate[]>([]);
const loading = ref(true); const error = ref(''); const saving = ref(false);
const showEditor = ref(false); const showDelete = ref(false); const pendingDelete = ref<ProductGroupTemplate | null>(null);
const draft = ref<TemplateDraft>({ id: '', name: '', variants: [] }); const variantName = ref('');
const editing = computed(() => Boolean(draft.value.id));

async function load() {
  if (!store.selectedWorkspaceId) return;
  loading.value = true; error.value = '';
  try { templates.value = (await api.get<ProductGroupTemplate[]>(`/workspaces/${store.selectedWorkspaceId}/product-group-templates`)).data; }
  catch { error.value = '组合模板加载失败，请重试'; }
  finally { loading.value = false; }
}
function openCreate() { draft.value = { id: '', name: '', variants: [] }; variantName.value = ''; showEditor.value = true; }
function openEdit(template: ProductGroupTemplate) { draft.value = { id: template.id, name: template.name, variants: template.variants.map((item) => item.name) }; variantName.value = ''; showEditor.value = true; }
function addVariant() { const value = variantName.value.trim(); if (!value) return; if (draft.value.variants.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) return showFailToast('款式不能重复'); draft.value.variants.push(value); variantName.value = ''; }
function removeVariant(index: number) { draft.value.variants.splice(index, 1); }
async function save() {
  if (!store.selectedWorkspaceId || !draft.value.name.trim() || !draft.value.variants.length) return showFailToast('请填写模板名称和至少一个款式');
  saving.value = true;
  try { const payload = { name: draft.value.name.trim(), variants: draft.value.variants.map((name) => ({ name })) }; if (editing.value) await api.patch(`/workspaces/${store.selectedWorkspaceId}/product-group-templates/${draft.value.id}`, payload); else await api.post(`/workspaces/${store.selectedWorkspaceId}/product-group-templates`, payload); showSuccessToast(editing.value ? '组合模板已保存' : '组合模板已创建'); showEditor.value = false; await load(); }
  catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '组合模板保存失败'); }
  finally { saving.value = false; }
}
function requestDelete(template: ProductGroupTemplate) { pendingDelete.value = template; showDelete.value = true; }
async function confirmDelete() {
  if (!store.selectedWorkspaceId || !pendingDelete.value) return;
  saving.value = true;
  try { await api.delete(`/workspaces/${store.selectedWorkspaceId}/product-group-templates/${pendingDelete.value.id}`); showSuccessToast('组合模板已删除'); showDelete.value = false; pendingDelete.value = null; await load(); }
  catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '组合模板删除失败'); }
  finally { saving.value = false; }
}
onMounted(async () => { if (!store.workspaces.length) await store.load(); if (!store.canEditProducts) { error.value = '当前角色没有管理组合模板权限'; loading.value = false; return; } await load(); });
</script>

<template>
  <div class="template-page" data-ai-id="product-group-template-page">
    <van-nav-bar title="组合模板管理" left-text="返回" left-arrow data-ai-id="product-group-template-topbar" @click-left="router.push('/products')" />
    <main>
      <p class="note">组合模板用于快速生成商品组款式。修改或删除模板不会影响已经创建的商品组。</p>
      <van-button v-if="!loading && !error" block type="primary" data-ai-id="product-group-template-create" @click="openCreate">新建组合模板</van-button>
      <div v-if="loading" class="state" data-ai-id="product-group-template-loading"><van-loading>正在加载组合模板…</van-loading></div>
      <van-empty v-else-if="error" :description="error" data-ai-id="product-group-template-error"><van-button type="primary" size="small" data-ai-id="product-group-template-retry" @click="load">重试</van-button></van-empty>
      <van-empty v-else-if="!templates.length" description="还没有组合模板" data-ai-id="product-group-template-empty" />
      <section v-else class="template-list" data-ai-id="product-group-template-list"><article v-for="template in templates" :key="template.id" class="template-item" :data-ai-id="`product-group-template-item-${template.id}`"><div><strong>{{ template.name }}</strong><small>{{ template.variants.map((item) => item.name).join(' · ') }}</small></div><aside><van-button size="small" plain type="primary" :data-ai-id="`product-group-template-edit-${template.id}`" @click="openEdit(template)">编辑</van-button><van-button size="small" plain type="danger" :data-ai-id="`product-group-template-delete-${template.id}`" @click="requestDelete(template)">删除</van-button></aside></article></section>
    </main>
  </div>
  <van-popup v-model:show="showEditor" position="bottom" round data-ai-id="product-group-template-editor"><section class="editor"><header><h2>{{ editing ? '编辑组合模板' : '新建组合模板' }}</h2><button type="button" data-ai-id="product-group-template-editor-close" aria-label="关闭" @click="showEditor = false">×</button></header><van-field v-model="draft.name" label="模板名称" required placeholder="例如：炽" data-ai-id="product-group-template-name" /><div class="variant-add"><van-field v-model="variantName" label="款式" placeholder="例如：樱" data-ai-id="product-group-template-variant-input" @keyup.enter="addVariant" /><van-button plain type="primary" data-ai-id="product-group-template-add-variant" @click="addVariant">添加</van-button></div><div v-if="draft.variants.length" class="editor-variants" data-ai-id="product-group-template-variants"><div v-for="(variant, index) in draft.variants" :key="`${variant}-${index}`" :data-ai-id="`product-group-template-variant-${index}`"><span>{{ variant }}</span><button type="button" :data-ai-id="`product-group-template-variant-remove-${index}`" @click="removeVariant(index)">移除</button></div></div><p v-else class="empty-variants">至少添加一个款式</p><footer><van-button data-ai-id="product-group-template-editor-cancel" @click="showEditor = false">取消</van-button><van-button type="primary" :loading="saving" data-ai-id="product-group-template-editor-submit" @click="save">保存模板</van-button></footer></section></van-popup>
  <van-popup v-model:show="showDelete" class="delete-popup" round data-ai-id="product-group-template-delete-confirm"><section><h2>删除组合模板？</h2><p>只删除模板，不影响已创建的商品组和历史账务。</p><footer><van-button data-ai-id="product-group-template-delete-cancel" @click="showDelete = false">取消</van-button><van-button type="danger" :loading="saving" data-ai-id="product-group-template-delete-confirm-action" @click="confirmDelete">删除</van-button></footer></section></van-popup>
</template>

<style scoped>
.template-page{min-height:100vh;background:#f5f7fb}.template-page :deep(.van-nav-bar){position:sticky;top:0;z-index:2}.template-page main{padding:16px}.note{margin:0 0 14px;color:#71809a;font-size:13px;line-height:1.55}.state{display:grid;min-height:240px;place-items:center}.template-list{margin-top:14px;overflow:hidden;border-radius:10px;background:#fff}.template-item{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #e4e8f0}.template-item:last-child{border-bottom:0}.template-item>div{min-width:0}.template-item strong,.template-item small{display:block}.template-item small{margin-top:5px;overflow:hidden;color:#71809a;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.template-item aside{display:flex;flex:0 0 auto;gap:6px}.template-item :deep(.van-button){min-height:var(--tl-button-compact-height)}.editor{padding:18px 16px max(16px,env(safe-area-inset-bottom))}.editor header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.editor h2{margin:0;font-size:18px}.editor header button{width:36px;height:36px;border:0;background:transparent;color:#536078;font-size:26px}.editor :deep(.van-field){margin-bottom:10px;border-radius:9px;background:#f5f7fb}.variant-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.variant-add :deep(.van-field){margin:0}.editor-variants{display:grid;gap:8px;margin-top:12px}.editor-variants>div{display:flex;min-height:42px;align-items:center;justify-content:space-between;padding:0 10px;border:1px solid #dce2ee;border-radius:8px}.editor-variants button{border:0;background:transparent;color:#b42318;font:inherit}.empty-variants{margin:12px 0;color:#b42318;font-size:12px}.editor footer,.delete-popup footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.editor footer :deep(.van-button),.delete-popup footer :deep(.van-button){min-height:var(--tl-button-confirm-height)}.delete-popup{width:calc(100% - 40px);max-width:360px}.delete-popup section{padding:20px}.delete-popup h2{margin:0 0 8px;font-size:18px}.delete-popup p{margin:0;color:#536078;font-size:13px;line-height:1.5}
</style>
