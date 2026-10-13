<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type SettlementDetail, type SettlementMemberDetails, type SettlementResultMember } from '../api'
import { formatDateTime } from '../utils/dateTime'
const SettlementMemberDetailsPopup = defineAsyncComponent(() => import('../components/SettlementMemberDetailsPopup.vue'))
const route = useRoute()
const router = useRouter()
const batchId = computed(() => String(route.params.id))
const settlementId = computed(() => String(route.params.settlementId))
const detail = ref<SettlementDetail | null>(null)
const loading = ref(true)
const error = ref('')
const showMemberDetails = ref(false)
const detailMember = ref<{ id: string; username: string } | null>(null)
const memberDetails = ref<SettlementMemberDetails | null>(null)
const detailsLoading = ref(false)
const detailsError = ref('')
const detailsCache = new Map<string, SettlementMemberDetails>()
let detailsRequestVersion = 0
let loadVersion = 0
const detailResult = computed<SettlementResultMember | undefined>(() => detail.value?.members.find((member) => member.userId === detailMember.value?.id))
const detailExpected = computed(() => ({ costTotal: detail.value?.costTotal || '0.00', costShare: detailResult.value?.costShare || '0.00' }))
async function fetchMemberDetails(force = false) {
  if (!detailMember.value || !showMemberDetails.value) return
  const memberId = detailMember.value.id
  const version = ++detailsRequestVersion
  const key = `${batchId.value}:${settlementId.value}:${memberId}`
  memberDetails.value = null
  detailsError.value = ''
  detailsLoading.value = true
  const cached = force ? undefined : detailsCache.get(key)
  if (cached) { memberDetails.value = cached; detailsLoading.value = false; return }
  try {
    const { data } = await api.get<SettlementMemberDetails>(`/batches/${batchId.value}/settlements/${settlementId.value}/members/${memberId}/details`)
    if (version !== detailsRequestVersion || !showMemberDetails.value) return
    detailsCache.set(key, data)
    memberDetails.value = data
  } catch (requestError) {
    if (version !== detailsRequestVersion || !showMemberDetails.value) return
    detailsError.value = (requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '明细加载失败，请重试。'
  } finally { if (version === detailsRequestVersion) detailsLoading.value = false }
}
function openMemberDetails(member: SettlementResultMember) {
  detailMember.value = { id: member.userId, username: member.username }
  showMemberDetails.value = true
  void fetchMemberDetails()
}
function openInventoryReference(productId: string) {
  window.open(router.resolve(`/batches/${batchId.value}/inventory/${productId}`).href, '_blank', 'noopener')
}
watch(showMemberDetails, (show) => { if (!show) detailsRequestVersion += 1 }, { flush: 'sync' })
onBeforeUnmount(() => { detailsRequestVersion += 1; loadVersion += 1 })
const netReceipts = computed(() => detail.value ? formatMoney(moneyToCents(detail.value.saleTotal) - moneyToCents(detail.value.serviceFeeTotal)) : '0.00')
function moneyToCents(value: string | null | undefined) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}
function formatMoney(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
function settlementFormula(member: { profitAmount: string; costRecovery: string; expensesPaid: string; salesReceived: string }) {
  const items = [
    { label: '利润分成', cents: moneyToCents(member.profitAmount) },
    { label: '成本返还', cents: moneyToCents(member.costRecovery) },
    { label: '其他费用垫付', cents: moneyToCents(member.expensesPaid) },
    { label: '已收销售款', cents: -moneyToCents(member.salesReceived) }
  ].filter((item) => item.cents !== 0)
  if (!items.length) return '本次无金额变动'
  return items.map((item, index) => `${index ? item.cents < 0 ? '− ' : '+ ' : item.cents < 0 ? '− ' : ''}${item.label} ¥${formatMoney(Math.abs(item.cents))}`).join(' ')
}
async function load() {
  const version = ++loadVersion
  detailsRequestVersion += 1
  showMemberDetails.value = false
  detailMember.value = null
  memberDetails.value = null
  detailsCache.clear()
  detail.value = null
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get<SettlementDetail>(`/batches/${batchId.value}/settlements/${settlementId.value}`)
    if (version === loadVersion) detail.value = data
  } catch {
    if (version === loadVersion) error.value = '账单详情加载失败，请重试'
  } finally {
    if (version === loadVersion) loading.value = false
  }
}
watch([batchId, settlementId], load, { immediate: true })
</script>
<template>
  <div class="settlement-detail-page" data-ai-id="settlement-detail-page">
    <van-nav-bar data-ai-id="settlement-detail-navigation" title="账单详情" left-text="返回" left-arrow @click-left="router.push(`/batches/${batchId}/settlements`)" />
    <div v-if="loading" class="state" data-ai-id="settlement-detail-loading"><van-loading /></div>
    <van-empty v-else-if="error" :description="error" data-ai-id="settlement-detail-error"><van-button type="primary" size="small" data-ai-id="settlement-detail-retry" @click="load">重试</van-button></van-empty>
    <main v-else-if="detail" class="content" data-ai-id="settlement-detail-content">
      <p class="muted">已确认 · {{ formatDateTime(detail.confirmedAt) }}</p>
      <div class="summary">
        <div data-ai-id="settlement-service-fee-total">
          <small>平台手续费</small><strong>¥{{ detail.serviceFeeTotal }}</strong>
        </div>
        <div>
          <small>销售额</small><strong>¥{{ detail.saleTotal }}</strong>
        </div>
        <div>
          <small>其他费用</small><strong>¥{{ detail.expenseTotal }}</strong>
        </div>
        <div>
          <small>商品成本</small><strong>¥{{ detail.costTotal }}</strong>
        </div>
        <div>
          <small>净收款</small><strong data-ai-id="settlement-detail-net-receipts">¥{{ netReceipts }}</strong>
        </div>
        <div>
          <small>本次{{ detail.isLoss ? '亏损' : '利润' }}</small
          ><strong :class="{ loss: detail.isLoss }">¥{{ detail.profitTotal }}</strong>
        </div>
      </div>
      <h2>参与人结果</h2>
      <section class="list" data-ai-id="settlement-detail-member-results">
        <article v-for="member in detail.members" :key="member.userId" class="member-result" :data-ai-id="`settlement-detail-member-result-${member.userId}`">
          <div class="member-result-main">
            <div><strong>{{ member.username }}</strong><small class="result-formula">{{ settlementFormula(member) }}</small></div>
            <b :class="member.direction">{{ member.direction === 'receivable' ? `应收 ¥${member.net}` : member.direction === 'payable' ? `应付 ¥${member.net.replace('-', '')}` : '已结清' }}</b>
          </div>
          <button type="button" class="member-result-details" :data-ai-id="`settlement-detail-member-details-${member.userId}`" @click="openMemberDetails(member)">查看计算明细 <span aria-hidden="true">›</span></button>
        </article>
      </section>
      <h2>转账建议</h2>
      <section class="list">
        <van-empty v-if="!detail.transfers.length" description="无需转账" />
        <div v-for="transfer in detail.transfers" :key="`${transfer.payerUserId}-${transfer.payeeUserId}`" class="row">
          <span>{{ transfer.payerUsername }} 给 {{ transfer.payeeUsername }}</span
          ><b>¥{{ transfer.amount }}</b>
        </div>
      </section>
      <h2>关联调整单</h2>
      <section class="list" data-ai-id="settlement-bill-adjustments">
        <van-empty v-if="!detail.adjustments.length" description="暂无关联调整单" /><button
          v-for="item in detail.adjustments"
          :key="item.id"
          class="row adjustment-link"
          :data-ai-id="`settlement-adjustment-${item.id}`"
          @click="router.push(`/batches/${batchId}/settlement-adjustments/${item.id}`)"
        >
          <span>调整单 · {{ item.status === 'pending' ? '待确认' : '已确认' }}</span
          ><b>¥{{ item.oldCost }} → ¥{{ item.newCost }}</b>
        </button>
      </section>
      <h2>纳入销售</h2>
      <section class="list" data-ai-id="settlement-detail-transactions">
        <div v-for="sale in detail.transactions || detail.sales" :key="`${sale.source || 'sale'}:${sale.id}`" class="row" :data-ai-id="`settlement-detail-${sale.source === 'quick_sale' ? 'quick-sale' : 'sale'}-${sale.id}`">
          <div>
            <strong><van-tag v-if="sale.source === 'quick_sale'" type="primary" plain size="medium">{{ sale.sourceLabel || '快速售出' }}</van-tag> {{ sale.productGroupName && sale.variantName ? `${sale.productGroupName} · ${sale.variantName}` : sale.productName }} · {{ sale.quantity }} 件</strong><small>{{ formatDateTime(sale.occurredAt) }} · {{ sale.sellerUsername }} 收款</small>
          </div>
          <b>¥{{ sale.totalPrice }}</b>
        </div>
      </section>
    </main>
    <SettlementMemberDetailsPopup v-model:show="showMemberDetails" mode="confirmed" :member="detailMember" :expected="detailExpected" :result="detailResult" :profit-total="detail?.profitTotal" :details="memberDetails" :loading="detailsLoading" :error="detailsError" @retry="fetchMemberDetails(true)" @inventory="openInventoryReference" />
  </div>
</template>
<style scoped>
.settlement-detail-page {
  min-height: 100vh;
  background: #f5f7fb;
}
.settlement-detail-page :deep(.van-nav-bar) {
  position: sticky;
  top: 0;
  z-index: 2;
}
.content {
  padding: 20px 16px 32px;
}
.muted {
  margin: 0 0 14px;
  color: #71809a;
  font-size: 12px;
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  overflow: hidden;
  border-radius: 10px;
  background: #e4e8f0;
}
.summary div {
  padding: 12px;
  background: #fff;
}
.summary small,
.summary strong {
  display: block;
}
.summary small {
  color: #71809a;
  font-size: 12px;
}
.summary strong {
  margin-top: 6px;
  font-size: 17px;
}
.content h2 {
  margin: 24px 0 9px;
  font-size: 17px;
}
.list {
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
}
.row {
  display: flex;
  width: 100%;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid #e4e8f0;
  background: #fff;
  color: #172033;
  text-align: left;
  font: inherit;
}
.row:last-child {
  border: 0;
}
.row div {
  min-width: 0;
}
.row strong,
.row small {
  display: block;
}
.row small {
  margin-top: 5px;
  color: #71809a;
  font-size: 12px;
  line-height: 1.45;
}
.row b {
  white-space: nowrap;
  font-size: 13px;
}
.member-result {
  border-bottom: 1px solid #e4e8f0;
}
.member-result:last-child {
  border: 0;
}
.member-result-main {
  display: flex;
  min-height: 66px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.member-result-main > div {
  min-width: 0;
  flex: 1;
}
.member-result-main strong,
.member-result-main small {
  display: block;
}
.member-result-main small {
  margin-top: 5px;
  color: #71809a;
  font-size: 12px;
  line-height: 1.45;
}
.member-result-main b {
  white-space: nowrap;
  font-size: 14px;
}
.result-formula {
  overflow-wrap: anywhere;
}
.member-result-details {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  background: #fff;
  color: #536078;
  text-align: left;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.member-result-details:focus-visible {
  outline: 2px solid var(--van-primary-color);
  outline-offset: -2px;
}
.loss,
.payable {
  color: #b42318;
}
.receivable {
  color: #15803d;
}
.state {
  display: grid;
  min-height: 60vh;
  place-items: center;
}
</style>
