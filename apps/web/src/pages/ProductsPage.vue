<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Product } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import WorkspacePicker from '../components/WorkspacePicker.vue';
import { useWorkspaceStore, type WorkspaceRole } from '../stores/workspace';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const products = ref<Product[]>([]);
type ProductGroup = { id: string; name: string; description: string | null; referencePrice: string | null; firstImage: string | null; variants: Array<{ id: string; name: string | null }> };
const productGroups = ref<ProductGroup[]>([]);
const keyword = ref('');
const queriedKeyword = ref('');
const loading = ref(false);
const error = ref('');
const showWorkspace = ref(false);
const showWorkspaceCreate = ref(false);
const showPurchaseBatch = ref(false);
const selectedPurchaseTarget = ref<{ type: 'group' | 'product'; id: string } | null>(null);
let requestVersion = 0;

const readonly = computed(() => !store.canEditProducts);
const standaloneProducts = computed(() => {
  const variantIds = new Set(productGroups.value.flatMap((group) => group.variants.map((variant) => variant.id)));
  return products.value.filter((product) => !variantIds.has(product.id));
});
const openBatches = computed(() => store.batches.filter((batch) => batch.status === 'open' && ['owner', 'editor'].includes(batch.role)).map((batch) => ({ text: batch.name, value: batch.id })));
const roleText = (role?: WorkspaceRole) => ({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' }[role ?? 'viewer']);
function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function load() {
  if (!store.selectedWorkspaceId) return;
  const version = ++requestVersion;
  loading.value = true; error.value = '';
  try {
    const query = queriedKeyword.value.trim();
    const [productResponse, groupResponse] = await Promise.all([api.get<Product[]>(`/workspaces/${store.selectedWorkspaceId}/products`, { params: query ? { q: query } : undefined }), api.get<ProductGroup[]>(`/workspaces/${store.selectedWorkspaceId}/product-groups`)]);
    if (version === requestVersion) { products.value = productResponse.data; productGroups.value = query ? groupResponse.data.filter((group) => group.name.includes(query) || group.variants.some((variant) => variant.name?.includes(query))) : groupResponse.data; }
  } catch { if (version === requestVersion) error.value = '商品列表加载失败，请重试'; }
  finally { if (version === requestVersion) loading.value = false; }
}
function submitSearch() { queriedKeyword.value = keyword.value; void load(); }
function clearSearch() { keyword.value = ''; queriedKeyword.value = ''; void load(); }
function openProduct(product: Product) { void router.push({ path: `/products/${product.id}`, query: queriedKeyword.value ? { q: queriedKeyword.value } : undefined }); }
function openGroup(groupId: string) { void router.push(`/product-groups/${groupId}`); }
function purchaseAndList(type: 'group' | 'product', id: string) { if (!openBatches.value.length) return; selectedPurchaseTarget.value = { type, id }; showPurchaseBatch.value = true; }
function choosePurchaseBatch({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const batchId = selectedOptions[0]?.value; const target = selectedPurchaseTarget.value; showPurchaseBatch.value = false; if (batchId && target) void router.push(`/batches/${batchId}/inventory/purchases/new?${target.type === 'group' ? 'productGroupId' : 'productId'}=${target.id}`); }
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
</script>

<template>
  <MobileShell page="products" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="products-page" data-ai-id="product-list-page">
      <header class="page-heading" data-ai-id="product-list-header"><h1>商品</h1><div class="create-actions"><span v-if="store.canEditProducts" class="compact-action"><van-button class="tl-button--compact" type="primary" data-ai-id="product-create" @click="router.push('/products/new')">新建商品</van-button></span><span v-if="store.canEditProducts" class="compact-action"><van-button class="tl-button--compact" type="primary" data-ai-id="product-group-create" @click="router.push('/product-groups/new')">新建商品组</van-button></span></div></header>
      <div class="search-row" data-ai-id="product-search-row"><van-search v-model="keyword" :disabled="loading" shape="round" placeholder="搜索商品名称" data-ai-id="product-search"><template v-if="keyword" #right-icon><button class="clear-search" type="button" data-ai-id="product-search-clear" aria-label="清除搜索" @click="clearSearch">×</button></template></van-search><span class="compact-action"><van-button class="tl-button--compact" type="primary" :loading="loading" data-ai-id="product-search-submit" @click="submitSearch">查询</van-button></span></div>
      <p v-if="readonly" class="readonly-notice" data-ai-id="product-list-readonly-notice"><strong>查看者模式</strong> · {{ roleText(store.selectedWorkspace?.role) }}只能查看商品资料。</p>
      <div v-if="loading" class="state-card" data-ai-id="product-list-loading"><van-loading>正在加载商品…</van-loading></div>
      <van-empty v-else-if="error" :description="error" data-ai-id="product-list-error"><van-button type="primary" size="small" data-ai-id="product-list-retry" @click="load">重试</van-button></van-empty>
      <van-empty v-else-if="!standaloneProducts.length && !productGroups.length && queriedKeyword" description="未找到匹配商品" data-ai-id="product-search-empty"><van-button size="small" data-ai-id="product-search-empty-clear" @click="clearSearch">清除搜索</van-button></van-empty>
      <van-empty v-else-if="!standaloneProducts.length && !productGroups.length" description="还没有商品资料" data-ai-id="product-list-empty" />
      <section v-else class="catalog-list" data-ai-id="product-catalog-list"><article v-for="group in productGroups" :key="group.id" class="product-item with-shortcut group-item" role="button" tabindex="0" :data-ai-id="`product-group-item-${group.id}`" @click="openGroup(group.id)" @keydown.enter="openGroup(group.id)"><span class="cover-wrap"><img v-if="group.firstImage" class="cover" :src="group.firstImage" alt="" :data-ai-id="`product-group-list-cover-${group.id}`"><span v-else class="cover no-image" :data-ai-id="`product-group-list-cover-${group.id}`">无图</span><van-tag round type="primary" class="type-tag" :data-ai-id="`product-group-list-type-${group.id}`">商品组</van-tag></span><span class="product-main"><strong>{{ group.name }}</strong><small>{{ group.variants.filter((item) => item.name).map((item) => item.name).join(' · ') || '无款式' }}</small><em>查看商品组详情</em></span><van-button v-if="store.canEditProducts" size="small" plain type="primary" :disabled="!openBatches.length" :data-ai-id="`product-group-purchase-${group.id}`" @click.stop="purchaseAndList('group', group.id)">采购</van-button></article><article v-for="product in standaloneProducts" :key="product.id" class="product-item with-shortcut" role="button" tabindex="0" :data-ai-id="`product-item-${product.id}`" @click="openProduct(product)" @keydown.enter="openProduct(product)"><span class="cover-wrap"><img v-if="product.firstImage" class="cover" :src="product.firstImage" alt="" :data-ai-id="`product-list-cover-${product.id}`"><span v-else class="cover no-image" :data-ai-id="`product-list-no-image-${product.id}`">无图</span><van-tag round type="success" class="type-tag" :data-ai-id="`product-list-type-${product.id}`">商品</van-tag></span><span class="product-main"><strong>{{ product.name }}</strong><small>{{ product.description || '未填写描述' }}</small><em>{{ product.referencePrice === null ? '未设置参考价' : `参考价 ¥${product.referencePrice}` }}</em></span><van-button v-if="store.canEditProducts" size="small" plain type="primary" :disabled="!openBatches.length" :data-ai-id="`product-purchase-${product.id}`" @click.stop="purchaseAndList('product', product.id)">采购</van-button></article></section>
    </section>
  </MobileShell>
  <WorkspacePicker v-model:show="showWorkspace" v-model:show-create="showWorkspaceCreate" @selected="load" />
  <van-popup v-if="selectedPurchaseTarget?.type === 'group'" v-model:show="showPurchaseBatch" position="bottom" round data-ai-id="product-group-purchase-batch-picker"><van-picker title="选择采购批次" :columns="openBatches" @confirm="choosePurchaseBatch" @cancel="showPurchaseBatch = false" /></van-popup>
  <van-popup v-else v-model:show="showPurchaseBatch" position="bottom" round data-ai-id="product-purchase-batch-picker"><van-picker title="选择采购批次" :columns="openBatches" @confirm="choosePurchaseBatch" @cancel="showPurchaseBatch = false" /></van-popup>
  <span hidden data-ai-id="product-success-toast" aria-live="polite"></span>
</template>

<style scoped>
.products-page { padding-bottom:8px; }
.page-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.page-heading h1 { margin:0; color:#172033; font-size:24px; }
.create-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.compact-action{position:relative;display:inline-flex;min-height:44px;align-items:center}.compact-action :deep(.van-button){position:relative;padding:0 10px}.compact-action :deep(.van-button)::after{position:absolute;inset:-4px 0;content:''}.search-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}.search-row :deep(.van-search){min-width:0;flex:1;padding:0;background:transparent}.search-row :deep(.van-search__content){border:1px solid #cfd6e2;background:#fff}.search-row :deep(.compact-action .van-button){min-width:56px}.clear-search { min-width:32px; min-height:40px; border:0; background:transparent; color:#8993a7; font-size:20px; }
.readonly-notice { margin:10px 0 14px; padding:10px 12px; border-radius:9px; background:#eef1f6; color:#536078; font-size:12px; }
.readonly-notice strong { color:#172033; }
.state-card { display:grid; min-height:180px; place-items:center; border-radius:10px; background:#fff; }
.catalog-list { overflow:hidden; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }.group-item{cursor:pointer}.group-item:focus-visible{outline:2px solid #3657c8;outline-offset:-2px}.with-shortcut :deep(.van-button){min-width:52px}
.product-item { display:grid; width:100%; min-height:88px; grid-template-columns:64px minmax(0,1fr) 16px; gap:12px; align-items:center; padding:12px; border:0; border-bottom:1px solid #e4e8f0; background:#fff; color:#172033; text-align:left; }.product-item.with-shortcut{grid-template-columns:64px minmax(0,1fr) auto}
.product-item:last-child { border-bottom:0; }.product-item:active,.product-item:focus-visible { background:#edf1ff; outline:2px solid #3657c8; outline-offset:-2px; }
.cover-wrap{position:relative;width:64px;height:64px}.cover { display:grid; width:64px; height:64px; place-items:center; overflow:hidden; border-radius:9px; background:#edf1f7; color:#7b879a; object-fit:cover; font-size:12px; }.no-image { border:1px solid #dce2ee; }.type-tag{position:absolute;top:3px;right:3px;max-width:56px;overflow:hidden;padding:1px 4px;font-size:10px;line-height:15px;white-space:nowrap}
.product-main { min-width:0; }.product-main strong,.product-main small,.product-main em { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.product-main strong { font-size:15px; }.product-main small { margin-top:5px; color:#7b879a; font-size:12px; }.product-main em { margin-top:5px; color:#536078; font-size:12px; font-style:normal; font-weight:700; }.arrow { color:#8993a7; font-size:20px; }
</style>
