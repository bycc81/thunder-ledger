<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, deleteWorkspaceImage, type Product, uploadWorkspaceImage } from '../api';
import { useWorkspaceStore } from '../stores/workspace';

type FormImage = { assetId: string; url: string | null; status: 'ready' | 'uploading' | 'error'; file?: File; persisted: boolean };
const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const editing = computed(() => typeof route.params.id === 'string');
const name = ref(''); const description = ref(''); const referencePrice = ref('');
const images = ref<FormImage[]>([]); const loading = ref(editing.value); const saving = ref(false); const error = ref('');
const nameError = ref(''); const priceError = ref(''); const fileInput = ref<HTMLInputElement>();
const showDiscard = ref(false); const showRemove = ref(false); const pendingRemove = ref<FormImage | null>(null);
const dirty = ref(false);
const readyAssetIds = computed(() => images.value.filter((image) => image.status === 'ready').map((image) => image.assetId));
const hasUploading = computed(() => images.value.some((image) => image.status === 'uploading'));

function markDirty() { dirty.value = true; }
function backTarget() { return editing.value ? `/products/${route.params.id}` : '/products'; }
function requestClose() { if (dirty.value) showDiscard.value = true; else void router.push(backTarget()); }
function validate() {
  nameError.value = name.value.trim() ? '' : '请填写商品名称';
  priceError.value = !referencePrice.value.trim() || /^\d+(\.\d)?$/.test(referencePrice.value.trim()) ? '' : '请输入非负金额，最多保留一位小数';
  return !nameError.value && !priceError.value;
}
async function load() {
  if (!editing.value || !store.selectedWorkspaceId) return;
  loading.value = true; error.value = '';
  try {
    const { data } = await api.get<Product>(`/workspaces/${store.selectedWorkspaceId}/products/${route.params.id}`);
    name.value = data.name; description.value = data.description ?? ''; referencePrice.value = data.referencePrice ?? '';
    images.value = data.images.map((image) => ({ ...image, status: 'ready', persisted: true })); dirty.value = false;
  } catch { error.value = '商品资料加载失败，请返回后重试'; }
  finally { loading.value = false; }
}
async function addFiles(files: FileList | null) {
  if (!files || !store.selectedWorkspaceId) return;
  const selected = Array.from(files).slice(0, 5 - images.value.length);
  if (selected.length < files.length) showFailToast('每个商品最多上传 5 张图片');
  for (const file of selected) {
    const temporary: FormImage = { assetId: '', url: URL.createObjectURL(file), status: 'uploading', file, persisted: false };
    images.value.push(temporary); markDirty();
    // 从响应式数组中取回代理对象；异步完成后必须更新它，才能驱动上传状态和保存按钮刷新。
    const image = images.value[images.value.length - 1]!;
    try {
      const uploaded = await uploadWorkspaceImage(store.selectedWorkspaceId, file, (assetId) => { image.assetId = assetId; });
      Object.assign(image, { assetId: uploaded.assetId, url: uploaded.url, status: 'ready' });
    } catch { image.status = 'error'; showFailToast(`“${file.name}”上传失败，可重试或删除`); }
  }
  if (fileInput.value) fileInput.value.value = '';
}
async function retry(image: FormImage) {
  if (!image.file || !store.selectedWorkspaceId) return;
  image.status = 'uploading';
  try { const uploaded = await uploadWorkspaceImage(store.selectedWorkspaceId, image.file, (assetId) => { image.assetId = assetId; }); Object.assign(image, { assetId: uploaded.assetId, url: uploaded.url, status: 'ready' }); }
  catch { image.status = 'error'; showFailToast('图片上传失败，请稍后重试'); }
}
function moveFirst(index: number) { images.value.unshift(images.value.splice(index, 1)[0]); markDirty(); }
function requestRemove(image: FormImage) { pendingRemove.value = image; showRemove.value = true; }
async function confirmRemove() {
  const image = pendingRemove.value; if (!image) return;
  images.value = images.value.filter((item) => item !== image); markDirty(); showRemove.value = false; pendingRemove.value = null;
  if (!image.persisted && image.status === 'ready' && store.selectedWorkspaceId) { try { await deleteWorkspaceImage(store.selectedWorkspaceId, image.assetId); } catch { /* Unattached cleanup can be retried server-side. */ } }
  if (image.url?.startsWith('blob:')) URL.revokeObjectURL(image.url);
}
async function save() {
  if (!store.selectedWorkspaceId || saving.value || !validate()) return;
  if (hasUploading.value) { showFailToast('图片仍在上传中，请稍候'); return; }
  if (images.value.some((image) => image.status === 'error')) { showFailToast('请重试或删除上传失败的图片'); return; }
  saving.value = true;
  const payload = { name: name.value.trim(), description: description.value.trim(), referencePrice: referencePrice.value.trim() || null, assetIds: readyAssetIds.value };
  try {
    if (editing.value) { await api.patch(`/workspaces/${store.selectedWorkspaceId}/products/${route.params.id}`, payload); showSuccessToast('商品已保存'); dirty.value = false; await router.replace(`/products/${route.params.id}`); }
    else { await api.post(`/workspaces/${store.selectedWorkspaceId}/products`, payload); showSuccessToast('商品已创建'); dirty.value = false; await router.replace('/products'); }
  } catch (requestError: unknown) {
    const message = (requestError as { response?: { data?: { message?: string } } }).response?.data?.message;
    showFailToast(message || '商品保存失败，请稍后重试');
  } finally { saving.value = false; }
}
onMounted(async () => { if (!store.workspaces.length) await store.load(); if (!store.canEditProducts) { error.value = '当前角色没有编辑商品权限'; loading.value = false; return; } await load(); });
</script>

<template>
  <div class="form-page" data-ai-id="product-form-page">
    <van-nav-bar :title="editing ? '编辑商品' : '新建商品'" left-text="返回" left-arrow data-ai-id="product-form-topbar" @click-left="requestClose" />
    <div v-if="loading" class="page-state"><van-loading>正在加载商品…</van-loading></div>
    <van-empty v-else-if="error" :description="error" data-ai-id="product-list-error"><van-button type="primary" size="small" @click="router.push('/products')">返回商品列表</van-button></van-empty>
    <main v-else class="content"><p class="form-note">商品资料属于当前工作区，第一张图片会显示在商品列表中。</p>
      <form data-ai-id="product-form" @submit.prevent="save">
        <van-field v-model="name" label="商品名称" placeholder="例如：复古牛仔外套" :error-message="nameError" required data-ai-id="product-name" @update:model-value="markDirty" /><span v-if="nameError" class="field-ai-error" data-ai-id="product-form-name-error">{{ nameError }}</span>
        <section class="image-section" data-ai-id="product-image-section"><div class="section-head"><div><strong>商品图片</strong><small>最多 5 张，第一张为列表首图</small></div><van-button plain size="small" :disabled="images.length >= 5" data-ai-id="product-image-add" @click="fileInput?.click()">{{ images.length >= 5 ? '最多 5 张' : '添加图片' }}</van-button></div><input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden data-ai-id="product-image-input" @change="addFiles(($event.target as HTMLInputElement).files)">
          <div v-if="!images.length" class="image-empty" data-ai-id="product-image-list">暂无图片</div>
          <div v-else class="image-grid" data-ai-id="product-image-list"><article v-for="(image, index) in images" :key="image.assetId" class="image-item" :data-ai-id="image.status === 'ready' ? `product-image-item-${image.assetId}` : image.status === 'uploading' ? 'product-image-uploading' : 'product-image-upload-error'"><template v-if="image.status === 'ready'"><img :src="image.url || ''" alt="商品图片"><span v-if="index === 0" class="cover-badge" :data-ai-id="`product-image-first-${image.assetId}`">首图</span><div class="image-actions"><button type="button" :disabled="index === 0" :data-ai-id="`product-image-move-first-${image.assetId}`" @click="moveFirst(index)">{{ index === 0 ? '当前首图' : '移到首图' }}</button><button type="button" :data-ai-id="`product-image-remove-${image.assetId}`" aria-label="删除图片" title="删除图片" @click="requestRemove(image)">⌫</button></div></template><template v-else><div class="upload-state">{{ image.status === 'uploading' ? '图片上传中…' : '上传失败' }}<button v-if="image.status === 'error'" type="button" :data-ai-id="`product-image-retry-${image.assetId}`" @click="retry(image)">重试</button><button v-if="image.status === 'error'" type="button" aria-label="删除图片" @click="requestRemove(image)">删除</button></div></template></article></div>
        </section>
        <van-field v-model="description" rows="4" autosize type="textarea" label="商品描述" placeholder="记录材质、规格或品相等基础信息" data-ai-id="product-description" @update:model-value="markDirty" />
        <van-field v-model="referencePrice" label="参考价（元）" inputmode="decimal" placeholder="可选，例如 99.9" :error-message="priceError" data-ai-id="product-reference-price" @update:model-value="markDirty" /><span v-if="priceError" class="field-ai-error" data-ai-id="product-form-price-error">{{ priceError }}</span>
      </form>
    </main>
    <footer v-if="!loading && !error" class="form-actions"><van-button data-ai-id="product-form-cancel" @click="requestClose">取消</van-button><van-button type="primary" :loading="saving" :disabled="hasUploading" data-ai-id="product-form-submit" @click="save">保存商品</van-button></footer>
    <p v-if="saving" class="saving" data-ai-id="product-form-saving">正在保存，请稍候…</p>
  </div>
  <van-popup v-model:show="showDiscard" class="confirm-popup" round data-ai-id="product-discard-confirm"><section><h2>放弃未保存变更？</h2><p>返回后本次填写内容不会保存。</p><footer><van-button data-ai-id="product-discard-cancel" @click="showDiscard = false">继续编辑</van-button><van-button type="primary" data-ai-id="product-discard-confirm-action" @click="router.push(backTarget())">放弃变更</van-button></footer></section></van-popup>
  <van-popup v-model:show="showRemove" class="confirm-popup" round data-ai-id="product-image-remove-confirm"><section><h2>移除这张图片？</h2><p>这只会从当前商品移除图片关联，不会删除已关联的图片资源。</p><footer><van-button data-ai-id="product-image-remove-cancel" @click="showRemove = false">保留图片</van-button><van-button type="danger" data-ai-id="product-image-remove-confirm-action" @click="confirmRemove">移除图片</van-button></footer></section></van-popup>
</template>

<style scoped>
.form-page { min-height:100vh; padding-bottom:76px; background:#f5f7fb; }.form-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:3; }.page-state { display:grid; min-height:60vh; place-items:center; }.content { padding:20px 16px 24px; }.form-note { margin:0 0 16px; color:#7b879a; font-size:13px; }.content :deep(.van-field) { margin-bottom:12px; border-radius:9px; background:#fff; }.field-ai-error { display:block; margin:-8px 0 10px 16px; color:#b42318; font-size:12px; }.image-section { margin:4px 0 14px; padding:13px; border-radius:10px; background:#fff; }.section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }.section-head strong,.section-head small { display:block; }.section-head strong { color:#364152; font-size:14px; }.section-head small { margin-top:3px; color:#7b879a; font-size:11px; }.section-head :deep(.van-button) { min-height:36px; }.image-empty { display:grid; min-height:104px; place-items:center; border:1px dashed #b5c0d7; border-radius:9px; color:#7b879a; font-size:13px; }.image-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }.image-item { position:relative; min-height:120px; overflow:hidden; border:1px solid #e4e8f0; border-radius:9px; background:#edf1f7; }.image-item img { display:block; width:100%; height:88px; object-fit:cover; }.cover-badge { position:absolute; top:5px; left:5px; padding:2px 5px; border-radius:4px; background:#172033cc; color:#fff; font-size:10px; font-weight:700; }.image-actions { display:grid; height:32px; grid-template-columns:1fr 36px; border-top:1px solid #e4e8f0; background:#fff; }.image-actions button { padding:0 3px; border:0; background:#fff; color:#3657c8; font-size:11px; font-weight:700; }.image-actions button + button { border-left:1px solid #e4e8f0; color:#b42318; font-size:17px; }.upload-state { display:grid; height:120px; place-items:center; align-content:center; gap:6px; color:#536078; font-size:12px; text-align:center; }.upload-state button { min-height:28px; border:0; background:transparent; color:#3657c8; font-size:12px; }.form-actions { position:fixed; z-index:4; right:0; bottom:0; left:0; display:grid; grid-template-columns:1fr 1.3fr; gap:8px; max-width:480px; margin:auto; padding:12px 16px max(12px,env(safe-area-inset-bottom)); border-top:1px solid #e4e8f0; background:#fff; }.form-actions :deep(.van-button) { min-height:44px; }.saving { position:fixed; z-index:5; right:16px; bottom:82px; left:16px; max-width:448px; margin:auto; padding:9px; border-radius:8px; background:#eef2ff; color:#3657c8; font-size:12px; text-align:center; }.confirm-popup { width:calc(100% - 40px); max-width:360px; }.confirm-popup section { padding:20px; }.confirm-popup h2 { margin:0 0 8px; color:#172033; font-size:18px; }.confirm-popup p { margin:0; color:#536078; font-size:13px; }.confirm-popup footer { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }.confirm-popup :deep(.van-button) { min-height:40px; }
</style>
