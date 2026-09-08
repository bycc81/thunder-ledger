<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Product } from '../api';
import { useWorkspaceStore } from '../stores/workspace';

const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const product = ref<Product | null>(null);
const loading = ref(true);
const error = ref('');
const imageIndex = ref(0);
const preview = ref(false);
const canEdit = computed(() => store.canEditProducts);
const currentImage = computed(() => product.value?.images[imageIndex.value] ?? null);
const returnToList = () => void router.push({ path: '/products', query: route.query.q ? { q: route.query.q } : undefined });
async function load() {
  if (!store.selectedWorkspaceId) return;
  loading.value = true; error.value = '';
  try { const { data } = await api.get<Product>(`/workspaces/${store.selectedWorkspaceId}/products/${route.params.id}`); product.value = data; imageIndex.value = 0; }
  catch { error.value = '商品详情加载失败，请返回列表后重试'; }
  finally { loading.value = false; }
}
function previous() { if (imageIndex.value > 0) imageIndex.value -= 1; }
function next() { if (product.value && imageIndex.value < product.value.images.length - 1) imageIndex.value += 1; }
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
</script>

<template>
  <div class="detail-page" data-ai-id="product-detail-page">
    <van-nav-bar title="商品详情" left-text="返回" left-arrow data-ai-id="product-detail-topbar" @click-left="returnToList" />
    <div v-if="loading" class="page-state"><van-loading>正在加载商品…</van-loading></div>
    <van-empty v-else-if="error" :description="error" data-ai-id="product-list-error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty>
    <main v-else-if="product" class="content">
      <h1>{{ product.name }}</h1>
      <section class="image-section" data-ai-id="product-detail-images">
        <div v-if="!currentImage" class="empty-image">暂无商品图片</div>
        <template v-else>
          <button class="carousel-image" type="button" :data-ai-id="`product-detail-image-${currentImage.assetId}`" :aria-label="`查看第 ${imageIndex + 1} 张图片大图`" @click="preview = true"><img :src="currentImage.url || ''" alt="商品图片"><span>点击查看大图</span></button>
          <div class="carousel-controls"><van-button plain :disabled="imageIndex === 0" data-ai-id="product-image-carousel-previous" @click="previous">上一张</van-button><strong data-ai-id="product-image-carousel-index">第 {{ imageIndex + 1 }} / {{ product.images.length }} 张</strong><van-button plain :disabled="imageIndex === product.images.length - 1" data-ai-id="product-image-carousel-next" @click="next">下一张</van-button></div>
        </template>
      </section>
      <section class="detail-list" data-ai-id="product-detail-content"><div><small>商品描述</small><p>{{ product.description || '未填写描述' }}</p></div><div><small>参考价</small><p>{{ product.referencePrice === null ? '未设置参考价' : `¥${product.referencePrice}` }}</p></div></section>
      <p v-if="!canEdit" class="readonly" data-ai-id="product-detail-readonly-notice"><strong>只读权限</strong><br>当前角色不能编辑此商品。</p>
      <van-button v-else block type="primary" class="edit-button" data-ai-id="product-edit" @click="router.push(`/products/${product.id}/edit`)">编辑商品</van-button>
    </main>
  </div>
  <van-popup v-model:show="preview" position="bottom" :style="{ height: '100%' }" data-ai-id="product-image-preview"><section v-if="currentImage" class="preview"><header><span data-ai-id="product-image-preview-index">第 {{ imageIndex + 1 }} / {{ product?.images.length }} 张</span><button type="button" data-ai-id="product-image-preview-close" aria-label="关闭图片预览" @click="preview = false">×</button></header><img :src="currentImage.url || ''" alt="商品图片大图" data-ai-id="product-image-preview-current"><footer><van-button plain :disabled="imageIndex === 0" data-ai-id="product-image-preview-previous" @click="previous">上一张</van-button><van-button plain :disabled="imageIndex === (product?.images.length ?? 1) - 1" data-ai-id="product-image-preview-next" @click="next">下一张</van-button></footer></section></van-popup>
</template>

<style scoped>
.detail-page { min-height:100vh; background:#f5f7fb; }.detail-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:2; }.page-state { display:grid; min-height:60vh; place-items:center; }.content { padding:20px 16px 32px; }.content h1 { margin:0 0 18px; color:#172033; font-size:26px; line-height:1.25; }
.image-section { margin-bottom:20px; }.empty-image { display:grid; height:184px; place-items:center; border:1px solid #dce2ee; border-radius:12px; background:#edf1f7; color:#7b879a; }.carousel-image { position:relative; display:block; width:100%; height:184px; overflow:hidden; padding:0; border:1px solid #dce2ee; border-radius:12px; background:#edf1f7; }.carousel-image img { width:100%; height:100%; object-fit:contain; }.carousel-image span { position:absolute; right:8px; bottom:8px; left:8px; padding:5px; border-radius:6px; background:#172033b8; color:#fff; font-size:11px; }.carousel-controls { display:grid; grid-template-columns:1fr auto 1fr; gap:8px; align-items:center; margin-top:8px; }.carousel-controls :deep(.van-button) { min-height:40px; }.carousel-controls strong { color:#7b879a; font-size:12px; white-space:nowrap; }
.detail-list { overflow:hidden; border-radius:10px; background:#fff; }.detail-list > div { padding:13px; border-bottom:1px solid #e4e8f0; }.detail-list > div:last-child { border-bottom:0; }.detail-list small { display:block; margin-bottom:6px; color:#7b879a; font-size:12px; }.detail-list p { margin:0; color:#364152; white-space:pre-wrap; }.readonly { margin:16px 0; padding:10px 12px; border-radius:9px; background:#eef1f6; color:#536078; font-size:13px; }.readonly strong { color:#172033; }.edit-button { margin-top:20px; min-height:44px; }
.preview { display:grid; height:100%; grid-template-rows:62px minmax(0,1fr) 72px; background:#111827; color:#fff; }.preview header,.preview footer { display:flex; align-items:center; justify-content:space-between; padding:0 16px; border-color:#ffffff2e; border-style:solid; }.preview header { border-width:0 0 1px; }.preview footer { justify-content:center; gap:12px; border-width:1px 0 0; }.preview header button { min-width:44px; min-height:44px; border:0; background:transparent; color:#fff; font-size:28px; }.preview > img { width:100%; height:100%; padding:16px; object-fit:contain; }.preview footer :deep(.van-button) { min-width:110px; background:#ffffff18; color:#fff; border-color:#ffffff35; }
</style>
