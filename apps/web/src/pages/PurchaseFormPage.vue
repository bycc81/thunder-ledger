<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type InventoryPurchase, type ManualChannel, type Product } from '../api';
import { useWorkspaceStore, type BatchMember } from '../stores/workspace';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';

type Share = { userId: string; amount: string };
const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const batchId = String(route.params.id);
const purchaseId = route.params.purchaseId ? String(route.params.purchaseId) : '';
const isEditing = Boolean(purchaseId);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const products = ref<Product[]>([]);
const channels = ref<ManualChannel[]>([]);
const participants = ref<BatchMember[]>([]);
const productId = ref('');
const channelId = ref('');
const payerUserId = ref('');
const quantity = ref('1');
const totalCost = ref('');
const occurredAt = ref(localDateTime(new Date().toISOString()));
const sourceUrl = ref('');
const note = ref('');
const costCorrectionReason = ref('');
const shares = ref<Share[]>([]);
const hasSales = ref(false);
const hasInventoryAdjustments = ref(false);
const corrections = ref<Array<{ id: string; reason: string; createdAt: string; createdByUsername: string }>>([]);
const selectedShares = computed(() => new Set(shares.value.map((share) => share.userId)));
const totalValid = computed(() => /^\d+(\.\d)?$/.test(totalCost.value) && Math.round(shares.value.reduce((sum, share) => sum + (Number(share.amount) || 0), 0) * 10) === Math.round(Number(totalCost.value) * 10));
const blockedByAdjustment = computed(() => hasInventoryAdjustments.value);

function back() { void router.push(`/batches/${batchId}/inventory`); }
function localDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function load() {
  loading.value = true;
  try {
    const [product, channel, members, purchase] = await Promise.all([
      api.get<Product[]>(`/workspaces/${store.selectedWorkspaceId}/products`),
      api.get<ManualChannel[]>(`/batches/${batchId}/channels`),
      api.get<BatchMember[]>(`/batches/${batchId}/members`),
      isEditing ? api.get<InventoryPurchase>(`/batches/${batchId}/purchases/${purchaseId}`) : Promise.resolve(null)
    ]);
    products.value = product.data;
    channels.value = channel.data;
    participants.value = members.data;
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
async function save() {
  if (blockedByAdjustment.value) {
    showFailToast('该商品已有报损或丢失记录，暂不支持更正采购');
    return;
  }
  if (!productId.value || !channelId.value || !payerUserId.value || !/^\d+$/.test(quantity.value) || !totalValid.value || !occurredAt.value || !shares.value.length || (hasSales.value && !costCorrectionReason.value.trim())) {
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
      totalCost: totalCost.value,
      costShares: shares.value,
      occurredAt: new Date(occurredAt.value).toISOString(),
      sourceUrl: sourceUrl.value || null,
      note: note.value || null,
      costCorrectionReason: costCorrectionReason.value || null
    };
    const response = isEditing
      ? await api.patch<{ adjustmentCount?: number }>(`/batches/${batchId}/purchases/${purchaseId}`, payload)
      : await api.post(`/batches/${batchId}/purchases`, payload);
    showSuccessToast(response.data.adjustmentCount ? `更正已保存，生成 ${response.data.adjustmentCount} 张调整单` : '采购已保存');
    await router.replace(`/batches/${batchId}/inventory/${productId.value}`);
  } catch (requestError: unknown) {
    showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '采购保存失败');
  } finally {
    saving.value = false;
  }
}
onMounted(async () => { if (!store.workspaces.length) await store.load(); await load(); });
</script>

<template>
  <div class="purchase-form-page" data-ai-id="inventory-purchase-form-page">
    <van-nav-bar :title="hasSales ? '更正采购' : (isEditing ? '编辑采购' : '新增采购')" left-text="返回" left-arrow @click-left="back" />
    <main v-if="!loading && !error" class="content">
      <p class="form-note">同一种商品合并核算，按移动平均成本计价；销售不对应某条采购记录。</p>
      <p v-if="hasSales" class="correction-note" data-ai-id="inventory-purchase-correction-notice">该采购已有销售。可更正数量、总成本、付款人和成本承担；商品、采购渠道、采购时间不可修改。</p>
      <p v-if="blockedByAdjustment" class="blocked-note" data-ai-id="inventory-purchase-adjustment-blocked">该商品已有报损或丢失记录，当前版本不支持更正采购。</p>
      <form @submit.prevent="save">
        <van-field label="商品" required>
          <template #input><select v-model="productId" :disabled="isEditing"><option value="" disabled>选择商品</option><option v-for="item in products" :key="item.id" :value="item.id">{{ item.name }}</option></select></template>
        </van-field>
        <van-field label="采购渠道" required>
          <template #input><select v-model="channelId" :disabled="hasSales || blockedByAdjustment"><option value="" disabled>选择渠道</option><option v-for="item in channels" :key="item.id" :value="item.id">{{ item.name }}</option></select></template>
        </van-field>
        <van-field label="付款人" required>
          <template #input><select v-model="payerUserId" :disabled="blockedByAdjustment"><option value="" disabled>选择付款人</option><option v-for="item in participants" :key="item.id" :value="item.id">{{ item.username }}</option></select></template>
        </van-field>
        <van-field v-model="quantity" label="数量" type="digit" required :disabled="blockedByAdjustment" />
        <van-field v-model="totalCost" label="总成本" inputmode="decimal" required :disabled="blockedByAdjustment" />
        <van-field v-model="occurredAt" label="采购时间" type="datetime-local" required :readonly="hasSales || blockedByAdjustment" :disabled="blockedByAdjustment" data-ai-id="inventory-purchase-occurred-at" />
        <section class="share-section" data-ai-id="inventory-cost-share-list">
          <div class="section-head"><strong>成本由谁承担</strong><van-button size="small" plain :disabled="shares.length >= participants.length || blockedByAdjustment" @click="addShare">添加成员</van-button></div>
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
  </div>
</template>

<style scoped>
.purchase-form-page{min-height:100vh;padding-bottom:66px;background:#f5f7fb}.content{padding:20px 16px}.content :deep(.van-field),.share-section{margin-bottom:10px;border:1px solid #cfd6e2;border-radius:9px;background:#fff}.content select,.share-row input{width:100%;min-height:40px;border:0;background:transparent;font:inherit}.form-note,.correction-note,.blocked-note{padding:10px 12px;border-radius:8px;color:#2949aa;background:#edf1ff;font-size:13px}.correction-note{color:#9a6700;background:#fff4dc}.blocked-note{color:#a33a2b;background:#fff0ed}.share-section{padding:12px}.section-head,.share-row{display:flex;gap:8px;align-items:center;justify-content:space-between}.share-row{margin-top:8px}.share-row select,.share-row input{border:1px solid #cfd6e2;border-radius:6px;padding:0 6px}.share-row button{min-width:44px;border:0;background:transparent;color:#b42318}.invalid{color:#b42318}.form-footer{display:grid;gap:10px;margin-top:20px}.form-footer :deep(.van-button){min-height:44px}.state{display:grid;min-height:60vh;place-items:center}
</style>
