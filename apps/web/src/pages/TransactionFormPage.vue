<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type InventoryItem, type Sale } from '../api';
import { type BatchMember } from '../stores/workspace';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';
import { formatDateTime } from '../utils/dateTime';

const route = useRoute(); const router = useRouter(); const batchId = computed(() => String(route.params.id)); const isSale = computed(() => route.path.includes('/sales/'));
const loading = ref(true); const saving = ref(false); const error = ref(''); const products = ref<InventoryItem[]>([]); const members = ref<BatchMember[]>([]); const sales = ref<Sale[]>([]);
const productId = ref(''); const quantity = ref('1'); const totalPrice = ref(''); const sellerUserId = ref(''); const occurredAt = ref(new Date().toISOString().slice(0, 16)); const note = ref('');
const expenseType = ref<'shipping' | 'custom'>('shipping'); const expenseName = ref('邮费'); const amount = ref(''); const payerUserId = ref(''); const saleId = ref('');
const selectedProduct = computed(() => products.value.find((item) => item.productId === productId.value));
async function load() { loading.value = true; error.value = ''; try { const [inventory, participants] = await Promise.all([api.get<InventoryItem[]>(`/batches/${batchId.value}/inventory`), api.get<BatchMember[]>(`/batches/${batchId.value}/members`)]); products.value = inventory.data; members.value = participants.data; if (!isSale.value) sales.value = (await api.get<Sale[]>(`/batches/${batchId.value}/sales`)).data.filter((item) => !item.reversalReason); } catch { error.value = '表单加载失败，请返回后重试'; } finally { loading.value = false; } }
function iso() { return new Date(occurredAt.value).toISOString(); }
async function save() { if (isSale.value) { if (!productId.value || !/^\d+$/.test(quantity.value) || Number(quantity.value) <= 0 || !/^\d+(\.\d)?$/.test(totalPrice.value) || !sellerUserId.value) { showFailToast('请补全销售内容，金额最多一位小数'); return; } } else if (!expenseName.value.trim() || !/^\d+(\.\d)?$/.test(amount.value) || !payerUserId.value) { showFailToast('请补全费用内容，金额最多一位小数'); return; }
  saving.value = true; try { if (isSale.value) await api.post(`/batches/${batchId.value}/sales`, { productId: productId.value, quantity: Number(quantity.value), totalPrice: totalPrice.value, sellerUserId: sellerUserId.value, occurredAt: iso(), note: note.value.trim() || null }); else await api.post(`/batches/${batchId.value}/expenses`, { type: expenseType.value, name: expenseName.value.trim(), amount: amount.value, payerUserId: payerUserId.value, saleId: saleId.value || null, occurredAt: iso(), note: note.value.trim() || null }); showSuccessToast(isSale.value ? '销售已保存，库存已减少' : '费用已保存'); await router.replace(`/batches/${batchId.value}/transactions`); } catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || (isSale.value ? '销售保存失败' : '费用保存失败')); } finally { saving.value = false; } }
onMounted(load);
</script>

<template>
  <div class="form-page" :data-ai-id="isSale ? 'sale-form-page' : 'expense-form-page'">
    <van-nav-bar :title="isSale ? '记录销售' : '记录费用'" left-text="返回" left-arrow @click-left="router.push(`/batches/${batchId}/transactions`)" />
    <div v-if="loading" class="state"><van-loading /></div><van-empty v-else-if="error" :description="error"><van-button size="small" type="primary" @click="load">重试</van-button></van-empty>
    <main v-else class="content">
      <template v-if="isSale">
        <p v-if="selectedProduct" class="notice" data-ai-id="sale-available-quantity">{{ selectedProduct.productName }} 当前可卖：{{ selectedProduct.availableQuantity }} 件。不需要选择从哪里买。</p>
        <van-field label="商品" required data-ai-id="sale-product-select"><template #input><select v-model="productId"><option value="" disabled>选择商品</option><option v-for="product in products" :key="product.productId" :value="product.productId">{{ product.productName }}</option></select></template></van-field>
        <van-field v-model="quantity" label="数量" required type="digit" data-ai-id="sale-quantity" /><van-field v-model="totalPrice" label="成交总价" required inputmode="decimal" placeholder="例如：99.0" data-ai-id="sale-price"><template #button>元</template></van-field>
        <van-field label="卖出人" required data-ai-id="sale-seller-select"><template #input><select v-model="sellerUserId"><option value="" disabled>选择卖出人</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.username }}</option></select></template></van-field><p class="notice">谁卖出，销售款就记在谁名下。</p>
      </template>
      <template v-else>
        <van-field label="费用类型" required data-ai-id="expense-type-select"><template #input><select v-model="expenseType" @change="expenseType === 'shipping' && (expenseName = '邮费')"><option value="shipping">邮费</option><option value="custom">自定义</option></select></template></van-field><van-field v-if="expenseType === 'custom'" v-model="expenseName" label="费用名称" required placeholder="例如：包装费" data-ai-id="expense-type-custom" /><van-field v-else v-model="expenseName" label="费用名称" readonly /><van-field v-model="amount" label="金额" required inputmode="decimal" placeholder="例如：8.0" data-ai-id="expense-amount"><template #button>元</template></van-field>
        <van-field label="付款人" required data-ai-id="expense-payer-select"><template #input><select v-model="payerUserId"><option value="" disabled>选择付款人</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.username }}</option></select></template></van-field><van-field label="关联销售" data-ai-id="expense-sale-select"><template #input><select v-model="saleId"><option value="">不关联</option><option v-for="sale in sales" :key="sale.id" :value="sale.id">{{ sale.productName }} · ¥{{ sale.totalPrice }} · {{ formatDateTime(sale.occurredAt) }}</option></select></template></van-field>
      </template>
      <van-field v-model="occurredAt" :label="isSale ? '成交时间' : '发生时间'" required type="datetime-local" :data-ai-id="isSale ? 'sale-occurred-at' : 'expense-occurred-at'" /><van-field v-model="note" label="备注" type="textarea" rows="2" placeholder="可选" :data-ai-id="isSale ? 'sale-note' : 'expense-note'" /><div class="footer"><van-button block type="primary" :loading="saving" :data-ai-id="isSale ? 'sale-submit' : 'expense-submit'" @click="save">{{ isSale ? '保存并减少库存' : '保存费用' }}</van-button></div>
    </main>
  </div>
  <AppBottomNavigation />
</template>

<style scoped>.form-page{min-height:100vh;padding-bottom:66px;background:#f5f7fb}.form-page :deep(.van-nav-bar){position:sticky;top:0;z-index:2}.content{padding:20px 16px}.content :deep(.van-field){margin-bottom:10px;border:1px solid #cfd6e2;border-radius:9px;background:#fff}.content select{width:100%;min-height:38px;border:0;background:transparent;font:inherit}.notice{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#edf1ff;color:#2949aa;font-size:13px}.footer{margin-top:22px}.footer :deep(.van-button){min-height:44px}.state{display:grid;min-height:60vh;place-items:center}</style>
