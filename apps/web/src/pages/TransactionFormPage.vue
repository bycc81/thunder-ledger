<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type InventoryItem, type Sale } from '../api';
import { type BatchMember } from '../stores/workspace';
import AppBottomNavigation from '../components/AppBottomNavigation.vue';
import { formatDateTime, localDateTime } from '../utils/dateTime';

const route = useRoute(); const router = useRouter(); const batchId = computed(() => String(route.params.id)); const isSale = computed(() => route.path.includes('/sales/'));
const loading = ref(true); const saving = ref(false); const error = ref(''); const products = ref<InventoryItem[]>([]); const members = ref<BatchMember[]>([]); const sales = ref<Sale[]>([]);
const productId = ref(''); const quantity = ref('1'); const totalPrice = ref(''); const sellerUserId = ref(''); const occurredAt = ref(localDateTime()); const note = ref('');
const salesChannel = ref(''); const feeMode = ref<'percentage' | 'amount'>('percentage'); const feeRate = ref(''); const feeAmount = ref('');
const expenseType = ref<'shipping' | 'custom'>('shipping'); const expenseName = ref('邮费'); const amount = ref(''); const payerUserId = ref(''); const saleId = ref('');
const selectedProduct = computed(() => products.value.find((item) => item.productId === productId.value));
const moneyPattern = /^\d+(\.\d{1,2})?$/; const ratePattern = /^(100|\d{1,2})(\.\d{1,2})?$/;
function cents(value: string) { if (!moneyPattern.test(value)) return null; const [whole, fraction = ''] = value.split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0')); }
function formatMoney(value: number) { return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`; }
const calculatedFee = computed(() => { const price = cents(totalPrice.value); if (price === null) return null; if (feeMode.value === 'amount') return cents(feeAmount.value); if (!feeRate.value) return 0; if (!ratePattern.test(feeRate.value)) return null; return Math.round(price * Math.round(Number(feeRate.value) * 100) / 10000); });
const receivedAmount = computed(() => { const price = cents(totalPrice.value); return price === null || calculatedFee.value === null ? null : price - calculatedFee.value; });
async function load() { loading.value = true; error.value = ''; try { const [inventory, participants] = await Promise.all([api.get<InventoryItem[]>(`/batches/${batchId.value}/inventory`), api.get<BatchMember[]>(`/batches/${batchId.value}/members`)]); products.value = inventory.data; members.value = participants.data; if (!isSale.value) sales.value = (await api.get<Sale[]>(`/batches/${batchId.value}/sales`)).data.filter((item) => !item.reversalReason); } catch { error.value = '表单加载失败，请返回后重试'; } finally { loading.value = false; } }
function iso() { return new Date(occurredAt.value).toISOString(); }
async function save() { if (isSale.value) { const feeValue = feeMode.value === 'percentage' ? feeRate.value : feeAmount.value; if (!productId.value || !/^\d+$/.test(quantity.value) || Number(quantity.value) <= 0 || !moneyPattern.test(totalPrice.value) || !sellerUserId.value || (feeValue && (feeMode.value === 'percentage' ? !ratePattern.test(feeValue) : !moneyPattern.test(feeValue))) || calculatedFee.value === null || receivedAmount.value === null || receivedAmount.value < 0) { showFailToast('请补全销售内容，金额最多两位小数'); return; } } else if (!expenseName.value.trim() || !moneyPattern.test(amount.value) || !payerUserId.value) { showFailToast('请补全费用内容，金额最多两位小数'); return; }
  saving.value = true; try { if (isSale.value) await api.post(`/batches/${batchId.value}/sales`, { productId: productId.value, quantity: Number(quantity.value), totalPrice: totalPrice.value, sellerUserId: sellerUserId.value, occurredAt: iso(), note: note.value.trim() || null, salesChannel: salesChannel.value.trim() || null, feeMode: feeMode.value, feeRate: feeMode.value === 'percentage' ? feeRate.value || null : null, feeAmount: feeMode.value === 'amount' ? feeAmount.value || null : null }); else await api.post(`/batches/${batchId.value}/expenses`, { type: expenseType.value, name: expenseName.value.trim(), amount: amount.value, payerUserId: payerUserId.value, saleId: saleId.value || null, occurredAt: iso(), note: note.value.trim() || null }); showSuccessToast(isSale.value ? '销售已保存，库存已减少' : '费用已保存'); await router.replace(`/batches/${batchId.value}/transactions`); } catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || (isSale.value ? '销售保存失败' : '费用保存失败')); } finally { saving.value = false; } }
onMounted(load);
</script>

<template>
  <div class="form-page" :data-ai-id="isSale ? 'sale-form-page' : 'expense-form-page'">
    <van-nav-bar :title="isSale ? '记录销售' : '记录费用'" left-text="返回" left-arrow @click-left="router.push(`/batches/${batchId}/transactions`)" />
    <div v-if="loading" class="state"><van-loading /></div><van-empty v-else-if="error" :description="error"><van-button size="small" type="primary" @click="load">重试</van-button></van-empty>
    <main v-else class="content">
      <template v-if="isSale">
        <p v-if="selectedProduct" class="notice" data-ai-id="sale-available-quantity">{{ selectedProduct.productName }} 当前可卖：{{ selectedProduct.availableQuantity }} 件。不需要选择从哪里买。</p>
        <p class="notice" data-ai-id="sale-time-freeze-notice">成交时间保存后不可修改，请填写实际成交时间。</p>
        <van-field label="商品" required data-ai-id="sale-product-select"><template #input><select v-model="productId"><option value="" disabled>选择商品</option><option v-for="product in products" :key="product.productId" :value="product.productId">{{ product.productName }}</option></select></template></van-field>
        <van-field v-model="quantity" label="数量" required type="digit" data-ai-id="sale-quantity" /><van-field v-model="totalPrice" label="成交总价" required inputmode="decimal" placeholder="例如：99.99" data-ai-id="sale-price"><template #button>元</template></van-field>
        <van-field v-model="salesChannel" label="销售渠道" placeholder="例如：闲鱼（可选）" data-ai-id="sale-channel" />
        <section class="fee-section" data-ai-id="sale-fee-section"><h2>平台手续费（可选）</h2><van-radio-group v-model="feeMode" direction="horizontal" data-ai-id="sale-fee-mode"><van-radio name="percentage" data-ai-id="sale-fee-mode-percentage">按比例</van-radio><van-radio name="amount" data-ai-id="sale-fee-mode-amount">按金额</van-radio></van-radio-group><van-field v-if="feeMode === 'percentage'" v-model="feeRate" label="手续费比例" inputmode="decimal" placeholder="例如：1.60" data-ai-id="sale-fee-rate"><template #button>%</template></van-field><van-field v-else v-model="feeAmount" label="手续费金额" inputmode="decimal" placeholder="例如：1.60" data-ai-id="sale-fee-amount"><template #button>元</template></van-field><p v-if="calculatedFee !== null && receivedAmount !== null" class="notice" data-ai-id="sale-fee-preview">手续费 ¥{{ formatMoney(calculatedFee) }}，预计实收 ¥{{ formatMoney(receivedAmount) }}</p></section>
        <van-field label="卖出人" required data-ai-id="sale-seller-select"><template #input><select v-model="sellerUserId"><option value="" disabled>选择卖出人</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.username }}</option></select></template></van-field><p class="notice">实际收款会记在卖出人名下。</p>
      </template>
      <template v-else>
        <van-field label="费用类型" required data-ai-id="expense-type-select"><template #input><select v-model="expenseType" @change="expenseType === 'shipping' && (expenseName = '邮费')"><option value="shipping">邮费</option><option value="custom">自定义</option></select></template></van-field><van-field v-if="expenseType === 'custom'" v-model="expenseName" label="费用名称" required placeholder="例如：包装费" data-ai-id="expense-type-custom" /><van-field v-else v-model="expenseName" label="费用名称" readonly /><van-field v-model="amount" label="金额" required inputmode="decimal" placeholder="例如：8.00" data-ai-id="expense-amount"><template #button>元</template></van-field>
        <van-field label="付款人" required data-ai-id="expense-payer-select"><template #input><select v-model="payerUserId"><option value="" disabled>选择付款人</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.username }}</option></select></template></van-field><van-field label="关联销售" data-ai-id="expense-sale-select"><template #input><select v-model="saleId"><option value="">不关联</option><option v-for="sale in sales" :key="sale.id" :value="sale.id">{{ sale.productName }} · ¥{{ sale.totalPrice }} · {{ formatDateTime(sale.occurredAt) }}</option></select></template></van-field>
      </template>
      <van-field v-model="occurredAt" :label="isSale ? '成交时间' : '发生时间'" required type="datetime-local" :data-ai-id="isSale ? 'sale-occurred-at' : 'expense-occurred-at'" /><van-field v-model="note" label="备注" type="textarea" rows="2" placeholder="可选" :data-ai-id="isSale ? 'sale-note' : 'expense-note'" /><div class="footer"><van-button block type="primary" :loading="saving" :data-ai-id="isSale ? 'sale-submit' : 'expense-submit'" @click="save">{{ isSale ? '保存并减少库存' : '保存费用' }}</van-button></div>
    </main>
  </div><AppBottomNavigation />
</template>

<style scoped>.form-page{min-height:100vh;padding-bottom:66px;background:#f7f9fc}.content{padding:16px}.notice{margin:0 0 10px;color:#71809a;font-size:12px;line-height:1.55}.fee-section{margin:12px 0;padding:12px;border:1px solid #edf0f5;border-radius:10px;background:#fff}.fee-section h2{margin:0 0 10px;font-size:14px}.fee-section :deep(.van-radio-group){gap:20px;margin-bottom:8px}.state{display:grid;min-height:60vh;place-items:center}.footer{margin-top:18px}</style>
