<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type InventoryDetail, type InventoryItem } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import { formatBusinessDate } from '../utils/dateTime';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';

const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const batchId = computed(() => String(route.params.id));
const productId = computed(() => route.params.productId ? String(route.params.productId) : '');
const inventory = ref<InventoryItem[]>([]);
const detail = ref<InventoryDetail | null>(null);
const loading = ref(true);
const error = ref('');
const showAdjustment = ref(false);
const adjustmentQuantity = ref('1');
const adjustmentReason = ref('');
const savingAdjustment = ref(false);
const canEdit = computed(() => {
  const batch = store.batches.find((item) => item.id === batchId.value);
  return Boolean(batch && (batch.role === 'owner' || batch.role === 'editor' || store.canManageWorkspace));
});
const money = (value: string) => `¥${value}`;

async function load() {
  loading.value = true; error.value = '';
  try {
    if (productId.value) {
      detail.value = null;
      detail.value = (await api.get<InventoryDetail>(`/batches/${batchId.value}/inventory/${productId.value}`)).data;
    } else {
      inventory.value = (await api.get<InventoryItem[]>(`/batches/${batchId.value}/inventory`)).data;
    }
  } catch { error.value = productId.value ? '库存详情加载失败，请重试' : '库存加载失败，请重试'; }
  finally { loading.value = false; }
}
function back() { void router.push(productId.value ? `/batches/${batchId.value}/inventory` : `/batches/${batchId.value}`); }
function openItem(item: InventoryItem) { void router.push(`/batches/${batchId.value}/inventory/${item.productId}`); }
function createPurchase() { void router.push(`/batches/${batchId.value}/inventory/purchases/new`); }
function editPurchase(purchase: InventoryDetail['purchases'][number]) { void router.push(`/batches/${batchId.value}/inventory/purchases/${purchase.id}/edit`); }
function selectMoreAction() { showAdjustment.value = true; }
async function createAdjustment() { if (!detail.value || !/^\d+$/.test(adjustmentQuantity.value) || Number(adjustmentQuantity.value) <= 0 || !adjustmentReason.value.trim()) { showFailToast('请填写减少数量和原因'); return; } savingAdjustment.value = true; try { await api.post(`/batches/${batchId.value}/inventory/${productId.value}/adjustments`, { quantity: Number(adjustmentQuantity.value), reason: adjustmentReason.value.trim() }); showSuccessToast('库存已减少'); showAdjustment.value = false; adjustmentQuantity.value = '1'; adjustmentReason.value = ''; await load(); } catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '减少库存失败'); } finally { savingAdjustment.value = false; } }
function shares(purchase: InventoryDetail['purchases'][number]) { return purchase.costShares.map((share) => `${share.username} ¥${share.amount}`).join('、'); }
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
watch([batchId, productId], () => { void load(); });
</script>

<template>
  <div class="inventory-page" :data-ai-id="productId ? 'inventory-detail-page' : 'inventory-list-page'">
    <van-nav-bar :title="productId ? '库存详情' : '库存'" left-text="返回" left-arrow :data-ai-id="productId ? 'inventory-detail-topbar' : 'inventory-list-topbar'" @click-left="back"><template v-if="productId && canEdit" #right><van-popover placement="bottom-end" :actions="[{ text: '登记商品损坏或丢失' }]" data-ai-id="inventory-detail-more-menu" @select="selectMoreAction"><template #reference><van-button class="more-button" plain size="small" aria-label="更多库存操作" data-ai-id="inventory-detail-more">更多操作</van-button></template></van-popover></template></van-nav-bar>
    <div v-if="loading" class="page-state" data-ai-id="inventory-list-loading"><van-loading>正在加载库存…</van-loading></div>
    <van-empty v-else-if="error" :description="error" data-ai-id="inventory-list-error"><van-button type="primary" size="small" data-ai-id="inventory-list-retry" @click="load">重试</van-button></van-empty>
    <main v-else-if="!productId" class="content">
      <header class="page-heading" data-ai-id="inventory-list-header"><div><span class="eyebrow">当前批次</span><h1>库存</h1><p>同一种商品合并在一起卖</p></div><van-button v-if="canEdit" type="primary" data-ai-id="inventory-purchase-create" @click="createPurchase">新增采购</van-button></header>
      <p v-if="!canEdit" class="readonly-notice" data-ai-id="inventory-readonly-notice"><strong>只读权限</strong> · 当前角色只能查看库存。</p>
      <van-empty v-if="!inventory.length" description="本批次还没有库存" data-ai-id="inventory-list-empty"><van-button v-if="canEdit" type="primary" size="small" @click="createPurchase">新增采购</van-button></van-empty>
      <section v-else class="inventory-list" data-ai-id="inventory-list">
        <article v-for="item in inventory" :key="item.productId" class="inventory-item" :data-ai-id="`inventory-item-${item.productId}`" tabindex="0" @click="openItem(item)" @keydown.enter="openItem(item)">
          <div><strong>{{ item.productName }}</strong><span>{{ item.purchaseCount }} 次采购 · 总成本 {{ money(item.totalCost) }}</span></div><div><b :data-ai-id="`inventory-available-${item.productId}`">可卖 {{ item.availableQuantity }} 件</b><van-icon name="arrow" /></div>
        </article>
      </section>
    </main>
    <main v-else-if="detail" class="content">
      <header class="detail-heading"><span class="eyebrow">商品库存</span><h1>{{ detail.productName }}</h1></header>
      <section class="summary" data-ai-id="inventory-summary"><div><small>可卖数量</small><strong>{{ detail.availableQuantity }} 件</strong></div><div><small>采购总成本</small><strong>{{ money(detail.totalCost) }}</strong></div></section>
      <section data-ai-id="inventory-purchase-list"><h2>采购记录</h2><article v-for="purchase in detail.purchases" :key="purchase.id" class="purchase-item" :data-ai-id="`inventory-purchase-item-${purchase.id}`"><div class="purchase-head"><strong>{{ purchase.channelName }}</strong><b>{{ purchase.quantity }} 件 · {{ money(purchase.totalCost) }}</b></div><p>{{ formatBusinessDate(purchase.purchasedOn) }} · {{ purchase.payerUsername }} 付款</p><div class="purchase-cost-row"><small>成本由：{{ shares(purchase) }}</small><button v-if="canEdit" type="button" class="purchase-edit" :data-ai-id="`inventory-purchase-edit-${purchase.id}`" @click="editPurchase(purchase)">编辑</button></div><a v-if="purchase.sourceUrl" :href="purchase.sourceUrl" target="_blank" rel="noreferrer">查看来源</a><p v-if="purchase.note" class="purchase-note">备注：{{ purchase.note }}</p></article></section>
      <section v-if="detail.adjustments.length" class="adjustment-list" data-ai-id="inventory-writeoff-list"><h2>减少库存记录</h2><article v-for="adjustment in detail.adjustments" :key="adjustment.id" class="purchase-item"><div class="purchase-head"><strong>商品损坏或丢失</strong><b>{{ adjustment.quantity }} 件 · {{ money(adjustment.consumedCost) }}</b></div><p>{{ adjustment.reason }}</p><small>{{ formatBusinessDate(adjustment.createdAt) }} · {{ adjustment.createdByUsername }} 登记</small></article></section>
    </main>
    <van-empty v-else description="未找到这件商品的库存记录" data-ai-id="inventory-detail-empty" />
  </div>
  <van-dialog v-model:show="showAdjustment" title="商品损坏或丢失" show-cancel-button :confirm-button-loading="savingAdjustment" data-ai-id="inventory-writeoff-dialog" @confirm="createAdjustment"><p class="adjustment-note">减少后无法恢复，请确认数量和原因。</p><van-field v-model="adjustmentQuantity" label="减少数量" type="digit" placeholder="例如：1" data-ai-id="inventory-writeoff-quantity" /><van-field v-model="adjustmentReason" label="原因" type="textarea" rows="2" placeholder="例如：运输时损坏" data-ai-id="inventory-writeoff-reason" /></van-dialog>
  <AppBottomNavigation />
</template>

<style scoped>
.inventory-page { min-height:100vh; padding-bottom:66px; background:#f5f7fb; }.inventory-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:2; }.more-button { min-width:76px; min-height:44px; border:0; background:transparent; color:#3657c8; }.content { padding:20px 16px 32px; }.page-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:18px; }.page-heading h1,.detail-heading h1 { margin:2px 0 4px; color:#172033; font-size:23px; }.page-heading p { margin:0; color:#71809a; font-size:12px; }.eyebrow { color:#8993a7; font-size:11px; }.page-heading :deep(.van-button) { flex-shrink:0; min-height:40px; }.readonly-notice { margin:0 0 14px; padding:10px 12px; border-radius:8px; background:#edf1ff; color:#2949aa; font-size:13px; }.inventory-list { display:grid; gap:8px; }.inventory-item { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:76px; padding:12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; cursor:pointer; }.inventory-item:focus-visible { outline:2px solid #3657c8; outline-offset:1px; }.inventory-item strong,.inventory-item span { display:block; }.inventory-item strong { margin-bottom:6px; font-size:15px; }.inventory-item span { color:#71809a; font-size:12px; }.inventory-item > div:last-child { display:flex; flex-shrink:0; align-items:center; gap:8px; color:#3657c8; }.inventory-item b { font-size:13px; }.summary { display:grid; grid-template-columns:1fr 1fr; gap:1px; overflow:hidden; margin:16px 0 18px; border-radius:10px; background:#e4e8f0; }.summary div { padding:13px; background:#fff; }.summary small { display:block; color:#71809a; font-size:12px; }.summary strong { display:block; margin-top:6px; color:#172033; font-size:18px; }.content h2 { margin:0 0 9px; font-size:17px; }.purchase-item { position:relative; margin-top:8px; padding:12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }.purchase-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }.purchase-head b { color:#3657c8; font-size:13px; }.purchase-item p { margin:7px 0 4px; color:#71809a; font-size:12px; }.purchase-item small { min-width:0; color:#536078; font-size:12px; }.purchase-cost-row { display:flex; min-height:36px; align-items:center; justify-content:space-between; gap:10px; }.purchase-cost-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.purchase-item a { display:block; margin-top:8px; color:#3657c8; font-size:12px; }.purchase-note { color:#536078 !important; }.purchase-edit { flex:0 0 auto; min-height:36px; padding:0 4px; border:0; background:transparent; color:#3657c8; font:inherit; font-size:13px; }.adjustment-list { margin-top:26px; }.adjustment-note { margin:0; padding:0 16px 10px; color:#71809a; font-size:13px; }.page-state { display:grid; min-height:60vh; place-items:center; }
</style>
