<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type InventoryPurchase, type ManualChannel, type Product } from '../api';
import { useWorkspaceStore, type BatchMember } from '../stores/workspace';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';

type Share = { userId: string; amount: string };
type ProductGroup = { id: string; name: string; variants: Array<{ id: string; name: string | null }> };
const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const batchId = String(route.params.id);
const purchaseId = route.params.purchaseId ? String(route.params.purchaseId) : '';
const isEditing = Boolean(purchaseId);
const productGroupId = ref(typeof route.query.productGroupId === 'string' ? route.query.productGroupId : '');
const groupMode = computed(() => Boolean(productGroupId.value && !isEditing));
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const products = ref<Product[]>([]);
const group = ref<ProductGroup | null>(null);
const productGroups = ref<ProductGroup[]>([]);
const groupVariants = ref<Array<{ productId: string; name: string; quantity: string; unitPrice: string }>>([]);
const channels = ref<ManualChannel[]>([]);
const participants = ref<BatchMember[]>([]);
const productId = ref(!isEditing && typeof route.query.productId === 'string' ? route.query.productId : '');
const channelId = ref('');
const payerUserId = ref('');
const quantity = ref('1');
const totalCost = ref('');
const groupCostToDistribute = ref('');
const occurredAt = ref(localDateTime(new Date().toISOString()));
const sourceUrl = ref('');
const note = ref('');
const costCorrectionReason = ref('');
const shares = ref<Share[]>([]);
const hasSales = ref(false);
const hasInventoryAdjustments = ref(false);
const corrections = ref<Array<{ id: string; reason: string; createdAt: string; createdByUsername: string }>>([]);
const showPurchaseTargetPicker = ref(false);
const showChannelPicker = ref(false);
const showChannelCreate = ref(false);
const newChannelName = ref('');
const creatingChannel = ref(false);
const selectedShares = computed(() => new Set(shares.value.map((share) => share.userId)));
const unitPricePattern = /^\d+(\.\d{1,6})?$/;
function lineTotalCents(item: { quantity: string; unitPrice: string }) { return /^\d+$/.test(item.quantity) && Number(item.quantity) > 0 && unitPricePattern.test(item.unitPrice) ? Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) : null; }
function moneyText(cents: number) { return (cents / 100).toFixed(2); }
const groupTotalCents = computed(() => groupVariants.value.reduce((sum, item) => sum + (lineTotalCents(item) ?? 0), 0));
const groupInputComplete = computed(() => groupVariants.value.length > 0 && groupVariants.value.every((item) => lineTotalCents(item) !== null));
const groupTotalCost = computed(() => groupInputComplete.value ? moneyText(groupTotalCents.value) : '—');
const effectiveTotalCost = computed(() => groupMode.value ? groupTotalCost.value : totalCost.value);
const totalValid = computed(() => /^\d+(\.\d{1,2})?$/.test(effectiveTotalCost.value) && Math.round(shares.value.reduce((sum, share) => sum + (Number(share.amount) || 0), 0) * 100) === Math.round(Number(effectiveTotalCost.value) * 100));
const groupCostsValid = computed(() => groupVariants.value.length > 0 && groupVariants.value.every((item) => lineTotalCents(item) !== null));
const blockedByAdjustment = computed(() => hasInventoryAdjustments.value);
const purchaseTargetOptions = computed(() => {
  const variantIds = new Set(productGroups.value.flatMap((item) => item.variants.map((variant) => variant.id)));
  return [...productGroups.value.map((item) => ({ text: `商品组 · ${item.name}`, value: `group:${item.id}` })), ...products.value.filter((item) => !variantIds.has(item.id)).map((item) => ({ text: item.name, value: `product:${item.id}` }))];
});
const purchaseTargetName = computed(() => groupMode.value ? `商品组 · ${group.value?.name ?? ''}` : products.value.find((item) => item.id === productId.value)?.name ?? '选择商品或商品组');
const channelName = computed(() => channels.value.find((item) => item.id === channelId.value)?.name ?? '选择渠道');

function distributeGroupCost() {
  if (!/^\d+(\.\d{1,2})?$/.test(groupCostToDistribute.value)) return showFailToast('请填写采购总金额');
  if (!groupVariants.value.every((item) => /^\d+$/.test(item.quantity) && Number(item.quantity) > 0)) return showFailToast('请填写所有款式数量');
  const totalCents = Math.round(Number(groupCostToDistribute.value) * 100);
  const totalQuantity = groupVariants.value.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (!totalQuantity) return showFailToast('请填写所有款式数量');
  let allocated = 0;
  groupVariants.value.forEach((item, index) => {
    const amount = index === groupVariants.value.length - 1 ? totalCents - allocated : Math.floor(totalCents * Number(item.quantity) / totalQuantity);
    item.unitPrice = (amount / (Number(item.quantity) * 100)).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    allocated += amount;
  });
}

function back() { void router.push(`/batches/${batchId}/inventory`); }
function localDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function load() {
  loading.value = true;
  try {
    const [product, channel, members, purchase, groups] = await Promise.all([
      api.get<Product[]>(`/workspaces/${store.selectedWorkspaceId}/products`),
      api.get<ManualChannel[]>(`/batches/${batchId}/channels`),
      api.get<BatchMember[]>(`/batches/${batchId}/members`),
      isEditing ? api.get<InventoryPurchase>(`/batches/${batchId}/purchases/${purchaseId}`) : Promise.resolve(null),
      api.get<ProductGroup[]>(`/workspaces/${store.selectedWorkspaceId}/product-groups`)
    ]);
    products.value = product.data;
    channels.value = channel.data;
    participants.value = members.data;
    productGroups.value = groups.data;
    if (productGroupId.value) selectGroup(productGroupId.value);
    else if (productId.value && !products.value.some((item) => item.id === productId.value)) showFailToast('商品不存在或已删除');
    if (purchase) {
      const value = purchase.data;
      productId.value = value.productId;
      channelId.value = value.channelId;
      payerUserId.value = value.payerUserId;
      quantity.value = String(value.quantity);
      totalCost.value = value.totalCost;
      occurredAt.value = localDateTime(value.occurredAt);
      sourceUrl.value = value.sourceUrl ?? '';
      note.value = value.note ?? '';
      shares.value = value.costShares.map((share) => ({ userId: share.userId, amount: share.amount }));
      hasSales.value = Boolean(value.hasSales);
      hasInventoryAdjustments.value = Boolean(value.hasInventoryAdjustments);
      corrections.value = value.corrections ?? [];
    }
  } catch {
    error.value = '采购表单加载失败，请返回后重试';
  } finally {
    loading.value = false;
  }
}
function addShare() {
  const member = participants.value.find((item) => !selectedShares.value.has(item.id));
  if (member) shares.value.push({ userId: member.id, amount: '' });
}
function removeShare(index: number) { shares.value.splice(index, 1); }
function distributeCostShares() {
  if (!/^\d+(\.\d{1,2})?$/.test(effectiveTotalCost.value)) return showFailToast('请先填写完整的采购金额');
  if (!shares.value.length) return showFailToast('请先添加成本承担成员');
  const totalCents = Math.round(Number(effectiveTotalCost.value) * 100);
  const base = Math.floor(totalCents / shares.value.length);
  let allocated = 0;
  shares.value.forEach((share, index) => {
    const amount = index === shares.value.length - 1 ? totalCents - allocated : base;
    share.amount = moneyText(amount);
    allocated += amount;
  });
}
function selectGroup(id: string) { const selected = productGroups.value.find((item) => item.id === id) ?? null; if (!selected) return showFailToast('商品组不存在'); group.value = selected; productGroupId.value = id; productId.value = ''; groupVariants.value = selected.variants.map((item) => ({ productId: item.id, name: item.name ?? selected.name, quantity: '1', unitPrice: '' })); }
function choosePurchaseTarget({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { const value = selectedOptions[0]?.value ?? ''; showPurchaseTargetPicker.value = false; if (value.startsWith('group:')) { selectGroup(value.slice(6)); return; } if (value.startsWith('product:')) { productGroupId.value = ''; group.value = null; groupVariants.value = []; productId.value = value.slice(8); } }
function chooseChannel({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) { channelId.value = selectedOptions[0]?.value ?? ''; showChannelPicker.value = false; }
async function createChannel() { const name = newChannelName.value.trim(); if (!name) return showFailToast('请填写渠道名称'); creatingChannel.value = true; try { const channel = (await api.post<ManualChannel>(`/batches/${batchId}/channels`, { name })).data; channels.value = [...channels.value, channel].sort((left, right) => left.name.localeCompare(right.name)); channelId.value = channel.id; newChannelName.value = ''; showChannelCreate.value = false; showSuccessToast('渠道已新增并选中'); } catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '新增渠道失败'); } finally { creatingChannel.value = false; } }
async function save() {
  if (blockedByAdjustment.value) {
    showFailToast('该商品已有报损或丢失记录，暂不支持更正采购');
    return;
  }
  if ((!groupMode.value && !productId.value) || !channelId.value || !payerUserId.value || (!groupMode.value && !/^\d+$/.test(quantity.value)) || !totalValid.value || (groupMode.value && !groupCostsValid.value) || !occurredAt.value || !shares.value.length || (hasSales.value && !costCorrectionReason.value.trim())) {
    showFailToast(hasSales.value ? '请填写完整信息和更正原因' : '请补全采购信息');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      productId: productId.value,
      channelId: channelId.value,
      payerUserId: payerUserId.value,
      quantity: Number(quantity.value),
      totalCost: effectiveTotalCost.value,
      costShares: shares.value,
      occurredAt: new Date(occurredAt.value).toISOString(),
      sourceUrl: sourceUrl.value || null,
      note: note.value || null,
      costCorrectionReason: costCorrectionReason.value || null
    };
    const response = groupMode.value ? await api.post<{ purchaseIds: string[] }>(`/batches/${batchId}/group-purchases`, { ...payload, variants: groupVariants.value.map((item) => ({ productId: item.productId, quantity: Number(item.quantity), totalCost: moneyText(lineTotalCents(item) ?? 0) })) }) : isEditing
      ? await api.patch<{ adjustmentCount?: number }>(`/batches/${batchId}/purchases/${purchaseId}`, payload)
      : await api.post(`/batches/${batchId}/purchases`, payload);
    showSuccessToast(response.data.adjustmentCount ? `更正已保存，生成 ${response.data.adjustmentCount} 张调整单` : '采购已保存');
    await router.replace(groupMode.value ? `/batches/${batchId}/inventory` : `/batches/${batchId}/inventory/${productId.value}`);
  } catch (requestError: unknown) {
    showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '采购保存失败');
  } finally {
    saving.value = false;
  }
}
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
watch(groupTotalCost, (value) => { if (value !== '—') groupCostToDistribute.value = value; });
</script>

<template>
  <div class="purchase-form-page" data-ai-id="inventory-purchase-form-page">
    <van-nav-bar :title="groupMode ? `采购 ${group?.name || ''}` : (hasSales ? '更正采购' : (isEditing ? '编辑采购' : '新增采购'))" left-text="返回" left-arrow @click-left="back" />
    <main v-if="!loading && !error" class="content">
      <p class="form-note">{{ groupMode ? '商品组采购会按款式分别入库和核算；总成本与承担合计必须一致。' : '同一种商品合并核算，按移动平均成本计价；销售不对应某条采购记录。' }}</p>
      <p v-if="hasSales" class="correction-note" data-ai-id="inventory-purchase-correction-notice">该采购已有销售。可更正数量、总成本、付款人和成本承担；商品、采购渠道、采购时间不可修改。</p>
      <p v-if="blockedByAdjustment" class="blocked-note" data-ai-id="inventory-purchase-adjustment-blocked">该商品已有报损或丢失记录，当前版本不支持更正采购。</p>
      <form @submit.prevent="save">
        <van-field :model-value="purchaseTargetName" label="商品" required readonly is-link :disabled="isEditing" data-ai-id="inventory-purchase-target" @click="!isEditing && (showPurchaseTargetPicker = true)" />
        <section v-if="groupMode" class="group-variants" data-ai-id="group-purchase-variants"><div class="section-head"><strong>商品组</strong><span>{{ group?.name }}</span></div><p class="group-cost-help">可直接填写采购总金额后按数量均摊，或逐款填写数量和单价，系统会自动汇总金额。</p><div class="group-cost-actions" data-ai-id="group-purchase-total"><van-field v-model="groupCostToDistribute" label="采购总金额" inputmode="decimal" placeholder="例如：99.90" data-ai-id="group-purchase-total-input" /><van-button size="small" plain type="primary" data-ai-id="group-purchase-distribute-cost" @click="distributeGroupCost">按数量均摊单价</van-button></div><div v-for="item in groupVariants" :key="item.productId" class="group-variant" :data-ai-id="`group-purchase-variant-${item.productId}`"><van-field :model-value="item.name" label="款式" readonly :data-ai-id="`group-purchase-name-${item.productId}`" /><van-field v-model="item.quantity" label="数量" type="digit" required :data-ai-id="`group-purchase-quantity-${item.productId}`" /><van-field v-model="item.unitPrice" label="单价" inputmode="decimal" required :data-ai-id="`group-purchase-unit-price-${item.productId}`" /><van-field :model-value="lineTotalCents(item) === null ? '' : moneyText(lineTotalCents(item)!)" label="款式总额" readonly :data-ai-id="`group-purchase-amount-${item.productId}`" /></div><small :class="{ invalid: !groupCostsValid }">请填写每个款式的数量和单价</small></section>
        <van-field :model-value="channelName" label="采购渠道" required readonly is-link :disabled="hasSales || blockedByAdjustment" data-ai-id="inventory-purchase-channel" @click="!hasSales && !blockedByAdjustment && (showChannelPicker = true)"><template #button><van-button size="small" plain :disabled="hasSales || blockedByAdjustment" data-ai-id="inventory-purchase-channel-add" @click.stop="showChannelCreate = true">新增</van-button></template></van-field>
        <van-field label="付款人" required>
          <template #input><select v-model="payerUserId" :disabled="blockedByAdjustment"><option value="" disabled>选择付款人</option><option v-for="item in participants" :key="item.id" :value="item.id">{{ item.username }}</option></select></template>
        </van-field>
        <van-field v-if="!groupMode" v-model="quantity" label="数量" type="digit" required :disabled="blockedByAdjustment" />
        <van-field v-if="!groupMode" v-model="totalCost" label="总成本" inputmode="decimal" required :disabled="blockedByAdjustment" />
        <van-field v-model="occurredAt" label="采购时间" type="datetime-local" required :readonly="hasSales || blockedByAdjustment" :disabled="blockedByAdjustment" data-ai-id="inventory-purchase-occurred-at" />
        <section class="share-section" data-ai-id="inventory-cost-share-list">
          <div class="section-head"><strong>成本由谁承担</strong><div class="share-actions"><van-button size="small" plain type="primary" :disabled="!shares.length || blockedByAdjustment" data-ai-id="inventory-cost-share-distribute" @click="distributeCostShares">均摊成本</van-button><van-button size="small" plain :disabled="shares.length >= participants.length || blockedByAdjustment" data-ai-id="inventory-cost-share-add" @click="addShare">添加成员</van-button></div></div>
          <div v-for="(share, index) in shares" :key="share.userId" class="share-row">
            <select v-model="share.userId" :disabled="blockedByAdjustment"><option v-for="member in participants" :key="member.id" :value="member.id">{{ member.username }}</option></select>
            <input v-model="share.amount" inputmode="decimal" placeholder="承担金额" :disabled="blockedByAdjustment">
            <button type="button" :disabled="blockedByAdjustment" @click="removeShare(index)">删除</button>
          </div>
          <small :class="{ invalid: !totalValid }">成本承担合计必须等于总成本</small>
        </section>
        <van-field v-if="hasSales" v-model="costCorrectionReason" label="更正原因" type="textarea" rows="2" required :disabled="blockedByAdjustment" data-ai-id="inventory-purchase-correction-reason" />
        <van-field v-model="sourceUrl" label="来源链接" :disabled="blockedByAdjustment" />
        <van-field v-model="note" label="备注" type="textarea" rows="2" :disabled="blockedByAdjustment" />
        <section v-if="corrections.length" data-ai-id="inventory-purchase-history"><h2>更正历史</h2><p v-for="item in corrections" :key="item.id">{{ item.createdByUsername }}：{{ item.reason }}</p></section>
        <div class="form-footer"><van-button block type="primary" native-type="submit" :loading="saving" :disabled="blockedByAdjustment" data-ai-id="inventory-purchase-submit">{{ hasSales ? '确认更正' : '保存采购' }}</van-button><van-button block plain @click="back">取消</van-button></div>
      </form>
    </main>
    <div v-else class="state"><van-loading v-if="loading" /><van-empty v-else :description="error" /></div>
    <AppBottomNavigation />
  </div><van-popup v-model:show="showPurchaseTargetPicker" position="bottom" round data-ai-id="inventory-purchase-target-picker"><van-picker title="选择商品或商品组" :columns="purchaseTargetOptions" @confirm="choosePurchaseTarget" @cancel="showPurchaseTargetPicker = false" /></van-popup><van-popup v-model:show="showChannelPicker" position="bottom" round data-ai-id="inventory-purchase-channel-picker"><van-picker title="选择采购渠道" :columns="channels.map((item) => ({ text: item.name, value: item.id }))" @confirm="chooseChannel" @cancel="showChannelPicker = false" /></van-popup><van-dialog v-model:show="showChannelCreate" title="新增采购渠道" show-cancel-button @confirm="createChannel"><van-field v-model="newChannelName" label="渠道名称" placeholder="例如：闲鱼" /></van-dialog>
</template>

<style scoped>
.purchase-form-page{min-height:100vh;padding-bottom:66px;background:#f5f7fb}.content{padding:20px 16px}.content :deep(.van-field),.share-section,.group-variants{margin-bottom:10px;border:1px solid #cfd6e2;border-radius:9px;background:#fff}.content select,.share-row input{width:100%;min-height:40px;border:0;background:transparent;font:inherit}.form-note,.correction-note,.blocked-note{padding:10px 12px;border-radius:8px;color:#2949aa;background:#edf1ff;font-size:13px}.correction-note{color:#9a6700;background:#fff4dc}.blocked-note{color:#a33a2b;background:#fff0ed}.share-section,.group-variants{padding:12px}.section-head,.share-row{display:flex;gap:8px;align-items:center;justify-content:space-between}.share-actions{display:flex;flex:0 0 auto;gap:6px}.share-actions :deep(.van-button){min-height:var(--tl-button-compact-height)}.group-cost-help{margin:8px 0 0;color:#71809a;font-size:12px}.group-cost-actions{display:flex;gap:8px;align-items:center;margin-top:12px}.group-cost-actions :deep(.van-field){width:224px;margin:0;border:0;border-radius:8px;background:#edf1ff}.group-cost-actions :deep(.van-cell){padding:10px 12px}.group-cost-actions :deep(.van-field__label){width:80px;color:#2949aa}.group-cost-actions :deep(.van-field__control){color:#2949aa;font-size:16px;font-weight:700;text-align:right}.group-variant{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #e4e8f0}.group-variant :deep(.van-field){margin:0}.group-cost-actions :deep(.van-button){flex:0 0 auto;min-height:var(--tl-button-compact-height)}.share-row{margin-top:8px}.share-row select,.share-row input{border:1px solid #cfd6e2;border-radius:6px;padding:0 6px}.share-row button{min-width:44px;border:0;background:transparent;color:#b42318}.invalid{color:#b42318}.form-footer{display:grid;gap:10px;margin-top:20px}.form-footer :deep(.van-button){min-height:var(--tl-button-primary-height)}.state{display:grid;min-height:60vh;place-items:center}
</style>
