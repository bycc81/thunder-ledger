<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Product } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';
import { useWorkspaceStore, type WorkspaceRole } from '../stores/workspace';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const products = ref<Product[]>([]);
const keyword = ref('');
const loading = ref(false);
const error = ref('');
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
let requestVersion = 0;

const readonly = computed(() => !store.canEditProducts);
const roleText = (role?: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role ?? 'viewer']);
function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function load() {
  if (!store.selectedWorkspaceId) return;
  const version = ++requestVersion;
  loading.value = true; error.value = '';
  try {
    const { data } = await api.get<Product[]>(`/workspaces/${store.selectedWorkspaceId}/products`, { params: keyword.value.trim() ? { q: keyword.value.trim() } : undefined });
    if (version === requestVersion) products.value = data;
  } catch { if (version === requestVersion) error.value = '商品列表加载失败，请重试'; }
  finally { if (version === requestVersion) loading.value = false; }
}
function clearSearch() { keyword.value = ''; }
function openProduct(product: Product) { void router.push({ path: `/products/${product.id}`, query: keyword.value ? { q: keyword.value } : undefined }); }
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
watch(keyword, () => { void load(); });
</script>

<template>
  <MobileShell page="products" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="products-page" data-ai-id="product-list-page">
      <header class="page-heading" data-ai-id="product-list-header"><h1>商品</h1><van-button v-if="store.canEditProducts" type="primary" data-ai-id="product-create" @click="router.push('/products/new')">新建</van-button></header>
      <van-search v-model="keyword" :disabled="loading" shape="round" placeholder="搜索商品名称" data-ai-id="product-search"><template v-if="keyword" #right-icon><button class="clear-search" type="button" data-ai-id="product-search-clear" aria-label="清除搜索" @click="clearSearch">×</button></template></van-search>
      <p v-if="readonly" class="readonly-notice" data-ai-id="product-list-readonly-notice"><strong>查看者模式</strong> · {{ roleText(store.selectedWorkspace?.role) }}只能查看商品资料。</p>
      <div v-if="loading" class="state-card" data-ai-id="product-list-loading"><van-loading>正在加载商品…</van-loading></div>
      <van-empty v-else-if="error" :description="error" data-ai-id="product-list-error"><van-button type="primary" size="small" data-ai-id="product-list-retry" @click="load">重试</van-button></van-empty>
      <van-empty v-else-if="!products.length && keyword" description="未找到匹配商品" data-ai-id="product-search-empty"><van-button size="small" data-ai-id="product-search-empty-clear" @click="clearSearch">清除搜索</van-button></van-empty>
      <van-empty v-else-if="!products.length" description="还没有商品资料" data-ai-id="product-list-empty" />
      <div v-else class="product-list" data-ai-id="product-list">
        <button v-for="product in products" :key="product.id" class="product-item" type="button" :data-ai-id="`product-item-${product.id}`" @click="openProduct(product)">
          <img v-if="product.firstImage" class="cover" :src="product.firstImage" alt="" :data-ai-id="`product-list-cover-${product.id}`">
          <span v-else class="cover no-image" :data-ai-id="`product-list-no-image-${product.id}`">无图</span>
          <span class="product-main"><strong>{{ product.name }}</strong><small>{{ product.description || '未填写描述' }}</small><em>{{ product.referencePrice === null ? '未设置参考价' : `参考价 ¥${product.referencePrice}` }}</em></span><span class="arrow" aria-hidden="true">›</span>
        </button>
      </div>
    </section>
  </MobileShell>
  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" @selected="load" />
  <span hidden data-ai-id="product-success-toast" aria-live="polite"></span>
</template>

<style scoped>
.products-page { padding-bottom:8px; }
.page-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.page-heading h1 { margin:0; color:#172033; font-size:24px; }
.page-heading :deep(.van-button) { min-height:40px; }
.clear-search { min-width:32px; min-height:40px; border:0; background:transparent; color:#8993a7; font-size:20px; }
.readonly-notice { margin:10px 0 14px; padding:10px 12px; border-radius:9px; background:#eef1f6; color:#536078; font-size:12px; }
.readonly-notice strong { color:#172033; }
.state-card { display:grid; min-height:180px; place-items:center; border-radius:10px; background:#fff; }
.product-list { overflow:hidden; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.product-item { display:grid; width:100%; min-height:88px; grid-template-columns:64px minmax(0,1fr) 16px; gap:12px; align-items:center; padding:12px; border:0; border-bottom:1px solid #e4e8f0; background:#fff; color:#172033; text-align:left; }
.product-item:last-child { border-bottom:0; }.product-item:active,.product-item:focus-visible { background:#edf1ff; outline:2px solid #3657c8; outline-offset:-2px; }
.cover { display:grid; width:64px; height:64px; place-items:center; overflow:hidden; border-radius:9px; background:#edf1f7; color:#7b879a; object-fit:cover; font-size:12px; }.no-image { border:1px solid #dce2ee; }
.product-main { min-width:0; }.product-main strong,.product-main small,.product-main em { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.product-main strong { font-size:15px; }.product-main small { margin-top:5px; color:#7b879a; font-size:12px; }.product-main em { margin-top:5px; color:#536078; font-size:12px; font-style:normal; font-weight:700; }.arrow { color:#8993a7; font-size:20px; }
</style>
