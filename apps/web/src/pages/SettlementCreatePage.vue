<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { api, type SettlementExpense, type SettlementMember, type SettlementPreview, type SettlementSale } from '../api'
import { formatDateTime } from '../utils/dateTime'
import AppMultiSelect from '../components/AppMultiSelect.vue'

const route = useRoute()
const router = useRouter()
const batchId = computed(() => String(route.params.id))
const members = ref<SettlementMember[]>([])
const transactions = ref<SettlementSale[]>([])
const selectedQuickSales = ref<string[]>([])
const selectedMemberIds = ref<string[]>([])
const keyword = ref('')
const saleType = ref<'all' | 'sale' | 'quick_sale'>('all')
const saleTypeOptions = [
  { value: 'all', label: '全部', aiId: 'settlement-sale-type-all' },
  { value: 'sale', label: '普通销售', aiId: 'settlement-sale-type-sale' },
  { value: 'quick_sale', label: '快速售出', aiId: 'settlement-sale-type-quick-sale' }
] as const
const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase())
const memberOptions = computed(() => members.value.map((member) => ({ value: member.id, label: member.username })))
const selectedMemberSet = computed(() => new Set(selectedMemberIds.value))
const filteredTransactions = computed(() => transactions.value.filter(matchesSaleFilters).sort((a, b) =>
  Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
  || Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '')
  || (a.source ?? 'sale').localeCompare(b.source ?? 'sale')
  || a.id.localeCompare(b.id)))
const filteredSales = computed(() => filteredTransactions.value.filter((sale) => sale.source !== 'quick_sale'))
const filteredQuickSales = computed(() => filteredTransactions.value.filter((sale) => sale.source === 'quick_sale'))
const visibleSaleCount = computed(() => filteredSales.value.length + filteredQuickSales.value.length)
const selectedSaleCount = computed(() => selectedSales.value.length + selectedQuickSales.value.length)
const hiddenSelectedSaleCount = computed(() => selectedSaleCount.value
  - filteredSales.value.filter((sale) => selectedSaleSet.value.has(sale.id)).length
  - filteredQuickSales.value.filter((sale) => selectedQuickSaleSet.value.has(sale.id)).length)

const expenses = ref<SettlementExpense[]>([])
const selectedSales = ref<string[]>([])
const selectedExpenses = ref<string[]>([])
const costs = ref<Record<string, string>>({})
const costTotal = ref('0.0')
const profits = ref<Record<string, string>>({})
const step = ref(1)
const preview = ref<SettlementPreview | null>(null)
const currentPreview = computed(() => preview.value as SettlementPreview)
const loading = ref(true)
const error = ref('')
const submitting = ref(false)
const showConfirm = ref(false)

const selectedSaleSet = computed(() => new Set(selectedSales.value))
const selectedQuickSaleSet = computed(() => new Set(selectedQuickSales.value))
function matchesSaleFilters(sale: SettlementSale) {
  const matchesMember = !selectedMemberSet.value.size || Boolean(sale.sellerUserId && selectedMemberSet.value.has(sale.sellerUserId))
  const matchesKeyword = !normalizedKeyword.value || [sale.productName, sale.displayName, sale.productGroupName, sale.variantName]
    .some((name) => name?.toLowerCase().includes(normalizedKeyword.value))
  return matchesMember && matchesKeyword && (saleType.value === 'all' || (sale.source ?? 'sale') === saleType.value)
}

function moneyToCents(value: string | null | undefined) {
  if (typeof value !== 'string') return 0
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))
}
function formatMoney(cents: number) {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
function signedMoneyToCents(value: string | null | undefined) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}
function settlementFormula(member: { profitAmount: string; costRecovery: string; expensesPaid: string; salesReceived: string }) {
  const items = [
    { label: '利润分成', cents: signedMoneyToCents(member.profitAmount) },
    { label: '成本返还', cents: signedMoneyToCents(member.costRecovery) },
    { label: '其他费用垫付', cents: signedMoneyToCents(member.expensesPaid) },
    { label: '已收销售款', cents: -signedMoneyToCents(member.salesReceived) }
  ].filter((item) => item.cents !== 0)
  if (!items.length) return '本次无金额变动'
  return items.map((item, index) => `${index ? item.cents < 0 ? '− ' : '+ ' : item.cents < 0 ? '− ' : ''}${item.label} ¥${formatMoney(Math.abs(item.cents))}`).join(' ')
}
const netReceipts = computed(() => {
  if (!preview.value) return '0.00'
  return formatMoney(moneyToCents(preview.value.saleTotal) - moneyToCents(preview.value.serviceFeeTotal))
})

function equalProfits() {
  const base = Math.floor(100 / members.value.length)
  let rest = 100 - base * members.value.length
  for (const member of members.value) profits.value[member.id] = String(base + (rest-- > 0 ? 1 : 0))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get<{ members: SettlementMember[]; sales: SettlementSale[]; transactions: SettlementSale[]; expenses: SettlementExpense[] }>(`/batches/${batchId.value}/settlements/draft`)
    members.value = data.members
    transactions.value = data.transactions ?? data.sales
    expenses.value = data.expenses
    equalProfits()
  } catch {
    error.value = '结算草稿加载失败，请返回后重试'
  } finally {
    loading.value = false
  }
}

function selectAll() {
  selectedSales.value = [...new Set([...selectedSales.value, ...filteredSales.value.map((sale) => sale.id)])]
  selectedQuickSales.value = [...new Set([...selectedQuickSales.value, ...filteredQuickSales.value.map((sale) => sale.id)])]
}

function clearAll() {
  const visibleSales = new Set(filteredSales.value.map((sale) => sale.id))
  const visibleQuickSales = new Set(filteredQuickSales.value.map((sale) => sale.id))
  selectedSales.value = selectedSales.value.filter((id) => !visibleSales.has(id))
  selectedQuickSales.value = selectedQuickSales.value.filter((id) => !visibleQuickSales.has(id))
}

function isExpenseSelected(expense: SettlementExpense) {
  if (expense.saleId) return selectedSaleSet.value.has(expense.saleId)
  if (expense.quickSaleId) return selectedQuickSaleSet.value.has(expense.quickSaleId)
  return selectedExpenses.value.includes(expense.id)
}

function updateExpense(expense: SettlementExpense, checked: boolean) {
  if (expense.saleId || expense.quickSaleId) return
  selectedExpenses.value = checked ? [...new Set([...selectedExpenses.value, expense.id])] : selectedExpenses.value.filter((id) => id !== expense.id)
}

function payload() {
  const automaticExpenses = expenses.value.filter((expense) => (expense.saleId && selectedSaleSet.value.has(expense.saleId)) || (expense.quickSaleId && selectedQuickSaleSet.value.has(expense.quickSaleId))).map((expense) => expense.id)
  return {
    saleIds: selectedSales.value,
    quickSaleIds: selectedQuickSales.value,
    expenseIds: [...new Set([...selectedExpenses.value, ...automaticExpenses])],
    profitShares: members.value.map((member) => ({ userId: member.id, percentage: Number(profits.value[member.id] ?? '') }))
  }
}

function cleanProfit(memberId: string) {
  const value = (profits.value[memberId] ?? '').replace(/[^\d.]/g, '')
  const [whole = '', decimal] = value.split('.')
  profits.value[memberId] = decimal === undefined ? whole.slice(0, 3) : `${whole.slice(0, 3)}.${decimal.slice(0, 2)}`
}

function profitBasisPoints(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return Number.NaN
  return Math.round(Number(value) * 100)
}

async function next() {
  if (step.value === 1) {
    if (!selectedSales.value.length && !selectedQuickSales.value.length) {
      showFailToast('请至少选择一笔销售')
      return
    }
    submitting.value = true
    try {
      const { data } = await api.post<{ costTotal: string; costShares: Array<{ userId: string; amount: string }> }>(`/batches/${batchId.value}/settlements/recommendation`, { saleIds: selectedSales.value, quickSaleIds: selectedQuickSales.value })
      costTotal.value = data.costTotal
      for (const share of data.costShares) costs.value[share.userId] = share.amount
      step.value = 2
    } catch (requestError: unknown) {
      showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '成本计算失败')
    } finally {
      submitting.value = false
    }
    return
  }
  if (step.value === 2) {
    const total = members.value.reduce((sum, member) => sum + profitBasisPoints(profits.value[member.id] ?? ''), 0)
    if (total !== 10000) {
      showFailToast('利润比例合计必须是 100%')
      return
    }
    submitting.value = true
    try {
      preview.value = (await api.post<SettlementPreview>(`/batches/${batchId.value}/settlements/preview`, payload())).data
      step.value = 3
    } catch (requestError: unknown) {
      showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '账单预览失败')
    } finally {
      submitting.value = false
    }
    return
  }
  showConfirm.value = true
}

async function confirm() {
  submitting.value = true
  try {
    const { data } = await api.post<{ id: string }>(`/batches/${batchId.value}/settlements`, payload())
    showConfirm.value = false
    showSuccessToast('账单已确认')
    await router.replace(`/batches/${batchId.value}/settlements/${data.id}`)
  } catch (requestError: unknown) {
    showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '确认账单失败')
  } finally {
    submitting.value = false
  }
}

function back() {
  if (step.value > 1) {
    step.value -= 1
    return
  }
  void router.push(`/batches/${batchId.value}/settlements`)
}

onMounted(load)
</script>

<template>
  <div class="settlement-create-page" data-ai-id="settlement-create-page">
    <van-nav-bar title="创建账单" left-text="返回" left-arrow @click-left="back" />
    <div v-if="loading" class="state"><van-loading /></div>
    <van-empty v-else-if="error" :description="error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty>
    <main v-else class="content">
      <div class="steps"><strong :class="{ active: step === 1 }">1 选择</strong><strong :class="{ active: step === 2 }">2 利润</strong><strong :class="{ active: step === 3 }">3 预览</strong></div>
      <section v-if="step === 1">
        <header class="section-head"><h2>本次销售</h2><div><button class="text-button" :disabled="!visibleSaleCount" data-ai-id="settlement-sales-select-all" @click="selectAll">全选</button><button class="text-button" data-ai-id="settlement-sales-clear" @click="clearAll">清空</button></div></header>
        <div class="sale-filters" data-ai-id="settlement-sale-filters">
          <div data-ai-id="settlement-product-keyword">
            <van-search v-model="keyword" placeholder="输入商品名称关键词" aria-label="商品名称关键词" clearable />
          </div>
          <div class="sale-type-filter" role="group" aria-label="销售类型" data-ai-id="settlement-sale-type-filter">
            <span>销售类型</span>
            <div class="sale-type-options">
              <button v-for="option in saleTypeOptions" :key="option.value" type="button" :aria-pressed="saleType === option.value" :data-ai-id="option.aiId" @click="saleType = option.value">{{ option.label }}</button>
            </div>
          </div>
          <AppMultiSelect
            v-model="selectedMemberIds"
            class="member-filter"
            :options="memberOptions"
            label="收款人"
            placeholder="全部人员"
            count-unit="人"
            hint="可多选，未选择时显示全部人员"
            empty-text="本批次暂无人员"
            ai-id="settlement-member-filter"
          />
        </div>
        <p class="filter-summary" role="status" data-ai-id="settlement-member-filter-summary">当前 {{ visibleSaleCount }} 笔 · 已选 {{ selectedSaleCount }} 笔<span v-if="hiddenSelectedSaleCount">（含筛选外 {{ hiddenSelectedSaleCount }} 笔）</span></p>
        <div class="list" data-ai-id="settlement-sales-list">
          <template v-for="sale in filteredTransactions" :key="`${sale.source || 'sale'}:${sale.id}`">
          <label v-if="sale.source !== 'quick_sale'" class="choice-row" :data-ai-id="`settlement-sale-${sale.id}`"><input v-model="selectedSales" type="checkbox" :value="sale.id"><span><strong>{{ sale.displayName || sale.productName }} · {{ sale.quantity }} 件</strong><small>{{ formatDateTime(sale.occurredAt) }} · {{ sale.sellerUsername }} 收款</small></span><b>¥{{ sale.totalPrice }}</b></label>
          <label v-else class="choice-row" :data-ai-id="`settlement-quick-sale-${sale.id}`"><input v-model="selectedQuickSales" type="checkbox" :value="sale.id"><span><strong><van-tag type="primary" plain size="medium">{{ sale.sourceLabel || '快速售出' }}</van-tag> {{ sale.productName }} · {{ sale.quantity }} 件</strong><small>{{ formatDateTime(sale.occurredAt) }} · {{ sale.sellerUsername }} 收款</small></span><b>¥{{ sale.totalPrice }}</b></label>
          </template>
        </div>
        <van-empty v-if="!visibleSaleCount" :description="normalizedKeyword || selectedMemberIds.length || saleType !== 'all' ? '当前筛选条件下暂无待结算销售' : '暂无待结算销售'" data-ai-id="settlement-sales-empty" />
        <header class="section-head"><h2>本次费用</h2></header>
        <div class="list" data-ai-id="settlement-expenses-list">
          <label v-for="expense in expenses" :key="expense.id" class="choice-row" :class="{ disabled: (expense.saleId && !selectedSaleSet.has(expense.saleId)) || (expense.quickSaleId && !selectedQuickSaleSet.has(expense.quickSaleId)) }" :data-ai-id="`settlement-expense-${expense.id}`"><input type="checkbox" :checked="isExpenseSelected(expense)" :disabled="Boolean(expense.saleId || expense.quickSaleId)" @change="updateExpense(expense, ($event.target as HTMLInputElement).checked)"><span><strong>{{ expense.name }} ¥{{ expense.amount }}</strong><small>{{ expense.payerUsername }} 支付 · {{ expense.saleId ? '已关联销售' : expense.quickSaleId ? '已关联快速售出' : '未关联销售' }}</small></span></label>
        </div>
      </section>
      <section v-else-if="step === 2">
        <h2>确认利润比例</h2>
        <p class="muted">成本承担和实际付款人根据采购记录与商品移动平均成本自动计算，结算时不能修改。</p>
        <div class="list" data-ai-id="settlement-auto-cost-breakdown">
          <div class="cost-total"><span>本次商品成本</span><strong>¥{{ costTotal }}</strong></div>
          <div v-for="member in members" :key="member.id" class="readonly-row" :data-ai-id="`settlement-cost-share-${member.id}`"><span>{{ member.username }} 承担成本</span><b>¥{{ costs[member.id] || '0.0' }}</b></div>
        </div>
        <header class="section-head"><h2>本次利润怎么分</h2></header>
        <div class="list" data-ai-id="settlement-profit-allocation">
          <label v-for="member in members" :key="member.id" class="field-row">{{ member.username }}<span class="percent"><van-field v-model="profits[member.id]" type="text" inputmode="decimal" input-align="right" :data-ai-id="`settlement-profit-share-${member.id}`" @update:model-value="cleanProfit(member.id)" />%</span></label>
        </div>
      </section>
      <section v-else-if="preview !== null">
        <h2>账单预览</h2>
        <div class="summary" data-ai-id="settlement-preview"><div><small>销售额</small><strong>¥{{ currentPreview.saleTotal }}</strong></div><div><small>平台手续费</small><strong>¥{{ currentPreview.serviceFeeTotal }}</strong></div><div><small>净收款</small><strong data-ai-id="settlement-preview-net-receipts">¥{{ netReceipts }}</strong></div><div><small>商品成本</small><strong>¥{{ currentPreview.costTotal }}</strong></div><div><small>其他费用</small><strong>¥{{ currentPreview.expenseTotal }}</strong></div><div><small>本次{{ currentPreview.isLoss ? '亏损' : '利润' }}</small><strong :class="{ loss: currentPreview.isLoss }">¥{{ currentPreview.profitTotal }}</strong></div></div>
        <h2 class="result-title">本次结果</h2>
        <div class="list" data-ai-id="settlement-preview-member-results"><article v-for="member in currentPreview.members" :key="member.userId" class="result-row" :data-ai-id="`settlement-preview-member-result-${member.userId}`"><div class="result-main"><div><strong>{{ member.username }}</strong><small class="result-formula">{{ settlementFormula(member) }}</small></div><b :class="member.direction">{{ member.direction === 'receivable' ? `应收 ¥${member.net}` : member.direction === 'payable' ? `应付 ¥${member.net.replace('-', '')}` : '已结清' }}</b></div><details class="result-details" :data-ai-id="`settlement-preview-member-details-${member.userId}`"><summary>查看计算明细</summary><div class="calculation-detail"><span>承担商品成本 ¥{{ member.costShare }}</span><span>采购付款 ¥{{ member.purchasesPaid }}</span></div></details></article></div>
        <h2 class="result-title">转账建议</h2>
         <div class="list transfer-list" data-ai-id="settlement-preview-transfers"><van-empty v-if="!currentPreview.transfers.length" description="无需转账" /><div v-for="transfer in currentPreview.transfers" :key="`${transfer.payerUserId}-${transfer.payeeUserId}`" class="transfer-row" :data-ai-id="`settlement-transfer-${transfer.payerUserId}-${transfer.payeeUserId}`"><div class="transfer-route"><strong>{{ transfer.payerUsername }}</strong><span>转给</span><strong>{{ transfer.payeeUsername }}</strong></div><b>¥{{ transfer.amount }}</b></div></div>
      </section>
    </main>
    <footer v-if="!loading && !error" class="footer"><van-button block type="primary" :loading="submitting" :disabled="submitting" data-ai-id="settlement-next" @click="next">{{ step === 3 ? '确认账单' : '下一步' }}</van-button></footer>
    <van-dialog v-model:show="showConfirm" title="确认账单" show-cancel-button :confirm-button-text="submitting ? '确认中' : '确认账单'" :confirm-button-disabled="submitting" data-ai-id="settlement-confirm-dialog" @confirm="confirm"><p class="dialog-note">确认后，本次选择的销售、费用和利润比例会锁定，不能再次结账。确认继续？</p><template #footer><div class="dialog-actions"><van-button plain :disabled="submitting" @click="showConfirm = false">取消</van-button><van-button type="primary" :loading="submitting" data-ai-id="settlement-confirm" @click="confirm">确认账单</van-button></div></template></van-dialog>
  </div>
</template>

<style scoped>
.sale-filters{overflow:hidden;border-radius:10px;background:#fff}.sale-filters :deep(.van-search){padding:10px 12px}.sale-filters :deep(.van-search__content){min-height:44px}.sale-type-filter{display:flex;align-items:center;gap:12px;padding:0 12px 12px;font-size:14px;color:#172033}.sale-type-filter>span{flex:none}.sale-type-options{display:flex;flex:1;min-width:0;overflow:hidden;border:1px solid #cfd6e2;border-radius:8px}.sale-type-options button{flex:1;min-width:0;min-height:44px;padding:0 4px;border:0;border-right:1px solid #e4e8f0;background:#fff;color:#536078;font-size:13px;cursor:pointer}.sale-type-options button:last-child{border-right:0}.sale-type-options button[aria-pressed="true"]{background:#edf1ff;color:#3657c8;font-weight:600}.sale-type-options button:focus-visible{outline:2px solid #3657c8;outline-offset:-2px}.member-filter{padding:0 12px 12px}.filter-summary{margin:8px 0;color:#71809a;font-size:12px;line-height:1.5}.text-button:disabled{color:#8993a7}
.settlement-create-page{min-height:100vh;padding-bottom:80px;background:#f5f7fb}.settlement-create-page :deep(.van-nav-bar){position:sticky;top:0;z-index:2}.content{padding:16px}.steps{display:flex;justify-content:space-between;margin:2px 0 18px;color:#8993a7;font-size:12px}.steps .active{color:#3657c8}.section-head{display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px}.content h2{margin:0;font-size:17px}.text-button{min-width:44px;min-height:44px;border:0;background:transparent;color:#3657c8;font:inherit}.list{overflow:hidden;border-radius:10px;background:#fff}.choice-row,.field-row{display:flex;min-height:62px;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #e4e8f0}.choice-row:last-child,.field-row:last-child,.result-row:last-child{border:0}.choice-row input{width:20px;height:20px;accent-color:#3657c8}.choice-row span,.result-main>div{min-width:0;flex:1}.choice-row strong,.choice-row small,.result-main strong,.result-main small{display:block}.choice-row small,.result-main small,.muted{margin-top:5px;color:#71809a;font-size:12px;line-height:1.45}.choice-row b{white-space:nowrap;font-size:14px}.choice-row.disabled{opacity:.48}.field-row{min-height:62px;justify-content:space-between}.readonly-row{display:flex;min-height:52px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e4e8f0}.readonly-row:last-child{border:0}.readonly-row b{font-size:14px}.cost-total{display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid #e4e8f0;color:#536078}.cost-total strong{color:#172033}.field-row :deep(.van-cell){width:116px;height:38px;min-height:38px;padding:0 10px;border:1px solid #cfd6e2;border-radius:8px}.field-row :deep(.van-field__body),.field-row :deep(.van-field__control){height:36px;min-height:36px;line-height:36px;font-size:16px}.percent{display:flex;width:124px;align-items:center;gap:4px}.percent :deep(.van-cell){width:100px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:1px;overflow:hidden;border-radius:10px;background:#e4e8f0}.summary div{padding:12px;background:#fff}.summary small,.summary strong{display:block}.summary small{color:#71809a;font-size:12px}.summary strong{margin-top:6px;font-size:17px}.loss,.payable{color:#b42318}.receivable{color:#15803d}.result-title{margin:22px 0 8px!important}.result-row{border-bottom:1px solid #e4e8f0}.result-main{display:flex;min-height:66px;align-items:center;gap:10px;padding:10px 12px}.result-main b{white-space:nowrap;font-size:14px}.result-formula{overflow-wrap:anywhere}.result-details{border-top:0}.result-details summary{position:relative;min-height:44px;padding:0 12px;cursor:pointer;color:#536078;font-size:13px;line-height:44px}.result-details summary::before{position:absolute;top:0;left:12px;width:48px;border-top:1px solid #e4e8f0;content:''}.calculation-detail{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 12px 12px;color:#71809a;font-size:12px;line-height:1.45}.transfer-list :deep(.van-empty){padding:12px}.transfer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;min-height:62px;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #e4e8f0}.transfer-row:last-child{border:0}.transfer-route{display:flex;min-width:0;align-items:center;gap:7px;flex-wrap:wrap;color:#536078;font-size:13px}.transfer-route strong{color:#172033;font-size:14px;overflow-wrap:anywhere}.transfer-row b{white-space:nowrap;color:#3657c8;font-size:14px}.footer{position:fixed;right:0;bottom:0;left:0;z-index:3;max-width:430px;margin:auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #e4e8f0;background:#fff}.footer :deep(.van-button){min-height:44px}.dialog-note{margin:0;padding:0 16px;color:#536078;line-height:1.5}.dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px}.dialog-actions :deep(.van-button){min-height:44px}.state{display:grid;min-height:60vh;place-items:center}
</style>
